-- Run this once in your Supabase SQL editor
-- Moves stocks config (RSS URLs + investment context) out of code and into DB

CREATE TABLE IF NOT EXISTS stocks (
  ticker      text PRIMARY KEY,
  name        text NOT NULL,
  rss_url     text NOT NULL,
  context     text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0
);

ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stocks"
  ON stocks FOR SELECT
  TO authenticated
  USING (true);

-- Seed your own portfolio below.
-- Get your Google Alerts RSS URL from: https://www.google.com/alerts → feed icon
INSERT INTO stocks (ticker, name, rss_url, context, sort_order) VALUES
(
  'EXAMPLE',
  'Example Company Ltd',
  'https://www.google.com/alerts/feeds/YOUR_ACCOUNT_ID/YOUR_FEED_ID',
  'Exclude if: generic sector roundup, price tracker
Include if: quarterly results, order wins, regulatory actions, management changes',
  1
)
ON CONFLICT (ticker) DO NOTHING;

-- Also add missing columns to analyzed_articles if not present
ALTER TABLE analyzed_articles ADD COLUMN IF NOT EXISTS dip_verdict text;
ALTER TABLE analyzed_articles ADD COLUMN IF NOT EXISTS is_analyst_rec boolean DEFAULT false;
