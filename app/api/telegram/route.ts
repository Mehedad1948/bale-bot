import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string;
const TARGET_URL = process.env.TARGET_URL as string;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   TYPES
========================= */
type Update = {
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
   TELEGRAM
========================= */
async function send(chatId: number, text: string, extra?: any) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    ...extra,
  });
}

/* =========================
   NORMALIZE URL
========================= */
function normalizeUrl(href: string) {
  if (!href) return null;

  if (href.startsWith("http")) return href;

  return `${TARGET_URL.replace(/\/$/, "")}/${href.replace(/^\//, "")}`;
}

/* =========================
   FETCH SEARCH
========================= */
async function fetchSearch(query: string) {
  const params = new URLSearchParams();

  params.append("req", query);

  ["t", "a", "s", "y", "p", "i"].forEach(v => params.append("columns[]", v));
  ["f", "e", "s", "a", "p", "w"].forEach(v => params.append("objects[]", v));
  ["l", "c", "f", "a", "m", "r", "s"].forEach(v => params.append("topics[]", v));

  params.append("res", "25");
  params.append("filesuns", "all");
  params.append("curtab", "e");

  const url = `${TARGET_URL}/index.php?${params.toString()}`;

  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const $ = cheerio.load(data);

  const results: { title: string; url: string }[] = [];

  $("tbody tr").each((_, el) => {
    const row = $(el);

    // IMPORTANT: only main result tables, skip nested UI tables
    if (row.closest(".navbar, nav, header").length > 0) return;

    const cell = row.find("td").eq(1);

    const a = cell.find("a[href*='series.php']").first();

    const title = a.text().trim();
    const href = a.attr("href");

    const full = href ? normalizeUrl(href) : null;

    if (!title || !full) return;

    results.push({ title, url: full });
  });

  return results;
}

/* =========================
   FETCH DETAIL PAGE (FIXED)
   - excludes navbar links
   - excludes junk UI links
========================= */
async function fetchPage(url: string) {
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const $ = cheerio.load(data);

  const items: { title: string; url: string }[] = [];

  $("a[href]").each((_, el) => {
    const el$ = $(el);

    // 🚫 HARD FILTER: skip navbar/menu/header areas
    if (
      el$.closest(".navbar, nav, header, .menu, .top, .footer").length > 0
    ) return;

    const href = el$.attr("href");
    const text = el$.text().trim();

    if (!href || text.length < 2) return;

    // 🚫 filter junk links
    if (
      href.startsWith("javascript") ||
      href === "#" ||
      href.includes("mailto:")
    ) return;

    const full = normalizeUrl(href);

    if (!full) return;

    items.push({
      title: text,
      url: full,
    });
  });

  // remove duplicates
  const unique = Array.from(
    new Map(items.map(i => [i.url, i])).values()
  );

  return unique.slice(0, 15);
}

/* =========================
   RENDER PAGE
========================= */
async function render(chatId: number, url: string) {
  const items = await fetchPage(url);

  if (items.length === 0) {
    await send(chatId, "No further links found.");
    return;
  }

  const message = items
    .map((i, idx) => `${idx + 1}. ${i.title}`)
    .join("\n");

  const keyboard = {
    inline_keyboard: [
      ...items.map(i => [
        {
          text: i.title.slice(0, 35),
          callback_data: `open:${encodeURIComponent(i.url)}`,
        },
      ]),
      [
        {
          text: "⬅ Back",
          callback_data: "back",
        },
      ],
    ],
  };

  await send(chatId, message, {
    reply_markup: keyboard,
  });
}

/* =========================
   HANDLER
========================= */
export async function POST(req: Request) {
  const body: Update = await req.json();

  const chatId =
    body.message?.chat.id ||
    body.callback_query?.message.chat.id;

  if (!chatId) return NextResponse.json({ ok: true });

  const text = body.message?.text;
  const cb = body.callback_query?.data;

  /* =========================
     SEARCH
  ========================= */
  if (text?.startsWith("/search")) {
    const query = text.replace("/search", "").trim();

    const results = await fetchSearch(query);

    if (results.length === 0) {
      await send(chatId, "No results found.");
      return NextResponse.json({ ok: true });
    }

    const keyboard = {
      inline_keyboard: results.slice(0, 6).map(r => [
        {
          text: r.title.slice(0, 35),
          callback_data: `open:${encodeURIComponent(r.url)}`,
        },
      ]),
    };

    await send(
      chatId,
      results.map((r, i) => `${i + 1}. ${r.title}`).join("\n"),
      { reply_markup: keyboard }
    );

    return NextResponse.json({ ok: true });
  }

  /* =========================
     OPEN PAGE (DRILL DOWN)
  ========================= */
  if (cb?.startsWith("open:")) {
    const url = decodeURIComponent(cb.replace("open:", ""));
    await render(chatId, url);
    return NextResponse.json({ ok: true });
  }

  /* =========================
     BACK NOT IMPLEMENTED YET
  ========================= */
  if (cb === "back") {
    await send(chatId, "Back navigation not stored in this version.");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}