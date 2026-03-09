'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import TickerCard from './TickerCard'
import { STOCKS } from '@/lib/stocks'

interface Article {
  title: string
  url: string
  publishedAt: string
  summary: string
  signal: string
  dipVerdict: string | null
  isAnalystRec: boolean
}

interface TickerData {
  ticker: string
  tickerSummary: string
  articles: Article[]
}

interface NewsData {
  coverageStart: string
  coverageEnd: string
  runAt: string
  tickers: TickerData[]
  noData?: boolean
}

type RefreshStatus = { ticker: string; done: number; total: number }

function formatIST(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

async function postTicker(ticker: string): Promise<Response> {
  return fetch('/api/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  })
}

async function recordRun(): Promise<void> {
  await fetch('/api/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export default function Dashboard() {
  const [data, setData] = useState<NewsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const loadCached = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/news')
      if (res.status === 401) { router.push('/login'); return }
      const json = await res.json()
      setData(json)
    } catch {
      setError('Failed to load cached news.')
    } finally {
      setLoading(false)
    }
  }, [router])

  const reloadData = useCallback(async () => {
    const res = await fetch('/api/news')
    if (!res.ok) throw new Error(`Server error: ${res.status}`)
    const json = await res.json()
    setData(json)
  }, [])

  // Refresh a single ticker — called from the per-card refresh button
  const refreshSingleTicker = useCallback(async (ticker: string) => {
    setRefreshStatus({ ticker, done: 0, total: 1 })
    setError(null)
    try {
      const res = await postTicker(ticker)
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      await recordRun()
      await reloadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh.')
    } finally {
      setRefreshStatus(null)
    }
  }, [router, reloadData])

  // Refresh all tickers sequentially
  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    const failed: string[] = []
    try {
      for (let i = 0; i < STOCKS.length; i++) {
        setRefreshStatus({ ticker: STOCKS[i].ticker, done: i, total: STOCKS.length })
        try {
          const res = await postTicker(STOCKS[i].ticker)
          if (res.status === 401) { router.push('/login'); return }
          if (!res.ok) failed.push(STOCKS[i].ticker)
        } catch {
          failed.push(STOCKS[i].ticker)
        }
      }
      setRefreshStatus(null)
      await recordRun()
      await reloadData()
      if (failed.length > 0) setError(`Failed to refresh: ${failed.join(', ')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh news.')
    } finally {
      setRefreshing(false)
      setRefreshStatus(null)
    }
  }, [router, reloadData])

  useEffect(() => {
    loadCached()
  }, [loadCached])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const sortedTickers = data?.tickers
    ? [...data.tickers].sort((a, b) => {
        const aHas = a.articles.length > 0 ? 1 : 0
        const bHas = b.articles.length > 0 ? 1 : 0
        if (bHas !== aHas) return bHas - aHas
        const signalOrder = (t: TickerData) => {
          if (t.articles.some((a) => a.signal === '❌')) return 0
          if (t.articles.some((a) => a.signal === '⚠️')) return 1
          if (t.articles.some((a) => a.signal === '✅')) return 2
          return 3
        }
        return signalOrder(a) - signalOrder(b)
      })
    : STOCKS.map((s) => ({ ticker: s.ticker, tickerSummary: '', articles: [] }))

  const withNewsCount = data?.tickers?.filter((t) => t.articles.length > 0).length ?? 0
  const progressPct = refreshStatus ? Math.round((refreshStatus.done / refreshStatus.total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">Stock News</h1>
            <span className="text-xs text-gray-400 hidden sm:block">Financial News Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              disabled={refreshing || !!refreshStatus || loading}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh All
            </button>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Fetch status bar — visible during any refresh */}
        {refreshStatus && (
          <div className="bg-blue-600 text-white">
            <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
              <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-semibold flex-shrink-0">
                {refreshStatus.total === 1
                  ? `Refreshing ${refreshStatus.ticker}…`
                  : `Analyzing ${refreshStatus.ticker}`}
              </span>
              {refreshStatus.total > 1 && (
                <>
                  <div className="flex-1 bg-blue-500 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-white rounded-full h-2 transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-blue-200 font-mono flex-shrink-0 tabular-nums">
                    {refreshStatus.done}/{refreshStatus.total}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Coverage info */}
        {!loading && data && !data.noData && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-4 items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Coverage Window</p>
              <p className="text-sm text-gray-800 font-medium">
                {formatIST(data.coverageStart)} → {formatIST(data.coverageEnd)}
              </p>
            </div>
            <div className="space-y-0.5 text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Last Run</p>
              <p className="text-sm text-gray-800">{formatIST(data.runAt)}</p>
            </div>
            <div className="flex gap-4 text-sm">
              <div className="text-center">
                <p className="font-bold text-2xl text-blue-600">{withNewsCount}</p>
                <p className="text-xs text-gray-500">tickers with news</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-2xl text-gray-700">
                  {data.tickers?.reduce((sum, t) => sum + t.articles.length, 0) ?? 0}
                </p>
                <p className="text-xs text-gray-500">total articles</p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="flex flex-col gap-3">
            {STOCKS.map((s) => (
              <div
                key={s.ticker}
                className="rounded-xl border border-gray-200 bg-white px-5 py-4 animate-pulse flex items-center gap-3"
              >
                <div className="h-4 w-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded w-16" />
                <div className="h-3 bg-gray-100 rounded w-48" />
              </div>
            ))}
          </div>
        )}

        {/* No data yet */}
        {!loading && data?.noData && (
          <div className="text-center py-16">
            <p className="text-gray-500 text-lg mb-4">No data yet.</p>
            <p className="text-gray-400 text-sm mb-6">Click Refresh All to fetch and analyze the latest news.</p>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Refreshing…' : 'Fetch News Now'}
            </button>
          </div>
        )}

        {/* Cards */}
        {!loading && data && !data.noData && (
          <div className="flex flex-col gap-3">
            {sortedTickers.map((t) => (
              <TickerCard
                key={t.ticker}
                ticker={t.ticker}
                tickerSummary={t.tickerSummary}
                articles={t.articles}
                onRefresh={refreshing || !!refreshStatus ? undefined : () => refreshSingleTicker(t.ticker)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
