'use client'

import { useState } from 'react'
import { type Signal } from '@/lib/stocks'

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
  accumulate: { label: 'Accumulate on dip', classes: 'text-emerald-700' },
  hold:       { label: 'Hold',              classes: 'text-blue-600' },
  monitor:    { label: 'Monitor',           classes: 'text-yellow-700' },
  avoid:      { label: 'Avoid adding',      classes: 'text-red-600' },
}

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
  const lines = text.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  if (lines.length > 1) return lines
  const inline = text.split(/\s+-\s+/).map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  if (inline.length > 1) return inline
  return lines
}

interface TickerCardProps {
  ticker: string
  name?: string
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

const SIGNAL_COLOR: Record<string, string> = {
  '❌': 'text-red-600',
  '⚠️': 'text-yellow-600',
  '✅': 'text-emerald-600',
}

export default function TickerCard({ ticker, name, tickerSummary, articles, onRefresh }: TickerCardProps) {
  const [expanded, setExpanded] = useState(true)
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const topSignal = getTopSignal(articles)
  const hasNews = articles.length > 0
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
    <div>
      {/* Row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 py-3 text-left"
      >
        <span className="font-mono text-sm font-semibold text-gray-900 w-14 flex-shrink-0">{ticker}</span>

        {hasNews && topSignal ? (
          <span className={`text-sm ${SIGNAL_COLOR[topSignal]}`}>
            {topSignal} {articles.length} signal{articles.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-xs text-gray-400 italic">No updates</span>
        )}

        {name && <span className="text-xs text-gray-400 hidden sm:block">{name}</span>}

        <div className="ml-auto flex items-center gap-2">
          {onRefresh && (
            <span
              role="button"
              onClick={handleRefresh}
              title={`Refresh ${ticker}`}
              className={`text-xs transition-colors ${
                isRefreshing ? 'text-blue-400 cursor-not-allowed' : 'text-gray-300 hover:text-blue-500 cursor-pointer'
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
          <svg
            className={`h-3 w-3 text-gray-300 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="pb-3 pl-14">
          {hasNews ? (
            <div className="space-y-2">
              <ul className="space-y-1 text-sm text-gray-700 leading-relaxed">
                {parseBullets(tickerSummary).map((bullet, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gray-300 flex-shrink-0">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              {topDipVerdict && DIP_VERDICT_STYLE[topDipVerdict] && (
                <p className={`text-xs font-medium ${DIP_VERDICT_STYLE[topDipVerdict].classes}`}>
                  {DIP_VERDICT_STYLE[topDipVerdict].label}
                </p>
              )}

              <div className="pt-1">
                <button
                  onClick={() => setSourcesExpanded((v) => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {sourcesExpanded ? 'Hide' : 'Show'} {Math.min(articles.length, 5)} source{Math.min(articles.length, 5) !== 1 ? 's' : ''}
                </button>
                {sourcesExpanded && (
                  <div className="mt-2 space-y-2">
                    {getTopSources(articles).map((article, i) => (
                      <div key={i}>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline leading-snug block"
                        >
                          {article.title}
                        </a>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">{formatIST(article.publishedAt)}</span>
                          {article.isAnalystRec && (
                            <span className="text-xs text-purple-600 font-medium">Analyst rec</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No material updates in this period.</p>
          )}
        </div>
      )}
    </div>
  )
}
