import { createHash, timingSafeEqual } from "node:crypto";

const TELEGRAM_API_URL = "https://api.telegram.org";

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
  const telegramToken = process.env.TELEGRAM_TOKEN?.trim();
  const proxyToken =
    process.env.GITLAB_TELEGRAM_PROXY_TOKEN?.trim() || telegramToken;

  if (!telegramToken || !proxyToken) {
    return jsonError(500, "The GitLab Telegram proxy is not configured.");
  }

  const { botToken } = await context.params;
  const receivedToken = botToken.startsWith("bot")
    ? botToken.slice(3)
    : "";

  if (!receivedToken || !tokensMatch(receivedToken, proxyToken)) {
    return jsonError(401, "Unauthorized.");
  }

  try {
    const upstreamResponse = await fetch(
      `${TELEGRAM_API_URL}/bot${telegramToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") || "application/json",
        },
        body: await request.arrayBuffer(),
        cache: "no-store",
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

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch {
    return jsonError(502, "Telegram API is unreachable through the proxy.");
  }
}
