'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mic, MicOff } from 'lucide-react'
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
1. Always respond in English
2. Keep responses SHORT (2-3 sentences for voice)
3. Be warm, friendly, and encouraging

YOUR IDENTITY:
- Name: QBOT (say "Q-bot")
- Created by KTH to help explore their climate and sustainability research
- You have access to 1,000+ KTH research papers

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
   - Examples: "latest climate news", "what is COP28", "Tesla's carbon footprint"

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

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null) // For audio visualization
  const animationFrameRef = useRef<number | null>(null)
  const audioQueueRef = useRef<Float32Array[]>([])
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const connectedRef = useRef(false)
  const sessionConfiguredRef = useRef(false)
  
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

  const connect = useCallback(async () => {
    if (connectedRef.current) return
    connectedRef.current = true
    sessionConfiguredRef.current = false
    setVoiceState('connecting')
    setHasSpoken(false)

    try {
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'realtime-config' })
      })
      const config = await res.json()
      
      if (!config.wsUrl) {
        console.error('No WebSocket URL:', config)
        return
      }

      const ws = new WebSocket(config.wsUrl)
      wsRef.current = ws

      ws.onopen = () => console.log('WebSocket connected')
      ws.onmessage = (e) => {
        try { handleMessage(JSON.parse(e.data)) } catch {}
      }
      ws.onerror = () => console.error('WebSocket error')
      ws.onclose = () => { connectedRef.current = false; sessionConfiguredRef.current = false }

    } catch (err) {
      console.error('Connection failed:', err)
      connectedRef.current = false
    }
  }, [])

  const configureSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (sessionConfiguredRef.current) return
    
    console.log('Configuring QBOT session...')
    
    // Build context from chat history if available (use ref to get latest)
    const currentChatHistory = chatHistoryRef.current
    let contextInstructions = QBOT_INSTRUCTIONS
    if (currentChatHistory.length > 0) {
      // Get last 10 messages for context (to avoid token limits)
      const recentHistory = currentChatHistory.slice(-10)
      const historyText = recentHistory.map(msg => 
        `${msg.role === 'user' ? 'User' : 'QBOT'}: ${msg.content.slice(0, 300)}${msg.content.length > 300 ? '...' : ''}`
      ).join('\n')
      
      contextInstructions = `${QBOT_INSTRUCTIONS}

CONVERSATION HISTORY (continue from here seamlessly):
${historyText}

The user has now switched to voice mode. Continue the conversation naturally, remembering everything discussed above.`
      
      console.log('📝 Including', recentHistory.length, 'messages of chat history')
    }
    
    wsRef.current.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: 'marin',
        instructions: contextInstructions,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800,
          create_response: true
        },
        tools: [
          {
            type: 'function',
            name: 'search_kth_research',
            description: 'Search KTH research database. Use FIRST for any question about climate research, sustainability, KTH papers, or researchers. Displays clickable paper cards with titles, authors, years, and links.',
            parameters: {
              type: 'object',
              properties: { 
                query: { 
                  type: 'string',
                  description: 'Search query - topic name, researcher name, or research area'
                } 
              },
              required: ['query']
            }
          },
          {
            type: 'function',
            name: 'search_web',
            description: 'Search the broader internet. Use as a SECOND option when: (1) KTH search found nothing relevant, (2) user asks about global/non-KTH topics, (3) user wants current news or recent developments, (4) user explicitly asks to search the web. Returns summarized answers with source links.',
            parameters: {
              type: 'object',
              properties: { 
                query: { 
                  type: 'string',
                  description: 'Search query for web search'
                } 
              },
              required: ['query']
            }
          }
        ],
        tool_choice: 'auto'
      }
    }))
    sessionConfiguredRef.current = true
  }, []) // Uses chatHistoryRef so no dependencies needed

  const handleToolCall = async (callId: string, name: string, args: string) => {
    try {
      const { query } = JSON.parse(args)
      let output = ''
      
      if (name === 'search_kth_research') {
        console.log('🔍 Tool call: search_kth_research ->', query)
        
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: 5 })
        })
        
        output = 'No research papers found for this query in KTH database. You may want to try search_web for broader results.'
        if (res.ok) {
          const data = await res.json()
          if (data.results?.length > 0) {
            // Store sources with URLs for later display
            currentSourcesRef.current = data.results.map((r: any) => ({
              title: r.title || 'Untitled',
              url: r.url,
              authors: r.authors,
              year: r.year,
              department: r.department,
              category: r.category
            }))
            
            output = 'Found these KTH research papers:\n\n' + data.results.map((r: any, i: number) => 
              `${i+1}. Title: "${r.title}"\n   Authors: ${r.authors || 'Unknown'}\n   Year: ${r.year || 'n.d.'}\n   URL: ${r.url || 'N/A'}\n   Summary: ${r.content?.slice(0, 200)}...`
            ).join('\n\n')
            console.log('✅ Found', data.results.length, 'KTH results')
          }
        }
      } 
      else if (name === 'search_web') {
        console.log('🌐 Tool call: search_web ->', query)
        
        const res = await fetch('/api/web-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: 5 })
        })
        
        output = 'Web search temporarily unavailable.'
        if (res.ok) {
          const data = await res.json()
          
          // Store web sources for display
          if (data.results?.length > 0) {
            currentSourcesRef.current = data.results.map((r: any) => ({
              title: r.title || r.source || 'Web Source',
              url: r.url,
              authors: r.source, // Use source domain as "author"
              department: 'Web',
              category: 'web'
            }))
          }
          
          if (data.answer) {
            output = `Web search results:\n\n${data.answer}`
            if (data.results?.length > 0) {
              output += '\n\nSources:\n' + data.results.map((r: any, i: number) => 
                `${i+1}. ${r.source}: ${r.url}`
              ).join('\n')
            }
            // Web search returned results
          } else if (data.results?.length > 0) {
            output = 'Found these web sources:\n' + data.results.map((r: any, i: number) => 
              `${i+1}. ${r.title}: ${r.url}`
            ).join('\n')
          }
        }
      }
      else {
        console.log('⚠️ Unknown tool:', name)
        output = 'Unknown tool called.'
      }
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output }
        }))
        wsRef.current.send(JSON.stringify({ type: 'response.create' }))
      }
    } catch (err) {
      console.error('Tool call error:', err)
    }
  }

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

  const handleMessage = useCallback((msg: any) => {
    // Debug logging
    if (!msg.type?.includes('audio.delta') && !msg.type?.includes('append')) {
      console.log('📨', msg.type)
    }

    switch (msg.type) {
      case 'session.created':
        configureSession()
        break

      case 'session.updated':
        console.log('✅ Session configured')
        startMicrophone()
        break

      case 'input_audio_buffer.speech_started':
        setHasSpoken(true)
        stopStreaming()
        if (currentSourceRef.current) {
          try { currentSourceRef.current.stop(0) } catch {}
          currentSourceRef.current = null
        }
        audioQueueRef.current = []
        isPlayingRef.current = false
        if (isRespondingRef.current) {
          wsRef.current?.send(JSON.stringify({ type: 'response.cancel' }))
        }
        rawTextRef.current = ''
        lastSentRef.current = ''
        isRespondingRef.current = false
        currentSourcesRef.current = [] // Clear sources for new turn
        // Reset pending transcription state when user starts speaking again
        pendingUserTranscriptionRef.current = false
        setVoiceState('listening')
        break

      case 'input_audio_buffer.speech_stopped':
        setVoiceState('processing')
        // Only add placeholder if we don't already have one pending
        if (!pendingUserTranscriptionRef.current) {
          pendingUserTranscriptionRef.current = true
          onUserMessage('...', true) // Placeholder
        }
        break

      case 'conversation.item.input_audio_transcription.completed':
        const userText = msg.transcript?.trim() || ''
        console.log('👤 User:', userText)
        if (userText && pendingUserTranscriptionRef.current) {
          // Update the placeholder with actual text
          console.log('📝 Updating placeholder with:', userText)
          onUpdateUserMessage(userText)
          pendingUserTranscriptionRef.current = false
        } else if (userText && !pendingUserTranscriptionRef.current) {
          // Transcription arrived but no placeholder - add as new message
          console.log('📝 Adding transcription as new message:', userText)
          onUserMessage(userText, false)
        }
        break

      case 'conversation.item.created':
        // Don't duplicate user messages - we handle them via transcription.completed
        break

      case 'response.created':
        isRespondingRef.current = true
        rawTextRef.current = ''
        lastSentRef.current = ''
        startStreaming()
        break

      case 'response.audio_transcript.delta':
        rawTextRef.current += (msg.delta || '')
        setVoiceState('speaking')
        break

      case 'response.audio.delta':
        if (msg.delta) playAudio(msg.delta)
        setVoiceState('speaking')
        break

      case 'response.function_call_arguments.done':
        console.log('🔧 Tool call:', msg.name)
        handleToolCall(msg.call_id, msg.name, msg.arguments)
        break

      case 'response.done':
        stopStreaming()
        const final = rawTextRef.current.trim()
        if (final) {
          // Pass sources along with the message
          const sources = currentSourcesRef.current.length > 0 ? [...currentSourcesRef.current] : undefined
          onAssistantMessage(final, sources)
          currentSourcesRef.current = [] // Clear after use
        }
        rawTextRef.current = ''
        lastSentRef.current = ''
        isRespondingRef.current = false
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) setVoiceState('ready')
        }, 200)
        break

      case 'error':
        if (!msg.error?.message?.includes('Cancellation')) {
          console.error('Error:', msg.error?.message)
        }
        break
    }
  }, [configureSession, onUserMessage, onUpdateUserMessage, onAssistantMessage, startStreaming, stopStreaming])

  const startMicrophone = async () => {
    if (mediaStreamRef.current) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      mediaStreamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = ctx
      
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      
      // Create analyser for audio visualization
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current = analyser
      source.connect(analyser)
      
      // Start audio level monitoring for visualizer
      const updateAudioLevel = () => {
        if (analyserRef.current && !isMicMuted) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
          analyserRef.current.getByteFrequencyData(dataArray)
          // Get average level from lower frequencies (voice range)
          const voiceRange = dataArray.slice(0, 32)
          const avg = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length
          setAudioLevel(avg / 255) // Normalize to 0-1
        } else {
          setAudioLevel(0)
        }
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel)
      }
      updateAudioLevel()
      
      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isMicMuted) return
        
        const input = e.inputBuffer.getChannelData(0)
        const pcm = new Int16Array(input.length)
        for (let i = 0; i < input.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, input[i] * 32768))
        }
        
        const bytes = new Uint8Array(pcm.buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: btoa(binary)
        }))
      }
      
      source.connect(processor)
      processor.connect(ctx.destination)
      setVoiceState('ready')
    } catch (err) {
      console.error('Microphone error:', err)
    }
  }

  const playAudio = (base64: string) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    
    const int16 = new Int16Array(bytes.buffer)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768
    
    audioQueueRef.current.push(float32)
    playNext()
  }

  const playNext = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return
    isPlayingRef.current = true

    let ctx = audioContextRef.current
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = ctx
    }
    if (ctx.state === 'suspended') await ctx.resume()

    const data = audioQueueRef.current.shift()!
    const buffer = ctx.createBuffer(1, data.length, 24000)
    buffer.getChannelData(0).set(data)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    currentSourceRef.current = source
    source.onended = () => {
      currentSourceRef.current = null
      isPlayingRef.current = false
      playNext()
    }
    source.start()
  }

  const cleanup = useCallback(() => {
    stopStreaming()
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    processorRef.current?.disconnect()
    analyserRef.current?.disconnect()
    if (currentSourceRef.current) try { currentSourceRef.current.stop(0) } catch {}
    mediaStreamRef.current?.getTracks().forEach(t => t.stop())
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close()
    wsRef.current?.close()
    
    wsRef.current = null
    audioContextRef.current = null
    mediaStreamRef.current = null
    processorRef.current = null
    analyserRef.current = null
    connectedRef.current = false
    sessionConfiguredRef.current = false
    audioQueueRef.current = []
    isPlayingRef.current = false
    isRespondingRef.current = false
    pendingUserTranscriptionRef.current = false
    currentSourcesRef.current = []
    setAudioLevel(0)
  }, [stopStreaming])

  useEffect(() => {
    if (isActive) connect()
    else cleanup()
  }, [isActive, connect, cleanup])

  useEffect(() => () => cleanup(), [cleanup])

  if (!isActive) return null

  // Only show prompt when no messages AND hasn't spoken yet
  const showPrompt = !hasMessages && !hasSpoken && (voiceState === 'ready' || voiceState === 'listening')

  return (
    <>
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
                onClick={() => setIsMicMuted(!isMicMuted)}
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
