import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
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

// ─── Shared prompt builders ───────────────────────────────────────────────────

function analysisPrompt(ticker: string, title: string, snippet: string, seenEvents: string[]): string {
  const dupeBlock = seenEvents.length > 0
    ? `\nALREADY COVERED EVENTS for ${ticker} this session — mark relevant=false if this article is about the same event (even if worded differently):\n${seenEvents.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n`
    : ''

  return `You are a buy-side equity analyst covering Indian stocks. A portfolio manager is holding ${ticker} long-term and wants to know if this article changes their view or gives them an informational edge.

FIRST CHECK — is ${ticker} the primary subject?
The article must be MAINLY about ${ticker} or its direct business. If ${ticker} is only briefly mentioned, is one of many companies listed, or is a minor party (e.g. "among companies affected by..."), mark relevant=false immediately. Do not analyse further.
${dupeBlock}
MATERIAL (mark relevant=true):
- Earnings, revenue, margins, PAT — actual results or pre-announced numbers
- Order wins, contract awards, capacity additions, new product launches
- Analyst upgrades/downgrades WITH a price target or stated reason
- M&A, stake sale, promoter buying/selling, block deals
- Regulatory approvals, government policy that directly benefits/hurts the sector
- Guidance changes, management commentary on growth outlook
- Auditor issues, governance red flags, litigation with financial impact
- Macro/sector news that materially shifts the investment thesis (e.g. budget allocation for defence, FMCG rural demand data)

NOT MATERIAL (mark relevant=false):
- ${ticker} is a minor mention or one of many companies in a roundup
- Pure price move articles ("${ticker} rises 2% today") with no fundamental reason
- Generic market roundups where ${ticker} is briefly mentioned
- Duplicate or follow-up articles restating already-known news
- Analyst recs with no reasoning, target, or new data ("analysts bullish on ${ticker}")

Title: ${title}
Content: ${snippet.slice(0, 1200)}

Reply with JSON only — no prose:
{"relevant":bool,"signal":"✅"|"⚠️"|"❌"|null,"summary":"2 sentences: first states the key fact with any number/%, second states why it matters for a long-term holder"|null,"dip_verdict":"accumulate"|"hold"|"avoid"|"monitor"|null,"is_analyst_rec":bool}

Signal guide:
✅ = net positive: order win, earnings beat, upgrade with target, regulatory tailwind, capacity expansion
⚠️ = mixed or uncertain: soft quarter, unresolved headwind, analyst rec without data, minor governance concern
❌ = red flag: fraud, auditor resignation, severe earnings miss, regulatory ban, promoter pledging at scale, structural demand collapse

dip_verdict guide (only set if relevant=true):
"accumulate" = fundamentals intact or improving, price dip is an opportunity (✅ news + temporary price weakness)
"hold" = no new reason to add or reduce, thesis unchanged
"monitor" = something to watch but not act on yet — wait for next quarter or management clarification
"avoid" = thesis at risk or broken, do not add on dips`
}

function synthesisPrompt(ticker: string, tickerName: string, findings: string): string {
  return `You are summarizing analyst findings on ${ticker} (${tickerName}) for a portfolio manager.\n\nFindings from material articles:\n${findings}\n\nWrite ONE sentence (max 30 words) capturing the most important development. Include a key number (%, ₹ crore) if present. If mixed signals, note the dominant theme. One sentence only:`
}

function parseAnalysis(text: string): AnalysisResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { relevant: false, signal: null, summary: null, dipVerdict: null, isAnalystRec: false }
  const parsed = JSON.parse(jsonMatch[0])
  return {
    relevant: Boolean(parsed.relevant),
    signal: parsed.signal as Signal | null,
    summary: parsed.summary || null,
    dipVerdict: (parsed.dip_verdict as DipVerdict) || null,
    isAnalystRec: Boolean(parsed.is_analyst_rec),
  }
}

// ─── Provider implementations ─────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function analyzeWithGroq(ticker: string, title: string, snippet: string, seenEvents: string[]): Promise<AnalysisResult> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: 'llama-3.1-8b-instant', // 6000 RPM free tier vs 30 RPM for 70b
        max_tokens: 400,
        messages: [{ role: 'user', content: analysisPrompt(ticker, title, snippet, seenEvents) }],
      })
      const text = response.choices[0]?.message?.content ?? ''
      const inputTokens = response.usage?.prompt_tokens
      const outputTokens = response.usage?.completion_tokens
      return { ...parseAnalysis(text), inputTokens, outputTokens, provider: 'groq' }
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('429') && attempt < 2) {
        const wait = (attempt + 1) * 3000
        console.warn(`  [groq] rate limited, retrying in ${wait / 1000}s...`)
        await sleep(wait)
      } else {
        throw err
      }
    }
  }
  throw new Error('groq: max retries exceeded')
}

