/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';

const TOKEN = process.env.BOT_TOKEN; // Set this in Vercel Environment Variables
const URL = `https://tapi.bale.ai/bot${TOKEN}/`;

// Define types for the courses
const course_info: Record<string, string> = {
    "📱 سواد رسانه": "📱 سواد رسانه\n\nتشخیص خبر واقعی و جعلی\nسن: ۷ تا ۹",
    "💰 سواد مالی": "💰 سواد مالی\n\nمدیریت پول\nسن: ۷ تا ۹",
    // ... add the rest of your courses here
};

// Define types for Bale API responses and Keyboards
interface ReplyKeyboardMarkup {
    keyboard: string[][];
    resize_keyboard?: boolean;
}

interface BaleUpdate {
    message?: {
        chat: {
            id: number;
        };
        text?: string;
    };
}

// Helper function to send messages
async function sendMessage(
    chatId: number, 
    text: string, 
    keyboard: ReplyKeyboardMarkup | null = null
): Promise<void> {
    const payload: any = { chat_id: chatId, text: text };
    
    if (keyboard) {
        payload.reply_markup = keyboard;
    }
    
    await fetch(`${URL}sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

// The Webhook POST Handler
export async function POST(req: NextRequest) {
    try {
        const update = (await req.json()) as BaleUpdate;

        // Ensure there is a message
        if (!update.message) {
            return NextResponse.json({ message: "No message" });
        }

        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        // TODO: Retrieve user state from your Database here (e.g., Redis or Postgres)
        // const userState = await db.getUserState(chatId);

        if (text === "/start" || text === "🏠 منوی اصلی") {
            // TODO: Clear user state in DB
            const kb: ReplyKeyboardMarkup = {
                keyboard: [
                    ["📚 معرفی دوره‌ها"], ["📝 ثبت‌نام"],
                    ["📂 ثبت نام‌های من"], ["☎️ پشتیبانی"]
                ],
                resize_keyboard: true
            };
            await sendMessage(chatId, "🌟 به ربات آموزشگاه خوش آمدید", kb);
        } 
        else if (text === "📚 معرفی دوره‌ها" || text === "📝 ثبت‌نام") {
            const kb: ReplyKeyboardMarkup = {
                keyboard: Object.keys(course_info).map(c => [c]).concat([["🏠 منوی اصلی"]]),
                resize_keyboard: true
            };
            await sendMessage(chatId, "یک دوره را انتخاب کنید:", kb);
        } 
        else if (course_info[text]) {
            // TODO: Save 'selected_course' to DB
            const kb: ReplyKeyboardMarkup = {
                keyboard: [["✅ ثبت‌نام همین دوره"], ["🏠 منوی اصلی"]],
                resize_keyboard: true
            };
            await sendMessage(chatId, course_info[text], kb);
        } 
        else if (text === "✅ ثبت‌نام همین دوره") {
            // TODO: Update state in DB to 'waiting_for_name'
            await sendMessage(chatId, "نام کودک را وارد کنید:");
        }
        // else if (userState === 'waiting_for_name') { ... }

        // Respond with 200 OK so Bale knows we received it
        return NextResponse.json({ ok: true });

    } catch (error) {
        console.error("Webhook error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
