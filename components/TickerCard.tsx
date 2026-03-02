'use client'

import { useState } from 'react'
import { STOCKS, getSignalBg, getSignalBadge, type Signal } from '@/lib/stocks'

interface Article {
  title: string
  url: string
  publishedAt: string
  summary: string
  signal: string
  dipVerdict: string | null
  isAnalystRec: boolean
}

const DIP_VERDICT_STYLE: Record<string, { label: string; classes: string }> = {
  accumulate: { label: 'Accumulate on dip', classes: 'bg-emerald-100 text-emerald-800' },
  hold:       { label: 'Hold',              classes: 'bg-blue-100 text-blue-700' },
  monitor:    { label: 'Monitor',           classes: 'bg-yellow-100 text-yellow-800' },
  avoid:      { label: 'Avoid adding',      classes: 'bg-red-100 text-red-700' },
}

interface TickerCardProps {
  ticker: string
  tickerSummary: string
  articles: Article[]
  onRefresh?: () => Promise<void>
}

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

function getTopSignal(articles: Article[]): Signal | null {
  if (articles.some((a) => a.signal === '❌')) return '❌'
  if (articles.some((a) => a.signal === '⚠️')) return '⚠️'
  if (articles.some((a) => a.signal === '✅')) return '✅'
  return null
}

export default function TickerCard({ ticker, tickerSummary, articles, onRefresh }: TickerCardProps) {
  const [expanded, setExpanded] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const stock = STOCKS.find((s) => s.ticker === ticker)
  const topSignal = getTopSignal(articles)
  const hasNews = articles.length > 0
  const cardBg = hasNews ? getSignalBg(topSignal) : 'bg-white border-gray-200'

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onRefresh || isRefreshing) return
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className={`rounded-xl border ${cardBg} transition-all`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Chevron */}
          <svg
            className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>

          <div className="min-w-0">
            <span className="font-bold text-gray-900 text-sm">{ticker}</span>
            {stock && <span className="ml-2 text-xs text-gray-500">{stock.name}</span>}
            {!expanded && tickerSummary && (
              <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{tickerSummary}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {hasNews && topSignal ? (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getSignalBadge(topSignal)}`}>
              {topSignal} {articles.length} update{articles.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-xs text-gray-400 italic">No material updates</span>
          )}

          {/* Per-ticker refresh button */}
          {onRefresh && (
            <span
              role="button"
              onClick={handleRefresh}
              title={`Refresh ${ticker}`}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                isRefreshing
                  ? 'text-blue-500 bg-blue-50 cursor-not-allowed'
                  : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer'
              }`}
            >
              <svg
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </span>
          )}
        </div>
      </button>

      {/* Collapsible body */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-200">
          {tickerSummary && (
            <p className="text-sm text-gray-600 italic pt-3 pb-3 leading-snug">{tickerSummary}</p>
          )}

          {hasNews ? (
            <div className={`space-y-3 ${tickerSummary ? 'border-t border-gray-200 pt-3' : 'pt-3'}`}>
              {articles.map((article, i) => (
                <div key={i} className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start gap-2 mb-1">
                    <span className="text-base mt-0.5 flex-shrink-0">{article.signal}</span>
                    <div className="min-w-0">
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-700 hover:underline leading-snug"
                      >
                        {article.title}
                      </a>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed ml-6">{article.summary}</p>
                  <div className="ml-6 mt-1.5 flex flex-wrap items-center gap-2">
                    {article.dipVerdict && DIP_VERDICT_STYLE[article.dipVerdict] && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${DIP_VERDICT_STYLE[article.dipVerdict].classes}`}>
                        {DIP_VERDICT_STYLE[article.dipVerdict].label}
                      </span>
                    )}
                    {article.isAnalystRec && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                        Analyst Rec — verify independently
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{formatIST(article.publishedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic pt-3">No material updates in this period.</p>
          )}
        </div>
      )}
    </div>
  )
}
