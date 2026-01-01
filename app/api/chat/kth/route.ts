import { NextRequest } from 'next/server'
import { generateEmbedding } from '@/lib/embeddings'
import { searchDocuments } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  try {
    const { message } = await request?.json?.()

    if (!message?.trim?.()) {
      return new Response('Message is required', { status: 400 })
    }

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(message)

    // Search for relevant documents
    const relevantDocs = await searchDocuments(queryEmbedding, 5, 0.5)

    if (!relevantDocs || relevantDocs?.length === 0) {
      // No relevant documents found
      const stream = new ReadableStream({
        async start(controller) {
          const noResultsMessage = `I couldn't find specific KTH research matching your query in my current database. However, KTH is actively researching many areas of climate and sustainability! \n\nTry asking about:\n- **Renewable Energy** (solar, wind, energy systems)\n- **Transportation** (electric vehicles, sustainable transport)\n- **Carbon Neutrality** (carbon capture, emissions reduction)\n- **Urban Planning** (sustainable cities, smart buildings)\n\nOr switch to **Global Research Mode** to explore cutting-edge climate solutions worldwide! 🌍✨`

          for (const char of noResultsMessage) {
            const chunk = JSON.stringify({ content: char })
            controller?.enqueue?.(encoder?.encode?.(`data: ${chunk}\n\n`) ?? new Uint8Array())
            await new Promise((resolve) => setTimeout(resolve, 10))
          }

          controller?.enqueue?.(encoder?.encode?.('data: [DONE]\n\n') ?? new Uint8Array())
          controller?.close?.()
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Prepare context from relevant documents
    const context = relevantDocs
      ?.map?.(
        (doc, idx) =>
          `[Source ${idx + 1}]\nTitle: ${doc?.title ?? 'Untitled'}\nAuthors: ${doc?.author ?? 'Unknown'}\nDepartment: ${doc?.department ?? 'KTH'}\nCategory: ${doc?.category ?? 'General'}\nContent: ${doc?.content?.slice?.(0, 800) ?? ''}...\n`
      )
      ?.join?.('\n---\n') ?? ''

    // Create sources array
    const sources = relevantDocs?.map?.((doc) => ({
      title: doc?.title ?? 'Untitled',
      url: doc?.url ?? undefined,  // Now standardized to 'url' (mapped from source_url)
      authors: doc?.author ?? undefined,
      department: doc?.department ?? undefined,
      category: doc?.category ?? undefined,
    })) ?? []

    // Create system prompt
    const systemPrompt = `You are QBOT, a friendly and hope-inspiring AI assistant specializing in KTH (Royal Institute of Technology) climate and sustainability research. Your mission is to make students excited about the future and inspire them to contribute to solving climate challenges.

Key Guidelines:
- Be **hope-inspiring** and **positive** - focus on solutions, breakthroughs, and progress
- Use **simple, accessible language** - avoid jargon, explain technical terms
- Be **encouraging and friendly** - make students feel they can make a difference
- Always cite your sources - reference specific research, authors, and departments
- Format your response in clear sections with emojis when appropriate
- Highlight KTH's cutting-edge work and real-world impact
- Connect research to tangible benefits for people and the planet

Context from KTH Research:
${context}

Your response should:
1. Answer the user's question using the KTH research provided
2. Emphasize the hope-inspiring aspects and breakthrough potential
3. Use specific examples, numbers, and findings from the sources
4. Make it clear how this research contributes to solving climate challenges
5. Be conversational and engaging

Remember: The sources will be automatically displayed below your response, so focus on synthesizing the information in an inspiring way rather than listing sources.`

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
          let firstChunk = true

          while (true) {
            const { done, value } = await reader?.read?.()
            if (done) {
              // Send sources at the end
              const sourcesChunk = JSON.stringify({ sources })
              controller?.enqueue?.(encoder?.encode?.(`data: ${sourcesChunk}\n\n`) ?? new Uint8Array())
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
                    if (firstChunk) {
                      firstChunk = false
                    }
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
