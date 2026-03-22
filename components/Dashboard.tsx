'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import TickerCard from './TickerCard'

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
  name: string
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
    const tickersToRefresh = data?.tickers ?? []
    try {
      for (let i = 0; i < tickersToRefresh.length; i++) {
        setRefreshStatus({ ticker: tickersToRefresh[i].ticker, done: i, total: tickersToRefresh.length })
        try {
          const res = await postTicker(tickersToRefresh[i].ticker)
          if (res.status === 401) { router.push('/login'); return }
          if (!res.ok) failed.push(tickersToRefresh[i].ticker)
        } catch {
          failed.push(tickersToRefresh[i].ticker)
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
  }, [router, reloadData, data])

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
    : []

  const withNewsCount = data?.tickers?.filter((t) => t.articles.length > 0).length ?? 0
  const progressPct = refreshStatus ? Math.round((refreshStatus.done / refreshStatus.total) * 100) : 0

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <header className="border-b border-gray-200 sticky top-0 z-10 bg-white">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-gray-900 tracking-tight">Kelu</h1>
            {!loading && data && !data.noData && (
              <span className="text-xs text-gray-400">
                {formatIST(data.coverageStart)} — {formatIST(data.coverageEnd)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {refreshStatus && (
              <span className="text-xs text-gray-500">
                {refreshStatus.total === 1
                  ? `Refreshing ${refreshStatus.ticker}…`
                  : `${refreshStatus.ticker} (${refreshStatus.done}/${refreshStatus.total})`}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={refreshing || !!refreshStatus || loading}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {refreshing || !!refreshStatus ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              onClick={handleSignOut}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4">
        {/* Error */}
        {error && (
          <p className="py-3 text-xs text-red-600">{error}</p>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="divide-y divide-gray-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="py-3 flex items-center gap-4 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-12" />
                <div className="h-3 bg-gray-100 rounded w-32" />
              </div>
            ))}
          </div>
        )}

        {/* No data yet */}
        {!loading && data?.noData && (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-500 mb-4">No data yet.</p>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors"
            >
              {refreshing ? 'Refreshing…' : 'Fetch news now'}
            </button>
          </div>
        )}

        {/* Flat list */}
        {!loading && data && !data.noData && (
          <div className="divide-y divide-gray-100">
            {sortedTickers.map((t) => (
              <TickerCard
                key={t.ticker}
                ticker={t.ticker}
                name={t.name}
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
