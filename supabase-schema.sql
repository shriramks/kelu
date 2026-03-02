-- Run this in your Supabase SQL editor

-- Table: analyzed_articles
-- Stores every article that was analyzed (for dedup and display)
CREATE TABLE IF NOT EXISTS analyzed_articles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker        text NOT NULL,
  article_url   text NOT NULL,
  article_title text,
  published_at  timestamptz,
  summary       text,           -- null if not relevant
  signal        text,           -- '✅' | '⚠️' | '❌' | null
  created_at    timestamptz DEFAULT now(),
  UNIQUE(ticker, article_url)
);

-- Index for efficient coverage window queries
CREATE INDEX IF NOT EXISTS idx_analyzed_articles_ticker_published
  ON analyzed_articles(ticker, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_analyzed_articles_published
  ON analyzed_articles(published_at DESC);

-- Table: news_runs
-- Tracks each run for coverage window tracking
CREATE TABLE IF NOT EXISTS news_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at            timestamptz DEFAULT now(),
  coverage_start    timestamptz,
  coverage_end      timestamptz,
  ticker_summaries  jsonb         -- cached one-liner per ticker, keyed by ticker symbol
);

-- Migration: add ticker_summaries to existing news_runs table
-- ALTER TABLE news_runs ADD COLUMN IF NOT EXISTS ticker_summaries jsonb;

-- Table: ticker_synthesis
-- Stores the latest AI-generated one-liner summary per ticker.
-- Updated only when new signals are found, so repeated refreshes don't waste Groq quota.
CREATE TABLE IF NOT EXISTS ticker_synthesis (
  ticker      text PRIMARY KEY,
  summary     text,
  updated_at  timestamptz DEFAULT now()
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE analyzed_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by API routes)
-- The service role bypasses RLS by default in Supabase

-- If you want to allow authenticated users to read:
CREATE POLICY "Authenticated users can read analyzed_articles"
  ON analyzed_articles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read news_runs"
  ON news_runs FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE ticker_synthesis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ticker_synthesis"
  ON ticker_synthesis FOR SELECT
  TO authenticated
  USING (true);