async function analyzeWithGemini(ticker: string, title: string, snippet: string, seenEvents: string[]): Promise<AnalysisResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })
  const result = await model.generateContent(analysisPrompt(ticker, title, snippet, seenEvents))
  const text = result.response.text()
  const inputTokens = result.response.usageMetadata?.promptTokenCount
  const outputTokens = result.response.usageMetadata?.candidatesTokenCount
  return { ...parseAnalysis(text), inputTokens, outputTokens, provider: 'gemini' }
}

async function analyzeWithClaude(ticker: string, title: string, snippet: string, seenEvents: string[]): Promise<AnalysisResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [{ role: 'user', content: analysisPrompt(ticker, title, snippet, seenEvents) }],
  })
  const content = response.content[0]
  const text = content.type === 'text' ? content.text : ''
  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  return { ...parseAnalysis(text), inputTokens, outputTokens, provider: 'claude' }
}

async function synthesizeWithGroq(prompt: string): Promise<string> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: 'llama-3.1-8b-instant', // fast model for simple summarisation, higher rate limit
        max_tokens: 80,
        messages: [{ role: 'user', content: prompt }],
      })
      return response.choices[0]?.message?.content?.trim() ?? ''
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('429') && attempt < 2) {
        const wait = (attempt + 1) * 3000
        console.warn(`  [groq:synth] rate limited, retrying in ${wait / 1000}s...`)
        await sleep(wait)
      } else {
        throw err
      }
    }
  }
  throw new Error('groq: max retries exceeded')
}

async function synthesizeWithGemini(prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })
  const result = await model.generateContent(prompt)
  return result.response.text().trim()
}

async function synthesizeWithClaude(prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 80,
    messages: [{ role: 'user', content: prompt }],
  })
  const content = response.content[0]
  return content.type === 'text' ? content.text.trim() : ''
}

// ─── Public API with fallback chain ──────────────────────────────────────────

const PROVIDERS = ['groq', 'gemini', 'claude'] as const
type Provider = typeof PROVIDERS[number]

function isAvailable(provider: Provider): boolean {
  if (provider === 'groq') return !!process.env.GROQ_API_KEY
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY
  if (provider === 'claude') return !!process.env.ANTHROPIC_API_KEY
  return false
}

export async function analyzeArticle(
  ticker: string,
  title: string,
  snippet: string,
  seenEvents: string[] = []
): Promise<AnalysisResult> {
  for (const provider of PROVIDERS) {
    if (!isAvailable(provider)) continue
    try {
      let result: AnalysisResult
      if (provider === 'groq') result = await analyzeWithGroq(ticker, title, snippet, seenEvents)
      else if (provider === 'gemini') result = await analyzeWithGemini(ticker, title, snippet, seenEvents)
      else result = await analyzeWithClaude(ticker, title, snippet, seenEvents)

      console.log(`  [${provider}] tokens in=${result.inputTokens} out=${result.outputTokens} relevant=${result.relevant} signal=${result.signal}`)
      return result
    } catch (err) {
      console.warn(`  [${provider}] failed, trying next:`, (err as Error).message.slice(0, 120))
    }
  }

  console.error(`  [analyzer] all providers failed for ${ticker}`)
  return { relevant: false, signal: null, summary: null, dipVerdict: null, isAnalystRec: false }
}

export async function synthesizeTicker(
  ticker: string,
  tickerName: string,
  summaries: string[]  // AI-generated summaries of relevant articles, not raw titles
): Promise<string> {
  if (summaries.length === 0) return 'No material news in the past 24 hours.'

  const findings = summaries.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n')
  const prompt = synthesisPrompt(ticker, tickerName, findings)

  for (const provider of PROVIDERS) {
    if (!isAvailable(provider)) continue
    try {
      let text: string
      if (provider === 'groq') text = await synthesizeWithGroq(prompt)
      else if (provider === 'gemini') text = await synthesizeWithGemini(prompt)
      else text = await synthesizeWithClaude(prompt)

      console.log(`  [synthesize:${provider}] ${ticker}: "${text.slice(0, 80)}"`)
      return text
    } catch (err) {
      console.warn(`  [synthesize:${provider}] failed:`, (err as Error).message.slice(0, 80))
    }
  }

  return 'Could not generate summary.'
}
