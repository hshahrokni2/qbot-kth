// Stream response from LLM API
export async function streamLLMResponse(
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => void,
  onComplete?: () => void
): Promise<void> {
  try {
    // Use OpenRouter if available for better models
    const useOpenRouter = !!process?.env?.OPENROUTER_API_KEY
    const apiUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://apps.abacus.ai/v1/chat/completions'
    const apiKey = useOpenRouter
      ? process.env.OPENROUTER_API_KEY
      : process.env.ABACUSAI_API_KEY
    const model = useOpenRouter ? 'openai/gpt-5.2-chat' : 'gpt-4.1-mini'

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
        model: model,
        messages: messages,
        stream: true,
        max_tokens: 3000,
        temperature: 0.7,
      }),
    })

    if (!response?.ok || !response?.body) {
      throw new Error(`LLM API error: ${response?.status}`)
    }

    const reader = response?.body?.getReader?.()
    if (!reader) throw new Error('No reader available')

    const decoder = new TextDecoder()
    let partialRead = ''

    while (true) {
      const { done, value } = await reader?.read?.()
      if (done) break

      partialRead += decoder?.decode?.(value, { stream: true }) ?? ''
      const lines = partialRead?.split?.('\n') ?? []
      partialRead = lines?.pop?.() ?? ''

      for (const line of lines ?? []) {
        if (line?.startsWith?.('data: ')) {
          const data = line?.slice?.(6) ?? ''
          if (data === '[DONE]') {
            onComplete?.()
            return
          }
          try {
            const parsed = JSON.parse(data)
            const content = parsed?.choices?.[0]?.delta?.content ?? ''
            if (content) {
              onChunk?.(content)
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    onComplete?.()
  } catch (error) {
    console.error('Error streaming LLM response:', error)
    throw error
  }
}
