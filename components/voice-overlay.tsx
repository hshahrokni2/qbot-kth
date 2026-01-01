'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, X, Volume2, Loader2, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

type VoiceState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error'

interface VoiceOverlayProps {
  isOpen: boolean
  onClose: () => void
  onMessage: (userMessage: string, assistantMessage: string, sources?: any[]) => void
  chatHistory: Array<{ role: string; content: string }>
}

// Komilion WebSocket proxy for OpenAI Realtime API
const KOMILION_WS_PROXY = 'wss://komilion-voice-proxy.fly.dev'

export function VoiceOverlay({ isOpen, onClose, onMessage, chatHistory }: VoiceOverlayProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  
  // WebSocket and audio refs
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const audioQueueRef = useRef<Int16Array[]>([])
  const isPlayingRef = useRef(false)
  const nextPlayTimeRef = useRef(0)

  // Connect to OpenAI Realtime via Komilion proxy
  const connectRealtime = useCallback(async () => {
    setVoiceState('connecting')
    setError(null)
    setTranscript('')
    setResponse('')

    try {
      // Get API key from server
      const configRes = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'realtime-config' })
      })
      
      if (!configRes.ok) {
        throw new Error('Failed to get realtime config')
      }
      
      const config = await configRes.json()
      const wsUrl = config.wsUrl || KOMILION_WS_PROXY
      const token = config.token
      
      // Build WebSocket URL with auth
      const fullWsUrl = token 
        ? `${wsUrl}?token=${token}&model=gpt-4o-realtime-preview`
        : `${wsUrl}?model=gpt-4o-realtime-preview`
      
      // Connecting to voice service
      
      const ws = new WebSocket(fullWsUrl)
      wsRef.current = ws

      ws.onopen = async () => {
        console.log('✅ WebSocket connected')
        
        // Configure the session
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: 'nova',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700
            },
            instructions: `You are QBOT, an AI assistant for KTH Royal Institute of Technology's climate research.
You help users understand:
- Climate science and BECCS (Bioenergy with Carbon Capture)
- Carbon capture and storage technologies
- Renewable energy research
- Sustainable development
- KTH's cutting-edge research projects

Keep responses concise (2-3 sentences) since this is voice mode.
Be enthusiastic about climate solutions!
If asked about specific research, mention KTH researchers when relevant.`
          }
        }))
        
        // Start capturing audio
        await startAudioCapture()
        setVoiceState('listening')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          handleRealtimeMessage(msg)
        } catch (e) {
          console.error('Failed to parse message:', e)
        }
      }

      ws.onerror = (e) => {
        console.error('WebSocket error:', e)
        setError('Connection error')
        setVoiceState('error')
      }

      ws.onclose = (e) => {
        console.log('WebSocket closed:', e.code, e.reason)
        if (voiceState !== 'idle') {
          setVoiceState('idle')
        }
      }

    } catch (err) {
      console.error('Connection error:', err)
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setVoiceState('error')
    }
  }, [])

  // Handle messages from OpenAI Realtime API
  const handleRealtimeMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'session.created':
        console.log('📝 Session created')
        break

      case 'session.updated':
        console.log('📝 Session updated')
        break

      case 'input_audio_buffer.speech_started':
        console.log('🎙️ Speech started')
        setVoiceState('listening')
        break

      case 'input_audio_buffer.speech_stopped':
        console.log('🛑 Speech stopped')
        setVoiceState('processing')
        break

      case 'conversation.item.input_audio_transcription.completed':
        console.log('📝 Transcript:', msg.transcript)
        setTranscript(msg.transcript || '')
        break

      case 'response.audio_transcript.delta':
        setResponse(prev => prev + (msg.delta || ''))
        break

      case 'response.audio.delta':
        // Decode and queue audio for playback
        if (msg.delta) {
          const audioData = base64ToInt16Array(msg.delta)
          audioQueueRef.current.push(audioData)
          if (!isPlayingRef.current) {
            playAudioQueue()
          }
        }
        setVoiceState('speaking')
        break

      case 'response.audio.done':
        console.log('🔊 Audio response complete')
        break

      case 'response.done':
        console.log('✅ Response complete')
        // Save to chat history
        if (transcript && response) {
          onMessage(transcript, response)
        }
        // Reset for next turn
        setTimeout(() => {
          setTranscript('')
          setResponse('')
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            setVoiceState('listening')
          }
        }, 500)
        break

      case 'error':
        console.error('API Error:', msg.error)
        setError(msg.error?.message || 'API error')
        setVoiceState('error')
        break
    }
  }, [transcript, response, onMessage])

  // Convert base64 to Int16Array for audio playback
  const base64ToInt16Array = (base64: string): Int16Array => {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return new Int16Array(bytes.buffer)
  }

  // Play queued audio chunks
  const playAudioQueue = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }

    isPlayingRef.current = true

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 })
    }

    const ctx = audioContextRef.current
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    while (audioQueueRef.current.length > 0) {
      const pcmData = audioQueueRef.current.shift()!
      
      // Convert Int16 to Float32
      const floatData = new Float32Array(pcmData.length)
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768
      }

      const audioBuffer = ctx.createBuffer(1, floatData.length, 24000)
      audioBuffer.getChannelData(0).set(floatData)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)

      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current)
      source.start(startTime)
      nextPlayTimeRef.current = startTime + audioBuffer.duration
    }

    // Check for more audio after a short delay
    setTimeout(() => {
      if (audioQueueRef.current.length > 0) {
        playAudioQueue()
      } else {
        isPlayingRef.current = false
      }
    }, 50)
  }, [])

  // Start capturing audio from microphone
  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = ctx

      // Setup analyser for visual feedback
      analyserRef.current = ctx.createAnalyser()
      analyserRef.current.fftSize = 256
      
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyserRef.current)

      // Start audio level animation
      const updateLevel = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
          analyserRef.current.getByteFrequencyData(dataArray)
          const avg = dataArray.reduce((a, b) => a + b) / dataArray.length
          setAudioLevel(avg / 255)
        }
        animationRef.current = requestAnimationFrame(updateLevel)
      }
      updateLevel()

      // Use ScriptProcessor for sending audio (AudioWorklet would be better but more complex)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return
        if (voiceState !== 'listening') return

        const inputData = e.inputBuffer.getChannelData(0)
        
        // Convert Float32 to Int16
        const pcmData = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]))
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }

        // Send as base64
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)))
        
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64
        }))
      }

      source.connect(processor)
      processor.connect(ctx.destination)

      console.log('🎙️ Audio capture started')

    } catch (err) {
      console.error('Audio capture error:', err)
      setError('Microphone access denied')
      setVoiceState('error')
    }
  }

  // Cleanup
  const cleanup = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
    }
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close()
    }
    audioQueueRef.current = []
    isPlayingRef.current = false
    nextPlayTimeRef.current = 0
  }, [])

  // Handle orb click
  const handleOrbClick = () => {
    if (voiceState === 'idle' || voiceState === 'error') {
      connectRealtime()
    } else if (voiceState === 'listening') {
      // Commit audio and trigger response
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        wsRef.current.send(JSON.stringify({ type: 'response.create' }))
        setVoiceState('processing')
      }
    } else if (voiceState === 'speaking') {
      // Interrupt - cancel current response
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'response.cancel' }))
      }
      audioQueueRef.current = []
      setVoiceState('listening')
    }
  }

  // Handle close
  const handleClose = () => {
    cleanup()
    setVoiceState('idle')
    setTranscript('')
    setResponse('')
    setError(null)
    onClose()
  }

  // Auto-connect when opened
  useEffect(() => {
    if (isOpen && voiceState === 'idle') {
      const timer = setTimeout(() => connectRealtime(), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  // Dynamic colors based on state
  const getColors = () => {
    switch (voiceState) {
      case 'connecting':
        return { primary: '#f59e0b', secondary: '#f97316', glow: 'rgba(245, 158, 11, 0.4)' }
      case 'listening':
        return { primary: '#10b981', secondary: '#059669', glow: 'rgba(16, 185, 129, 0.4)' }
      case 'processing':
        return { primary: '#3b82f6', secondary: '#6366f1', glow: 'rgba(59, 130, 246, 0.4)' }
      case 'speaking':
        return { primary: '#8b5cf6', secondary: '#d946ef', glow: 'rgba(139, 92, 246, 0.4)' }
      case 'error':
        return { primary: '#ef4444', secondary: '#dc2626', glow: 'rgba(239, 68, 68, 0.4)' }
      default:
        return { primary: '#06b6d4', secondary: '#3b82f6', glow: 'rgba(6, 182, 212, 0.3)' }
    }
  }

  const colors = getColors()

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <motion.div 
          className="absolute inset-0 bg-black/85 backdrop-blur-md"
          onClick={handleClose}
        />

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-6 right-6 z-60 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Main content */}
        <div className="relative z-50 flex flex-col items-center justify-center px-4">
          
          {/* Aura container */}
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 flex items-center justify-center">
            
            {/* Background aura */}
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{
                background: `radial-gradient(ellipse at center bottom, ${colors.primary}40, ${colors.secondary}20, transparent 70%)`,
                filter: 'blur(40px)',
              }}
              animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.8, 0.6] }}
              transition={{ duration: 3, repeat: Infinity }}
            />

            {/* Rotating ring */}
            <motion.div
              className="absolute inset-4 rounded-full"
              style={{
                background: `conic-gradient(from 0deg, ${colors.primary}30, ${colors.secondary}30, ${colors.primary}30)`,
                filter: 'blur(25px)',
              }}
              animate={{
                rotate: 360,
                scale: voiceState === 'listening' ? [1, 1.1 + audioLevel * 0.3, 1] : 1,
              }}
              transition={{
                rotate: { duration: 8, repeat: Infinity, ease: 'linear' },
                scale: { duration: 0.1 },
              }}
            />

            {/* Listening pulses */}
            {voiceState === 'listening' && (
              <>
                <motion.div
                  className="absolute inset-0 rounded-full border-2"
                  style={{ borderColor: `${colors.primary}60` }}
                  initial={{ scale: 0.8, opacity: 1 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <motion.div
                  className="absolute inset-0 rounded-full border"
                  style={{ borderColor: `${colors.primary}40` }}
                  initial={{ scale: 0.8, opacity: 1 }}
                  animate={{ scale: 1.8, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                />
              </>
            )}

            {/* Speaking waves */}
            {voiceState === 'speaking' && (
              <div className="absolute inset-0 flex items-center justify-center">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full border-2"
                    style={{ 
                      borderColor: `${colors.primary}40`,
                      width: `${60 + i * 15}%`,
                      height: `${60 + i * 15}%`,
                    }}
                    animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 1 + i * 0.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            )}

            {/* Center orb */}
            <motion.button
              onClick={handleOrbClick}
              className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-full flex items-center justify-center cursor-pointer backdrop-blur-xl"
              style={{
                background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.15), rgba(255,255,255,0.02) 70%)`,
                boxShadow: `0 0 60px ${colors.glow}, inset 0 0 30px rgba(255,255,255,0.05)`,
                border: '1px solid rgba(255,255,255,0.15)',
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              animate={{ scale: voiceState === 'listening' ? 1 + audioLevel * 0.15 : 1 }}
            >
              <div 
                className="absolute inset-3 rounded-full"
                style={{ background: `radial-gradient(circle at center, ${colors.primary}30, transparent 70%)` }}
              />
              
              <div className="relative z-10">
                {voiceState === 'connecting' && (
                  <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-amber-400 animate-spin" />
                )}
                {voiceState === 'listening' && (
                  <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
                    <Square className="w-8 h-8 sm:w-10 sm:h-10 text-green-400 fill-green-400" />
                  </motion.div>
                )}
                {voiceState === 'processing' && (
                  <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-blue-400 animate-spin" />
                )}
                {voiceState === 'speaking' && (
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                    <Volume2 className="w-10 h-10 sm:w-12 sm:h-12 text-purple-400" />
                  </motion.div>
                )}
                {voiceState === 'error' && (
                  <MicOff className="w-10 h-10 sm:w-12 sm:h-12 text-red-400" />
                )}
                {voiceState === 'idle' && (
                  <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-cyan-400" />
                )}
              </div>
            </motion.button>
          </div>

          {/* Status */}
          <motion.p
            className={cn(
              "mt-8 text-xl sm:text-2xl font-light tracking-wide",
              voiceState === 'connecting' && "text-amber-400",
              voiceState === 'listening' && "text-green-400",
              voiceState === 'processing' && "text-blue-400",
              voiceState === 'speaking' && "text-purple-400",
              voiceState === 'error' && "text-red-400",
              voiceState === 'idle' && "text-white/70"
            )}
          >
            {voiceState === 'connecting' && 'Connecting to OpenAI...'}
            {voiceState === 'listening' && 'Listening... (tap to send)'}
            {voiceState === 'processing' && 'Thinking...'}
            {voiceState === 'speaking' && 'Speaking... (tap to interrupt)'}
            {voiceState === 'error' && (error || 'Connection error')}
            {voiceState === 'idle' && 'Tap to start'}
          </motion.p>

          {/* Transcript */}
          {transcript && (
            <motion.div 
              className="mt-6 px-6 py-4 max-w-md rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-white/60 text-sm mb-1">You:</p>
              <p className="text-white/90">"{transcript}"</p>
            </motion.div>
          )}

          {/* Response */}
          {response && (
            <motion.div 
              className="mt-4 px-6 py-4 max-w-lg max-h-40 overflow-y-auto rounded-2xl bg-gradient-to-b from-white/[0.07] to-white/[0.03] backdrop-blur-xl border border-white/10"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-white/80 text-sm leading-relaxed">{response}</p>
            </motion.div>
          )}

          {/* Hint */}
          <p className="mt-8 text-white/40 text-sm">
            {voiceState === 'listening' && 'Speak naturally • Tap orb to send • Click outside to close'}
            {voiceState === 'speaking' && 'Tap orb to interrupt'}
            {voiceState === 'idle' && 'Click outside to close'}
            {voiceState === 'connecting' && 'Establishing secure connection...'}
            {voiceState === 'error' && 'Tap orb to retry'}
          </p>
        </div>

        {/* Bottom glow */}
        <div className="absolute bottom-0 left-0 right-0 h-[40vh] pointer-events-none">
          <motion.div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 80% 60% at 50% 100%, ${colors.primary}25, ${colors.secondary}10, transparent 70%)`,
            }}
            animate={{ opacity: [0.6, 0.8, 0.6] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
