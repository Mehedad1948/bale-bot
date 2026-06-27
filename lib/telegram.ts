type JsonRecord = Record<string, unknown>;

export type TelegramProxyRequestBody = {
  message?: string;
  text?: string;
  parse_mode?: string;
  disable_notification?: boolean;
  protect_content?: boolean;
  message_thread_id?: number;
  reply_to_message_id?: number;
  reply_markup?: JsonRecord;
  link_preview_options?: JsonRecord;
};

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
};

export function extractTelegramMessage(body: TelegramProxyRequestBody): string | null {
  const candidate =
    typeof body.message === "string"
      ? body.message.trim()
      : typeof body.text === "string"
        ? body.text.trim()
        : "";

  return candidate.length > 0 ? candidate : null;
}

export function buildTelegramSendMessagePayload(
  chatId: string,
  body: TelegramProxyRequestBody
) {
  const message = extractTelegramMessage(body);

  if (!message) {
    throw new Error('Request body must include a non-empty "message" or "text" field.');
  }

  return {
    chat_id: chatId,
    text: message,
    ...(body.parse_mode ? { parse_mode: body.parse_mode } : {}),
    ...(typeof body.disable_notification === "boolean"
      ? { disable_notification: body.disable_notification }
      : {}),
    ...(typeof body.protect_content === "boolean"
      ? { protect_content: body.protect_content }
      : {}),
    ...(typeof body.message_thread_id === "number"
      ? { message_thread_id: body.message_thread_id }
      : {}),
    ...(typeof body.reply_to_message_id === "number"
      ? { reply_to_message_id: body.reply_to_message_id }
      : {}),
    ...(body.reply_markup ? { reply_markup: body.reply_markup } : {}),
    ...(body.link_preview_options
      ? { link_preview_options: body.link_preview_options }
      : {}),
  };
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  body: TelegramProxyRequestBody
) {
  const payload = buildTelegramSendMessagePayload(chatId, body);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as TelegramApiResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.description || "Telegram sendMessage request failed.");
  }

  return {
    chatId,
    messageId: data.result?.message_id ?? null,
  };
}
