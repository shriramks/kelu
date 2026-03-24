# Kelu

Kelu filters the noise out of financial news for your stock picks — pulling from Google Alerts, running each article through Gemini AI, and surfacing only what actually matters for a long-term investor.

---

## Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [AI Features](#ai-features)
- [Docs](#docs)

---

## The Problem

Following a focused set of stocks across Indian financial media means wading through:
- "Stocks to watch" roundups where your holding is one of 50
- Price movement articles with no fundamental content
- Recycled analyst targets with no new reasoning
- Generic sector commentary that never names your company

The signal-to-noise ratio is terrible. A tax demand slashed by 90%, a major order win, a regulatory ruling — these get buried under the same volume of noise as a stock-price tick.

---

## The Solution

Kelu connects a Google Alerts RSS feed to each stock in your watchlist. Every refresh:

1. Fetches new articles from each feed
2. Fetches the full meta description from each article URL for richer context
3. Runs each article through Gemini AI — is this actually material for a long-term investor?
4. Stores results and surfaces only what passes the filter, with a signal flag and a plain-English summary
5. After all articles are analysed, synthesises everything into a short bullet-point briefing per ticker — so you read a three-line AI summary, not ten headlines

No brokerage integration. No auto-sync. Intentionally manual.

---

## AI Features

Analysis uses **Gemini 2.5 Flash** (Groq llama-3.1-8b as fallback):

- **Per-article signal**: ✅ positive catalyst, ⚠️ watch, ❌ thesis-breaking event
- **Dip verdict**: `accumulate / hold / monitor / avoid` — should you add if the stock pulls back?
- **AI summary**: after each refresh, Gemini reads all signals found in the window and writes a short bullet-point briefing per ticker — what happened, why it matters, and whether the thesis holds

Tap any ticker to expand its AI-written summary. Sources are listed below it if you want to verify.

Stocks and their investment context (what to include, what to ignore) are configured in Supabase — no hardcoded watchlist in the code.

---

## Docs

| Document | Description |
|----------|-------------|
| [docs/architecture.md](docs/architecture.md) | Data flow, filters, edge cases, DB schema |

---

## Built with

Vibe-coded with [Claude Code](https://claude.ai/code). Stack: Next.js 14, TypeScript, Tailwind CSS, Supabase, Gemini 2.5 Flash.
