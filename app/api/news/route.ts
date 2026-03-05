import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase-server'
import { STOCKS } from '@/lib/stocks'
import { fetchRssFeed, fetchMetaDescription } from '@/lib/rss'
import { analyzeArticle, synthesizeTicker } from '@/lib/analyzer'

// 24-hour rolling coverage window
function getCoverageWindow(): { start: Date; end: Date } {
  const now = new Date()
  return {
    start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    end: now,
  }
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

// POST { ticker } — analyze one ticker (called once per ticker from the client)
// POST {}        — record the news_run timestamp after all tickers are done
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createSupabaseServiceClient()
  const body = await req.json().catch(() => ({}))
  const ticker = (body as { ticker?: string }).ticker

  // No ticker = final call to record the run timestamp
  if (!ticker) {
    const { start, end } = getCoverageWindow()
    await serviceClient.from('news_runs').insert({
      coverage_start: start.toISOString(),
      coverage_end: end.toISOString(),
    })
    return NextResponse.json({ done: true })
  }

  const stock = STOCKS.find((s) => s.ticker === ticker)
  if (!stock) return NextResponse.json({ error: 'Unknown ticker' }, { status: 400 })

  const { start: coverageStart, end: coverageEnd } = getCoverageWindow()

  console.log(`[${ticker}] POST started`)

  // Fetch RSS + DB dedup in parallel
  const [{ data: existing, error: dedupErr }, articles] = await Promise.all([
    serviceClient
      .from('analyzed_articles')
      .select('article_url, signal')
      .eq('ticker', ticker)
      .gte('published_at', coverageStart.toISOString()),
    fetchRssFeed(stock.rssUrl, coverageStart, coverageEnd),
  ])

  if (dedupErr) console.error(`[${ticker}] Dedup error:`, dedupErr.message)

  const seenUrls = new Set(
    (existing || [])
      .filter((r: { signal: string | null }) => r.signal !== null)
      .map((r: { article_url: string }) => r.article_url)
  )

  console.log(`[${ticker}] RSS: ${articles.length} articles in window`)

  // Sort: articles mentioning the company name in the title come first,
  // so the 5-article cap doesn't waste slots on generic market roundups.
  const namePrefix = stock.name.toLowerCase().split(' ').slice(0, 2).join(' ')
  const tickerLower = ticker.toLowerCase()
  const sortedArticles = [...articles].sort((a, b) => {
    const aTitle = a.title.toLowerCase()
    const bTitle = b.title.toLowerCase()
    const aScore = (aTitle.includes(namePrefix) || aTitle.includes(tickerLower)) ? 1 : 0
    const bScore = (bTitle.includes(namePrefix) || bTitle.includes(tickerLower)) ? 1 : 0
    return bScore - aScore
  })

  const newArticles = sortedArticles.filter((a) => !seenUrls.has(a.link)).slice(0, 5)
  console.log(`[${ticker}] ${newArticles.length} to analyze (${seenUrls.size} already have a signal)`)

  // Fetch meta descriptions in parallel for all articles before analysis
  const metaDescs = await Promise.all(
    newArticles.map((a) => fetchMetaDescription(a.realUrl))
  )

  const seenTitles: string[] = []
  const seenEvents: string[] = []
  let newSignalFound = false

  for (let idx = 0; idx < newArticles.length; idx++) {
    const article = { ...newArticles[idx], snippet: metaDescs[idx] || newArticles[idx].snippet }
    console.log(`[${ticker}] snippet source: ${metaDescs[idx] ? `meta(${metaDescs[idx]!.length}c)` : `rss(${newArticles[idx].snippet.length}c)`}`)
    const titleWords = new Set(article.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3))
    const isDuplicate = seenTitles.some((seen) => {
      const seenWords = new Set(seen.toLowerCase().split(/\W+/).filter((w) => w.length > 3))
      const intersection = Array.from(titleWords).filter((w) => seenWords.has(w)).length
      const union = new Set([...Array.from(titleWords), ...Array.from(seenWords)]).size
      return union > 0 && intersection / union > 0.5
    })
    if (isDuplicate) {
      console.log(`[${ticker}] skipped duplicate title: "${article.title.slice(0, 60)}"`)
      continue
    }
    seenTitles.push(article.title)

    const analysis = await analyzeArticle(ticker, stock.name, stock.context, article.title, article.snippet, seenEvents)
    console.log(`[${ticker}] "${article.title.slice(0, 60)}" → relevant=${analysis.relevant} signal=${analysis.signal}`)

    if (analysis.relevant && analysis.summary) seenEvents.push(article.title)
    if (analysis.signal !== null) newSignalFound = true

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

  // Synthesize only if new signals were found this run
  if (newSignalFound) {
    const { data: relevantForTicker } = await serviceClient
      .from('analyzed_articles')
      .select('signal, summary')
      .eq('ticker', ticker)
      .gte('published_at', coverageStart.toISOString())
      .not('signal', 'is', null)
      .not('summary', 'is', null)
      .order('published_at', { ascending: false })

    const summaries = (relevantForTicker || []).map((r) => `${r.signal} ${r.summary}`)
    const synthesis = await synthesizeTicker(ticker, stock.name, summaries)

    await serviceClient
      .from('ticker_synthesis')
      .upsert({ ticker, summary: synthesis, updated_at: new Date().toISOString() }, { onConflict: 'ticker' })

    console.log(`[${ticker}] synthesized: "${synthesis.slice(0, 80)}"`)
  } else {
    console.log(`[${ticker}] no new signals, skipping synthesis`)
  }

  return NextResponse.json({ done: true })
}

// GET — pure DB read: rolling 24h window, no Groq calls
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
  const { start: coverageStart, end: coverageEnd } = getCoverageWindow()

  const [{ data: synthRows }, { data: allRelevant }, { data: lastRun }] = await Promise.all([
    serviceClient.from('ticker_synthesis').select('ticker, summary'),
    serviceClient
      .from('analyzed_articles')
      .select('*')
      .gte('published_at', coverageStart.toISOString())
      .lte('published_at', coverageEnd.toISOString())
      .not('signal', 'is', null)
      .order('published_at', { ascending: false }),
    serviceClient
      .from('news_runs')
      .select('run_at, coverage_start, coverage_end')
      .order('run_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  if (!lastRun && (!allRelevant || allRelevant.length === 0)) {
    return NextResponse.json({ noData: true })
  }

  const tickerSummaries: Record<string, string> = {}
  for (const row of synthRows || []) {
    tickerSummaries[row.ticker] = row.summary
  }

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
    coverageStart: coverageStart.toISOString(),
    coverageEnd: coverageEnd.toISOString(),
    runAt: lastRun?.run_at ?? new Date().toISOString(),
    tickers: Object.values(byTicker),
  })
}
