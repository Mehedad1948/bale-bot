import { NextResponse } from "next/server";

import { sendTelegramMessage, type TelegramProxyRequestBody } from "@/lib/telegram";

const TELEGRAM_PROXY_SECRET = process.env.TELEGRAM_PROXY_SECRET;
const DEFAULT_TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

function getBearerToken(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }

  return headerValue.startsWith("Bearer ") ? headerValue.slice(7).trim() : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  if (!TELEGRAM_PROXY_SECRET) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing TELEGRAM_PROXY_SECRET.",
      },
      { status: 500 }
    );
  }

  const proxySecret = request.headers.get("x-telegram-proxy-secret");

  if (proxySecret !== TELEGRAM_PROXY_SECRET) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized proxy request.",
      },
      { status: 401 }
    );
  }

  try {
    const { chatId } = await context.params;
    const headerToken =
      request.headers.get("x-telegram-bot-token") ??
      getBearerToken(request.headers.get("authorization"));
    const telegramToken = headerToken?.trim() || DEFAULT_TELEGRAM_TOKEN;

    if (!chatId.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "The chatId route param is required.",
        },
        { status: 400 }
      );
    }

    if (!telegramToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing Telegram bot token. Set TELEGRAM_TOKEN or send x-telegram-bot-token.",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as TelegramProxyRequestBody;
    const result = await sendTelegramMessage(telegramToken, chatId, body);

    return NextResponse.json({
      ok: true,
      forwardedTo: result.chatId,
      messageId: result.messageId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    const status = message.includes('non-empty "message" or "text"') ? 400 : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status }
    );
  }
}
