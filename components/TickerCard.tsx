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

// Pick the most actionable dip verdict across all articles
const VERDICT_PRIORITY = ['accumulate', 'avoid', 'monitor', 'hold']
function getTopDipVerdict(articles: Article[]): string | null {
  for (const v of VERDICT_PRIORITY) {
    if (articles.some((a) => a.dipVerdict === v)) return v
  }
  return null
}

const SIGNAL_SORT_ORDER: Record<string, number> = { '❌': 0, '⚠️': 1, '✅': 2 }
function getTopSources(articles: Article[], limit = 5): Article[] {
  return [...articles]
    .sort((a, b) => (SIGNAL_SORT_ORDER[a.signal] ?? 3) - (SIGNAL_SORT_ORDER[b.signal] ?? 3))
    .slice(0, limit)
}

function parseBullets(text: string): string[] {
  // Try newline-separated first
  const lines = text.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  if (lines.length > 1) return lines
  // Fallback: inline bullets separated by " - "
  const inline = text.split(/\s+-\s+/).map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  if (inline.length > 1) return inline
  return lines
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
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const stock = STOCKS.find((s) => s.ticker === ticker)
  const topSignal = getTopSignal(articles)
  const hasNews = articles.length > 0
  const cardBg = hasNews ? getSignalBg(topSignal) : 'bg-white border-gray-200'
  const topDipVerdict = getTopDipVerdict(articles)

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
          <svg
            className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <div className="min-w-0">
            <span className="font-bold text-gray-900 text-sm">{ticker}</span>
            {stock && <span className="ml-2 text-xs text-gray-500">{stock.name}</span>}
            {!expanded && tickerSummary && hasNews && (
              <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{tickerSummary}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {hasNews && topSignal ? (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getSignalBadge(topSignal)}`}>
              {topSignal} {articles.length} signal{articles.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-xs text-gray-400 italic">No material updates</span>
          )}

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
          {hasNews ? (
            <div className="pt-3 space-y-3">
              {/* Bullet summary */}
              <ul className="space-y-1.5 text-sm text-gray-800 leading-relaxed">
                {parseBullets(tickerSummary).map((bullet, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gray-400 flex-shrink-0 mt-0.5">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              {/* Dip verdict */}
              {topDipVerdict && DIP_VERDICT_STYLE[topDipVerdict] && (
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${DIP_VERDICT_STYLE[topDipVerdict].classes}`}>
                    {DIP_VERDICT_STYLE[topDipVerdict].label}
                  </span>
                </div>
              )}

              {/* Sources toggle */}
              <div className="border-t border-gray-100 pt-3">
                <button
                  onClick={() => setSourcesExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg
                    className={`h-3 w-3 transition-transform duration-150 ${sourcesExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  {Math.min(articles.length, 5)} source{Math.min(articles.length, 5) !== 1 ? 's' : ''}
                </button>
                {sourcesExpanded && (
                  <div className="mt-2 space-y-1.5">
                    {getTopSources(articles).map((article, i) => (
                      <div key={i} className="min-w-0">
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline leading-snug block truncate"
                        >
                          {article.title}
                        </a>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">{formatIST(article.publishedAt)}</span>
                          {article.isAnalystRec && (
                            <span className="text-xs px-1 py-0 rounded bg-purple-100 text-purple-700 font-medium">
                              Analyst rec
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic pt-3">No material updates in this period.</p>
          )}
        </div>
      )}
    </div>
  )
}
