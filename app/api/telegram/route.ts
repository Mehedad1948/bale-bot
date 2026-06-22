import { NextResponse } from "next/server";

type TelegramRequestBody = {
  message?: string;
  text?: string;
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_BOT_CHAT_ID = process.env.TELEGRAM_BOT_CHAT_ID;

async function sendTelegramMessage(message: string) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_BOT_CHAT_ID,
        text: message,
      }),
    }
  );

  const data = (await response.json()) as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || !data.ok) {
    throw new Error(data.description || "Telegram sendMessage request failed.");
  }
}

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
    const body = (await request.json()) as TelegramRequestBody;
    const message = body.message?.trim() || body.text?.trim();

    if (!message) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Request body must include a non-empty "message" or "text" field.',
        },
        { status: 400 }
      );
    }

    await sendTelegramMessage(message);

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
