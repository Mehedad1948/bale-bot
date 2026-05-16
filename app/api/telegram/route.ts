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
   FETCH SEARCH RESULTS
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
    const row = $(el);

    const cell = row.find("td").eq(1);
    const link = cell.find("a[href^='series.php']").first();

    const title = link.text().trim();
    const href = link.attr("href");

    if (!title || !href) return;

    const full = href.startsWith("http")
      ? href
      : `${TARGET_URL}/${href}`;

    results.push({
      title,
      url: full,
    });
  });

  return results;
}

/* =========================
   FETCH DETAIL PAGE LINKS
========================= */
async function fetchDetailPage(url: string) {
  const { data } = await axios.get(url);

  const $ = cheerio.load(data);

  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();

    if (!href) return;

    // filter junk links
    if (
      href.includes("javascript") ||
      href === "#" ||
      text.length < 2
    )
      return;

    const full = href.startsWith("http")
      ? href
      : `${TARGET_URL}/${href}`;

    links.push(`${text || "link"}\n${full}`);
  });

  return links.slice(0, 20);
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

  /* =========================
     CALLBACK HANDLER
  ========================= */
  const cb = body.callback_query?.data;

  if (cb?.startsWith("open:")) {
    const url = decodeURIComponent(cb.replace("open:", ""));

    await send(chatId, "Fetching page...");

    const links = await fetchDetailPage(url);

    const msg =
      links.join("\n\n") || "No links found";

    await send(chatId, msg);

    return NextResponse.json({ ok: true });
  }

  /* =========================
     SEARCH HANDLER
  ========================= */
  const text = body.message?.text;

  if (!text?.startsWith("/search")) {
    await send(chatId, "Use /search query");
    return NextResponse.json({ ok: true });
  }

  const query = text.replace("/search", "").trim();

  if (!query) {
    await send(chatId, "Send /search something");
    return NextResponse.json({ ok: true });
  }

  const results = await fetchSearch(query);

  const preview = results.slice(0, 5);

  const message = preview
    .map(
      (r, i) => `${i + 1}. ${r.title}\n${r.url}`
    )
    .join("\n\n");

  /* =========================
     INLINE BUTTONS
  ========================= */
  const keyboard = {
    inline_keyboard: [
      ...preview.map((r) => [
        {
          text: "📄 Open",
          callback_data: `open:${encodeURIComponent(r.url)}`,
        },
      ]),
      [
        {
          text: "📚 Load more",
          callback_data: `more:${encodeURIComponent(query)}`,
        },
      ],
    ],
  };

  await send(chatId, message, {
    reply_markup: keyboard,
  });

  return NextResponse.json({ ok: true });
}