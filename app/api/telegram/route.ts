/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string;
const TARGET_URL = process.env.TARGET_URL as string;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/* =========================
   MEMORY (Replace with Redis in prod)
========================= */
const navStack = new Map<number, string[]>();
const urlCache = new Map<string, string>(); // Maps shortId -> full URL

function cacheUrl(url: string): string {
  // Generate a random 8-character ID
  const id = Math.random().toString(36).substring(2, 10);
  urlCache.set(id, url);
  return id;
}

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
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      ...extra,
    });
  } catch (error: any) {
    console.error("Telegram Send Error:", error.response?.data || error.message);
  }
}

/* =========================
   STACK HELPERS
========================= */
function push(chatId: number, url: string) {
  const stack = navStack.get(chatId) || [];
  // Prevent pushing duplicates if reloading the same page
  if (stack[stack.length - 1] !== url) {
    stack.push(url);
  }
  navStack.set(chatId, stack);
}

function pop(chatId: number) {
  const stack = navStack.get(chatId) || [];
  stack.pop(); // Remove current page
  const prev = stack[stack.length - 1]; // Get previous page
  navStack.set(chatId, stack);
  return prev;
}

/* =========================
   SEARCH
========================= */
async function fetchSearch(query: string) {
  const params = new URLSearchParams();
  params.append("req", query);
  ["t", "a", "s", "y", "p", "i"].forEach((v) => params.append("columns[]", v));
  ["f", "e", "s", "a", "p", "w"].forEach((v) => params.append("objects[]", v));
  ["l", "c", "f", "a", "m", "r", "s"].forEach((v) => params.append("topics[]", v));
  params.append("res", "25");
  params.append("filesuns", "all");
  params.append("curtab", "e");

  const url = `${TARGET_URL}/index.php?${params.toString()}`;
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results: { title: string; url: string }[] = [];

  $("tbody tr").each((_, el) => {
    const cell = $(el).find("td").eq(1);
    const link = cell.find("a[href^='series.php']").first();

    const title = link.text().trim();
    const href = link.attr("href");

    if (!title || !href) return;

    const full = href.startsWith("http") ? href : `${TARGET_URL}/${href}`;
    results.push({ title, url: full });
  });

  return results;
}

/* =========================
   FETCH ANY PAGE LINKS
========================= */
/* =========================
   FETCH ANY PAGE LINKS
========================= */
async function fetchPage(url: string) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const items: { title: string; url: string }[] = [];
  const seenUrls = new Set<string>(); 

  // 1. SPECIFIC EXTRACTION: Look for the issues table first
  const issuesTableLinks = $("#tablelibgen a[href*='req=issuesid']");
  
  if (issuesTableLinks.length > 0) {
    issuesTableLinks.each((_, el) => {
      const elAny = $(el);
      const href = elAny.attr("href");
      let title = elAny.text().trim();

      if (!href) return;

      // If the text is just a number (like "1") or "???", it's an issue. 
      // Let's build a clean title by extracting the volume/issue from the URL itself!
      if (/^\d+$/.test(title) || title === "???") {
         const volMatch = href.match(/issuevolume:([a-zA-Z0-9]+)/);
         const issueMatch = href.match(/issuenumber:([a-zA-Z0-9]+)/);
         
         if (volMatch && issueMatch) {
           title = `Vol ${volMatch[1]}, Issue ${issueMatch[1]}`;
         } else if (volMatch) {
           title = `Vol ${volMatch[1]}, Issue ${title}`;
         }
      }

      const full = href.startsWith("http")
        ? href
        : `${TARGET_URL}/${href.replace(/^\//, "")}`;

      if (seenUrls.has(full)) return;
      seenUrls.add(full);

      items.push({
        title: title.replace(/\s+/g, ' '),
        url: full,
      });
    });

    // Return up to 30 issues so the user can see a good chunk of the table
    return items.slice(0, 30);
  }

  // 2. GENERIC EXTRACTION: Fallback for regular pages
  $("a[href]").each((_: any, el: any) => {
    const elAny = $(el);
    const href = elAny.attr("href");
    const title = elAny.text().trim() || elAny.attr("title")?.trim();

    if (!href || !title || title.length < 2) return;

    if (href.startsWith("javascript") || href.startsWith("#") || href.startsWith("mailto:")) return;

    if (elAny.closest(".navbar, nav, header, footer, [class*='nav'], [class*='menu']").length > 0) {
      return;
    }

    const full = href.startsWith("http")
      ? href
      : `${TARGET_URL}/${href.replace(/^\//, "")}`;

    if (seenUrls.has(full)) return;
    seenUrls.add(full);

    items.push({
      title: title.replace(/\s+/g, ' '), 
      url: full,
    });
  });

  return items.slice(0, 15);
}


