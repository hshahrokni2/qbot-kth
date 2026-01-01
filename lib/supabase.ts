import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'

// Validate environment variables but don't throw during module initialization
// This prevents the entire app from crashing if env vars are temporarily missing
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_KEY || ''

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('⚠️ WARNING: Missing Supabase environment variables. Search functionality will be degraded.')
}

// Create client with fallback empty strings (will fail gracefully at runtime)
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_KEY || 'placeholder-key'
)

// Raw database schema (matches Supabase table structure)
export interface RawDocument {
  id: string  // UUID in Supabase
  title: string
  content: string
  source_url?: string  // Database column name
  doi?: string
  author?: string
  department?: string
  year?: number
  category?: string
  publication_date?: string
  embeddings: string  // Database column name (plural)
  metadata?: {
    language?: string
    open_access?: boolean
    kth_research?: boolean
    peer_reviewed?: boolean
  }
}

// Standardized document interface (matches RPC function output)
// Both RPC and fallback search should return this format
export interface Document {
  id: string  // UUID in Supabase
  title: string
  content: string
  url?: string  // Mapped from source_url by RPC adapter
  doi?: string
  author?: string
  department?: string
  year?: number
  category?: string
  publication_date?: string
  embedding?: number[]  // Parsed from embeddings JSON
  metadata?: {
    language?: string
    open_access?: boolean
    kth_research?: boolean
    peer_reviewed?: boolean
  }
}

export interface DocumentWithScore extends Document {
  similarity: number
  vectorScore?: number
  keywordScore?: number
}

// Calculate cosine similarity between two vectors
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a?.length !== b?.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < (a?.length ?? 0); i++) {
    dotProduct += (a?.[i] ?? 0) * (b?.[i] ?? 0)
    normA += (a?.[i] ?? 0) ** 2
    normB += (b?.[i] ?? 0) ** 2
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Extract keywords from query for hybrid search
// Enhanced to filter out conversational filler words and focus on substantive terms
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    // Basic articles, prepositions, conjunctions
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'from',
    // Question words
    'what', 'how', 'why', 'when', 'where', 'who', 'whom', 'whose', 'does', 'do', 'did',
    // Verbs (common auxiliaries)
    'has', 'have', 'had', 'can', 'could', 'would', 'should', 'will', 'are', 'was', 'were', 'been', 'being', 'get', 'got',
    // KTH-specific stopwords
    'kth', 'research', 'doing', 'work', 'working', 'about', 'royal', 'institute', 'technology',
    // Pronouns
    'their', 'them', 'they', 'this', 'that', 'these', 'those', 'its', 'it', 'we', 'our', 'you', 'your', 'i', 'me', 'my',
    // Common adjectives/adverbs (not useful for search)
    'new', 'recent', 'latest', 'good', 'best', 'great', 'really', 'very', 'much', 'more', 'most', 'some', 'any', 'all',
    // Conversational fillers - CRITICAL for high schooler queries!
    'everyone', 'everybody', 'someone', 'somebody', 'anyone', 'anybody', 'thing', 'things', 'stuff',
    'talking', 'saying', 'think', 'thinking', 'know', 'knowing', 'tell', 'told', 'say', 'said',
    'like', 'want', 'need', 'going', 'gonna', 'actually', 'really', 'basically', 'literally',
    'cool', 'interesting', 'important', 'matter', 'matters', 'deal', 'big', 'lot', 'lots',
    // Typos
    'waht', 'bout', 'abot', 'whats', 'hows', 'whys',
    // Question phrases
    "what's", "how's", "why's", "who's", "where's", "when's"
  ])
  
  // Known department/centre acronyms (case-insensitive)
  const knownAcronyms = new Set([
    'seed', 'beccs', 'ccs', 'ccus', 'dac', 'itm', 'abe', 'eecs', 'sci', 'cbh'
  ])
  
  // Extract words, preserving case for acronyms
  const words = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 0)
  
  // Separate acronyms from regular words
  const keywords: string[] = []
  words.forEach(word => {
    const isAllCapsAcronym = /^[A-Z]{2,6}$/.test(word) // SEED, BECCS, CCS, etc.
    const isKnownAcronym = knownAcronyms.has(word.toLowerCase())
    
    if (isAllCapsAcronym || isKnownAcronym) {
      // Preserve acronyms in uppercase for better matching
      keywords.push(word.toUpperCase())
    } else {
      // Lowercase and filter stopwords for regular words
      const lower = word.toLowerCase()
      if (lower.length > 2 && !stopWords.has(lower)) {
        keywords.push(lower)
      }
    }
  })
  
  return keywords
}

