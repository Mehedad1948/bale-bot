type JsonPrimitive = string | number | boolean | null;

interface JsonRecord {
  [key: string]: JsonValue;
}

type JsonValue = JsonPrimitive | JsonRecord | JsonValue[];

const VALID_PARSE_MODES = new Set(["Markdown", "MarkdownV2", "HTML"]);
const VALID_INLINE_BUTTON_FIELDS = new Set([
  "url",
  "callback_data",
  "web_app",
  "login_url",
  "switch_inline_query",
  "switch_inline_query_current_chat",
  "switch_inline_query_chosen_chat",
  "copy_text",
  "callback_game",
  "pay",
]);

export class TelegramValidationError extends Error {
  status = 400;
}

export class TelegramApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type TelegramProxyRequestBody = {
  message?: string;
  text?: string;
  parseMode?: string;
  parse_mode?: string;
  disableWebPagePreview?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  message_thread_id?: number;
  reply_to_message_id?: number;
  replyMarkup?: JsonRecord;
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

type TelegramSendMessagePayload = {
  chat_id: string;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  disable_notification?: boolean;
  protect_content?: boolean;
  message_thread_id?: number;
  reply_to_message_id?: number;
  reply_markup?: JsonRecord;
  link_preview_options?: JsonRecord;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIntegerField(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TelegramValidationError(`"${fieldName}" must be an integer.`);
  }
}

function validateBooleanField(value: unknown, fieldName: string) {
  if (typeof value !== "boolean") {
    throw new TelegramValidationError(`"${fieldName}" must be a boolean.`);
  }
}

function normalizeParseMode(body: TelegramProxyRequestBody) {
  const parseMode = body.parseMode ?? body.parse_mode;

  if (typeof parseMode === "undefined") {
    return undefined;
  }

  if (typeof parseMode !== "string" || !VALID_PARSE_MODES.has(parseMode)) {
    throw new TelegramValidationError(
      '"parseMode" must be one of "Markdown", "MarkdownV2", or "HTML".'
    );
  }

  return parseMode as TelegramSendMessagePayload["parse_mode"];
}

function validateInlineKeyboardButton(button: unknown) {
  if (!isJsonRecord(button)) {
    throw new TelegramValidationError(
      '"replyMarkup.inline_keyboard" buttons must be objects.'
    );
  }

  if (typeof button.text !== "string" || button.text.trim().length === 0) {
    throw new TelegramValidationError(
      '"replyMarkup.inline_keyboard" buttons must include a non-empty "text" field.'
    );
  }

  const actionCount = Object.keys(button).filter((key) =>
    VALID_INLINE_BUTTON_FIELDS.has(key)
  ).length;

  if (actionCount !== 1) {
    throw new TelegramValidationError(
      '"replyMarkup.inline_keyboard" buttons must include exactly one Telegram button action field.'
    );
  }

  if ("url" in button && typeof button.url !== "string") {
    throw new TelegramValidationError('"replyMarkup.inline_keyboard[].url" must be a string.');
  }

  if ("callback_data" in button && typeof button.callback_data !== "string") {
    throw new TelegramValidationError(
      '"replyMarkup.inline_keyboard[].callback_data" must be a string.'
    );
  }
}

function normalizeReplyMarkup(body: TelegramProxyRequestBody) {
  const replyMarkup = body.replyMarkup ?? body.reply_markup;

  if (typeof replyMarkup === "undefined") {
    return undefined;
  }

  if (!isJsonRecord(replyMarkup)) {
    throw new TelegramValidationError('"replyMarkup" must be a JSON object.');
  }

  if ("inline_keyboard" in replyMarkup) {
    const inlineKeyboard = replyMarkup.inline_keyboard;

    if (!Array.isArray(inlineKeyboard)) {
      throw new TelegramValidationError(
        '"replyMarkup.inline_keyboard" must be an array of button rows.'
      );
    }

    inlineKeyboard.forEach((row) => {
      if (!Array.isArray(row)) {
        throw new TelegramValidationError(
          '"replyMarkup.inline_keyboard" must be an array of button rows.'
        );
      }

      row.forEach((button) => {
        validateInlineKeyboardButton(button);
      });
    });
  }

  return replyMarkup;
}

function normalizeLinkPreviewOptions(body: TelegramProxyRequestBody) {
  if (typeof body.disableWebPagePreview !== "undefined") {
    validateBooleanField(body.disableWebPagePreview, "disableWebPagePreview");

    if (typeof body.link_preview_options !== "undefined") {
      throw new TelegramValidationError(
        'Use either "disableWebPagePreview" or "link_preview_options", not both.'
      );
    }

    return { is_disabled: body.disableWebPagePreview };
  }

  if (typeof body.link_preview_options === "undefined") {
    return undefined;
  }

  if (!isJsonRecord(body.link_preview_options)) {
    throw new TelegramValidationError('"link_preview_options" must be a JSON object.');
  }

  return body.link_preview_options;
}

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
): TelegramSendMessagePayload {
  if (!chatId.trim()) {
    throw new TelegramValidationError('"chatId" must be a non-empty string.');
  }

  const message = extractTelegramMessage(body);

  if (!message) {
    throw new TelegramValidationError(
      'Request body must include a non-empty "message" or "text" field.'
    );
  }

  if (
    typeof body.disable_notification !== "undefined" &&
    typeof body.disable_notification !== "boolean"
  ) {
    throw new TelegramValidationError('"disable_notification" must be a boolean.');
  }

  if (
    typeof body.protect_content !== "undefined" &&
    typeof body.protect_content !== "boolean"
  ) {
    throw new TelegramValidationError('"protect_content" must be a boolean.');
  }

  if (typeof body.message_thread_id !== "undefined") {
    validateIntegerField(body.message_thread_id, "message_thread_id");
  }

  if (typeof body.reply_to_message_id !== "undefined") {
    validateIntegerField(body.reply_to_message_id, "reply_to_message_id");
  }

  const parseMode = normalizeParseMode(body);
  const replyMarkup = normalizeReplyMarkup(body);
  const linkPreviewOptions = normalizeLinkPreviewOptions(body);

  return {
    chat_id: chatId,
    text: message,
    ...(parseMode ? { parse_mode: parseMode } : {}),
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
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(linkPreviewOptions ? { link_preview_options: linkPreviewOptions } : {}),
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

  const data = (await response.json().catch(() => null)) as TelegramApiResponse | null;

  if (!response.ok || !data?.ok) {
    throw new TelegramApiError(
      data?.description || "Telegram sendMessage request failed.",
      response.status || 502
    );
  }

  return {
    chatId,
    messageId: data.result?.message_id ?? null,
  };
}
