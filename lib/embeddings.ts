import { logger } from './logger'

// Simple in-memory cache for embeddings (TTL: 1 hour)
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

// Normalize query for cache key (lowercase, trim, remove extra spaces)
function normalizeQuery(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ')
}

// Get cached embedding or null
function getCachedEmbedding(text: string): number[] | null {
  const key = normalizeQuery(text)
  const cached = embeddingCache.get(key)
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug(`📦 Cache hit for: "${key.substring(0, 30)}..."`)
    return cached.embedding
  }
  
  // Clean up expired entry
  if (cached) {
    embeddingCache.delete(key)
  }
  
  return null
}

// Store embedding in cache
function cacheEmbedding(text: string, embedding: number[]): void {
  const key = normalizeQuery(text)
  embeddingCache.set(key, { embedding, timestamp: Date.now() })
  
  // Limit cache size to 500 entries (LRU-style cleanup)
  if (embeddingCache.size > 500) {
    const firstKey = embeddingCache.keys().next().value
    if (firstKey) embeddingCache.delete(firstKey)
  }
}

// Cache for spell corrections (avoids re-checking same misspellings)
const spellCache = new Map<string, string>()

// Spell correction using LLM (fast model)
export async function correctSpelling(query: string): Promise<string> {
  // Skip if query looks clean (no obvious typos)
  if (query.length < 3) return query
  
  // Skip if query is long (likely well-formed sentences)
  if (query.split(' ').length > 12) return query
  
  // Check spell cache
  const cacheKey = query.toLowerCase().trim()
  if (spellCache.has(cacheKey)) {
    const cached = spellCache.get(cacheKey)!
    logger.debug(`📦 Spell cache hit: "${query}" → "${cached}"`)
    return cached
  }
  
  const useOpenRouter = !!process?.env?.OPENROUTER_API_KEY
  const apiUrl = useOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://apps.abacus.ai/v1/chat/completions'
  const apiKey = useOpenRouter
    ? process.env.OPENROUTER_API_KEY
    : process.env.ABACUSAI_API_KEY

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(useOpenRouter ? {
          'HTTP-Referer': 'https://qbot.abacusai.app',
          'X-Title': 'QBOT - Spell Correction',
        } : {}),
      },
      body: JSON.stringify({
        model: useOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are a spell checker for climate/energy research queries. Fix obvious typos while preserving technical terms and acronyms.

Rules:
- Fix misspellings (nucleaer → nuclear, energi → energy, sustainible → sustainable)
- Preserve acronyms exactly (BECCS, CCS, CCUS, DAC, KTH)
- Preserve proper nouns and Swedish words (Stockholm, Exergi, Vinnova)
- If the query looks correct, return it unchanged
- Return ONLY the corrected query, nothing else
- Don't add punctuation or change capitalization unless fixing typos`
          },
          {
            role: 'user',
            content: query
          }
        ],
        temperature: 0,
        max_tokens: 100
      })
    })

    if (response.ok) {
      const data = await response.json()
      const corrected = data.choices?.[0]?.message?.content?.trim()
      
      if (corrected && corrected !== query) {
        logger.info(`🔧 Spell correction: "${query}" → "${corrected}"`)
        spellCache.set(cacheKey, corrected)
        return corrected
      }
    }
  } catch (error) {
    logger.debug('Spell correction failed, using original query:', error)
  }

  // Cache the original (no correction needed)
  spellCache.set(cacheKey, query)
  return query
}

// Generate embeddings using LLM API (with caching)
export async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache first
  const cached = getCachedEmbedding(text)
  if (cached) return cached
  try {
    // Use OpenRouter for embeddings (fallback to Abacus.AI if unavailable)
    const useOpenRouter = !!process?.env?.OPENROUTER_API_KEY
    const apiUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1/embeddings'
      : 'https://apps.abacus.ai/v1/embeddings'
    const apiKey = useOpenRouter
      ? process.env.OPENROUTER_API_KEY
      : process.env.ABACUSAI_API_KEY

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(useOpenRouter
          ? {
              'HTTP-Referer': 'https://qbot.kth.se',
              'X-Title': 'QBOT - KTH Climate Research Assistant',
            }
          : {}),
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small', // CRITICAL: Must match Supabase embeddings
      }),
    })

    if (!response?.ok) {
      const errorText = await response?.text?.()
      logger.error(`Embedding API error: ${response?.status}`, errorText)
      throw new Error(`Embedding API error: ${response?.status}`)
    }

    const data = await response?.json?.()
    const embedding = data?.data?.[0]?.embedding

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response')
    }

    // Cache the result
    cacheEmbedding(text, embedding)

    return embedding
  } catch (error) {
    logger.error('Error generating embedding:', error)
    throw error
  }
}