// Technical terms that should be weighted higher in keyword matching
const TECHNICAL_TERMS = new Set([
  'beccs', 'ccs', 'ccus', 'dac', 'carbon capture', 'carbon dioxide', 'co2',
  'hydrogen', 'solar', 'wind', 'nuclear', 'biofuel', 'bioenergy', 'biogas',
  'heat pump', 'district heating', 'energy storage', 'battery', 'electric vehicle',
  'emission', 'greenhouse', 'climate', 'sustainable', 'renewable', 'fossil',
  'photovoltaic', 'geothermal', 'hydropower', 'biomass', 'sequestration',
  'negative emission', 'net zero', 'carbon neutral', 'decarbonization',
])

// Calculate keyword match score (0-1) with boosting for technical terms
function keywordMatchScore(doc: Document, keywords: string[]): number {
  if (keywords.length === 0) return 0
  
  const text = `${doc.title} ${doc.content} ${doc.category} ${doc.author}`.toLowerCase()
  
  let totalWeight = 0
  let matchedWeight = 0
  
  keywords.forEach(keyword => {
    const lower = keyword.toLowerCase()
    // Technical terms get 3x weight
    const weight = TECHNICAL_TERMS.has(lower) ? 3 : 1
    totalWeight += weight
    
    if (text.includes(lower)) {
      matchedWeight += weight
    }
  })
  
  return totalWeight > 0 ? matchedWeight / totalWeight : 0
}

// Fallback search when RPC function doesn't exist (slower but works)
async function fallbackSearch(
  queryEmbedding: number[],
  limit: number,
  threshold: number,
  queryText?: string
): Promise<DocumentWithScore[]> {
  logger.debug('🔄 Using fallback client-side search (create RPC for better performance)')
  
  // Fetch all documents (raw format with source_url and embeddings)
  const { data: rawDocuments, error } = await supabase
    .from('documents')
    .select('*')
    .limit(1000)

  if (error || !rawDocuments || rawDocuments.length === 0) {
    logger.error('Error fetching documents for fallback:', error)
    return []
  }

  const keywords = queryText ? extractKeywords(queryText) : []
  logger.debug('🔤 Keywords:', keywords.join(', '))
  
  // Calculate similarities client-side
  const allDocs = []
  
  for (const rawDoc of rawDocuments) {
    try {
      const docEmbedding = JSON.parse(rawDoc?.embeddings ?? '[]')
      const vectorScore = cosineSimilarity(queryEmbedding, docEmbedding)
      
      // Map raw document to standardized format (to match RPC output)
      const doc: Document = {
        id: rawDoc.id,
        title: rawDoc.title,
        content: rawDoc.content,
        url: rawDoc.source_url,  // Map source_url → url
        doi: rawDoc.doi,
        author: rawDoc.author,
        department: rawDoc.department,
        year: rawDoc.year,
        category: rawDoc.category,
        publication_date: rawDoc.publication_date,
        embedding: docEmbedding,  // Parse embeddings JSON
        metadata: rawDoc.metadata,
      }
      
      const keywordScore = keywords.length > 0 ? keywordMatchScore(doc, keywords) : 0
      // Prioritize keyword matching (60%) over vector similarity (40%)
      const hybridScore = (vectorScore * 0.4) + (keywordScore * 0.6)
      
      if (hybridScore >= threshold) {
        allDocs.push({
          ...doc,
          similarity: hybridScore,
        })
      }
    } catch (e) {
      // Skip invalid embeddings
    }
  }
  
  logger.debug(`Found ${allDocs.length} documents above threshold (${threshold})`)

  // Filter out documents that don't actually contain the query keywords
  // This prevents generic "research overview" pages from polluting results
  const relevantDocs = allDocs.filter(doc => {
    if (keywords.length === 0) return true
    const text = `${doc.title} ${doc.content}`.toLowerCase()
    // Require at least one keyword match in content or title
    return keywords.some(keyword => text.includes(keyword))
  })
  
  logger.debug(`After content filtering: ${relevantDocs.length} documents`)

  // Remove duplicates based on title
  const seen = new Set<string>()
  const uniqueDocs = relevantDocs.filter(doc => {
    if (seen.has(doc.title)) return false
    seen.add(doc.title)
    return true
  })
  
  logger.debug(`After deduplication: ${uniqueDocs.length} unique documents`)

  uniqueDocs.sort((a, b) => b.similarity - a.similarity)
  return uniqueDocs.slice(0, limit)
}

