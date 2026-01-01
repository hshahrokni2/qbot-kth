'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2, Sparkles, X, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// Komilion Premium WebSocket Voice Configuration
const KOMILION_WS_URL = 'wss://api.komilion.com/v1/realtime'
const KOMILION_API_URL = 'https://api.komilion.com/v1'

export function VoiceInterface() {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [isConnected, setIsConnected] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isVADActive, setIsVADActive] = useState(false) // Voice Activity Detection
  
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioQueueRef = useRef<ArrayBuffer[]>([])
  const isPlayingRef = useRef(false)

  // Real-time audio level visualization
  const updateAudioLevel = useCallback(() => {
    if (analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteFrequencyData(dataArray)
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length
      setAudioLevel(average / 255)
      
      // Voice Activity Detection - auto-trigger when speaking
      if (isVADActive && average > 30 && status === 'idle' && isConnected) {
        startListening()
      }
    }
    animationRef.current = requestAnimationFrame(updateAudioLevel)
  }, [status, isConnected, isVADActive])

  useEffect(() => {
    if (isConnected) {
      updateAudioLevel()
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isConnected, updateAudioLevel])

  // Connect to Komilion Premium WebSocket
  const connectWebSocket = async (apiKey: string) => {
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${KOMILION_WS_URL}?model=gpt-4o-realtime-preview`)
      
      ws.onopen = () => {
        // Voice WebSocket connected
        
        // Send authentication
        ws.send(JSON.stringify({
          type: 'auth',
          api_key: apiKey
        }))
        
        // Configure session for voice
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: 'shimmer', // Premium voice
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500
            },
            instructions: `You are QBOT, an expert AI assistant for KTH Royal Institute of Technology's climate research. 
            You help users understand climate science, BECCS, carbon capture, renewable energy, and sustainability research.
            Keep responses concise and conversational since this is voice mode.
            Be enthusiastic about climate solutions and KTH's cutting-edge research.`
          }
        }))
        
        resolve(ws)
      }
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        reject(error)
      }
      
      ws.onclose = () => {
        console.log('WebSocket closed')
        setIsConnected(false)
        setStatus('idle')
      }
    })
  }

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = useCallback(async (event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data)
      
      switch (message.type) {
        case 'session.created':
          console.log('✅ Session created')
          setIsConnected(true)
          setStatus('idle')
          break
          
        case 'input_audio_buffer.speech_started':
          setStatus('listening')
          break
          
        case 'input_audio_buffer.speech_stopped':
          setStatus('processing')
          break
          
        case 'conversation.item.input_audio_transcription.completed':
          setTranscript(message.transcript)
          setMessages(prev => [...prev, {
            role: 'user',
            content: message.transcript,
            timestamp: new Date()
          }])
          break
          
        case 'response.audio.delta':
          // Queue audio chunks for playback
          if (message.delta) {
            const audioData = base64ToArrayBuffer(message.delta)
            audioQueueRef.current.push(audioData)
            if (!isPlayingRef.current) {
              playAudioQueue()
            }
          }
          setStatus('speaking')
          break
          
        case 'response.audio_transcript.delta':
          setResponse(prev => prev + (message.delta || ''))
          break
          
        case 'response.audio_transcript.done':
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: message.transcript,
            timestamp: new Date()
          }])
          break
          
        case 'response.done':
          // Response complete
          setTimeout(() => {
            if (status === 'speaking') {
              setStatus('idle')
            }
          }, 500)
          break
          
        case 'error':
          console.error('Komilion error:', message)
          setError(message.error?.message || 'An error occurred')
          setStatus('error')
          break
      }
    } catch (e) {
      console.error('Error parsing WebSocket message:', e)
    }
  }, [status])

  // Convert base64 to ArrayBuffer
  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  }

  // Play audio queue
  const playAudioQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }
    
    isPlayingRef.current = true
    
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 })
    }
    
    const audioData = audioQueueRef.current.shift()!
    
    try {
      // Convert PCM16 to AudioBuffer
      const pcmData = new Int16Array(audioData)
      const floatData = new Float32Array(pcmData.length)
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768
      }
      
      const audioBuffer = audioContextRef.current.createBuffer(1, floatData.length, 24000)
      audioBuffer.getChannelData(0).set(floatData)
      
      const source = audioContextRef.current.createBufferSource()
      source.buffer = audioBuffer
      source.connect(audioContextRef.current.destination)
      
      source.onended = () => {
        playAudioQueue() // Play next chunk
      }
      
      source.start()
    } catch (e) {
      console.error('Audio playback error:', e)
      playAudioQueue() // Try next chunk
    }
  }

  // Start premium voice session
  const startVoiceSession = async () => {
    try {
      setStatus('connecting')
      setError(null)
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000
        }
      })
      streamRef.current = stream
      
      // Setup audio analysis
      audioContextRef.current = new AudioContext({ sampleRate: 24000 })
      const source = audioContextRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      source.connect(analyserRef.current)
      
      // Get API key from environment (passed through API)
      const apiKeyResponse = await fetch('/api/voice/key')
      const { apiKey } = await apiKeyResponse.json()
      
      if (!apiKey) {
        // Fallback to local simulation mode
        console.log('🎭 Running in demo mode (no API key)')
        setIsConnected(true)
        setStatus('idle')
        return
      }
      
      // Connect to Komilion WebSocket
      const ws = await connectWebSocket(apiKey)
      wsRef.current = ws
      ws.onmessage = handleWebSocketMessage
      
    } catch (err) {
      console.error('Failed to start voice session:', err)
      setError('Failed to connect. Running in demo mode.')
      // Still allow demo mode
      setIsConnected(true)
      setStatus('idle')
    }
  }

  const endVoiceSession = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    audioQueueRef.current = []
    setIsConnected(false)
    setStatus('idle')
    setTranscript('')
    setResponse('')
  }

  const startListening = async () => {
    if (!streamRef.current) return
    
    setStatus('listening')
    setTranscript('')
    setResponse('')
    
    // If WebSocket connected, stream audio
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Create audio processor for streaming
      const audioContext = new AudioContext({ sampleRate: 24000 })
      const source = audioContext.createMediaStreamSource(streamRef.current)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      
      processor.onaudioprocess = (e) => {
        if (status !== 'listening') return
        
        const inputData = e.inputBuffer.getChannelData(0)
        const pcmData = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768))
        }
        
        // Send audio to WebSocket
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)))
          }))
        }
      }
      
      source.connect(processor)
      processor.connect(audioContext.destination)
      
    } else {
      // Demo mode - use MediaRecorder
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: 'audio/webm;codecs=opus'
      })
      mediaRecorderRef.current = mediaRecorder
      
      const chunks: Blob[] = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' })
        await processDemoAudio(audioBlob)
      }
      
      mediaRecorder.start()
    }
  }

  const stopListening = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Signal end of audio input
      wsRef.current.send(JSON.stringify({
        type: 'input_audio_buffer.commit'
      }))
      wsRef.current.send(JSON.stringify({
        type: 'response.create'
      }))
    }
    
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    
    setStatus('processing')
  }

  // Demo mode audio processing (uses chat API)
  const processDemoAudio = async (audioBlob: Blob) => {
    try {
      setStatus('processing')
      
      // Simulate transcript
      const demoQuestions = [
        "What is BECCS and how does it help with climate change?",
        "Tell me about KTH's hydrogen research",
        "How is Sweden becoming carbon neutral?",
        "What's the deal with carbon capture?"
      ]
      const randomQuestion = demoQuestions[Math.floor(Math.random() * demoQuestions.length)]
      setTranscript(randomQuestion)
      
      // Get response from QBOT
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: randomQuestion,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      })
      
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ''
      
      setStatus('speaking')
      
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
        
        for (const line of lines) {
          try {
            const json = JSON.parse(line.replace('data: ', ''))
            if (json.content) {
              fullResponse += json.content
              setResponse(fullResponse)
            }
          } catch {}
        }
      }
      
      setMessages(prev => [
        ...prev,
        { role: 'user', content: randomQuestion, timestamp: new Date() },
        { role: 'assistant', content: fullResponse, timestamp: new Date() }
      ])
      
      // Simulate TTS with Web Speech API
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(fullResponse.substring(0, 500))
        utterance.rate = 1.1
        utterance.pitch = 1
        utterance.onend = () => setStatus('idle')
        speechSynthesis.speak(utterance)
      } else {
        setTimeout(() => setStatus('idle'), 2000)
      }
      
    } catch (err) {
      console.error('Demo processing error:', err)
      setError('Processing failed')
      setStatus('error')
    }
  }

  const handleMicClick = () => {
    if (status === 'listening') {
      stopListening()
    } else if (status === 'idle' && isConnected) {
      startListening()
    }
  }

  // Dynamic aura based on status and audio level
  const getAuraStyles = () => {
    const baseIntensity = {
      idle: 0.4,
      connecting: 0.5,
      listening: 0.7 + audioLevel * 0.3,
      processing: 0.6,
      speaking: 0.8 + Math.sin(Date.now() / 200) * 0.1,
      error: 0.3
    }[status]

    const colors = {
      idle: ['#06b6d4', '#3b82f6', '#8b5cf6'],
      connecting: ['#f59e0b', '#f97316', '#ef4444'],
      listening: ['#10b981', '#059669', '#14b8a6'],
      processing: ['#3b82f6', '#6366f1', '#8b5cf6'],
      speaking: ['#8b5cf6', '#d946ef', '#ec4899'],
      error: ['#ef4444', '#dc2626', '#b91c1c']
    }[status]

    return { intensity: baseIntensity, colors }
  }

  const auraStyles = getAuraStyles()

  return (
    <div className="relative min-h-screen bg-[#050508] overflow-hidden flex flex-col">
      {/* Deep Space Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12] via-[#050508] to-[#0a0a12]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(59,130,246,0.1),transparent_70%)]" />
      </div>
      
      {/* Animated Star Field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(80)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: Math.random() > 0.8 ? '2px' : '1px',
              height: Math.random() > 0.8 ? '2px' : '1px',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: 0.1 + Math.random() * 0.4,
              animation: `pulse ${2 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      {/* Header */}
      <header className="relative z-20 p-4 sm:p-6 flex items-center justify-between">
        <Link 
          href="/"
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">Back to Chat</span>
        </Link>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
            <div className={cn(
              "w-2 h-2 rounded-full",
              isConnected ? "bg-green-500 animate-pulse" : "bg-white/30"
            )} />
            <span className="text-white/60 text-sm">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          
          {isConnected && (
            <button
              onClick={endVoiceSession}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all border border-red-500/30"
            >
              <PhoneOff className="w-4 h-4" />
              <span className="hidden sm:inline text-sm">End</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 -mt-16">
        {/* Aura Container */}
        <div className="relative w-72 h-72 sm:w-96 sm:h-96 flex items-center justify-center">
          
          {/* Outer Aura Layers - Rising from below */}
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-full transition-all duration-700"
              style={{
                background: `radial-gradient(ellipse at center bottom, ${auraStyles.colors[i % 3]}${Math.round((0.3 - i * 0.05) * 100).toString(16)}, transparent 70%)`,
                transform: `scale(${1.3 + i * 0.2 + (status === 'listening' ? audioLevel * 0.2 : 0)})`,
                opacity: auraStyles.intensity * (1 - i * 0.15),
                filter: `blur(${30 + i * 15}px)`,
                animation: status === 'speaking' ? `pulse ${1.5 + i * 0.3}s ease-in-out infinite` : undefined
              }}
            />
          ))}
          
          {/* Rotating Gradient Ring */}
          <div 
            className="absolute inset-8 rounded-full opacity-50"
            style={{
              background: `conic-gradient(from ${Date.now() / 50}deg, ${auraStyles.colors.join(', ')}, ${auraStyles.colors[0]})`,
              filter: 'blur(20px)',
              animation: 'spin 8s linear infinite'
            }}
          />
          
          {/* Pulsing Rings for Listening */}
          {status === 'listening' && (
            <>
              <div 
                className="absolute inset-0 rounded-full border-2 border-green-500/40"
                style={{ animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
              />
              <div 
                className="absolute inset-4 rounded-full border border-green-400/30"
                style={{ animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite', animationDelay: '0.5s' }}
              />
              <div 
                className="absolute inset-8 rounded-full border border-teal-400/20"
                style={{ animation: 'ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite', animationDelay: '1s' }}
              />
            </>
          )}
          
          {/* Speaking Waves */}
          {status === 'speaking' && (
            <div className="absolute inset-0 flex items-center justify-center">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full border-2 border-purple-500/30"
                  style={{
                    width: `${60 + i * 20}%`,
                    height: `${60 + i * 20}%`,
                    animation: `pulse ${1 + i * 0.2}s ease-in-out infinite`,
                    animationDelay: `${i * 0.2}s`
                  }}
                />
              ))}
            </div>
          )}

          {/* Center Orb */}
          <div 
            className={cn(
              "relative w-28 h-28 sm:w-36 sm:h-36 rounded-full transition-all duration-300",
              "flex items-center justify-center cursor-pointer",
              "backdrop-blur-xl",
              status === 'listening' && "scale-110",
              status === 'speaking' && "scale-105"
            )}
            style={{
              background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.15), rgba(255,255,255,0.02) 70%)`,
              boxShadow: `
                0 0 60px ${auraStyles.colors[0]}40,
                0 0 100px ${auraStyles.colors[1]}30,
                inset 0 0 60px ${auraStyles.colors[0]}10
              `,
              border: '1px solid rgba(255,255,255,0.1)',
              transform: `scale(${1 + audioLevel * 0.1})`
            }}
            onClick={isConnected ? handleMicClick : startVoiceSession}
          >
            {/* Inner Glow */}
            <div 
              className="absolute inset-2 rounded-full"
              style={{
                background: `radial-gradient(circle at center, ${auraStyles.colors[0]}20, transparent 70%)`
              }}
            />
            
            {/* Status Icon */}
            <div className="relative z-10">
              {status === 'connecting' && (
                <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-white/80 animate-spin" />
              )}
              {status === 'idle' && isConnected && (
                <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-white/80 transition-transform hover:scale-110" />
              )}
              {status === 'listening' && (
                <div className="relative">
                  <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-green-400" />
                  <div className="absolute inset-0 rounded-full bg-green-500/30 animate-ping" />
                </div>
              )}
              {status === 'processing' && (
                <div className="relative">
                  <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-blue-400 animate-spin" />
                  <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-blue-300 animate-pulse" />
                </div>
              )}
              {status === 'speaking' && (
                <div className="relative">
                  <Volume2 className="w-10 h-10 sm:w-12 sm:h-12 text-purple-400 animate-pulse" />
                  <div className="absolute -inset-2 rounded-full border-2 border-purple-400/50 animate-ping" />
                </div>
              )}
              {status === 'error' && (
                <MicOff className="w-10 h-10 sm:w-12 sm:h-12 text-red-400" />
              )}
              {!isConnected && status === 'idle' && (
                <Phone className="w-10 h-10 sm:w-12 sm:h-12 text-white/60 transition-transform hover:scale-110" />
              )}
            </div>
          </div>
        </div>

        {/* Status Text */}
        <div className="mt-8 text-center max-w-md mx-auto">
          <p className={cn(
            "text-xl sm:text-2xl font-light tracking-wide transition-all duration-500",
            status === 'idle' && !isConnected && "text-white/50",
            status === 'idle' && isConnected && "text-white/70",
            status === 'connecting' && "text-amber-400/90",
            status === 'listening' && "text-green-400",
            status === 'processing' && "text-blue-400",
            status === 'speaking' && "text-purple-400",
            status === 'error' && "text-red-400"
          )}>
            {status === 'idle' && !isConnected && "Tap to connect"}
            {status === 'idle' && isConnected && "Tap to speak"}
            {status === 'connecting' && "Connecting..."}
            {status === 'listening' && "Listening..."}
            {status === 'processing' && "Thinking..."}
            {status === 'speaking' && "Speaking..."}
            {status === 'error' && (error || "Something went wrong")}
          </p>
          
          {/* Live Transcript */}
          {transcript && (
            <div className="mt-6 p-4 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
              <p className="text-white/60 text-sm mb-1">You said:</p>
              <p className="text-white/90">"{transcript}"</p>
            </div>
          )}
        </div>

        {/* Response Display */}
        {response && (
          <div className="mt-6 max-w-2xl mx-auto w-full px-4">
            <div className="p-5 rounded-2xl bg-gradient-to-b from-white/[0.07] to-white/[0.03] backdrop-blur-xl border border-white/10 shadow-2xl">
              <p className="text-white/80 leading-relaxed text-sm sm:text-base">
                {response}
              </p>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        {isConnected && status === 'idle' && (
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {['What is BECCS?', 'Climate research', 'Carbon capture'].map((prompt) => (
              <button
                key={prompt}
                onClick={() => {
                  setTranscript(prompt)
                  processDemoAudio(new Blob())
                }}
                className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white/90 text-sm transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Bottom Aura - The signature "shining from below" effect */}
      <div className="absolute bottom-0 left-0 right-0 h-[50vh] pointer-events-none overflow-hidden">
        <div 
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 100% 100% at 50% 100%, ${auraStyles.colors[0]}30, ${auraStyles.colors[1]}15, transparent 70%)`,
            opacity: auraStyles.intensity,
            transform: `translateY(${30 - auraStyles.intensity * 20}%)`
          }}
        />
        <div 
          className="absolute inset-x-0 bottom-0 h-64"
          style={{
            background: `linear-gradient(to top, ${auraStyles.colors[0]}20, transparent)`,
            filter: 'blur(40px)',
            opacity: auraStyles.intensity * 0.8
          }}
        />
      </div>

      {/* Floating Particles Rising */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {status === 'speaking' && [...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-purple-400/60"
            style={{
              left: `${20 + Math.random() * 60}%`,
              bottom: '-10px',
              animation: `float-up ${3 + Math.random() * 2}s ease-out infinite`,
              animationDelay: `${Math.random() * 2}s`
            }}
          />
        ))}
      </div>

      {/* Message Count Badge */}
      {messages.length > 0 && (
        <div className="absolute bottom-6 right-6 z-20">
          <div className="px-4 py-2 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 text-white/50 text-sm">
            {messages.length} messages
          </div>
        </div>
      )}
      
      {/* CSS for custom animations */}
      <style jsx>{`
        @keyframes float-up {
          0% { transform: translateY(0) scale(0); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(-100vh) scale(1); opacity: 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
