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

    if (!process.env.PERPLEXITY_API_KEY) {
      return NextResponse.json(
        { error: 'Web search not configured', results: [] },
        { status: 503 }
      )
    }

    const { answer, results } = await webSearch(query, limit)

    return NextResponse.json({ 
      answer,
      results,
    })

  } catch (error) {
    console.error('Web search error:', error)
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
}
