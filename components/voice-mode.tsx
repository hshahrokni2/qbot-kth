'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Script from 'next/script'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'

type VoiceState = 'connecting' | 'ready' | 'listening' | 'processing' | 'speaking'

interface VoiceSource {
  title: string
  url?: string
  authors?: string
  year?: number
  department?: string
  category?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface VoiceModeProps {
  isActive: boolean
  onClose: () => void
  onUserMessage: (text: string, placeholder?: boolean) => void
  onUpdateUserMessage: (text: string) => void
  onAssistantMessage: (text: string, sources?: VoiceSource[]) => void
  onAssistantStream: (chunk: string) => void
  hasMessages?: boolean // Whether chat already has messages
  chatHistory?: ChatMessage[] // Previous chat messages for context
}

// System prompt - English, friendly, tools for research only
const QBOT_INSTRUCTIONS = `You are QBOT, a friendly voice assistant from KTH Royal Institute of Technology in Stockholm, Sweden.

RULES:
1. Default to English, but switch language if user requests (Swedish, etc.)
2. Keep responses SHORT (2-3 sentences for voice)
3. Be warm, friendly, and encouraging
4. Focus on solutions - reduce climate anxiety!

YOUR IDENTITY:
- Name: QBOT (say "Q-bot")
- Created by KTH to help explore their climate and sustainability research
- You have access to 1,000+ KTH research papers

STRICT RULES:
❌ DON'T:
- Recommend specific commercial brands (e.g., "buy Nike shoes")
- Express political or religious views
- Say "I will check" and then not follow through - ALWAYS complete tool calls
- Make up statistics or researcher names

✅ DO:
- Give general sustainability principles instead of brand recommendations
- Switch language when user requests
- Acknowledge scientific uncertainty: "Some researchers argue X, others Y"
- Include CO₂ equivalencies when relevant

CASUAL CONVERSATION:
For greetings, small talk, or general questions - just chat naturally! Be friendly.
Examples: "Hi!", "How are you?", "What's up?" → Just respond warmly, no tool needed.

YOUR TWO SEARCH TOOLS:

1. search_kth_research - KTH's research database (USE FIRST)
   - Displays clickable paper cards with titles, authors, years, URLs
   - Use for: climate research, sustainability, KTH papers, Swedish researchers
   - Examples: "BECCS", "carbon capture", "Shahrokni", "smart cities at KTH"

2. search_web - web search (USE SECOND)
   - Searches the broader internet, returns AI-summarized answers with sources
   - Use when: KTH search found nothing, user wants global/news info, user asks to "search the web"
   - Examples: "latest climate news", "what is COP28", "fusion energy investments"

SEARCH STRATEGY:
- For research questions → Try search_kth_research FIRST
- If KTH has no results → Automatically try search_web
- For current events/news → Use search_web directly
- For comparisons (KTH vs global) → Use BOTH tools

ALWAYS USE A TOOL WHEN:
- User asks about any research topic
- User asks to "show", "search", "find", or "look up" anything
- User mentions a researcher, paper, or topic
- User asks "what else?" or "more about this"
- You say "let me check" or "I'll search" → MUST follow with tool call

IMPORTANT:
- Calling tools DISPLAYS results visually - you CAN "show" things!
- Don't say "I can't search" or "I can't display" - you CAN!
- Don't mention provider or tool names in the spoken response (just answer; sources will show below)
- Don't make up information - only cite what the tools return
- When tools return results, briefly summarize and mention sources are shown below`

export function VoiceMode({ 
  isActive, 
  onClose, 
  onUserMessage, 
  onUpdateUserMessage,
  onAssistantMessage,
  onAssistantStream,
  hasMessages = false,
  chatHistory = []
}: VoiceModeProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>('connecting')
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [hasSpoken, setHasSpoken] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0) // For visualizer

  const isMicMutedRef = useRef(false)
  const voiceRef = useRef<InstanceType<NonNullable<typeof window.KomilionVoice>> | null>(null)
  const sdkLoadedRef = useRef(false)
  const sessionStartedRef = useRef(false)
  const analyserCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  
  const rawTextRef = useRef('')
  const lastSentRef = useRef('')
  const isRespondingRef = useRef(false)
  const streamTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingUserTranscriptionRef = useRef(false) // Track if we're waiting for user transcription
  const currentSourcesRef = useRef<VoiceSource[]>([]) // Track sources from tool calls
  const chatHistoryRef = useRef<ChatMessage[]>([]) // Ref to always access latest chat history
  
