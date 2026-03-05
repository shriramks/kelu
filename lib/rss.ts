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

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// Fetch the og:description or meta description from an article URL.
// Returns null on timeout, error, or if no tag found.
export async function fetchMetaDescription(url: string, timeoutMs = 3000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    })
    clearTimeout(timer)
    if (!res.ok) return null

    // Read only the first 50KB — enough to contain <head>
    const reader = res.body?.getReader()
    if (!reader) return null
    let html = ''
    while (html.length < 51200) {
      const { done, value } = await reader.read()
      if (done) break
      html += new TextDecoder().decode(value)
      if (html.includes('</head>')) break
    }
    reader.cancel()

    // Try og:description first (usually more informative), then name=description
    for (const attr of ['og:description', 'description']) {
      const withContentFirst = new RegExp(
        `<meta[^>]+content=["']([^"']{20,}?)["'][^>]+(?:property|name)=["']${attr}["']`,
        'i'
      )
      const withAttrFirst = new RegExp(
        `<meta[^>]+(?:property|name)=["']${attr}["'][^>]+content=["']([^"']{20,}?)["']`,
        'i'
      )
      const m = html.match(withAttrFirst) || html.match(withContentFirst)
      if (m?.[1]) return decodeHtmlEntities(m[1].trim())
    }
    return null
  } catch {
    return null
  }
}

export async function fetchRssFeed(
  url: string,
  coverageStart: Date,
  coverageEnd: Date,
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
      const snippet = stripHtml(
        (itemAny.contentEncoded as string) ||
        (itemAny.summary as string) ||
        (item.content ?? '') ||
        (item.contentSnippet ?? '') ||
        ''
      )

      const realUrl = extractRealUrl(link)

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
