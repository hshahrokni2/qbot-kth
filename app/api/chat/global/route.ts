import { NextRequest } from 'next/server'
import { generateEmbedding } from '@/lib/embeddings'
import { searchDocuments } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Simple web search function using DuckDuckGo-style search
async function performWebSearch(query: string): Promise<string> {
  try {
    // Use the LLM to generate a comprehensive answer about global research
    // This simulates web search by using the LLM's knowledge
    const response = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are a research assistant providing information about the latest global climate and sustainability research. Provide factual, up-to-date information about recent breakthroughs, ongoing projects, and state-of-the-art developments in the field. Include specific examples, institutions, and researchers when possible.`,
          },
          {
            role: 'user',
            content: `Provide comprehensive information about: ${query}\n\nFocus on: latest breakthroughs, current state-of-the-art, leading research institutions, recent publications (2023-2025), and future directions. Be specific with names, numbers, and facts.`,
          },
        ],
        max_tokens: 1500,
        temperature: 0.7,
      }),
    })

    if (!response?.ok) {
      throw new Error(`Search API error: ${response?.status}`)
    }

    const data = await response?.json?.()
    return data?.choices?.[0]?.message?.content ?? ''
  } catch (error) {
    console.error('Web search error:', error)
    return ''
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  try {
    const { message } = await request?.json?.()

    if (!message?.trim?.()) {
      return new Response('Message is required', { status: 400 })
    }

    // Perform web search (using LLM knowledge)
    const webSearchResults = await performWebSearch(message)

    // Also search KTH database for complementary information
    let kthContext = ''
    let kthSources: Array<any> = []
    try {
      const queryEmbedding = await generateEmbedding(message)
      const relevantDocs = await searchDocuments(queryEmbedding, 3, 0.6)
      if (relevantDocs && relevantDocs?.length > 0) {
        kthContext =
          '\n\n**Complementary KTH Research:**\n' +
          relevantDocs
            ?.map?.(
              (doc) =>
                `- ${doc?.title ?? 'Untitled'} (${doc?.department ?? 'KTH'}, ${doc?.category ?? 'General'}): ${doc?.content?.slice?.(0, 300) ?? ''}...`
            )
            ?.join?.('\n') ?? ''

        kthSources = relevantDocs?.map?.((doc) => ({
          title: `[KTH] ${doc?.title ?? 'Untitled'}`,
          url: doc?.url ?? undefined,  // Now standardized to 'url' (mapped from source_url)
          authors: doc?.author ?? undefined,
          department: doc?.department ?? undefined,
          category: doc?.category ?? undefined,
        })) ?? []
      }
    } catch (error) {
      console.error('Error searching KTH database:', error)
    }

    // Create system prompt for global research mode
    const systemPrompt = `You are QBOT, a friendly and hope-inspiring AI assistant specializing in global climate and sustainability research. Your mission is to make students excited about the future and inspire them to contribute to solving climate challenges.

Key Guidelines:
- Be **hope-inspiring** and **positive** - focus on solutions, breakthroughs, and progress
- Use **simple, accessible language** - avoid jargon, explain technical terms
- Be **encouraging and friendly** - make students feel they can make a difference
- Highlight recent breakthroughs and state-of-the-art developments
- Mention specific researchers, institutions, and projects when possible
- Format your response in clear sections with emojis when appropriate
- Connect research to tangible benefits for people and the planet
- Emphasize the collaborative global effort to solve climate challenges

Global Research Context:
${webSearchResults}
${kthContext}

Your response should:
1. Answer the user's question comprehensively
2. Emphasize the hope-inspiring aspects and breakthrough potential
3. Use specific examples, numbers, and findings
4. Make it clear how this research contributes to solving climate challenges
5. Be conversational and engaging
6. If relevant KTH research is available, mention how KTH contributes to this global effort

Remember: Focus on synthesizing the information in an inspiring, accessible way. Make students feel excited about the future and motivated to contribute to climate solutions!`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ]

    // Stream the response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await fetch(
            'https://apps.abacus.ai/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.ABACUSAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: 'gpt-4.1-mini',
                messages: messages,
                stream: true,
                max_tokens: 3000,
                temperature: 0.7,
              }),
            }
          )

          if (!response?.ok || !response?.body) {
            throw new Error(`LLM API error: ${response?.status}`)
          }

          const reader = response?.body?.getReader?.()
          if (!reader) throw new Error('No reader available')

          const decoder = new TextDecoder()
          let partialRead = ''

          while (true) {
            const { done, value } = await reader?.read?.()
            if (done) {
              // Send KTH sources at the end if available
              if (kthSources?.length > 0) {
                const sourcesChunk = JSON.stringify({ sources: kthSources })
                controller?.enqueue?.(encoder?.encode?.(`data: ${sourcesChunk}\n\n`) ?? new Uint8Array())
              }
              controller?.enqueue?.(encoder?.encode?.('data: [DONE]\n\n') ?? new Uint8Array())
              break
            }

            partialRead += decoder?.decode?.(value, { stream: true }) ?? ''
            const lines = partialRead?.split?.('\n') ?? []
            partialRead = lines?.pop?.() ?? ''

            for (const line of lines ?? []) {
              if (line?.startsWith?.('data: ')) {
                const data = line?.slice?.(6) ?? ''
                if (data === '[DONE]') {
                  continue
                }
                try {
                  const parsed = JSON.parse(data)
                  const content = parsed?.choices?.[0]?.delta?.content ?? ''
                  if (content) {
                    const chunk = JSON.stringify({ content })
                    controller?.enqueue?.(encoder?.encode?.(`data: ${chunk}\n\n`) ?? new Uint8Array())
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }

          controller?.close?.()
        } catch (error) {
          console.error('Stream error:', error)
          const errorChunk = JSON.stringify({
            content: "I'm having trouble connecting right now. Please try again! 🤖",
          })
          controller?.enqueue?.(encoder?.encode?.(`data: ${errorChunk}\n\n`) ?? new Uint8Array())
          controller?.enqueue?.(encoder?.encode?.('data: [DONE]\n\n') ?? new Uint8Array())
          controller?.close?.()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('API Error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
