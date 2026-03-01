import Parser from 'rss-parser'

export interface RssArticle {
  title: string
  link: string
  realUrl: string
  pubDate: Date
  snippet: string
}

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['summary', 'summary'],
    ],
  },
})

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Extract the real article URL from a Google redirect URL
function extractRealUrl(googleUrl: string): string {
  try {
    const parsed = new URL(googleUrl)
    const real = parsed.searchParams.get('url')
    return real || googleUrl
  } catch {
    return googleUrl
  }
}

// Fetch the actual article page and extract body text from <p> tags
// inside <article> or <main> containers, avoiding nav/header/footer boilerplate.
async function fetchArticleContent(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept': 'text/html',
      },
    })
    clearTimeout(timeout)
    if (!res.ok) return ''
    const html = await res.text()

    // Remove noisy regions first
    const stripped = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')

    // Only extract content if the page has a proper <article> or <main> block.
    // Sites without these (paywalled, JS-rendered, poorly structured) return ''
    // so the caller falls back to the RSS snippet, which is more reliable.
    const mainBlockMatch =
      stripped.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
      stripped.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
      stripped.match(/<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/i)

    if (!mainBlockMatch) return ''

    const contentBlock = mainBlockMatch[1]

    // Extract <p> tags with >= 80 chars — skips nav links, bylines, captions
    const paragraphs: string[] = []
    const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi
    let match: RegExpExecArray | null
    while ((match = pTagRegex.exec(contentBlock)) !== null) {
      const text = stripHtml(match[1]).trim()
      if (text.length >= 80) paragraphs.push(text)
    }

    const result = paragraphs.join(' ').slice(0, 1200)
    return result.length >= 200 ? result : ''
  } catch {
    return ''
  }
}

export async function fetchRssFeed(
  url: string,
  coverageStart: Date,
  coverageEnd: Date,
  skipUrls: Set<string> = new Set()
): Promise<RssArticle[]> {
  try {
    const feed = await parser.parseURL(url)
    const articles: RssArticle[] = []

    for (const item of feed.items) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : null
      if (!pubDate || isNaN(pubDate.getTime())) continue
      if (pubDate < coverageStart || pubDate > coverageEnd) continue

      const link = item.link || item.guid || ''
      if (!link) continue

      const itemAny = item as unknown as Record<string, unknown>
      const rssSnippet = stripHtml(
        (itemAny.contentEncoded as string) ||
        (itemAny.summary as string) ||
        (item.content ?? '') ||
        (item.contentSnippet ?? '') ||
        ''
      )

      const realUrl = extractRealUrl(link)

      // Skip full article fetch for already-analyzed URLs — saves significant time
      let snippet = rssSnippet
      if (!skipUrls.has(link)) {
        const fullContent = await fetchArticleContent(realUrl)
        snippet = fullContent.length > rssSnippet.length ? fullContent : rssSnippet
      }

      console.log(`  [rss] "${stripHtml(item.title || '').slice(0, 60)}" — snippet: ${snippet.length} chars`)

      articles.push({
        title: stripHtml(item.title || ''),
        link,
        realUrl,
        pubDate,
        snippet,
      })
    }

    return articles
  } catch (err) {
    console.error(`RSS fetch error for ${url}:`, err)
    return []
  }
}
