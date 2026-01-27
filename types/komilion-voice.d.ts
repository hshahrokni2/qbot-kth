export {}

declare global {
  type KomilionToolSchema = {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }

  type KomilionToolCall = {
    call_id: string
    name: string
    arguments: any
  }

  interface Window {
    KomilionVoice?: new (options: {
      apiKey?: string
      clientToken?: string
      model?: string
      voice?: string
      instructions?: string
      tools?: KomilionToolSchema[]
      toolChoice?: 'auto' | 'none' | 'required' | { name: string }
      autoPlayAudio?: boolean
      debug?: boolean
      [key: string]: any
    }) => {
      start: () => Promise<void> | void
      stop: () => Promise<void> | void
      mute: () => void
      unmute: () => void
      toggleMute: () => boolean
      submitToolResult: (callId: string, result: any, options?: any) => void
      setInstructions?: (instructions: string) => void
      setTools?: (tools: KomilionToolSchema[], toolChoice?: any) => void
      on: (event: string, handler: (...args: any[]) => void) => void
      off?: (event: string, handler: (...args: any[]) => void) => void
      mediaStream?: MediaStream
      isMuted?: boolean
      isConnected?: boolean
      [key: string]: any
    }
  }
}

