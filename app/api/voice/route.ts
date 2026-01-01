import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Komilion Voice API Configuration
const KOMILION_API_KEY = process.env.KOMILION_API_KEY || ''
const KOMILION_VOICE_BASE = 'https://www.komilion.com/api/voice'
const KOMILION_WS_PROXY = 'wss://komilion-voice-proxy.fly.dev'

/**
 * Komilion Voice API - Premium STT/TTS via OpenAI Realtime
 * No OpenAI key needed - Komilion handles everything!
 */
export async function POST(request: NextRequest) {
  if (!KOMILION_API_KEY) {
    return NextResponse.json(
      { error: 'KOMILION_API_KEY not configured' },
      { status: 500 }
    )
  }

  try {
    const contentType = request.headers.get('content-type') || ''
    
    // ============================================
    // SPEECH-TO-TEXT (STT) - Audio Upload
    // Uses Komilion's /api/voice/transcribe endpoint
    // ============================================
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const audioFile = formData.get('audio') as File
      
      if (!audioFile) {
        return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
      }

      console.log(`🎙️ STT Request: ${audioFile.size} bytes via Komilion`)

      // Forward to Komilion STT
      const komilionFormData = new FormData()
      komilionFormData.append('audio', audioFile)
      
      const sttResponse = await fetch(`${KOMILION_VOICE_BASE}/transcribe`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KOMILION_API_KEY}`,
        },
        body: komilionFormData
      })

      if (!sttResponse.ok) {
        const errorText = await sttResponse.text()
        console.error('Komilion STT error:', sttResponse.status, errorText)
        return NextResponse.json(
          { error: 'Speech-to-text failed', details: errorText },
          { status: sttResponse.status }
        )
      }

      const sttResult = await sttResponse.json()
      console.log(`✅ STT Success: "${sttResult.text?.substring(0, 50)}..."`)
      
      return NextResponse.json({ 
        transcript: sttResult.text || sttResult.transcript,
        provider: 'komilion'
      })
    }

    // Parse JSON body for other actions
    const body = await request.json()
    
    // ============================================
    // TEXT-TO-SPEECH (TTS)
    // Uses Komilion's /api/voice/speak endpoint
    // ============================================
    if (body.action === 'tts' && body.text) {
      console.log(`🔊 TTS Request: "${body.text.substring(0, 50)}..." via Komilion`)
      
      const ttsResponse = await fetch(`${KOMILION_VOICE_BASE}/speak`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KOMILION_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: body.text.substring(0, 4096),
          voice: body.voice || 'nova', // OpenAI voices: nova, alloy, echo, fable, onyx, shimmer
        })
      })

      if (!ttsResponse.ok) {
        const errorText = await ttsResponse.text()
        console.error('Komilion TTS error:', ttsResponse.status, errorText)
        return NextResponse.json(
          { error: 'Text-to-speech failed', details: errorText },
          { status: ttsResponse.status }
        )
      }

      // Return audio (might be base64 or direct buffer)
      const responseType = ttsResponse.headers.get('content-type')
      
      if (responseType?.includes('audio')) {
        // Direct audio response
        const audioBuffer = await ttsResponse.arrayBuffer()
        const base64Audio = Buffer.from(audioBuffer).toString('base64')
        const mimeType = responseType.split(';')[0] || 'audio/mp3'
        
        console.log(`✅ TTS Success: ${audioBuffer.byteLength} bytes`)
        
        return NextResponse.json({ 
          audio: `data:${mimeType};base64,${base64Audio}`,
          provider: 'komilion'
        })
      } else {
        // JSON response with audio URL or base64
        const ttsData = await ttsResponse.json()
        
        if (ttsData.audio_url) {
          // Fetch the audio from URL
          const audioRes = await fetch(ttsData.audio_url)
          const audioBuffer = await audioRes.arrayBuffer()
          const base64Audio = Buffer.from(audioBuffer).toString('base64')
          
          return NextResponse.json({
            audio: `data:audio/mp3;base64,${base64Audio}`,
            provider: 'komilion'
          })
        }
        
        return NextResponse.json({
          audio: ttsData.audio || ttsData.audio_base64,
          provider: 'komilion'
        })
      }
    }

    // ============================================
    // GET REALTIME WEBSOCKET CONFIG
    // For bidirectional voice streaming
    // ============================================
    if (body.action === 'realtime-config') {
      console.log('🔌 Getting WebSocket config from Komilion...')
      
      // Use gpt-realtime-mini for balanced mode (cheapest realtime)
      // frugal = Deepgram (different endpoint, not realtime)
      // premium = gpt-realtime (expensive)
      const openaiModel = body.model === 'premium' ? 'gpt-realtime' : 'gpt-realtime-mini'
      
      console.log(`📊 Using model: ${openaiModel}`)
      
      try {
        const configResponse = await fetch(`${KOMILION_VOICE_BASE}/realtime`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KOMILION_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: openaiModel
          })
        })

        if (configResponse.ok) {
          const config = await configResponse.json()
          console.log('✅ Komilion realtime config received')
          
          // Komilion returns: { websocket: { url: "wss://...", model: "..." }, sessionConfig: {...} }
          return NextResponse.json({
            wsUrl: config.websocket?.url || config.ws_url || config.wsUrl,
            sessionConfig: config.sessionConfig,
            events: config.events,
            provider: 'komilion'
          })
        } else {
          const errorText = await configResponse.text()
          console.error('Komilion realtime error:', configResponse.status, errorText)
        }
      } catch (err) {
        console.error('Komilion realtime fetch error:', err)
      }
      
      // Fallback: Try OpenAI direct if we have key
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY
      if (OPENAI_API_KEY) {
        console.log('✅ Fallback: Using OpenAI Realtime directly')
        return NextResponse.json({
          wsUrl: 'wss://api.openai.com/v1/realtime',
          token: OPENAI_API_KEY,
          provider: 'openai-direct',
          model: 'balanced'
        })
      }
      
      return NextResponse.json({
        error: 'Failed to get realtime config',
        provider: 'none'
      }, { status: 500 })
    }

    // ============================================
    // CHECK API STATUS
    // ============================================
    if (body.action === 'check') {
      // Quick health check on Komilion
      try {
        const healthCheck = await fetch(`${KOMILION_VOICE_BASE}/realtime`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KOMILION_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: 'balanced' })
        })
        
        return NextResponse.json({
          status: healthCheck.ok ? 'ok' : 'degraded',
          provider: 'komilion',
          wsProxy: KOMILION_WS_PROXY,
          hasKey: true,
          message: healthCheck.ok 
            ? 'Komilion Premium Voice Ready (OpenAI Realtime)'
            : 'Komilion API may be temporarily unavailable'
        })
      } catch {
        return NextResponse.json({
          status: 'ok',
          provider: 'komilion',
          wsProxy: KOMILION_WS_PROXY,
          hasKey: true,
          message: 'Komilion Premium Voice Ready'
        })
      }
    }

    return NextResponse.json({ error: 'Invalid request action' }, { status: 400 })

  } catch (error) {
    console.error('Voice API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET - API Info
 */
export async function GET() {
  return NextResponse.json({
    service: 'QBOT Voice (Komilion)',
    status: KOMILION_API_KEY ? 'ready' : 'no-api-key',
    provider: 'komilion',
    wsProxy: KOMILION_WS_PROXY,
    features: {
      stt: 'OpenAI Whisper',
      tts: 'OpenAI TTS',
      realtime: 'balanced / premium'
    },
    endpoints: {
      realtime: 'POST /api/voice with JSON { action: "realtime-config" }',
      check: 'POST /api/voice with JSON { action: "check" }'
    },
    models: ['balanced', 'premium'],
    voices: ['nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer']
  })
}
