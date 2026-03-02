import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase-server'
import { STOCKS } from '@/lib/stocks'
import { fetchRssFeed, type RssArticle } from '@/lib/rss'
import { analyzeArticle, synthesizeTicker } from '@/lib/analyzer'

// 24-hour rolling coverage window
function getCoverageWindow(): { start: Date; end: Date } {
  const now = new Date()
  return {
    start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    end: now,
  }
}

// Run up to `concurrency` promises at a time
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = []
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const current = index++
      results[current] = await tasks[current]()
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)
  return results
}

type ArticleRow = {
  title: string
  url: string
  publishedAt: string
  summary: string
  signal: string
  dipVerdict: string | null
  isAnalystRec: boolean
}

type TickerResult = {
  ticker: string
  tickerSummary: string
  articles: ArticleRow[]
}

export async function POST(req: NextRequest) {
  // Verify session
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createSupabaseServiceClient()
  const { start: coverageStart, end: coverageEnd } = getCoverageWindow()

  console.log(`[news] POST started — coverage: ${coverageStart.toISOString()} → ${coverageEnd.toISOString()}`)

  // ── Phase 1: RSS fetch + DB dedup in parallel (no Groq, pure I/O) ──────────
  type PreparedTicker = {
    ticker: string
    name: string
    newArticles: RssArticle[]
  }

  const prepTasks = STOCKS.map((stock) => async (): Promise<PreparedTicker> => {
    try {
      const [{ data: existing, error: dedupErr }, articles] = await Promise.all([
        serviceClient
          .from('analyzed_articles')
          .select('article_url, signal')
          .eq('ticker', stock.ticker)
          .gte('published_at', coverageStart.toISOString()),
        fetchRssFeed(stock.rssUrl, coverageStart, coverageEnd),
      ])

      if (dedupErr) console.error(`[${stock.ticker}] Dedup query error:`, dedupErr.message)

      const seenUrls = new Set(
        (existing || [])
          .filter((r: { signal: string | null }) => r.signal !== null)
          .map((r: { article_url: string }) => r.article_url)
      )

      console.log(`[${stock.ticker}] RSS: ${articles.length} articles in window`)

      // Pre-filter: title+snippet must contain at least one keyword
      const relevant = articles.filter((a) => {
        const haystack = (a.title + ' ' + a.snippet).toLowerCase()
        return stock.keywords.some((kw) => haystack.includes(kw.toLowerCase()))
      })
      const filtered = articles.length - relevant.length
      if (filtered > 0) console.log(`[${stock.ticker}] pre-filter removed ${filtered} off-topic articles`)

      const newArticles = relevant.filter((a) => !seenUrls.has(a.link)).slice(0, 5)
      console.log(`[${stock.ticker}] ${newArticles.length} to analyze (${seenUrls.size} already have a signal)`)

      return { ticker: stock.ticker, name: stock.name, newArticles }
    } catch (err) {
      console.error(`[${stock.ticker}] Prep error:`, err)
      return { ticker: stock.ticker, name: stock.name, newArticles: [] }
    }
  })

  // All 12 RSS fetches + DB checks run in parallel — no Groq involved
  const prepared = await Promise.all(prepTasks.map((t) => t()))

  // ── Phase 2: Groq analysis — one ticker at a time ─────────────────────────
  const analysisTasks = prepared
    .filter((p) => p.newArticles.length > 0)
    .map(({ ticker, newArticles }) => async () => {
      const seenTitles: string[] = []
      const seenEvents: string[] = []

      for (const article of newArticles) {
        // Title similarity pre-check — skip if >50% word overlap with an already-seen title
        const titleWords = new Set(article.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3))
        const isDuplicateTitle = seenTitles.some((seen) => {
          const seenWords = new Set(seen.toLowerCase().split(/\W+/).filter((w) => w.length > 3))
          const intersection = Array.from(titleWords).filter((w) => seenWords.has(w)).length
          const union = new Set([...Array.from(titleWords), ...Array.from(seenWords)]).size
          return union > 0 && intersection / union > 0.5
        })
        if (isDuplicateTitle) {
          console.log(`[${ticker}] skipped duplicate title: "${article.title.slice(0, 60)}"`)
          continue
        }
        seenTitles.push(article.title)

        const analysis = await analyzeArticle(ticker, article.title, article.snippet, seenEvents)
        console.log(`[${ticker}] "${article.title.slice(0, 60)}" → relevant=${analysis.relevant} signal=${analysis.signal}`)

        if (analysis.relevant && analysis.summary) {
          seenEvents.push(article.title)
        }

        const { error: upsertErr } = await serviceClient.from('analyzed_articles').upsert(
          {
            ticker,
            article_url: article.link,
            article_title: article.title,
            published_at: article.pubDate.toISOString(),
            summary: analysis.summary,
            signal: analysis.signal,
            dip_verdict: analysis.dipVerdict,
            is_analyst_rec: analysis.isAnalystRec,
          },
          { onConflict: 'ticker,article_url' }
        )
        if (upsertErr) console.error(`[${ticker}] Upsert error:`, upsertErr.message)
      }
    })

  await pLimit(analysisTasks, 1)

  // ── Phase 3: Synthesize all tickers and store with the run ─────────────────
  const { data: relevantAnalyzed } = await serviceClient
    .from('analyzed_articles')
    .select('ticker, signal, summary')
    .gte('published_at', coverageStart.toISOString())
    .lte('published_at', coverageEnd.toISOString())
    .not('signal', 'is', null)
    .not('summary', 'is', null)
    .order('published_at', { ascending: false })

  const summariesByTicker: Record<string, string[]> = {}
  for (const stock of STOCKS) summariesByTicker[stock.ticker] = []
  for (const row of relevantAnalyzed || []) {
    if (summariesByTicker[row.ticker]) {
      summariesByTicker[row.ticker].push(`${row.signal} ${row.summary}`)
    }
  }

  const synthTasks = STOCKS.map((stock) => async () => ({
    ticker: stock.ticker,
    summary: await synthesizeTicker(stock.ticker, stock.name, summariesByTicker[stock.ticker]),
  }))
  const synthResults = await pLimit(synthTasks, 1)

  const tickerSummaries: Record<string, string> = {}
  for (const r of synthResults) {
    if (r) tickerSummaries[r.ticker] = r.summary
  }

  // Record the run with cached synthesis — GET reads this directly, no Groq on page load
  const { error: runErr } = await serviceClient.from('news_runs').insert({
    coverage_start: coverageStart.toISOString(),
    coverage_end: coverageEnd.toISOString(),
    ticker_summaries: tickerSummaries,
  })
  if (runErr) console.error('[news] news_runs insert error:', runErr.message)
  else console.log('[news] news_run recorded')

  return NextResponse.json({ done: true })
}

