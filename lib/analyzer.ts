import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Signal } from './stocks'

export type DipVerdict = 'accumulate' | 'hold' | 'avoid' | 'monitor'

export interface AnalysisResult {
  relevant: boolean
  signal: Signal | null
  summary: string | null
  dipVerdict: DipVerdict | null
  isAnalystRec: boolean
  inputTokens?: number
  outputTokens?: number
  provider?: string
}

// ─── System prompt (overall analyst persona) ──────────────────────────────────

const SYSTEM_PROMPT = `You are a portfolio manager reviewing news for a long-term Indian equity investor. You think like someone who needs to decide: "does this change anything about my position?"

You already know these businesses well. No need for sector background or company introductions.

Your job per article:
- Is this specifically about the company's business, financials, management, or regulation?
- If yes, is it positive, negative, or worth monitoring?
- Surface it. If no, discard it.

You care about:
- Earnings, guidance, order wins/losses, regulatory actions, management changes
- Analyst calls that are specific and reasoned (not just target price changes)
- Sector news that directly names the company or materially affects its core business

You do NOT care about:
- Price movements, technical levels, 52-week highs/lows
- "Stocks to watch" roundups where this is one of 5+ tickers
- Broad Sensex/Nifty market commentary
- Recycled PR or IR fluff without new data

EXCEPTION — "Why is X falling/rising" articles: if the article explicitly names a specific business reason for the move (earnings miss, order cancellation, guidance cut, regulatory action, management statement), mark it relevant and surface that business reason as the signal. Ignore the price-movement framing; extract the underlying cause. A 5%+ single-day move almost always has a fundamental driver worth flagging.`

// ─── Shared prompt builders ───────────────────────────────────────────────────

function analysisPrompt(ticker: string, tickerName: string, context: string, title: string, snippet: string, seenEvents: string[]): string {
  const dupeBlock = seenEvents.length > 0
    ? `\nALREADY COVERED EVENTS this session — mark relevant=false if this covers the same event:\n${seenEvents.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n`
    : ''

  return `Stock: ${ticker} (${tickerName})
${context}
${dupeBlock}
Title: ${title}
Content: ${snippet.slice(0, 800)}

Reply with JSON only:
{"relevant":bool,"signal":"✅"|"⚠️"|"❌"|null,"summary":"2 sentences: key fact with number/%, then why it matters"|null,"dip_verdict":"accumulate"|"hold"|"avoid"|"monitor"|null,"is_analyst_rec":bool}

If the content snippet is short or generic, rely on the title — a specific title naming an order win, result, regulatory action, or analyst call is enough to mark relevant=true.

✅ = positive: order win, earnings beat, specific upgrade, regulatory tailwind
⚠️ = mixed/watch: soft results, downgrade, unresolved risk, governance concern
❌ = serious adverse: fraud, ban, >30% earnings collapse, thesis-breaking event
dip_verdict only if relevant=true`
}

export interface ArticleForSynthesis {
  signal: string
  summary: string
  title: string
}

function synthesisPrompt(ticker: string, tickerName: string, findings: string): string {
  return `You are briefing a portfolio manager on ${ticker} (${tickerName}).

Relevant developments:
${findings}

Write as bullet points, one per distinct development. Each bullet must be on its own line. Lead with the most important signal. Group related events into one bullet (e.g. multiple reports of the same crash = one bullet). Include key numbers (₹ crore, %). No headers, no source references. Use 2 bullets if the news is thin, up to 6 if there are many distinct developments. Do not pad.

Output format (one bullet per line, no blank lines between):
- first development
- second development
- third development`
}

function parseAnalysis(text: string): AnalysisResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { relevant: false, signal: null, summary: null, dipVerdict: null, isAnalystRec: false }
  // Models sometimes emit bare emoji as JSON values (e.g. "signal": ✅) which is invalid JSON
  const normalized = jsonMatch[0].replace(/:\s*(✅|⚠️|❌)/g, ': "$1"')
  const parsed = JSON.parse(normalized)
  return {
    relevant: Boolean(parsed.relevant),
    signal: (parsed.signal ?? null) as Signal | null,
    summary: parsed.summary || null,
    dipVerdict: (parsed.dip_verdict as DipVerdict) || null,
    isAnalystRec: Boolean(parsed.is_analyst_rec),
  }
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function analyzeWithGemini(ticker: string, tickerName: string, context: string, title: string, snippet: string, seenEvents: string[]): Promise<AnalysisResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  })
  const result = await model.generateContent(analysisPrompt(ticker, tickerName, context, title, snippet, seenEvents))
  const text = result.response.text()
  const inputTokens = result.response.usageMetadata?.promptTokenCount
  const outputTokens = result.response.usageMetadata?.candidatesTokenCount
  return { ...parseAnalysis(text), inputTokens, outputTokens, provider: 'gemini' }
}

async function synthesizeWithGemini(prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  const result = await model.generateContent(prompt)
  return result.response.text().trim()
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function analyzeArticle(
  ticker: string,
  tickerName: string,
  context: string,
  title: string,
  snippet: string,
): Promise<AnalysisResult> {
  try {
    const result = await analyzeWithGemini(ticker, tickerName, context, title, snippet, [])
    console.log(`  [gemini] tokens in=${result.inputTokens} out=${result.outputTokens} relevant=${result.relevant} signal=${result.signal}`)
    return result
  } catch (err) {
    console.error(`  [analyzer] gemini failed for ${ticker}:`, (err as Error).message.slice(0, 120))
    return { relevant: false, signal: null, summary: null, dipVerdict: null, isAnalystRec: false }
  }
}

export async function synthesizeTicker(
  ticker: string,
  tickerName: string,
  articles: ArticleForSynthesis[]
): Promise<string> {
  if (articles.length === 0) return 'No material news in the past 24 hours.'

  const findings = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. ${a.signal} ${a.summary} [${a.title.slice(0, 70)}]`
  ).join('\n')
  const prompt = synthesisPrompt(ticker, tickerName, findings)

  try {
    const text = await synthesizeWithGemini(prompt)
    console.log(`  [synthesize:gemini] ${ticker}: "${text.slice(0, 80)}"`)
    return text
  } catch (err) {
    console.warn(`  [synthesize:gemini] failed:`, (err as Error).message.slice(0, 80))
    return 'Could not generate summary.'
  }
}
