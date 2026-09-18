import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const TELEGRAM_API_URL = "https://api.telegram.org";

type LogLevel = "info" | "warn" | "error";

type TelegramErrorResponse = {
  ok?: boolean;
  error_code?: number;
  description?: string;
};

function proxyLog(
  level: LogLevel,
  event: string,
  requestId: string,
  details: Record<string, unknown> = {}
) {
  console[level](
    "[gitlab-telegram-proxy]",
    JSON.stringify({ event, requestId, ...details })
  );
}

function summarizeRequestBody(body: ArrayBuffer) {
  const summary: Record<string, unknown> = {
    byteLength: body.byteLength,
    validJson: false,
  };

  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return summary;
    }

    const payload = parsed as Record<string, unknown>;
    summary.validJson = true;
    summary.fields = Object.keys(payload).sort();
    summary.chatIdType = typeof payload.chat_id;
    summary.textType = typeof payload.text;
    summary.textLength =
      typeof payload.text === "string" ? payload.text.length : null;
    summary.parseMode =
      typeof payload.parse_mode === "string" ? payload.parse_mode : null;
    summary.hasMessageThreadId = "message_thread_id" in payload;
  } catch {
    // The upstream Telegram response will explain malformed JSON to GitLab.
  }

  return summary;
}

function readTelegramError(body: string): TelegramErrorResponse | null {
  try {
    const parsed = JSON.parse(body) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as TelegramErrorResponse)
      : null;
  } catch {
    return null;
  }
}

function jsonError(status: number, description: string) {
  return Response.json(
    {
      ok: false,
      description,
    },
    { status }
  );
}

function tokensMatch(received: string, expected: string) {
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(receivedDigest, expectedDigest);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ botToken: string }> }
) {
  const requestId = randomUUID();
  const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
  const proxyToken =
    process.env.GITLAB_TELEGRAM_PROXY_TOKEN?.trim() || telegramToken;

  proxyLog("info", "request.received", requestId, {
    method: request.method,
    routeIncludesSendMessage: new URL(request.url).pathname.endsWith(
      "/sendMessage"
    ),
    contentType: request.headers.get("content-type"),
    contentLength: request.headers.get("content-length"),
    userAgent: request.headers.get("user-agent"),
    vercelRequestId: request.headers.get("x-vercel-id"),
  });

  if (!telegramToken || !proxyToken) {
    proxyLog("error", "configuration.invalid", requestId, {
      telegramTokenConfigured: Boolean(telegramToken),
      proxyTokenConfigured: Boolean(proxyToken),
    });

    return jsonError(500, "The GitLab Telegram proxy is not configured.");
  }

  const { botToken } = await context.params;
  const receivedToken = botToken.startsWith("bot")
    ? botToken.slice(3)
    : "";
  const authorized =
    Boolean(receivedToken) && tokensMatch(receivedToken, proxyToken);

  proxyLog(authorized ? "info" : "warn", "authentication.checked", requestId, {
    hasBotPrefix: botToken.startsWith("bot"),
    tokenPresent: Boolean(receivedToken),
    authorized,
    usingSeparateProxyToken: Boolean(
      process.env.GITLAB_TELEGRAM_PROXY_TOKEN?.trim()
    ),
  });

  if (!authorized) {
    return jsonError(401, "Unauthorized.");
  }

  try {
    const requestBody = await request.arrayBuffer();
    proxyLog("info", "request.body", requestId, summarizeRequestBody(requestBody));

    const startedAt = Date.now();
    const upstreamResponse = await fetch(
      `${TELEGRAM_API_URL}/bot${telegramToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") || "application/json",
        },
        body: requestBody,
        cache: "no-store",
      }
    );
    const upstreamBody = await upstreamResponse.text();
    const telegramError = readTelegramError(upstreamBody);

    proxyLog(
      upstreamResponse.ok ? "info" : "warn",
      "telegram.response",
      requestId,
      {
        durationMs: Date.now() - startedAt,
        status: upstreamResponse.status,
        telegramOk: telegramError?.ok ?? null,
        telegramErrorCode: telegramError?.error_code ?? null,
        telegramDescription: upstreamResponse.ok
          ? null
          : telegramError?.description || "Non-JSON error response",
        retryAfter: upstreamResponse.headers.get("retry-after"),
      }
    );

    const headers = new Headers();
    const contentType = upstreamResponse.headers.get("content-type");
    const retryAfter = upstreamResponse.headers.get("retry-after");

    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    if (retryAfter) {
      headers.set("Retry-After", retryAfter);
    }

    return new Response(upstreamBody, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch (error) {
    proxyLog("error", "telegram.request_failed", requestId, {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonError(502, "Telegram API is unreachable through the proxy.");
  }
}
