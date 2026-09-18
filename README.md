# Telegram Proxy

This project exposes a secured Telegram proxy endpoint for server-to-server notifications:

```text
POST /api/telegram/proxy/:chatId
```

## Environment Variables

```env
TELEGRAM_PROXY_SECRET=your-shared-secret
TELEGRAM_TOKEN=optional-default-bot-token
TELEGRAM_BOT_CHAT_ID=optional-default-chat-id-for-/api/telegram
GITLAB_TELEGRAM_PROXY_TOKEN=optional-separate-token-entered-in-gitlab
```

## GitLab Telegram Integration

GitLab's Telegram integration cannot send the custom secret header required by
the general-purpose proxy above. A separate Telegram Bot API-compatible endpoint
is available for it:

```text
POST /api/telegram/gitlab/bot<TOKEN>/sendMessage
```

Configure the GitLab integration as follows:

- **Hostname:** `https://your-domain/api/telegram/gitlab`
- **New token:** the value of `GITLAB_TELEGRAM_PROXY_TOKEN`
- **Channel identifier:** the target Telegram chat or channel ID
- **Message thread ID:** optional Telegram forum topic ID

Set both `TELEGRAM_TOKEN` (the real Telegram bot token) and
`GITLAB_TELEGRAM_PROXY_TOKEN` (a separate random secret) in Vercel. GitLab
appends `/bot<TOKEN>/sendMessage` to the hostname; the route verifies that proxy
token and substitutes the real bot token before forwarding the request to
Telegram.

If `GITLAB_TELEGRAM_PROXY_TOKEN` is omitted, the route falls back to using
`TELEGRAM_TOKEN` for compatibility, so the real bot token must also be entered
in GitLab. A separate proxy token is recommended because path values can appear
in HTTP access logs.

## Headers

- `x-telegram-proxy-secret`: required
- `x-telegram-bot-token`: optional if `TELEGRAM_TOKEN` is set on this app

## Request Body

Backward-compatible body:

```json
{
  "message": "Build completed successfully"
}
```

Enhanced body:

```json
{
  "message": "Next.js build failed\n\n```bash\nerror log here\n```",
  "parseMode": "Markdown",
  "disableWebPagePreview": true,
  "replyMarkup": {
    "inline_keyboard": [
      [
        {
          "text": "Open Build",
          "url": "https://example.com/build/123"
        }
      ]
    ]
  }
}
```

Supported enhanced fields:

- `parseMode`: `Markdown`, `MarkdownV2`, or `HTML`
- `disableWebPagePreview`: boolean
- `replyMarkup`: Telegram `reply_markup` object

Legacy snake_case fields remain supported:

- `parse_mode`
- `reply_markup`
- `link_preview_options`

## Examples

### Plain Text Message

```bash
curl -X POST "https://your-domain/api/telegram/proxy/-1001234567890" \
  -H "Content-Type: application/json" \
  -H "x-telegram-proxy-secret: YOUR_PROXY_SECRET" \
  -H "x-telegram-bot-token: YOUR_BOT_TOKEN" \
  -d '{
    "message": "Build completed successfully"
  }'
```

### Markdown Code Block Message

```bash
curl -X POST "https://your-domain/api/telegram/proxy/-1001234567890" \
  -H "Content-Type: application/json" \
  -H "x-telegram-proxy-secret: YOUR_PROXY_SECRET" \
  -H "x-telegram-bot-token: YOUR_BOT_TOKEN" \
  -d '{
    "message": "Next.js build failed\n\n```bash\nnpm run build\nError: Cannot find module\n```",
    "parseMode": "Markdown"
  }'
```

### HTML pre/code Message

```bash
curl -X POST "https://your-domain/api/telegram/proxy/-1001234567890" \
  -H "Content-Type: application/json" \
  -H "x-telegram-proxy-secret: YOUR_PROXY_SECRET" \
  -H "x-telegram-bot-token: YOUR_BOT_TOKEN" \
  -d '{
    "message": "<b>Next.js build failed</b>\n<pre><code>npm run build\nError: Cannot find module</code></pre>",
    "parseMode": "HTML"
  }'
```

### Message With Inline Keyboard Button

```bash
curl -X POST "https://your-domain/api/telegram/proxy/-1001234567890" \
  -H "Content-Type: application/json" \
  -H "x-telegram-proxy-secret: YOUR_PROXY_SECRET" \
  -H "x-telegram-bot-token: YOUR_BOT_TOKEN" \
  -d '{
    "message": "Build failed. Open the build details.",
    "parseMode": "Markdown",
    "disableWebPagePreview": true,
    "replyMarkup": {
      "inline_keyboard": [
        [
          {
            "text": "Open Build",
            "url": "https://example.com/build/123"
          }
        ]
      ]
    }
  }'
```

## Notes

- The proxy does not log secrets or bot tokens.
- Invalid `parseMode`, malformed JSON, and malformed `replyMarkup` return `400`.
- Telegram API failures are returned without exposing secrets.
