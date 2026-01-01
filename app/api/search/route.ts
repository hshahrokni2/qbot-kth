import { NextResponse } from 'next/server'
import { searchDocuments, supabase } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/embeddings'

// Key researchers for specific topics - ensures we find relevant papers
const TOPIC_EXPERTS: Record<string, string[]> = {
  'beccs': ['levihn', 'möllersten', 'zetterberg', 'johnsson', 'lefvert'],
  'bioenergy': ['levihn', 'möllersten', 'yan'],
  'carbon capture': ['levihn', 'möllersten', 'johnsson'],
  'ccs': ['levihn', 'möllersten', 'johnsson'],
  'smart city': ['shahrokni', 'brandt'],
  'urban metabolism': ['shahrokni', 'brandt'],
  'district heating': ['levihn', 'shahrokni'],
}

// Detect if query is asking about a specific author/researcher
function extractAuthorName(query: string): string | null {
  const lowerQuery = query.toLowerCase()
  
  // Patterns that indicate author search
  const authorPatterns = [
    /(?:papers?|publications?|work|research|published)\s+(?:by|from|of)\s+([a-z]+)/i,
    /([a-z]+)(?:'s)?\s+(?:papers?|publications?|work|research)/i,
    /(?:what has|what did)\s+([a-z]+)\s+(?:published|written|researched)/i,
    /(?:find|show|list|get)\s+(?:me\s+)?([a-z]+)(?:'s)?\s+(?:papers?|work)/i,
    /(?:authored|written)\s+by\s+([a-z]+)/i,
  ]
  
  for (const pattern of authorPatterns) {
    const match = query.match(pattern)
    if (match && match[1]) {
      const name = match[1].toLowerCase()
      // Filter out common non-name words
      const nonNames = ['the', 'kth', 'more', 'some', 'any', 'all', 'other', 'new', 'recent']
      if (!nonNames.includes(name) && name.length > 2) {
        return name
      }
    }
  }
  
  // Also check if query contains a capitalized name that looks like a surname
  const words = query.split(/\s+/)
  for (const word of words) {
    // Capitalized word that's not at start of sentence and not common word
    if (/^[A-Z][a-z]{3,}$/.test(word)) {
      const lower = word.toLowerCase()
      const commonWords = ['what', 'when', 'where', 'which', 'papers', 'research', 'more', 'about', 'find']
      if (!commonWords.includes(lower)) {
        return lower
      }
    }
  }
  
  return null
}

// Detect topic keywords and return relevant expert names
function getTopicExperts(query: string): string[] {
  const lowerQuery = query.toLowerCase()
  const experts: Set<string> = new Set()
  
  for (const [topic, topicExperts] of Object.entries(TOPIC_EXPERTS)) {
    if (lowerQuery.includes(topic)) {
      topicExperts.forEach(e => experts.add(e))
    }
  }
  
  return Array.from(experts)
}

export async function POST(request: Request) {
  try {
    const { query, limit = 5 } = await request.json()

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Check if this is an author-specific query
    const authorName = extractAuthorName(query)
    let authorResults: any[] = []
    
    if (authorName) {
      console.log(`🔍 Detected author query for: "${authorName}"`)
      
      // Direct author search - this finds papers where the author field contains the name
      const { data: authorDocs, error: authorError } = await supabase
        .from('documents')
        .select('id, title, content, source_url, author, department, year, category')
        .ilike('author', `%${authorName}%`)
        .limit(limit * 2)
      
      if (!authorError && authorDocs && authorDocs.length > 0) {
        console.log(`✅ Found ${authorDocs.length} papers by author "${authorName}"`)
        authorResults = authorDocs.map(doc => ({
          title: doc.title || 'Untitled',
          authors: doc.author || 'Unknown',
          year: doc.year,
          department: doc.department,
          category: doc.category,
          content: doc.content?.slice(0, 500),
          url: doc.source_url
        }))
      }
    }

    // Check for topic-specific expert papers (e.g., BECCS → Levihn)
    const topicExperts = getTopicExperts(query)
    let expertResults: any[] = []
    
    if (topicExperts.length > 0 && !authorName) {
      console.log(`🔍 Topic experts for query: ${topicExperts.join(', ')}`)
      
      // Search for papers by topic experts that match the query topic
      const lowerQuery = query.toLowerCase()
      
      for (const expert of topicExperts.slice(0, 3)) { // Limit to top 3 experts
        const { data: expertDocs, error: expertError } = await supabase
          .from('documents')
          .select('id, title, content, source_url, author, department, year, category')
          .ilike('author', `%${expert}%`)
          .limit(5)
        
        if (!expertError && expertDocs) {
          // Filter to papers that match the query topic
          const relevantDocs = expertDocs.filter(doc => {
            const titleLower = (doc.title || '').toLowerCase()
            const contentLower = (doc.content || '').slice(0, 1000).toLowerCase()
            
            // Check if paper is relevant to the query topic
            for (const [topic] of Object.entries(TOPIC_EXPERTS)) {
              if (lowerQuery.includes(topic) && 
                  (titleLower.includes(topic) || contentLower.includes(topic))) {
                return true
              }
            }
            return false
          })
          
          expertResults.push(...relevantDocs.map(doc => ({
            title: doc.title || 'Untitled',
            authors: doc.author || 'Unknown',
            year: doc.year,
            department: doc.department,
            category: doc.category,
            content: doc.content?.slice(0, 500),
            url: doc.source_url
          })))
        }
      }
      
      if (expertResults.length > 0) {
        console.log(`✅ Found ${expertResults.length} expert papers for topic`)
      }
    }

    // Generate embedding for semantic search
    const embedding = await generateEmbedding(query)

    // Search documents - signature: (embedding, limit, threshold, queryText)
    const semanticResults = await searchDocuments(embedding, limit, 0.5, query)

    // Format semantic results
    const formattedSemantic = semanticResults.map(doc => ({
      title: doc.title || 'Untitled',
      authors: doc.author || 'Unknown',
      year: doc.year,
      department: doc.department,
      category: doc.category,
      content: doc.content?.slice(0, 500),
      url: doc.url
    }))

    // Merge results: author > expert > semantic
    // Remove duplicates based on title
    const seenTitles = new Set<string>()
    const mergedResults: typeof formattedSemantic = []
    
    // Add author results first (direct author queries)
    for (const result of authorResults) {
      if (!seenTitles.has(result.title)) {
        seenTitles.add(result.title)
        mergedResults.push(result)
      }
    }
    
    // Add expert results second (topic-specific expert papers)
    for (const result of expertResults) {
      if (!seenTitles.has(result.title)) {
        seenTitles.add(result.title)
        mergedResults.push(result)
      }
    }
    
    // Add semantic results last
    for (const result of formattedSemantic) {
      if (!seenTitles.has(result.title)) {
        seenTitles.add(result.title)
        mergedResults.push(result)
      }
    }

    // Limit final results
    const finalResults = mergedResults.slice(0, limit)
    
    console.log(`📊 Search results: ${authorResults.length} author + ${expertResults.length} expert + ${formattedSemantic.length} semantic = ${finalResults.length} final`)

    return NextResponse.json({ 
      results: finalResults,
      count: finalResults.length 
    })
  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
