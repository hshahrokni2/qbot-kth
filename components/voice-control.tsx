'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, X, Volume2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type VoiceState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'muted' | 'error'

interface VoiceControlProps {
  isActive: boolean
  onClose: () => void
  onUserMessage: (text: string) => void
  onAssistantMessage: (text: string, sources?: any[]) => void
  onAssistantChunk: (chunk: string) => void
  chatHistory: Array<{ role: string; content: string }>
}

const KOMILION_WS_PROXY = 'wss://komilion-voice-proxy.fly.dev'

export function VoiceControl({ 
  isActive, 
  onClose, 
  onUserMessage, 
  onAssistantMessage,
  onAssistantChunk,
  chatHistory 
}: VoiceControlProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [currentResponse, setCurrentResponse] = useState('')
  
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const audioQueueRef = useRef<Int16Array[]>([])
  const isPlayingRef = useRef(false)
  const nextPlayTimeRef = useRef(0)
  const isMutedRef = useRef(false)

  // Connect to OpenAI Realtime
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    
    setVoiceState('connecting')
    setError(null)

    try {
      // Get config from server
      const configRes = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'realtime-config' })
      })
      
      const config = await configRes.json()
      const wsUrl = config.wsUrl || KOMILION_WS_PROXY
      const token = config.token
      
      const fullWsUrl = token 
        ? `${wsUrl}?token=${token}&model=gpt-4o-realtime-preview`
        : `${wsUrl}?model=gpt-4o-realtime-preview`
      
      console.log('🔌 Connecting to OpenAI Realtime...')
      
      const ws = new WebSocket(fullWsUrl)
      wsRef.current = ws

      ws.onopen = async () => {
        console.log('✅ Connected')
        
        // Configure session with QBOT personality
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: 'nova',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 800
            },
            instructions: `You are QBOT, a friendly AI assistant for KTH Royal Institute of Technology's climate research.

You help users explore:
- Climate science, BECCS, carbon capture
- Renewable energy and hydrogen research
- Sustainable cities and smart buildings
- KTH's cutting-edge research projects

Keep responses SHORT (1-3 sentences) for voice. Be enthusiastic about climate solutions!
When mentioning specific research, name KTH researchers if relevant.`
          }
        }))
        
        await startAudioCapture()
        setVoiceState('listening')
      }

      ws.onmessage = (e) => {
        try {
          handleMessage(JSON.parse(e.data))
        } catch {}
      }

      ws.onerror = () => {
        setError('Connection failed')
        setVoiceState('error')
      }

      ws.onclose = () => {
        if (voiceState !== 'idle') {
          setVoiceState('idle')
        }
      }

    } catch (err) {
      setError('Failed to connect')
      setVoiceState('error')
    }
  }, [voiceState])

  // Handle realtime messages
  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'input_audio_buffer.speech_started':
        setVoiceState('listening')
        setCurrentTranscript('')
        break

      case 'input_audio_buffer.speech_stopped':
        setVoiceState('processing')
        break

      case 'conversation.item.input_audio_transcription.completed':
        const transcript = msg.transcript || ''
        setCurrentTranscript(transcript)
        if (transcript.trim()) {
          onUserMessage(transcript) // Add to chat!
        }
        break

      case 'response.audio_transcript.delta':
        const chunk = msg.delta || ''
        setCurrentResponse(prev => prev + chunk)
        onAssistantChunk(chunk) // Stream to chat!
        break

      case 'response.audio.delta':
        if (msg.delta) {
          const audioData = base64ToInt16(msg.delta)
          audioQueueRef.current.push(audioData)
          if (!isPlayingRef.current) playAudio()
        }
        setVoiceState('speaking')
        break

      case 'response.done':
        if (currentResponse.trim()) {
          onAssistantMessage(currentResponse) // Finalize in chat
        }
        setCurrentResponse('')
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN && !isMutedRef.current) {
            setVoiceState('listening')
          }
        }, 300)
        break

      case 'error':
        setError(msg.error?.message || 'Error')
        setVoiceState('error')
        break
    }
  }, [currentResponse, onUserMessage, onAssistantChunk, onAssistantMessage])

  // Audio helpers
  const base64ToInt16 = (b64: string): Int16Array => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Int16Array(bytes.buffer)
  }

  const playAudio = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }
    isPlayingRef.current = true

    const ctx = audioContextRef.current || new AudioContext({ sampleRate: 24000 })
    if (!audioContextRef.current) audioContextRef.current = ctx
    if (ctx.state === 'suspended') await ctx.resume()

    while (audioQueueRef.current.length > 0) {
      const pcm = audioQueueRef.current.shift()!
      const float = new Float32Array(pcm.length)
      for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768

      const buf = ctx.createBuffer(1, float.length, 24000)
      buf.getChannelData(0).set(float)

      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)

      const t = Math.max(ctx.currentTime, nextPlayTimeRef.current)
      src.start(t)
      nextPlayTimeRef.current = t + buf.duration
    }

    setTimeout(() => {
      if (audioQueueRef.current.length > 0) playAudio()
      else isPlayingRef.current = false
    }, 50)
  }, [])

  // Start mic capture
  const startAudioCapture = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    streamRef.current = stream

    const ctx = new AudioContext({ sampleRate: 24000 })
    audioContextRef.current = ctx

    analyserRef.current = ctx.createAnalyser()
    analyserRef.current.fftSize = 256

    const src = ctx.createMediaStreamSource(stream)
    src.connect(analyserRef.current)

    // Audio level animation
    const updateLevel = () => {
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        setAudioLevel(data.reduce((a, b) => a + b) / data.length / 255)
      }
      animationRef.current = requestAnimationFrame(updateLevel)
    }
    updateLevel()

    // Send audio to WebSocket
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor
    
    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      if (isMutedRef.current) return

      const input = e.inputBuffer.getChannelData(0)
      const pcm = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]))
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      
      wsRef.current.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)))
      }))
    }

    src.connect(processor)
    processor.connect(ctx.destination)
  }

  // Mute/unmute
  const toggleMute = () => {
    isMutedRef.current = !isMutedRef.current
    setVoiceState(isMutedRef.current ? 'muted' : 'listening')
  }

  // Cleanup
  const cleanup = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    wsRef.current?.close()
    wsRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close()
    audioQueueRef.current = []
    isPlayingRef.current = false
    isMutedRef.current = false
    setVoiceState('idle')
    setCurrentTranscript('')
    setCurrentResponse('')
  }, [])

  // Auto-connect when active
  useEffect(() => {
    if (isActive && voiceState === 'idle') {
      connect()
    } else if (!isActive && voiceState !== 'idle') {
      cleanup()
    }
  }, [isActive, voiceState, connect, cleanup])

  useEffect(() => () => cleanup(), [cleanup])

  if (!isActive) return null

  // Colors based on state
  const stateColors = {
    idle: 'bg-slate-500',
    connecting: 'bg-amber-500 animate-pulse',
    listening: 'bg-green-500',
    processing: 'bg-blue-500 animate-pulse',
    speaking: 'bg-purple-500',
    muted: 'bg-red-500',
    error: 'bg-red-600'
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.9 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50"
    >
      {/* Floating pill control */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-full bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl">
        
        {/* Status indicator */}
        <div className={cn("w-3 h-3 rounded-full", stateColors[voiceState])} />
        
        {/* Status text */}
        <span className="text-sm text-white/80 min-w-[100px]">
          {voiceState === 'connecting' && 'Connecting...'}
          {voiceState === 'listening' && '🎙️ Listening'}
          {voiceState === 'processing' && '🤔 Thinking...'}
          {voiceState === 'speaking' && '🔊 Speaking'}
          {voiceState === 'muted' && '🔇 Muted'}
          {voiceState === 'error' && '❌ Error'}
          {voiceState === 'idle' && 'Voice Mode'}
        </span>

        {/* Audio level visualizer */}
        {(voiceState === 'listening' || voiceState === 'speaking') && (
          <div className="flex items-center gap-0.5 h-6">
            {[...Array(5)].map((_, i) => (
              <motion.div
                key={i}
                className={cn(
                  "w-1 rounded-full",
                  voiceState === 'listening' ? 'bg-green-400' : 'bg-purple-400'
                )}
                animate={{
                  height: voiceState === 'listening' 
                    ? `${8 + audioLevel * 16 + Math.sin(Date.now() / 100 + i) * 4}px`
                    : `${8 + Math.sin(Date.now() / 150 + i * 0.5) * 8}px`
                }}
                transition={{ duration: 0.05 }}
              />
            ))}
          </div>
        )}

        {/* Mute button */}
        <button
          onClick={toggleMute}
          disabled={voiceState === 'connecting' || voiceState === 'idle'}
          className={cn(
            "p-2 rounded-full transition-colors",
            voiceState === 'muted' 
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" 
              : "bg-white/10 text-white/80 hover:bg-white/20",
            (voiceState === 'connecting' || voiceState === 'idle') && "opacity-50"
          )}
        >
          {voiceState === 'muted' ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Close button */}
        <button
          onClick={() => { cleanup(); onClose(); }}
          className="p-2 rounded-full bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error tooltip */}
      {error && (
        <motion.div 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-red-500/90 text-white text-sm whitespace-nowrap"
        >
          {error}
        </motion.div>
      )}
    </motion.div>
  )
}

