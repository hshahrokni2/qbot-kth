export type WebSearchResult = {
  title: string
  url: string
  source?: string
  snippet?: string
}

export type WebSearchResponse = {
  answer: string
  results: WebSearchResult[]
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'web'
  }
}

async function fetchTitle(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'QBOT/1.0' },
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const html = await res.text()
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (!titleMatch?.[1]) return null

    return titleMatch[1]
      .trim()
      .replace(/\s*[\|–-]\s*[^|–-]+$/, '') // Remove site name suffix
      .slice(0, 80)
  } catch {
    return null
  }
}

function fallbackTitle(url: string): string {
  const host = safeHostname(url)
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || ''
    const candidate = last
      .replace(/[-_]/g, ' ')
      .replace(/\.\w+$/, '')
      .trim()
    return candidate || host
  } catch {
    return host
  }
}

export async function webSearch(
  query: string,
  limit = 5,
  opts?: { timeoutMs?: number; titleTimeoutMs?: number }
): Promise<WebSearchResponse> {
  const trimmed = query?.trim?.() ?? ''
  if (!trimmed) return { answer: '', results: [] }

  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) return { answer: '', results: [] }

  const timeoutMs = opts?.timeoutMs ?? 10_000
  const titleTimeoutMs = opts?.titleTimeoutMs ?? 1500

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful research assistant. Provide concise, factual answers with sources. Prefer recent and authoritative information.',
          },
          { role: 'user', content: trimmed },
        ],
        max_tokens: 900,
        temperature: 0.2,
        return_citations: true,
        return_related_questions: false,
      }),
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { answer: '', results: [] }
    }

    const data = await response.json()
    const answer = data?.choices?.[0]?.message?.content || ''
    const citations: string[] = Array.isArray(data?.citations) ? data.citations : []

    const urls = citations
      .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
      .slice(0, limit)

    const results = await Promise.all(
      urls.map(async (url) => {
        const source = safeHostname(url)
        const title = (await fetchTitle(url, titleTimeoutMs)) ?? fallbackTitle(url)
        return { title, url, source, snippet: '' } satisfies WebSearchResult
      })
    )

    return { answer, results }
  } catch {
    clearTimeout(timeout)
    return { answer: '', results: [] }
  }
}