// GET: return cached results from last run — pure DB read, no Groq calls
export async function GET(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createSupabaseServiceClient()

  const { data: lastRun } = await serviceClient
    .from('news_runs')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(1)
    .single()

  if (!lastRun) {
    return NextResponse.json({ noData: true })
  }

  const coverageStart = lastRun.coverage_start
  const coverageEnd = lastRun.coverage_end
  const tickerSummaries: Record<string, string> = lastRun.ticker_summaries ?? {}

  // Fetch material articles for display
  const { data: allRelevant } = await serviceClient
    .from('analyzed_articles')
    .select('*')
    .gte('published_at', coverageStart)
    .lte('published_at', coverageEnd)
    .not('signal', 'is', null)
    .order('published_at', { ascending: false })

  const byTicker: Record<string, TickerResult> = {}
  for (const stock of STOCKS) {
    byTicker[stock.ticker] = {
      ticker: stock.ticker,
      tickerSummary: tickerSummaries[stock.ticker] ?? 'No news in coverage window.',
      articles: [],
    }
  }

  for (const row of allRelevant || []) {
    if (byTicker[row.ticker]) {
      byTicker[row.ticker].articles.push({
        title: row.article_title,
        url: row.article_url,
        publishedAt: row.published_at,
        summary: row.summary,
        signal: row.signal,
        dipVerdict: row.dip_verdict ?? null,
        isAnalystRec: row.is_analyst_rec ?? false,
      })
    }
  }

  return NextResponse.json({
    coverageStart,
    coverageEnd,
    runAt: lastRun.run_at,
    tickers: Object.values(byTicker),
  })
}
