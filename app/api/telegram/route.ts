/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import axios from "axios";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string;
const TARGET_URL = process.env.TARGET_URL as string;

const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

type TelegramMessage = {
  message?: {
    chat: {
      id: number;
    };
    text?: string;
  };
};

async function sendTelegramMessage(chatId: number, text: string) {
  try {
    console.log("[TELEGRAM] Sending message to:", chatId);

    await axios.post(
      TELEGRAM_API_URL,
      {
        chat_id: chatId,
        text,
        // IMPORTANT:
        // No parse_mode to avoid Telegram Markdown parsing issues
      },
      {
        timeout: 15000,
      }
    );

    console.log("[TELEGRAM] Message sent successfully");
  } catch (error: any) {
    console.error("[TELEGRAM_ERROR] Failed to send message");

    if (axios.isAxiosError(error)) {
      console.error({
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      console.error(error);
    }
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  console.log("================================================");
  console.log("[WEBHOOK] Incoming Telegram webhook");

  try {
    // =========================
    // ENV VALIDATION
    // =========================

    if (!TELEGRAM_TOKEN) {
      throw new Error("Missing TELEGRAM_TOKEN env");
    }

    if (!TARGET_URL) {
      throw new Error("Missing TARGET_URL env");
    }

    console.log("[ENV] TARGET_URL:", TARGET_URL);

    // Validate URL
    try {
      new URL(TARGET_URL);
    } catch {
      throw new Error(`Invalid TARGET_URL: ${TARGET_URL}`);
    }

    // =========================
    // PARSE BODY
    // =========================

    const body: TelegramMessage = await req.json();

    console.log("[BODY]");
    console.log(JSON.stringify(body, null, 2));

    const chatId = body.message?.chat.id;
    const userText = body.message?.text;

    if (!chatId) {
      console.log("[SKIP] No chat id");
      return NextResponse.json({ message: "No chat id" });
    }

    if (!userText) {
      console.log("[SKIP] No text");
      return NextResponse.json({ message: "No text" });
    }

    console.log("[MESSAGE]", userText);

    // =========================
    // COMMAND VALIDATION
    // =========================

    if (!userText.startsWith("/search")) {
      console.log("[SKIP] Not a /search command");

      await sendTelegramMessage(
        chatId,
        "Use:\n/search your query"
      );

      return NextResponse.json({ message: "Ignored" });
    }

    // =========================
    // EXTRACT QUERY
    // =========================

    const query = userText.replace(/^\/search\s*/i, "").trim();

    console.log("[QUERY]", query);

    if (!query) {
      console.log("[ERROR] Empty query");

      await sendTelegramMessage(
        chatId,
        "Please provide a search query.\n\nExample:\n/search mathematics"
      );

      return NextResponse.json({ message: "Empty query" });
    }

    // =========================
    // BUILD TARGET URL
    // =========================

    const targetUrl =
      `${TARGET_URL}/index.php?req=${encodeURIComponent(query)}`;

    console.log("[FETCH_URL]", targetUrl);

    // =========================
    // FETCH HTML
    // =========================

    let html = "";

    try {
      console.log("[FETCH] Sending request...");

      const response = await axios.get<string>(targetUrl, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      html = response.data;

      console.log("[FETCH] Success");
      console.log("[FETCH] HTML length:", html.length);
    } catch (fetchError: any) {
      console.error("[FETCH_ERROR]");

      if (axios.isAxiosError(fetchError)) {
        console.error({
          message: fetchError.message,
          status: fetchError.response?.status,
          data: fetchError.response?.data,
        });
      } else {
        console.error(fetchError);
      }

      await sendTelegramMessage(
        chatId,
        "Failed to fetch search results from target website."
      );

      return NextResponse.json(
        { message: "Fetch failed" },
        { status: 500 }
      );
    }

    // =========================
    // PARSE HTML
    // =========================

    console.log("[PARSER] Loading HTML into cheerio");

    const $ = cheerio.load(html);

    const results: string[] = [];

    $("tr").each((index: number, element: any) => {
      try {
        const titleElement = $(element)
          .find("td")
          .eq(0)
          .find("a");

        const title = titleElement.text().trim();

        const link = titleElement.attr("href");

        const publisher = $(element)
          .find("td")
          .eq(2)
          .text()
          .trim();

        if (title && link) {
          const fullLink = `${TARGET_URL}/${link}`;

          console.log(`[RESULT_${index}]`, {
            title,
            publisher,
            fullLink,
          });

          results.push(
            `${results.length + 1}. ${title}\n` +
              `Publisher: ${publisher || "Unknown"}\n` +
              `Link: ${fullLink}`
          );
        }
      } catch (rowError) {
        console.error("[ROW_PARSE_ERROR]", rowError);
      }
    });

    console.log("[RESULTS_COUNT]", results.length);

    // =========================
    // BUILD RESPONSE
    // =========================

    let resultsText = "";

    if (results.length === 0) {
      resultsText = `No results found for: ${query}`;
    } else {
      const limitedResults = results.slice(0, 10);

      resultsText =
        `Search Results for: ${query}\n\n` +
        limitedResults.join("\n\n");

      if (results.length > 10) {
        resultsText += `\n\nAnd ${results.length - 10} more results...`;
      }
    }

    // Telegram hard limit safety
    if (resultsText.length > 3900) {
      resultsText = resultsText.slice(0, 3900);
      resultsText += "\n\nMessage trimmed due to Telegram limit.";
    }

    console.log("[RESPONSE_LENGTH]", resultsText.length);

    // =========================
    // SEND TO TELEGRAM
    // =========================

    console.log("[TELEGRAM] Sending final response");

    await sendTelegramMessage(chatId, resultsText);

    console.log("[DONE] Request processed successfully");

    return NextResponse.json(
      {
        message: "OK",
        resultsCount: results.length,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("================================================");
    console.error("[FATAL_ERROR]");

    if (axios.isAxiosError(error)) {
      console.error({
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
    } else {
      console.error(error);
    }

    // =========================
    // SEND ERROR TO TELEGRAM
    // =========================

    try {
      const body: TelegramMessage = await req.clone().json();

      const chatId = body.message?.chat.id;

      if (chatId) {
        const errorMessage =
          "An internal server error occurred.\n\n" +
          `Error:\n${error?.message || "Unknown error"}`;

        await sendTelegramMessage(chatId, errorMessage);
      }
    } catch (telegramError) {
      console.error(
        "[ERROR_REPORTING_FAILED]",
        telegramError
      );
    }

    return NextResponse.json(
      {
        message: "Internal server error",
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}