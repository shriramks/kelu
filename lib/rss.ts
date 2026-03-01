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
