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

const DIP_VERDICT_STYLE: Record<string, { label: string; color: string }> = {
  accumulate: { label: 'Accumulate on dip', color: 'text-positive' },
  hold:       { label: 'Hold',              color: 'text-warning'  },
  monitor:    { label: 'Monitor',           color: 'text-warning'  },
  avoid:      { label: 'Avoid adding',      color: 'text-negative' },
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

// Maps signal emoji to Haku token colour class
const SIGNAL_COLOR: Record<string, string> = {
  '❌': 'text-negative',
  '⚠️': 'text-warning',
  '✅': 'text-positive',
}

export default function TickerCard({ ticker, name, tickerSummary, articles, onRefresh }: TickerCardProps) {
  const [expanded, setExpanded] = useState(false)
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
    <div onClick={() => setExpanded((v) => !v)} className="tap-row cursor-pointer select-none" style={{ borderBottom: '1px solid var(--divider)' }}>
      {/* Row — min 48px per Haku ListRow contract */}
      <div className="flex items-center gap-3 px-4 min-h-[48px] py-3">
        {/* Primary: ticker symbol — headline (17px/600) */}
        <span className="text-headline flex-shrink-0 min-w-[5.5rem]" style={{ color: 'var(--text-primary)' }}>
          {ticker}
        </span>

        {/* Secondary: signal — subheadline (13px/400) */}
        <span className="flex-1 min-w-0">
          {hasNews && topSignal ? (
            <span className={`text-subheadline ${SIGNAL_COLOR[topSignal]}`}>
              {topSignal} {articles.length} signal{articles.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-subheadline" style={{ color: 'var(--text-faint)' }}>No updates</span>
          )}
        </span>

        {/* Trailing: refresh + chevron */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onRefresh && (
            <div
              onClick={handleRefresh}
              role="button"
              aria-label={`Refresh ${ticker}`}
              className="flex items-center justify-center min-h-tap min-w-tap"
            >
              <svg
                className={`h-4 w-4 ${isRefreshing ? 'text-accent animate-spin' : ''}`}
                style={!isRefreshing ? { color: 'var(--text-faint)' } : undefined}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          )}
          <svg
            className={`h-3 w-3 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            style={{ color: 'var(--text-faint)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Expanded body — tapping here also collapses */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* Company name — footnote */}
          {name && (
            <p className="text-footnote mb-2" style={{ color: 'var(--text-faint)' }}>{name}</p>
          )}

          {hasNews ? (
            <div className="space-y-3">
              {/* Bullets — body (15px) */}
              <ul className="space-y-1.5">
                {parseBullets(tickerSummary).map((bullet, i) => (
                  <li key={i} className="flex gap-2 text-body" style={{ color: 'var(--text-primary)' }}>
                    <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }}>•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              {/* Dip verdict — subheadline */}
              {topDipVerdict && DIP_VERDICT_STYLE[topDipVerdict] && (
                <p className={`text-subheadline font-medium ${DIP_VERDICT_STYLE[topDipVerdict].color}`}>
                  {DIP_VERDICT_STYLE[topDipVerdict].label}
                </p>
              )}

              {/* Sources — stopPropagation so tapping doesn't collapse */}
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setSourcesExpanded((v) => !v)}
                  className="text-subheadline min-h-tap flex items-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {sourcesExpanded ? 'Hide' : 'Show'} {Math.min(articles.length, 5)} source{Math.min(articles.length, 5) !== 1 ? 's' : ''}
                </button>
                {sourcesExpanded && (
                  <div className="space-y-3 pb-1">
                    {getTopSources(articles).map((article, i) => (
                      <div key={i}>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-body text-accent block leading-snug"
                        >
                          {article.title}
                        </a>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-subheadline tabnum" style={{ color: 'var(--text-faint)' }}>
                            {formatIST(article.publishedAt)}
                          </span>
                          {article.isAnalystRec && (
                            <span className="text-subheadline font-medium" style={{ color: '#BF5AF2' }}>
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
            <p className="text-body" style={{ color: 'var(--text-faint)' }}>No material updates in this period.</p>
          )}
        </div>
      )}
    </div>
  )
}
