import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string;
const TARGET_URL = process.env.TARGET_URL as string;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   MEMORY (replace with Redis in prod)
========================= */
const navStack = new Map<number, string[]>();

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
   TELEGRAM SEND
========================= */
async function send(chatId: number, text: string, extra?: any) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    ...extra,
  });
}

/* =========================
   STACK HELPERS
========================= */
function push(chatId: number, url: string) {
  const stack = navStack.get(chatId) || [];
  stack.push(url);
  navStack.set(chatId, stack);
}

function pop(chatId: number) {
  const stack = navStack.get(chatId) || [];
  stack.pop();
  navStack.set(chatId, stack);
}

function current(chatId: number) {
  const stack = navStack.get(chatId) || [];
  return stack[stack.length - 1];
}

/* =========================
   SEARCH
========================= */
async function fetchSearch(query: string) {
  const params = new URLSearchParams();

  params.append("req", query);

  ["t", "a", "s", "y", "p", "i"].forEach(v =>
    params.append("columns[]", v)
  );
  ["f", "e", "s", "a", "p", "w"].forEach(v =>
    params.append("objects[]", v)
  );
  ["l", "c", "f", "a", "m", "r", "s"].forEach(v =>
    params.append("topics[]", v)
  );

  params.append("res", "25");
  params.append("filesuns", "all");
  params.append("curtab", "e");

  const url = `${TARGET_URL}/index.php?${params.toString()}`;

  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results: any[] = [];

  $("tbody tr").each((_, el) => {
    const cell = $(el).find("td").eq(1);
    const link = cell.find("a[href^='series.php']").first();

    const title = link.text().trim();
    const href = link.attr("href");

    if (!title || !href) return;

    const full = href.startsWith("http")
      ? href
      : `${TARGET_URL}/${href}`;

    results.push({ title, url: full });
  });

  return results;
}

/* =========================
   FETCH ANY PAGE LINKS (FIXED)
   - EXCLUDES NAVBAR LINKS
========================= */
async function fetchPage(url: string) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const items: { title: string; url: string }[] = [];

  $("a[href]").each((_, el) => {
    const elAny = $(el);

    const href = elAny.attr("href");
    const title = elAny.text().trim();

    if (!href || title.length < 2) return;

    // ❌ skip junk links
    if (
      href.startsWith("javascript") ||
      href === "#"
    ) return;

    // ❌ SKIP ANY LINK INSIDE NAVBAR
    if (
      elAny.closest(".navbar").length > 0 ||
      elAny.closest("nav").length > 0
    ) return;

    const full = href.startsWith("http")
      ? href
      : `${TARGET_URL}/${href.replace(/^\//, "")}`;

    items.push({
      title,
      url: full,
    });
  });

  return items.slice(0, 10);
}

/* =========================
   RENDER NODE
========================= */
async function render(chatId: number, url: string) {
  push(chatId, url);

  const items = await fetchPage(url);

  if (items.length === 0) {
    await send(chatId, "No further links.");
    return;
  }

  const message = items
    .map((i, idx) => `${idx + 1}. ${i.title}`)
    .join("\n");

  const keyboard = {
    inline_keyboard: [
      ...items.map((i) => [
        {
          text: i.title.slice(0, 30),
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
   MAIN HANDLER
========================= */
export async function POST(req: Request) {
  const body: Update = await req.json();

  const chatId =
    body.message?.chat.id ||
    body.callback_query?.message.chat.id;

  if (!chatId) return NextResponse.json({ ok: true });

  const cb = body.callback_query?.data;
  const text = body.message?.text;

  /* =========================
     BACK BUTTON
  ========================= */
  if (cb === "back") {
    pop(chatId);

    const prev = current(chatId);

    if (!prev) {
      await send(chatId, "No previous page.");
      return NextResponse.json({ ok: true });
    }

    await send(chatId, "⬅ Going back...");
    await render(chatId, prev);

    return NextResponse.json({ ok: true });
  }

  /* =========================
     OPEN NODE
  ========================= */
  if (cb?.startsWith("open:")) {
    const url = decodeURIComponent(cb.replace("open:", ""));
    await render(chatId, url);
    return NextResponse.json({ ok: true });
  }

  /* =========================
     SEARCH
  ========================= */
  if (text?.startsWith("/search")) {
    const query = text.replace("/search", "").trim();

    const results = await fetchSearch(query);

    const keyboard = {
      inline_keyboard: results.slice(0, 5).map((r) => [
        {
          text: r.title.slice(0, 30),
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

  return NextResponse.json({ ok: true });
}