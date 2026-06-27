import { NextResponse } from "next/server";

import { sendTelegramMessage, type TelegramProxyRequestBody } from "@/lib/telegram";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_BOT_CHAT_ID = process.env.TELEGRAM_BOT_CHAT_ID;

export async function POST(request: Request) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_BOT_CHAT_ID) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing TELEGRAM_TOKEN or TELEGRAM_BOT_CHAT_ID.",
      },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as TelegramProxyRequestBody;
    await sendTelegramMessage(TELEGRAM_TOKEN, TELEGRAM_BOT_CHAT_ID, body);

    return NextResponse.json({
      ok: true,
      forwardedTo: TELEGRAM_BOT_CHAT_ID,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
