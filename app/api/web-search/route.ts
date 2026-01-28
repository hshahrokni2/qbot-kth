import { NextRequest, NextResponse } from 'next/server'
import { webSearch } from '@/lib/web-search'

export const dynamic = 'force-dynamic'

/**
 * Web Search API - AI-powered web search
 * Returns summarized answers with citations
 */
export async function POST(request: NextRequest) {
  try {
    const { query, limit = 5 } = await request.json()
    
    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 })
    }

    const hasKey = !!process.env.PERPLEXITY_API_KEY
    console.log('🌐 Web search request:', { query: query.slice(0, 50), hasKey })

    if (!hasKey) {
      console.error('❌ PERPLEXITY_API_KEY not configured in environment')
      return NextResponse.json(
        { error: 'Web search not configured - missing API key', results: [], configured: false },
        { status: 503 }
      )
    }

    const { answer, results } = await webSearch(query, limit)
    
    console.log('🌐 Web search result:', { hasAnswer: !!answer, resultsCount: results?.length ?? 0 })

    return NextResponse.json({ 
      answer,
      results,
      configured: true,
    })

  } catch (error) {
    console.error('Web search error:', error)
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
}