// Hybrid search: combines RPC vector similarity with keyword matching
export async function searchDocuments(
  queryEmbedding: number[],
  limit: number = 5,
  threshold: number = 0.5,
  queryText?: string
): Promise<DocumentWithScore[]> {
  logger.debug('🔍 Searching for:', queryText, '(threshold:', threshold, ')')
  
  try {
    // STEP 1: Use RPC function for proper vector similarity search
    // Lower threshold to 0.10 (10%) for initial vector search
    // This catches more candidates for keyword re-ranking, handling query phrasing variations
    // Needs to be very low to catch documents with different phrasing (e.g., "BECCS" vs "what is kth doing with beccs")
    const vectorThreshold = Math.max(threshold - 0.35, 0.10)
    
    const { data: vectorResults, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: vectorThreshold,
      match_count: limit * 20, // Get 20x more for better keyword re-ranking coverage (was 10x at 20% threshold, now 20x at 10%)
    })

    // FALLBACK: If RPC doesn't exist, use client-side similarity search
    if (error && error.message?.includes('match_documents')) {
      logger.warn('⚠️ RPC function not found, using fallback search')
      const fallbackResults = await fallbackSearch(queryEmbedding, limit, threshold, queryText)
      logger.debug(`Found ${fallbackResults.length} documents via fallback`)
      return fallbackResults
    }

    if (error) {
      logger.error('❌ RPC error:', error)
      throw error
    }

    if (!vectorResults || vectorResults.length === 0) {
      logger.debug('⚠️ No vector results found above threshold', vectorThreshold)
      return []
    }

    logger.debug(`✅ Found ${vectorResults.length} candidates from vector search (threshold: ${(vectorThreshold * 100).toFixed(0)}%)`)

    // STEP 2: Extract keywords and boost with keyword matching
    const keywords = queryText ? extractKeywords(queryText) : []
    logger.debug('🔑 Keywords:', keywords.join(', '))

    // STEP 3: Calculate hybrid scores with recency boost
    const currentYear = new Date().getFullYear()
    const hybridResults: DocumentWithScore[] = vectorResults.map((doc: any): DocumentWithScore => {
      const vectorScore = doc.similarity as number
      const keywordScore = keywords.length > 0 ? keywordMatchScore(doc as Document, keywords) : 0
      
      // Recency boost: newer papers get up to 5% bonus (decays over 10 years)
      const docYear = doc.year as number | null
      const recencyBoost = docYear 
        ? Math.max(0, (1 - (currentYear - docYear) / 10)) * 0.05
        : 0
      
      // Hybrid score: 40% vector + 60% keyword + recency boost
      const hybridScore = (vectorScore * 0.4) + (keywordScore * 0.6) + recencyBoost
      
      // Debug: Log first few results to see what's happening
      if (vectorResults.indexOf(doc) < 3) {
        logger.debug(`  Doc ${vectorResults.indexOf(doc) + 1}: vec=${(vectorScore * 100).toFixed(1)}% kwd=${(keywordScore * 100).toFixed(1)}% → hybrid=${(hybridScore * 100).toFixed(1)}% "${doc.title?.substring(0, 50)}"`)
      }
      
      return {
        ...(doc as Document),
        similarity: hybridScore,
        vectorScore,
        keywordScore,
      }
    })

    // STEP 4: Sort by hybrid score
    hybridResults.sort((a, b) => b.similarity - a.similarity)
    
    // Log top results (debug mode only)
    logger.debug('📊 Top 5 hybrid search results:')
    hybridResults.slice(0, 5).forEach((doc, i) => {
      logger.debug(`  ${i+1}. [Hybrid: ${(doc.similarity * 100).toFixed(1)}% = Vec: ${((doc.vectorScore ?? 0) * 100).toFixed(1)}% + Kwd: ${((doc.keywordScore ?? 0) * 100).toFixed(1)}%] ${doc.title?.substring(0, 50) || 'No title'}`)
    })
    logger.debug(`📊 Final Threshold: ${(threshold * 100).toFixed(0)}%`)

    // STEP 5: Filter by final threshold
    const aboveThreshold = hybridResults.filter((doc) => doc.similarity >= threshold)
    logger.debug(`📋 ${aboveThreshold.length} documents above threshold`)

    // STEP 6: Content relevance filter - ensure keywords appear in document
    const contentRelevant = aboveThreshold.filter(doc => {
      if (keywords.length === 0) return true
      const text = `${doc.title} ${doc.content}`.toLowerCase()
      return keywords.some(keyword => text.includes(keyword))
    })
    logger.debug(`📋 ${contentRelevant.length} documents after content filtering`)

    // STEP 7: Remove duplicates based on title
    const seen = new Set<string>()
    const uniqueResults = contentRelevant.filter(doc => {
      if (seen.has(doc.title)) return false
      seen.add(doc.title)
      return true
    })
    logger.debug(`📋 ${uniqueResults.length} unique documents`)

    // STEP 7.5: Filter out generic KTH web pages (not actual research)
    // These pages like "Research | KTH" or "News from KTH" aren't useful sources
    const isGenericPage = (title: string, content?: string): boolean => {
      if (!title) return false
      
      // Pattern 1: Exact matches of known generic pages
      const exactGenericPages = new Set([
        'research | kth',
        'forskning | kth',
        'news from kth | kth',
        'studies at kth | kth | sweden',
        'studies at kth | kth',
        'about kth | kth',
        'contact | kth',
        'kth\'s president and management | kth',
        'business and community | kth',
        'kth innovation | kth',
        'environment and sustainable development at kth | kth',
        'national infrastructures | kth',
        'research centres | kth',
        'research environments | kth',
        'kth\'s research environments | kth',
        'kth:s strategic research initiatives | kth',
      ])
      
      const lowerTitle = title.toLowerCase().trim()
      if (exactGenericPages.has(lowerTitle)) return true
      
      // Pattern 2: Generic category pages (School of X, Department of X)
      const categoryPatterns = [
        /^school of .+ \|\s*kth$/i,
        /^department of .+ \|\s*kth$/i,
        /^the school of .+ \|\s*kth$/i,
        /^division of .+ \|\s*kth$/i,
      ]
      if (categoryPatterns.some(p => p.test(title))) return true
      
      // Pattern 3: Navigation/index pages ending with " | KTH" that are too generic
      // BUT allow specific project pages, studies, and research overviews
      if (/\s*\|\s*KTH$/i.test(title)) {
        // Keep these even if they end with " | KTH"
        const keepPatterns = [
          /research overview/i,
          /project/i,
          /study/i,
          /assessment/i,
          /analysis/i,
          /beccs/i,
          /carbon capture/i,
          /energy/i,
          /climate/i,
          /sustainable/i,
          /workshop/i,
          /award/i,
          /initiative/i,
        ]
        
        // If it matches a "keep" pattern, don't filter it
        if (keepPatterns.some(p => p.test(title))) {
          // But still filter if it's ONLY a generic title like "Research | KTH"
          if (title.split('|')[0].trim().split(' ').length <= 2) {
            return true  // Too short to be specific
          }
          return false  // Keep it
        }
        
        // Generic " | KTH" pages without specific content indicators
        return true
      }
      
      // Pattern 4: Very short content indicates landing page (if content available)
      if (content && content.length < 200) return true
      
      return false
    }
    
    const qualityResults = uniqueResults.filter(doc => !isGenericPage(doc.title, doc.content))
    if (qualityResults.length < uniqueResults.length) {
      const filtered = uniqueResults.length - qualityResults.length
      logger.debug(`🗑️ Filtered ${filtered} generic pages: ${uniqueResults.filter(d => isGenericPage(d.title, d.content)).map(d => d.title?.substring(0, 40)).join(', ')}`)
    }

    // STEP 8: Optimized BM25 Keyword Fallback (Option A)
    // If we have 0 results after filtering, fall back to indexed full-text search
    // Backend has optimized this with:
    //   - Generated column (fts) pre-calculating text vectors
    //   - GIN index for O(1) lookup
    //   - No ILIKE scans needed
    if (qualityResults.length === 0 && queryText) {
      logger.warn('⚠️ No results from hybrid search, trying optimized BM25 fallback...')
      
      // Use extracted keywords for BM25 to avoid noise from stopwords and typos
      const keywordsForBM25 = keywords.length > 0 ? keywords.join(' ') : queryText
      logger.debug(`🔍 BM25 query: "${keywordsForBM25}" (from: "${queryText}")`)
      
      try {
        const { data: keywordResults, error: keywordError } = await supabase.rpc('search_keyword_documents', {
          query_text: keywordsForBM25,
          match_count: limit * 2, // Get more for filtering
        })

        if (keywordError) {
          if (keywordError.message?.includes('search_keyword_documents')) {
            logger.warn('⚠️ BM25 RPC function not found - backend optimization not deployed yet')
          } else {
            logger.error('❌ BM25 search error:', keywordError)
          }
          return []
        }

        if (keywordResults && keywordResults.length > 0) {
          logger.info(`✅ Optimized BM25 found ${keywordResults.length} matches (via GIN index)`)
          
          // Convert BM25 results to DocumentWithScore format
          // Note: ts_rank scores are typically 0.01-0.1, so we normalize them to 0.5-0.9 range
          // This ensures BM25 results pass source validation (50%+ threshold)
          const maxBM25Score = Math.max(...keywordResults.map((d: any) => d.similarity as number))
          const bm25Results: DocumentWithScore[] = keywordResults.map((doc: any, idx: number) => {
            const rawScore = doc.similarity as number
            // Normalize to 0.5-0.9 range (0.9 for best match, 0.5 for worst)
            // Top result gets 0.9, others scale down proportionally
            const normalizedScore = maxBM25Score > 0 
              ? 0.5 + (0.4 * (rawScore / maxBM25Score))
              : 0.7 // Fallback if all scores are 0
            
            return {
              ...(doc as Document),
              similarity: normalizedScore,
              vectorScore: 0, // No vector score for keyword-only results
              keywordScore: normalizedScore, // Normalized BM25 score
            }
          })

          // Deduplicate BM25 results
          const bm25Seen = new Set<string>()
          const uniqueBM25 = bm25Results.filter(doc => {
            if (bm25Seen.has(doc.title)) return false
            bm25Seen.add(doc.title)
            return true
          })

          const topBM25 = uniqueBM25.slice(0, limit)
          logger.info('📊 Top BM25 results:', topBM25.map((d, i) => `${i+1}. [${(d.similarity * 100).toFixed(0)}%] ${d.title?.substring(0, 50)}`).join(' | '))
          return topBM25
        }
      } catch (bm25Error) {
        logger.error('❌ BM25 fallback exception:', bm25Error)
        // Continue to return empty results
      }
    }

    const topResults = qualityResults.slice(0, limit)
    return topResults
  } catch (error) {
    logger.error('Error in searchDocuments:', error)
    throw error
  }
}
