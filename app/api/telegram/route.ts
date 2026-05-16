/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string;
const TARGET_URL = process.env.TARGET_URL as string;

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

type TelegramMessage = {
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    data: string;
    message: {
      chat: { id: number };
    };
  };
};

/* =========================
   TELEGRAM SENDER
========================= */
async function sendTelegramMessage(chatId: number, text: string, extra?: any) {
  try {
    console.log("[TELEGRAM] Sending message:", chatId);

    await axios.post(
      TELEGRAM_API_URL,
      {
        chat_id: chatId,
        text,
        ...extra, // inline keyboard support
      },
      { timeout: 15000 }
    );

    console.log("[TELEGRAM] Sent");
  } catch (error) {
    console.error("[TELEGRAM_ERROR]", error);
  }
}

/* =========================
   FETCH + PARSE LOGIC
========================= */
async function fetchResults(query: string) {
  const params = new URLSearchParams();

  params.append("req", query);

  ["t", "a", "s", "y", "p", "i"].forEach(v => params.append("columns[]", v));
  ["f", "e", "s", "a", "p", "w"].forEach(v => params.append("objects[]", v));
  ["l", "c", "f", "a", "m", "r", "s"].forEach(v => params.append("topics[]", v));

  params.append("res", "25");
  params.append("filesuns", "all");
  params.append("curtab", "e");

  const url = `${TARGET_URL}/index.php?${params.toString()}`;

  console.log("[FETCH_URL]", url);

  const { data: html } = await axios.get(url, {
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const $ = cheerio.load(html);

  const results: { title: string; link: string; publisher: string }[] = [];

  $("tbody tr").each((_, el) => {
    const row = $(el);

    const titleCell = row.find("td").eq(1);
    const a = titleCell.find("a[href^='series.php']").first();

    const title = a.text().trim();
    const href = a.attr("href");

    if (!title || !href) return;

    const publisher = row.find("td").eq(3).text().trim();

    const fullLink = href.startsWith("http")
      ? href
      : `${TARGET_URL.replace(/\/$/, "")}/${href.replace(/^\//, "")}`;

    results.push({
      title,
      link: fullLink,
      publisher: publisher || "Unknown",
    });
  });

  return results;
}

/* =========================
   MAIN HANDLER
========================= */
export async function POST(req: Request): Promise<NextResponse> {
  console.log("==================================");
  console.log("[WEBHOOK] Incoming update");

  try {
    const body: TelegramMessage = await req.json();

    const chatId =
      body.message?.chat.id ||
      body.callback_query?.message.chat.id;

    const text = body.message?.text;
    const callback = body.callback_query?.data;

    if (!chatId) {
      return NextResponse.json({ ok: false });
    }

    /* =========================
       HANDLE CALLBACK (BUTTON)
    ========================= */
    if (callback?.startsWith("load:")) {
      const query = decodeURIComponent(callback.replace("load:", ""));

      console.log("[CALLBACK_QUERY]", query);

      await sendTelegramMessage(chatId, "Loading full results...");

      const results = await fetchResults(query);

      const message =
        results
          .slice(0, 15)
          .map((r, i) =>
            `${i + 1}. ${r.title}\n${r.publisher}\n${r.link}`
          )
          .join("\n\n") || "No results found";

      await sendTelegramMessage(chatId, message);

      return NextResponse.json({ ok: true });
    }

    /* =========================
       HANDLE /SEARCH
    ========================= */
    if (!text?.startsWith("/search")) {
      await sendTelegramMessage(chatId, "Use /search query");
      return NextResponse.json({ ok: true });
    }

    const query = text.replace(/^\/search\s*/i, "").trim();

    if (!query) {
      await sendTelegramMessage(chatId, "Send: /search mathematics");
      return NextResponse.json({ ok: true });
    }

    console.log("[QUERY]", query);

    const results = await fetchResults(query);

    const preview = results.slice(0, 5);

    const message =
      preview
        .map((r, i) =>
          `${i + 1}. ${r.title}\n${r.publisher}\n${r.link}`
        )
        .join("\n\n") || "No results found";

    await sendTelegramMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📚 Load more results",
              callback_data: `load:${encodeURIComponent(query)}`,
            },
          ],
        ],
      },
    });

    return NextResponse.json({
      ok: true,
      count: results.length,
    });
  } catch (error) {
    console.error("[FATAL]", error);
    return NextResponse.json(
      { ok: false },
      { status: 500 }
    );
  }
}