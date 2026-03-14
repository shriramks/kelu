# Kelu — Architecture

## Overview

```
Google Alerts RSS feeds (one per ticker) → rss-parser → Gemini AI → Supabase → UI
```

**Storage (Supabase tables)**

| Table | Purpose |
|-------|---------|
| `stocks` | Ticker list with RSS URLs and investment context — edit here to add/remove stocks |
| `analyzed_articles` | Every analyzed article with its AI verdict |
| `ticker_synthesis` | Latest bullet-point summary per ticker |
| `news_runs` | Timestamps of each refresh run |

**AI providers** (priority order): Gemini 2.5 Flash → Groq llama-3.1-8b (fallback)

No cron jobs — all refreshes are manual.

---

## On Page Load — GET /api/news

Pure DB read. No AI calls.

1. Auth check via Supabase session cookie. 401 → redirect to `/login`.
2. Compute coverage window: `now - 48h` to `now`.
3. Parallel DB queries:
   - `stocks` — full ticker list (drives what cards are shown)
   - `analyzed_articles` — articles within coverage window with a non-null signal, newest first
   - `ticker_synthesis` — latest summary per ticker (no time filter)
   - `news_runs` — most recent run timestamp
4. If no last run and no articles → `{ noData: true }`.
5. Build per-ticker result and return.

**Known issue — stale synthesis:** `ticker_synthesis` has no expiry. A ticker with no new news today can still show a summary from a previous run. Not fixed yet.

---

## On Refresh — Client Flow

**Refresh All:**
```
for each ticker in stocks (sequentially):
  POST /api/news { ticker }    ← waits for each to complete
POST /api/news {}              ← records run timestamp
GET /api/news                  ← reloads display
```

**Per-ticker refresh** (card button): same pattern, single ticker only.

---

## POST /api/news { ticker } — Single Ticker Analysis

### Step 1 — Parallel fetch: RSS + DB dedup

Both happen simultaneously:

**RSS fetch:**
- Calls the ticker's Google Alerts feed via rss-parser
- Filters by `pubDate` within the 48h coverage window
- Extracts snippet from `content:encoded`, `summary`, `content`, or `contentSnippet`

**DB dedup:**
- Queries `analyzed_articles` for this ticker within the coverage window
- Builds `seenUrls` = article URLs that already have a non-null signal
- Articles already analyzed as irrelevant (signal = null) are NOT in seenUrls — they will be re-analyzed on each refresh

### Step 2 — Filter + enrich

- Drops articles whose URL is already in `seenUrls`
- Caps at 20 new articles per refresh
- Fetches `og:description` or `meta description` from each article URL (3s timeout, first 50KB only)
- Deduplicates by title similarity within the batch (Jaccard > 50% word overlap → skip)

### Step 3 — AI analysis (Gemini → Groq fallback)

Sends each article:
- System prompt: portfolio manager persona
- User message: ticker, investment context (from `stocks` table), title + snippet (≤800 chars)

Returns JSON:
```json
{ "relevant": bool, "signal": "✅"|"⚠️"|"❌"|null, "summary": "...", "dip_verdict": "accumulate|hold|monitor|avoid", "is_analyst_rec": bool }
```

Always upserts result to `analyzed_articles` regardless of relevance.

### Step 4 — Synthesis

If at least one new signal was found: queries all relevant articles for this ticker in the window, sends to Gemini for bullet-point synthesis, upserts to `ticker_synthesis`.

If no new signals: synthesis is skipped. Previous summary stays.

---

## What "No News in Window" Means

When a ticker shows no articles, one of:

| Cause | Log to check |
|-------|-------------|
| RSS feed returned 0 articles in the 48h window | `[TICKER] RSS: 0 articles in window` |
| All articles already had a signal in DB | `[TICKER] 0 to analyze (N already have a signal)` |
| All articles were marked irrelevant by AI | `relevant=false signal=null` for every article |

**Debugging:** Check Vercel function logs → Functions tab → POST /api/news, filter by ticker.

---

## Google Alerts Behaviour

- Alerts **batch** RSS updates. An article published at 10am may not appear in the feed until 2–4pm.
- Google uses the **article's original** `published_at`, not the feed batch time. So a 10am article batched at 2pm still has `pubDate = 10am` — it passes the 48h filter as long as it's within 48h of now.
- Google occasionally surfaces **old articles** (recirculated) with their original old timestamp. These get dropped by the pubDate filter before reaching AI.

---

## Known Edge Cases

1. **Stale synthesis** — `ticker_synthesis` has no expiry. A ticker with no news today can show a summary from a previous run.
2. **5-article cap** — only the first 20 new articles per refresh are analyzed. On heavy news days, some articles may age out before the next refresh picks them up.
3. **Irrelevant articles re-analyzed** — articles with `signal=null` are not deduplicated, so they are re-sent to AI on every refresh. Harmless but wastes tokens.
4. **Coverage window drift** — each POST computes its own `now()`. A 12-ticker refresh takes ~2–3 mins, so the last ticker's window is slightly newer than the first's. Practically harmless.

---

## DB Schema

**analyzed_articles**
```
id             uuid PK
ticker         text
article_url    text                ← Google redirect URL
article_title  text
published_at   timestamptz         ← from RSS pubDate
summary        text | null         ← null if relevant=false
signal         text | null         ← '✅' | '⚠️' | '❌' | null
dip_verdict    text | null         ← 'accumulate' | 'hold' | 'monitor' | 'avoid'
is_analyst_rec boolean
created_at     timestamptz
UNIQUE(ticker, article_url)
```

**ticker_synthesis**
```
ticker         text PK
summary        text
updated_at     timestamptz
```

**stocks**
```
ticker         text PK
name           text
rss_url        text
context        text                ← investment context sent to AI per article
sort_order     integer
```

**news_runs**
```
id             uuid PK
run_at         timestamptz
coverage_start timestamptz
coverage_end   timestamptz
```
