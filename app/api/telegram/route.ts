import { NextResponse } from 'next/server'
import axios from 'axios'
import * as cheerio from 'cheerio'

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN as string
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`

type TelegramMessage = {
  message?: {
    chat: {
      id: number
    }
    text?: string
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body: TelegramMessage = await req.json()

    // Check if the message contains text
    if (body.message?.text) {
      const chatId = body.message.chat.id
      const userText = body.message.text

      if (userText.startsWith('/search')) {
        // Extract the query after the "/search" command
        const query = userText.replace(/^\/search\s*/i, '').trim()

        // Handle empty queries
        if (!query) {
          await axios.post(TELEGRAM_API_URL, {
            chat_id: chatId,
            text: 'Please provide a search query. Example: `/search mathematics`',
            parse_mode: 'Markdown',
          })
          return NextResponse.json({ message: 'Empty query' }, { status: 200 })
        }

        // 1. Fetch HTML with the dynamic user query
        const targetUrl = `https://my-website/index.php?req=${encodeURIComponent(query)}&curtab=e&order=year&ordermode=asc`
        const { data: html } = await axios.get<string>(targetUrl)

        // 2. Parse HTML
        const $ = cheerio.load(html)
        let resultsText = `📚 *Search Results for "${query}":*\n\n`

        // 3. Iterate table rows (Type-safe Element)
        $('tr').each((_: number, element: Element) => {
          const titleElement = $(element).find('td').eq(0).find('a')
          const title = titleElement.text().trim()
          const link = titleElement.attr('href')
          const publisher = $(element).find('td').eq(2).text().trim()

          if (title && link) {
            resultsText += `*${title}*\n`
            resultsText += `Publisher: ${publisher}\n`
            resultsText += `Link: https://my-website/${link}\n\n`
          }
        })

        if (resultsText === `📚 *Search Results for "${query}":*\n\n`) {
          resultsText = `No results found for "${query}".`
        }

        // 4. Send result to Telegram
        await axios.post(TELEGRAM_API_URL, {
          chat_id: chatId,
          text: resultsText,
          parse_mode: 'Markdown',
        })
      }
    }

    return NextResponse.json({ message: 'OK' }, { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ message: 'Error processed' }, { status: 200 })
  }
}
