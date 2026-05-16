import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string;
const TARGET_URL = process.env.TARGET_URL as string;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   MEMORY STORE (replace with Redis later)
========================= */
const sessionStore = new Map<
  number,
  {
    results?: string[];
    pageItems?: { title: string; url: string }[];
    pageUrl?: string;
  }
>();

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
   TELEGRAM SEND (SAFE)
========================= */
async function send(chatId: number, text: string, extra?: any) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      ...extra,
    });
  } catch (e: any) {
    console.error("Telegram error:", e?.response?.data || e.message);
  }
}

/* =========================
   SEARCH PAGE
========================= */
async function fetchSearch(query: string) {
  const params = new URLSearchParams();

  params.append("req", query);

  ["t", "a", "s", "y", "p", "i"].forEach((v) =>
    params.append("columns[]", v)
  );
  ["f", "e", "s", "a", "p", "w"].forEach((v) =>
    params.append("objects[]", v)
  );
  ["l", "c", "f", "a", "m", "r", "s"].forEach((v) =>
    params.append("topics[]", v)
  );

  params.append("res", "25");

  const url = `${TARGET_URL}/index.php?${params.toString()}`;

  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results: { title: string; url: string }[] = [];

  $("tbody tr").each((_, el) => {
    const link = $(el)
      .find("td")
      .eq(1)
      .find("a[href^='series.php']")
      .first();

    const title = link.text().trim();
    const href = link.attr("href");

    if (!title || !href) return;

    results.push({
      title,
      url: href.startsWith("http")
        ? href
        : `${TARGET_URL}/${href}`,
    });
  });

  return results;
}

/* =========================
   DETAIL PAGE (FIXED)
   - excludes navbar
   - extracts structured links only
========================= */
async function fetchDetailPage(url: string) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const items: { title: string; url: string }[] = [];

  // grab only main content table rows
  $("#tablelibgen tbody tr, table#tablelibgen tr").each((_, el) => {
    const row = $(el);

    // skip navbar or junk sections
    if (row.closest(".navbar").length) return;

    const links = row.find("a[href]");

    links.each((_, a) => {
      const el = $(a);

      const href = el.attr("href");
      const text = el.text().trim();

      if (!href || text.length < 2) return;
      if (href.startsWith("javascript") || href === "#") return;

      // avoid header links like "Year", "Issue"
      if (
        text.toLowerCase().includes("year") ||
        text.toLowerCase().includes("issue")
      )
        return;

      const full = href.startsWith("http")
        ? href
        : `${TARGET_URL}/${href.replace(/^\//, "")}`;

      items.push({ title: text, url: full });
    });
  });

  return items;
}

/* =========================
   RENDER PAGE WITH PAGINATION
========================= */
async function renderDetail(
  chatId: number,
  url: string,
  page = 0
) {
  const PAGE_SIZE = 8;

  let session = sessionStore.get(chatId);

  if (!session || session.pageUrl !== url) {
    const items = await fetchDetailPage(url);

    session = {
      pageUrl: url,
      pageItems: items,
    };

    sessionStore.set(chatId, session);
  }

  const items = session.pageItems || [];

  const start = page * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);

  if (slice.length === 0) {
    await send(chatId, "No more items.");
    return;
  }

  const text = slice
    .map((i, idx) => `${start + idx + 1}. ${i.title}`)
    .join("\n");

  const keyboard: any = {
    inline_keyboard: [
      ...slice.map((i, idx) => [
        {
          text: i.title.slice(0, 30),
          callback_data: `o:${start + idx}`,
        },
      ]),
    ],
  };

  // pagination controls
  const navRow: any[] = [];

  if (page > 0) {
    navRow.push({
      text: "⬅ Prev",
      callback_data: `p:${page - 1}`,
    });
  }

  if (start + PAGE_SIZE < items.length) {
    navRow.push({
      text: "Next ➡",
      callback_data: `p:${page + 1}`,
    });
  }

  if (navRow.length) keyboard.inline_keyboard.push(navRow);

  await send(chatId, text, { reply_markup: keyboard });
}

/* =========================
   OPEN ITEM PAGE (optional deep navigation)
========================= */
async function openItem(chatId: number, index: number) {
  const session = sessionStore.get(chatId);
  if (!session?.pageItems?.[index]) return;

  const item = session.pageItems[index];

  const { data } = await axios.get(item.url);
  const $ = cheerio.load(data);

  const links: string[] = [];

  // IMPORTANT: exclude navbar here too
  $("a[href]").each((_, el) => {
    if ($(el).closest(".navbar").length) return;

    const href = $(el).attr("href");
    const text = $(el).text().trim();

    if (!href || text.length < 2) return;

    if (href.startsWith("javascript") || href === "#") return;

    links.push(
      `${text}\n${
        href.startsWith("http")
          ? href
          : `${TARGET_URL}/${href}`
      }`
    );
  });

  const msg =
    links.slice(0, 15).join("\n\n") || "No links found";

  await send(chatId, msg);
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
     CALLBACK ROUTING
  ========================= */
  if (cb?.startsWith("p:")) {
    const page = Number(cb.split(":")[1]);
    const session = sessionStore.get(chatId);

    if (session?.pageUrl) {
      await renderDetail(chatId, session.pageUrl, page);
    }

    return NextResponse.json({ ok: true });
  }

  if (cb?.startsWith("o:")) {
    const index = Number(cb.split(":")[1]);
    await openItem(chatId, index);
    return NextResponse.json({ ok: true });
  }

  if (cb?.startsWith("open:")) {
    const url = decodeURIComponent(cb.replace("open:", ""));
    await renderDetail(chatId, url, 0);
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