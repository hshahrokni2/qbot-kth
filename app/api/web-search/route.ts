import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Web Search API - uses Perplexity for AI-powered web search
 * Returns summarized answers with citations
 */
export async function POST(request: NextRequest) {
  try {
    const { query, limit = 5 } = await request.json()
    
    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query required' }, { status: 400 })
    }

    const apiKey = process.env.PERPLEXITY_API_KEY
    if (!apiKey) {
      console.error('❌ PERPLEXITY_API_KEY not configured')
      return NextResponse.json({ 
        error: 'Web search not configured',
        results: [] 
      }, { status: 503 })
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar', // Perplexity's search model
        messages: [
          {
            role: 'system',
            content: 'You are a helpful research assistant. Provide concise, factual answers with sources. Focus on recent and authoritative information.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 1000,
        temperature: 0.2,
        return_citations: true,
        return_related_questions: false,
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Perplexity API error:', response.status, errorText)
      return NextResponse.json({ 
        error: 'Search failed',
        results: [] 
      }, { status: response.status })
    }

    const data = await response.json()
    
    // Extract the answer and citations
    const answer = data.choices?.[0]?.message?.content || ''
    const citations = data.citations || []
    
    // Web search completed

    // Format results for display - fetch page titles for better UX
    const results = await Promise.all(
      citations.slice(0, limit).map(async (url: string) => {
        let source = 'Web'
        let title = url
        
        try {
          source = new URL(url).hostname.replace('www.', '')
          
          // Try to fetch the page title (with timeout)
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 2000)
          
          try {
            const pageRes = await fetch(url, { 
              signal: controller.signal,
              headers: { 'User-Agent': 'QBOT/1.0' }
            })
            clearTimeout(timeout)
            
            if (pageRes.ok) {
              const html = await pageRes.text()
              const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
              if (titleMatch?.[1]) {
                title = titleMatch[1].trim()
                  .replace(/\s*[\|–-]\s*[^|–-]+$/, '') // Remove site name suffix
                  .slice(0, 80) // Limit length
              }
            }
          } catch {
            // Timeout or fetch error - use URL path as title
            const path = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
            title = path.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') || source
          }
        } catch {}
        
        return {
          title: title || source,
          url: url,
          snippet: '',
          source: source,
        }
      })
    )

    return NextResponse.json({ 
      answer, // The AI-generated summary
      results, // The citation URLs
      provider: 'perplexity'
    })

  } catch (error) {
    console.error('Web search error:', error)
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 })
  }
}