/* =========================
   RENDER NODE
========================= */
async function render(chatId: number, url: string, isBacking: boolean = false) {
  if (!isBacking) {
    push(chatId, url);
  }

  const items = await fetchPage(url);

  if (items.length === 0) {
    const stack = navStack.get(chatId) || [];
    const backMarkup = stack.length > 1 ? {
      inline_keyboard: [[{ text: "⬅ Back", callback_data: "back" }]]
    } : undefined;

    await send(chatId, "No further links found on this page.", { reply_markup: backMarkup });
    return;
  }

  const message = items
    .map((i, idx) => `${idx + 1}. ${i.title}`)
    .join("\n");

  const inline_keyboard = items.map((i) => [
    {
      text: i.title.length > 30 ? i.title.slice(0, 27) + "..." : i.title,
      // Use cache ID to stay under 64-byte Telegram limit
      callback_data: `o:${cacheUrl(i.url)}`,
    },
  ]);

  // Add back button if we have history
  const stack = navStack.get(chatId) || [];
  if (stack.length > 1) {
    inline_keyboard.push([{ text: "⬅ Back", callback_data: "back" }]);
  }

  await send(chatId, message || "Select a link:", {
    reply_markup: { inline_keyboard },
  });
}

/* =========================
   MAIN HANDLER
========================= */
export async function POST(req: Request) {
  const body: Update = await req.json();

  const chatId = body.message?.chat.id || body.callback_query?.message.chat.id;
  if (!chatId) return NextResponse.json({ ok: true });

  const cb = body.callback_query?.data;
  const text = body.message?.text;

  /* =========================
     BACK BUTTON
  ========================= */
  if (cb === "back") {
    const prevUrl = pop(chatId);

    if (!prevUrl) {
      await send(chatId, "No previous page.");
      return NextResponse.json({ ok: true });
    }

    await send(chatId, "⬅ Going back...");
    // Pass `true` so we don't re-push it to the stack
    await render(chatId, prevUrl, true); 
    return NextResponse.json({ ok: true });
  }

  /* =========================
     OPEN NODE (Using Short ID)
  ========================= */
  if (cb?.startsWith("o:")) {
    const shortId = cb.replace("o:", "");
    const url = urlCache.get(shortId);
    
    if (!url) {
      await send(chatId, "Link expired or invalid. Please search again.");
      return NextResponse.json({ ok: true });
    }

    await send(chatId, "⏳ Loading page...");
    await render(chatId, url);
    return NextResponse.json({ ok: true });
  }

  /* =========================
     SEARCH
  ========================= */
  if (text?.startsWith("/search")) {
    const query = text.replace("/search", "").trim();
    if (!query) {
      await send(chatId, "Please provide a search term. Example: /search matrix");
      return NextResponse.json({ ok: true });
    }

    await send(chatId, "🔍 Searching...");
    const results = await fetchSearch(query);

    if (results.length === 0) {
      await send(chatId, "No results found.");
      return NextResponse.json({ ok: true });
    }

    // Reset stack on new search
    navStack.set(chatId, []);

    const inline_keyboard = results.slice(0, 5).map((r) => [
      {
        text: r.title.length > 30 ? r.title.slice(0, 27) + "..." : r.title,
        callback_data: `o:${cacheUrl(r.url)}`,
      },
    ]);

    // Push the search url so 'back' works properly even from root search
    push(chatId, `search:${query}`);

    await send(
      chatId,
      results.slice(0, 5).map((r, i) => `${i + 1}. ${r.title}`).join("\n"),
      { reply_markup: { inline_keyboard } }
    );

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