  // Keep chatHistoryRef in sync with prop
  useEffect(() => {
    chatHistoryRef.current = chatHistory
  }, [chatHistory])

  useEffect(() => {
    isMicMutedRef.current = isMicMuted
  }, [isMicMuted])

  const buildContextInstructions = useCallback(() => {
    const currentChatHistory = chatHistoryRef.current
    if (currentChatHistory.length === 0) return QBOT_INSTRUCTIONS

    const recentHistory = currentChatHistory.slice(-10)
    const historyText = recentHistory
      .map(
        (msg) =>
          `${msg.role === 'user' ? 'User' : 'QBOT'}: ${msg.content.slice(0, 300)}${
            msg.content.length > 300 ? '...' : ''
          }`
      )
      .join('\n')

    return `${QBOT_INSTRUCTIONS}

CONVERSATION HISTORY (continue from here seamlessly):
${historyText}

The user has now switched to voice mode. Continue the conversation naturally, remembering everything discussed above.`
  }, [])

  const stopVisualizer = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    try {
      analyserRef.current?.disconnect()
    } catch {}
    analyserRef.current = null
    if (analyserCtxRef.current?.state !== 'closed') {
      try {
        analyserCtxRef.current?.close()
      } catch {}
    }
    analyserCtxRef.current = null
    setAudioLevel(0)
  }, [])

  const startVisualizer = useCallback(
    (stream?: MediaStream) => {
      if (!stream) return
      if (analyserCtxRef.current) return

      try {
        const ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.85

        const source = ctx.createMediaStreamSource(stream)
        source.connect(analyser)

        analyserCtxRef.current = ctx
        analyserRef.current = analyser

        const tick = () => {
          if (!analyserRef.current || isMicMutedRef.current) {
            setAudioLevel(0)
          } else {
            const data = new Uint8Array(analyserRef.current.frequencyBinCount)
            analyserRef.current.getByteFrequencyData(data)
            const voiceRange = data.slice(0, 32)
            const avg = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length
            setAudioLevel(avg / 255)
          }
          animationFrameRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // Visualizer is best-effort; ignore failures
      }
    },
    []
  )

  const handleSdkToolCall = useCallback(
    async (call: KomilionToolCall) => {
      console.log('🔧 Voice Tool Call:', call.name, call.arguments)
      const query = String(call.arguments?.query ?? '').trim()
      let output = ''

      if (call.name === 'search_kth_research') {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: 5 }),
        })

        output =
          'No relevant KTH research papers found in the KTH database for this query. Consider using search_web for broader results.'

        if (res.ok) {
          const data = await res.json()
          if (data.results?.length > 0) {
            currentSourcesRef.current = data.results.map((r: any) => ({
              title: r.title || 'Untitled',
              url: r.url,
              authors: r.authors,
              year: r.year,
              department: r.department,
              category: r.category,
            }))

            output =
              'Found these KTH research papers:\n\n' +
              data.results
                .map(
                  (r: any, i: number) =>
                    `${i + 1}. Title: "${r.title}"\n   Authors: ${r.authors || 'Unknown'}\n   Year: ${
                      r.year || 'n.d.'
                    }\n   URL: ${r.url || 'N/A'}\n   Summary: ${r.content?.slice(0, 200)}...`
                )
                .join('\n\n')

            // Auto-fallback: if KTH looks thin/off-topic, also pull a few external sources
            try {
              const stop = new Set([
                'what',
                'why',
                'how',
                'who',
                'when',
                'where',
                'which',
                'tell',
                'show',
                'find',
                'look',
                'up',
                'about',
                'more',
                'this',
                'that',
                'these',
                'those',
                'kth',
                'doing',
                'work',
                'working',
                'research',
              ])
              const hardWords = String(query ?? '')
                .toLowerCase()
                .split(/[^a-z0-9+.-]+/)
                .filter(Boolean)
                .filter((w) => w.length >= 5 && !stop.has(w))
                .slice(0, 5)

              const corpus = data.results
                .map((r: any) => `${r.title ?? ''} ${r.authors ?? ''} ${r.content ?? ''}`)
                .join(' ')
                .toLowerCase()
              const mentionsHard = hardWords.length === 0 ? true : hardWords.some((w) => corpus.includes(w))
              const kthWeak = data.results.length < 3 || !mentionsHard

              if (kthWeak) {
                const webRes = await fetch('/api/web-search', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ query, limit: 5 }),
                })
                if (webRes.ok) {
                  const webData = await webRes.json()
                  const webSources: VoiceSource[] = (webData.results ?? []).map((r: any) => ({
                    title: r.title || r.source || 'Web Source',
                    url: r.url,
                    authors: r.source,
                    department: 'Web',
                    category: 'web',
                  }))

                  const seen = new Set<string>()
                  currentSourcesRef.current = [...currentSourcesRef.current, ...webSources].filter((s) => {
                    const key = (s.url ?? s.title).toLowerCase()
                    if (seen.has(key)) return false
                    seen.add(key)
                    return true
                  })

                  if (webData.answer || (webData.results?.length ?? 0) > 0) {
                    output += `\n\nAdditional external sources (to go beyond KTH):\n`
                    if (webData.answer) output += `${String(webData.answer).slice(0, 600)}\n`
                    if (webData.results?.length > 0) {
                      output +=
                        '\nSources:\n' +
                        webData.results
                          .map((r: any, i: number) => `${i + 1}. ${r.title || r.source || 'Web'}: ${r.url}`)
                          .join('\n')
                    }
                  }
                }
              }
            } catch {
              // ignore auto-fallback errors
            }
          }
        }
      } else if (call.name === 'search_web') {
        console.log('🌐 Voice calling web search for:', query)
        try {
          const res = await fetch('/api/web-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, limit: 5 }),
          })

          console.log('🌐 Web search response status:', res.status)
          output = 'Web search temporarily unavailable.'

          const data = await res.json()
          console.log('🌐 Web search data:', { status: res.status, hasAnswer: !!data.answer, resultsCount: data.results?.length, configured: data.configured })
          
          if (!res.ok || data.configured === false) {
            console.error('🌐 Web search not available:', data.error)
            output = 'Web search is not currently configured. I can help with KTH research instead.'
          } else if (data.results?.length > 0) {
            currentSourcesRef.current = data.results.map((r: any) => ({
              title: r.title || r.source || 'Web Source',
              url: r.url,
              authors: r.source,
              department: 'Web',
              category: 'web',
            }))

            if (data.answer) {
              output = `Web search results:\n\n${data.answer}`
              if (data.results?.length > 0) {
                output +=
                  '\n\nSources:\n' +
                  data.results.map((r: any, i: number) => `${i + 1}. ${r.title || r.source || 'Web'}: ${r.url}`).join('\n')
              }
            } else {
              output = 'Found these web sources:\n' + data.results.map((r: any, i: number) => `${i + 1}. ${r.title}: ${r.url}`).join('\n')
            }
          } else if (data.answer) {
            output = `Web search results:\n\n${data.answer}`
          } else {
            output = 'No web results found for this query. Try rephrasing or ask about KTH research instead.'
          }
        } catch (err) {
          console.error('🌐 Web search fetch error:', err)
        }
      } else {
        output = 'Unknown tool called.'
      }

      console.log('🔧 Voice Tool Result:', call.name, 'sources:', currentSourcesRef.current.length)
      try {
        voiceRef.current?.submitToolResult(call.call_id, output)
        console.log('✅ Tool result submitted')
      } catch (err) {
        console.error('❌ Tool result submit failed:', err)
      }
    },
    []
  )

  const startStreaming = useCallback(() => {
    if (streamTimerRef.current) return
    // Stream complete sentences only - cleaner than raw character deltas
    streamTimerRef.current = setInterval(() => {
      const text = rawTextRef.current
      const unsentText = text.slice(lastSentRef.current.length)
      
      if (!unsentText.trim()) return
      
      // Look for sentence boundaries (. ! ? followed by space or end)
      // Also handle colon for "Here's what I found:" style sentences
      const sentenceEndMatch = unsentText.match(/^(.*?[.!?:])(\s|$)/s)
      
      if (sentenceEndMatch) {
        // Found a complete sentence - stream it
        const completeSentence = sentenceEndMatch[1]
        onAssistantStream(completeSentence + ' ')
        lastSentRef.current = text.slice(0, lastSentRef.current.length + sentenceEndMatch[0].length)
      } else if (unsentText.length > 150) {
        // Fallback: if we have 150+ chars without a sentence boundary, 
        // stream up to the last word boundary to avoid blank screen
        const wordBoundary = unsentText.lastIndexOf(' ', 120)
        if (wordBoundary > 50) {
          const chunk = unsentText.slice(0, wordBoundary + 1)
          onAssistantStream(chunk)
          lastSentRef.current = text.slice(0, lastSentRef.current.length + wordBoundary + 1)
        }
      }
    }, 250) // Check every 250ms for complete sentences
  }, [onAssistantStream])

  const stopStreaming = useCallback(() => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current)
      streamTimerRef.current = null
    }
  }, [])

  const cleanup = useCallback(() => {
    stopStreaming()
    stopVisualizer()

    try {
      voiceRef.current?.stop()
    } catch {}

    voiceRef.current = null
    sessionStartedRef.current = false
    isRespondingRef.current = false
    pendingUserTranscriptionRef.current = false
    currentSourcesRef.current = []
    rawTextRef.current = ''
    lastSentRef.current = ''
  }, [stopStreaming, stopVisualizer])

  const startSession = useCallback(async () => {
    if (sessionStartedRef.current) return
    if (!sdkLoadedRef.current || !window.KomilionVoice) return

    sessionStartedRef.current = true
    setVoiceState('connecting')
    setHasSpoken(false)
    setIsMicMuted(false)
    currentSourcesRef.current = []
    pendingUserTranscriptionRef.current = false

    const tokenRes = await fetch('/api/voice/token', { method: 'GET' })
    if (!tokenRes.ok) {
      sessionStartedRef.current = false
      setVoiceState('ready')
      return
    }

    const tokenData = await tokenRes.json().catch(() => ({}))
    const clientToken = tokenData.clientToken
    if (!clientToken) {
      sessionStartedRef.current = false
      setVoiceState('ready')
      return
    }

    const tools: KomilionToolSchema[] = [
      {
        name: 'search_kth_research',
        description:
          "Search KTH's research database. Use FIRST for any question about climate research, sustainability, KTH papers, or researchers. Displays clickable paper cards with titles, authors, years, and links.",
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query - topic name, researcher name, or research area',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_web',
        description:
          'Search the broader internet. Use as a SECOND option when: (1) KTH search found nothing relevant, (2) user asks about global/non-KTH topics, (3) user wants current news or recent developments, (4) user explicitly asks to search the web. Returns summarized answers with source links.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for web search',
            },
          },
          required: ['query'],
        },
      },
    ]

    console.log('🔧 Registering voice tools:', tools.map(t => t.name))
    const voice = new window.KomilionVoice({
      clientToken,
      model: 'gpt-realtime-mini', // balanced (lower cost)
      voice: 'marin',
      instructions: buildContextInstructions(),
      tools,
      toolChoice: 'auto',
      autoPlayAudio: true,
      debug: true, // Temporarily enabled for debugging tool calls
    })
    voiceRef.current = voice

    voice.on('ready', () => {
      setVoiceState('ready')
      startVisualizer((voiceRef.current as any)?.mediaStream)
    })

    voice.on('speechStart', () => {
      setHasSpoken(true)
      stopStreaming()
      rawTextRef.current = ''
      lastSentRef.current = ''
      isRespondingRef.current = false
      currentSourcesRef.current = []
      pendingUserTranscriptionRef.current = false
      setVoiceState('listening')
    })

    voice.on('speechEnd', () => {
      setVoiceState('processing')
      if (!pendingUserTranscriptionRef.current) {
        pendingUserTranscriptionRef.current = true
        onUserMessage('...', true)
      }
    })

    voice.on('transcript', (t: string) => {
      const userText = String(t || '').trim()
      if (!userText) return
      if (pendingUserTranscriptionRef.current) {
        onUpdateUserMessage(userText)
        pendingUserTranscriptionRef.current = false
      } else {
        onUserMessage(userText, false)
      }
    })

    voice.on('responseStart', () => {
      isRespondingRef.current = true
      rawTextRef.current = ''
      lastSentRef.current = ''
      startStreaming()
      setVoiceState('processing')
    })

    voice.on('responseTranscriptDelta', (delta: string) => {
      rawTextRef.current += String(delta || '')
      setVoiceState('speaking')
    })

    voice.on('response', (t: string) => {
      stopStreaming()
      const final = String(t || '').trim()
      if (final) {
        const sources = currentSourcesRef.current.length > 0 ? [...currentSourcesRef.current] : undefined
        console.log('🎤 Voice response complete, sources:', sources?.length ?? 0)
        onAssistantMessage(final, sources)
      }
      rawTextRef.current = ''
      lastSentRef.current = ''
      isRespondingRef.current = false
      currentSourcesRef.current = []
      if (isActive) setVoiceState('ready')
    })

    voice.on('toolCall', handleSdkToolCall)
    voice.on('muted', () => setIsMicMuted(true))
    voice.on('unmuted', () => setIsMicMuted(false))

    voice.on('error', () => {
      // Keep UI usable; user can close/reopen
      if (isActive) setVoiceState('ready')
    })

    await Promise.resolve(voice.start())
  }, [
    buildContextInstructions,
    handleSdkToolCall,
    isActive,
    onAssistantMessage,
    onUpdateUserMessage,
    onUserMessage,
    startStreaming,
    startVisualizer,
    stopStreaming,
  ])

  useEffect(() => {
    if (isActive) startSession()
    else cleanup()
  }, [cleanup, isActive, startSession])

  useEffect(() => () => cleanup(), [cleanup])

  if (!isActive) return null

  // Only show prompt when no messages AND hasn't spoken yet
  const showPrompt = !hasMessages && !hasSpoken && (voiceState === 'ready' || voiceState === 'listening')

  return (
    <>
      <Script
        src="https://www.komilion.com/komilion-voice-sdk.js"
        strategy="afterInteractive"
        onLoad={() => {
          sdkLoadedRef.current = true
          if (isActive) startSession()
        }}
      />
      {/* Warm glow from bottom */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 pointer-events-none z-40"
        style={{
          background: 'linear-gradient(to top, rgba(251, 146, 60, 0.1) 0%, transparent 30%)'
        }}
      />

      {/* "You may start speaking" - only on empty state */}
      <AnimatePresence>
        {showPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center z-40 pointer-events-none"
          >
            <div className="flex items-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-zinc-400 rounded-full"
                  animate={{ height: [8, 20, 8] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }}
                />
              ))}
            </div>
            <p className="text-zinc-400 text-base">You may start speaking</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom control bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6"
      >
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-zinc-900/90 backdrop-blur-xl border border-zinc-800/50">
            
            {/* Left controls */}
            <div className="flex items-center gap-2">
              {/* Grok-style audio visualizer button with waves */}
              <button
                onClick={() => {
                  const v = voiceRef.current as any
                  if (v && typeof v.toggleMute === 'function') {
                    const nextMuted = v.toggleMute()
                    setIsMicMuted(Boolean(nextMuted))
                    return
                  }
                  setIsMicMuted(!isMicMuted)
                }}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-full transition-all",
                  isMicMuted 
                    ? "bg-zinc-800 border border-zinc-700" 
                    : "bg-zinc-800 border border-zinc-600"
                )}
              >
                {/* Audio wave bars inside button */}
                <div className="flex items-center gap-0.5 h-5">
                  {[...Array(5)].map((_, i) => {
                    const baseHeight = 6
                    const maxHeight = 16
                    const variation = [0.5, 0.8, 1.0, 0.8, 0.5][i]
                    const dynamicHeight = isMicMuted 
                      ? baseHeight 
                      : baseHeight + (audioLevel * maxHeight * variation)
                    
                    return (
                      <motion.div
                        key={i}
                        className={cn(
                          "w-0.5 rounded-full transition-colors",
                          isMicMuted
                            ? "bg-red-400"
                            : voiceState === 'connecting'
                              ? "bg-zinc-500"
                              : audioLevel > 0.1
                                ? "bg-white"
                                : "bg-zinc-400"
                        )}
                        animate={{ 
                          height: voiceState === 'connecting' && !isMicMuted
                            ? [6, 14, 6] 
                            : dynamicHeight,
                          opacity: voiceState === 'connecting' && !isMicMuted ? [0.4, 1, 0.4] : 1
                        }}
                        transition={{ 
                          duration: voiceState === 'connecting' ? 0.8 : 0.05,
                          repeat: voiceState === 'connecting' && !isMicMuted ? Infinity : 0,
                          delay: voiceState === 'connecting' ? i * 0.08 : 0
                        }}
                      />
                    )
                  })}
                </div>
                
                {/* Mic icon - only show when muted */}
                {isMicMuted && <MicOff className="w-4 h-4 text-red-400 ml-1" />}
              </button>
              
            </div>

            <div className="flex-1" />

            <button
              onClick={() => { cleanup(); onClose() }}
              className="p-2.5 rounded-full bg-white text-black hover:bg-zinc-200 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
