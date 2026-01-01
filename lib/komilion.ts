/**
 * Komilion Voice API Integration
 * WebSocket-based real-time voice streaming
 */

export interface KomilionConfig {
  apiKey?: string;
  wsUrl?: string;
}

export interface VoiceMessage {
  type: 'audio' | 'text' | 'status' | 'error';
  data: string | ArrayBuffer;
  timestamp?: number;
}

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error';

export class KomilionVoice {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private onStatusChange: (status: VoiceStatus) => void;
  private onTranscript: (text: string) => void;
  private onAudioResponse: (audio: ArrayBuffer) => void;
  private onError: (error: string) => void;
  
  // Komilion API endpoints
  private readonly API_BASE = 'https://api.komilion.com';
  private readonly WS_URL = 'wss://api.komilion.com/v1/voice/stream';
  
  constructor(
    onStatusChange: (status: VoiceStatus) => void,
    onTranscript: (text: string) => void,
    onAudioResponse: (audio: ArrayBuffer) => void,
    onError: (error: string) => void
  ) {
    this.onStatusChange = onStatusChange;
    this.onTranscript = onTranscript;
    this.onAudioResponse = onAudioResponse;
    this.onError = onError;
  }

  async connect(token: string): Promise<void> {
    this.onStatusChange('connecting');
    
    try {
      // Initialize WebSocket connection
      this.ws = new WebSocket(`${this.WS_URL}?token=${token}`);
      
      this.ws.onopen = () => {
        console.log('🎙️ Komilion WebSocket connected');
        this.onStatusChange('idle');
      };

      this.ws.onmessage = async (event) => {
        try {
          if (event.data instanceof Blob) {
            // Audio response
            const arrayBuffer = await event.data.arrayBuffer();
            this.onAudioResponse(arrayBuffer);
            this.onStatusChange('speaking');
          } else {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
              case 'transcript':
                this.onTranscript(message.text);
                this.onStatusChange('processing');
                break;
              case 'status':
                this.onStatusChange(message.status);
                break;
              case 'error':
                this.onError(message.message);
                this.onStatusChange('error');
                break;
              case 'done':
                this.onStatusChange('idle');
                break;
            }
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onError('Connection error');
        this.onStatusChange('error');
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.onStatusChange('idle');
      };

    } catch (error) {
      this.onError('Failed to connect');
      this.onStatusChange('error');
      throw error;
    }
  }

  async startListening(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.onError('Not connected');
      return;
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.audioChunks = [];
      
      // Create MediaRecorder for audio capture
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          // Stream audio chunks to WebSocket
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(event.data);
          }
        }
      };

      this.mediaRecorder.onstop = () => {
        // Signal end of audio stream
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'end_audio' }));
        }
        stream.getTracks().forEach(track => track.stop());
      };

      // Start recording with 100ms chunks for real-time streaming
      this.mediaRecorder.start(100);
      this.onStatusChange('listening');
      
      // Signal start of audio stream
      if (this.ws) {
        this.ws.send(JSON.stringify({ 
          type: 'start_audio',
          config: {
            model: 'nova-2',
            language: 'en',
            encoding: 'opus',
            sample_rate: 16000
          }
        }));
      }

    } catch (error) {
      console.error('Error starting recording:', error);
      this.onError('Microphone access denied');
      this.onStatusChange('error');
    }
  }

  stopListening(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
      this.onStatusChange('processing');
    }
  }

  async playAudio(audioData: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    try {
      const audioBuffer = await this.audioContext.decodeAudioData(audioData);
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      source.onended = () => {
        this.onStatusChange('idle');
      };
      
      source.start(0);
      this.onStatusChange('speaking');
    } catch (error) {
      console.error('Error playing audio:', error);
      this.onError('Failed to play audio');
    }
  }

  // Text-to-Speech via REST API (fallback)
  async textToSpeech(text: string, token: string): Promise<ArrayBuffer> {
    const response = await fetch(`${this.API_BASE}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'aura-asteria-en',
        input: text,
        voice: 'asteria',
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      throw new Error('TTS request failed');
    }

    return response.arrayBuffer();
  }

  // Speech-to-Text via REST API (fallback)
  async speechToText(audioBlob: Blob, token: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'nova-2');
    
    const response = await fetch(`${this.API_BASE}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error('STT request failed');
    }

    const data = await response.json();
    return data.text;
  }

  disconnect(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.onStatusChange('idle');
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Simplified Voice Hook for React
export function createVoiceSession() {
  let audioContext: AudioContext | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  
  return {
    async startRecording(onData: (blob: Blob) => void): Promise<void> {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        onData(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      
      mediaRecorder.start();
    },
    
    stopRecording(): void {
      if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
      }
    },
    
    async playAudio(arrayBuffer: ArrayBuffer): Promise<void> {
      if (!audioContext) audioContext = new AudioContext();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
    }
  };
}

