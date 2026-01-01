'use client'

import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, MessageCircle, Zap, Lightbulb, ArrowDown, Plus, History, Clock, Paperclip, Brain, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MessageList } from '@/components/message-list'
import { ThemeToggle } from '@/components/theme-toggle'
import { VoiceMode } from '@/components/voice-mode'
import { cn } from '@/lib/utils'
import Image from 'next/image'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    title: string
    url?: string
    authors?: string
    department?: string
    category?: string
    year?: number
  }>
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [thinkingMode, setThinkingMode] = useState(false) // Extended thinking toggle
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [isVoiceOpen, setIsVoiceOpen] = useState(false) // Voice overlay state
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const searchParams = useSearchParams()

  // Auto-open voice mode if ?voice=1 in URL (redirect from /voice page)
  useEffect(() => {
    if (searchParams?.get('voice') === '1') {
      setIsVoiceOpen(true)
      // Clean up URL
      window.history.replaceState({}, '', '/')
    }
  }, [searchParams])

  const scrollToBottom = () => {
    messagesEndRef?.current?.scrollIntoView?.({ behavior: 'smooth' })
  }

  // Check if user has scrolled up
  useEffect(() => {
    const chatContainer = chatContainerRef.current
    if (!chatContainer) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = chatContainer
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
      setShowScrollButton(!isNearBottom && messages.length > 0)
    }

    chatContainer.addEventListener('scroll', handleScroll)
    return () => chatContainer.removeEventListener('scroll', handleScroll)
  }, [messages])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input?.trim() && attachedFiles.length === 0) return

    // Abort any existing request if user is overriding
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // Process attached files to base64
    const filePromises = attachedFiles.map(async (file) => {
      return new Promise<{ name: string; type: string; data: string }>((resolve) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          resolve({
            name: file.name,
            type: file.type,
            data: e.target?.result as string,
          })
        }
        reader.readAsDataURL(file)
      })
    })

    const processedFiles = await Promise.all(filePromises)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim() || '[Attached files]',
    }

    setMessages((prev) => [...(prev ?? []), userMessage])
    setInput('')
    setAttachedFiles([]) // Clear files after sending
    setIsLoading(true)
    
    // Refocus textarea immediately so user can keep typing
    setTimeout(() => textareaRef.current?.focus(), 0)

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      // Send conversation history along with the new message and files
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input.trim() || 'Please analyze the attached files',
          history: messages, // Send full conversation history for context
          thinkingMode, // Enable extended thinking if toggled
          files: processedFiles, // Attach processed files
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response?.ok) {
        throw new Error('Failed to get response')
      }

      const reader = response?.body?.getReader?.()
      if (!reader) throw new Error('No reader available')

      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let sources: Message['sources'] = []
      let partialRead = ''

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        sources: [],
      }

      setMessages((prev) => [...(prev ?? []), assistantMessage])

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
              break
            }
            try {
              const parsed = JSON.parse(data)
              if (parsed?.content) {
                accumulatedContent += parsed.content
                setMessages((prev) => {
                  const newMessages = [...(prev ?? [])]
                  const lastMsg = newMessages?.[newMessages.length - 1]
                  if (lastMsg) {
                    lastMsg.content = accumulatedContent
                  }
                  return newMessages
                })
              }
              if (parsed?.sources) {
                sources = parsed.sources
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Update with final sources
      setMessages((prev) => {
        const newMessages = [...(prev ?? [])]
        const lastMsg = newMessages?.[newMessages.length - 1]
        if (lastMsg) {
          lastMsg.sources = sources
        }
        return newMessages
      })
    } catch (error) {
      // Don't show error for aborted requests (user override)
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request aborted by user')
        return
      }
      console.error('Chat error:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          "I'm having trouble connecting right now. Please try again in a moment! 🤖",
      }
      setMessages((prev) => [...(prev ?? []), errorMessage])
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e?.key === 'Enter' && !e?.shiftKey) {
      e?.preventDefault?.()
      handleSubmit(e as any)
    }
  }

  // Voice mode handlers - messages appear in regular chat
  const voiceAssistantIdRef = useRef<string | null>(null)
  const voiceUserIdRef = useRef<string | null>(null)

  const handleVoiceUserMessage = (text: string, placeholder?: boolean) => {
    if (!text) return
    const id = `voice-user-${Date.now()}`
    voiceUserIdRef.current = id
    const msg: Message = {
      id,
      role: 'user',
      content: text,
    }
    setMessages(prev => [...(prev ?? []), msg])
    scrollToBottom()
  }

  const handleUpdateVoiceUserMessage = (text: string) => {
    if (!voiceUserIdRef.current || !text.trim()) return
    const targetId = voiceUserIdRef.current
    setMessages(prev => {
      // Create new array with new object for the updated message (proper React state update)
      return (prev ?? []).map(msg => 
        msg.id === targetId 
          ? { ...msg, content: text }  // New object reference triggers re-render
          : msg
      )
    })
    voiceUserIdRef.current = null
    scrollToBottom()
  }

  const handleVoiceAssistantStream = (chunk: string) => {
    setMessages(prev => {
      const msgs = [...(prev ?? [])]
      if (!voiceAssistantIdRef.current) {
        // Start new assistant message
        voiceAssistantIdRef.current = `voice-assistant-${Date.now()}`
        msgs.push({
          id: voiceAssistantIdRef.current,
          role: 'assistant',
          content: chunk,
        })
      } else {
        // Append to existing
        const msg = msgs.find(m => m.id === voiceAssistantIdRef.current)
        if (msg) msg.content += chunk
      }
      return msgs
    })
    scrollToBottom()
  }

  const handleVoiceAssistantDone = (fullText: string, sources?: Message['sources']) => {
    // Replace streamed content with final deduplicated text and add sources
    if (voiceAssistantIdRef.current && fullText.trim()) {
      setMessages(prev => {
        const msgs = [...(prev ?? [])]
        const msg = msgs.find(m => m.id === voiceAssistantIdRef.current)
        if (msg) {
          msg.content = fullText // Final clean version replaces streamed version
          if (sources && sources.length > 0) {
            msg.sources = sources
          }
        }
        return msgs
      })
    }
    voiceAssistantIdRef.current = null
    scrollToBottom()
  }

  const suggestedQuestions = [
    { text: 'What is KTH doing for electric vehicles?', icon: Zap },
    { text: 'Latest breakthroughs in fusion energy?', icon: Lightbulb },
    { text: 'How is renewable energy advancing globally?', icon: MessageCircle },
  ]

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Minimal header - KTH logo + theme toggle */}
      <header className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4">
        {/* KTH Logo */}
        <a 
          href="https://www.kth.se" 
          target="_blank" 
          rel="noopener noreferrer"
          className="opacity-60 hover:opacity-100 transition-opacity"
        >
          <Image
            src="/kth-logo.png"
            alt="KTH Royal Institute of Technology"
            width={60}
            height={60}
            className="w-12 h-12 sm:w-14 sm:h-14 object-contain"
          />
        </a>
        
        {/* Voice Mode & Theme Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsVoiceOpen(true)}
            className="flex items-center justify-center w-12 h-12 rounded-2xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-all duration-300 group"
            aria-label="Voice mode"
          >
            {/* Audio wave bars - Grok style */}
            <div className="flex items-center gap-0.5 h-5">
              {[0.4, 0.7, 1, 0.7, 0.4].map((scale, i) => (
                <div
                  key={i}
                  className="w-0.5 bg-zinc-400 group-hover:bg-white rounded-full transition-colors"
                  style={{ height: `${scale * 16}px` }}
                />
              ))}
            </div>
          </button>
        <ThemeToggle />
        </div>
      </header>

      {/* Voice Mode - Integrated (messages appear in chat) */}
      <AnimatePresence>
        <VoiceMode
          isActive={isVoiceOpen}
          onClose={() => setIsVoiceOpen(false)}
          onUserMessage={handleVoiceUserMessage}
          onUpdateUserMessage={handleUpdateVoiceUserMessage}
          onAssistantStream={handleVoiceAssistantStream}
          onAssistantMessage={handleVoiceAssistantDone}
          hasMessages={messages.length > 0}
          chatHistory={messages.map(m => ({ role: m.role, content: m.content }))}
        />
      </AnimatePresence>

      {messages?.length === 0 ? (
        /* Empty state - centered welcome + input */
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-12">
          {/* Elegant welcome - Claude style with orange starburst */}
          <div className="text-center space-y-12 mb-16">
            <div className="space-y-6">
              <div className="flex items-center justify-center gap-3">
                <h1 className="text-5xl sm:text-6xl font-light tracking-tight text-foreground">
                  Ready when you are
                </h1>
              </div>
              <p className="text-base text-slate-500 dark:text-slate-500 font-light">
                Climate & sustainability research from KTH
              </p>
            </div>
          </div>

          {/* Centered Input - Claude style (hidden during voice mode) */}
          <div className={cn(
            "w-full max-w-3xl transition-opacity",
            isVoiceOpen ? "opacity-0 pointer-events-none" : "opacity-100"
          )}>
            <form onSubmit={handleSubmit}>
              <div className="relative bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 shadow-sm">
                {/* Icon buttons on the left */}
                <div className="absolute left-2 bottom-3 flex items-center gap-1">
                  <button
                    type="button"
                    className="w-8 h-8 flex items-center justify-center text-slate-500 dark:text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                    aria-label="Attach file"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-4 h-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setThinkingMode(!thinkingMode)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                      thinkingMode
                        ? 'bg-[#C15F3C] dark:bg-[#d97757] text-white'
                        : 'text-slate-500 dark:text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                    }`}
                    aria-label="Extended thinking mode"
                    title={thinkingMode ? 'Extended thinking ON' : 'Extended thinking OFF'}
                  >
                    <Brain className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
                
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,application/pdf,.txt,.doc,.docx"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    setAttachedFiles(prev => [...prev, ...files])
                    if (e.target) e.target.value = '' // Reset input
                  }}
                />
                
                {/* File preview chips */}
                {attachedFiles.length > 0 && (
                  <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
                    {attachedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-slate-200/80 dark:bg-slate-700/80 px-3 py-1.5 rounded-lg text-sm"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                        <span className="text-slate-700 dark:text-slate-300 max-w-[200px] truncate">
                          {file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachedFiles(prev => prev.filter((_, i) => i !== idx))
                          }}
                          className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Textarea - always enabled so user can override */}
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e?.target?.value ?? '')}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything about climate research..."
                  className="min-h-[56px] max-h-[200px] resize-none pl-20 pr-14 py-4 border-0 bg-transparent text-[15px] text-foreground placeholder:text-slate-500 dark:placeholder:text-slate-500 focus:ring-0 focus:outline-none"
                  autoFocus
                />
                
                {/* Mic & Send buttons on the right */}
                <div className="absolute right-2 bottom-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsVoiceOpen(true)}
                    className="h-10 w-10 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors border border-zinc-700 group"
                    aria-label="Voice mode"
                  >
                    {/* Audio wave bars */}
                    <div className="flex items-center gap-0.5">
                      {[0.4, 0.7, 1, 0.7, 0.4].map((scale, i) => (
                        <div
                          key={i}
                          className="w-0.5 bg-zinc-400 group-hover:bg-white rounded-full transition-colors"
                          style={{ height: `${scale * 14}px` }}
                        />
                      ))}
                    </div>
                  </button>
                  <Button
                    type="submit"
                    disabled={!input?.trim() && attachedFiles.length === 0}
                    className="h-10 w-10 bg-[#C15F3C] dark:bg-[#d97757] hover:bg-[#A04B2E] dark:hover:bg-[#d97757] text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-lg p-0 shadow-sm"
                  >
                    {isLoading && !input?.trim() ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </div>
              
              {/* Footer text - minimal */}
              <p className="text-xs text-center text-slate-500 dark:text-slate-600 mt-3">
                QBOT can make mistakes • 1,010+ research papers
              </p>
            </form>
          </div>
        </div>
      ) : (
        /* Conversation view - messages + bottom input */
        <>
          {/* Chat Area */}
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-6 sm:py-8 relative">
            <div className="max-w-4xl mx-auto">
              <MessageList messages={messages} isLoading={isLoading} />
              <div ref={messagesEndRef} />
            </div>
            
            {/* Scroll to bottom button - ultra minimal */}
            <AnimatePresence>
              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  className="fixed bottom-32 right-6 z-40 w-9 h-9 bg-slate-200/80 dark:bg-slate-700/80 backdrop-blur-sm rounded-full shadow-sm flex items-center justify-center hover:bg-slate-300/80 dark:hover:bg-slate-600/80 transition-colors"
                  aria-label="Scroll to bottom"
                >
                  <ArrowDown className="w-4 h-4 text-slate-600 dark:text-slate-300" strokeWidth={2} />
                </button>
              )}
            </AnimatePresence>
          </div>

          {/* Input Area - Fixed at bottom (hidden during voice mode) */}
          <div className={cn(
            "sticky bottom-0 bg-background border-t border-border/50 transition-opacity",
            isVoiceOpen ? "opacity-0 pointer-events-none" : "opacity-100"
          )}>
            <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4 sm:p-6 pb-6">
              <div className="relative bg-slate-100/50 dark:bg-slate-800/30 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 shadow-sm">
                {/* Icon buttons on the left */}
                <div className="absolute left-2 bottom-3 flex items-center gap-1">
                  <button
                    type="button"
                    className="w-8 h-8 flex items-center justify-center text-slate-500 dark:text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                    aria-label="Attach file"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-4 h-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setThinkingMode(!thinkingMode)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                      thinkingMode
                        ? 'bg-[#C15F3C] dark:bg-[#d97757] text-white'
                        : 'text-slate-500 dark:text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                    }`}
                    aria-label="Extended thinking mode"
                    title={thinkingMode ? 'Extended thinking ON (uses gpt-5.2)' : 'Extended thinking OFF (uses gpt-5.2-chat)'}
                  >
                    <Brain className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
                
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,application/pdf,.txt,.doc,.docx"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    setAttachedFiles(prev => [...prev, ...files])
                    if (e.target) e.target.value = '' // Reset input
                  }}
                />
                
                {/* File preview chips */}
                {attachedFiles.length > 0 && (
                  <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
                    {attachedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-slate-200/80 dark:bg-slate-700/80 px-3 py-1.5 rounded-lg text-sm"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                        <span className="text-slate-700 dark:text-slate-300 max-w-[200px] truncate">
                          {file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setAttachedFiles(prev => prev.filter((_, i) => i !== idx))
                          }}
                          className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Textarea - always enabled so user can override */}
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e?.target?.value ?? '')}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything about climate research..."
                  className="min-h-[56px] max-h-[200px] resize-none pl-20 pr-14 py-4 border-0 bg-transparent text-[15px] text-foreground placeholder:text-slate-500 dark:placeholder:text-slate-500 focus:ring-0 focus:outline-none"
                />
                
                {/* Mic & Send buttons on the right */}
                <div className="absolute right-2 bottom-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsVoiceOpen(true)}
                    className="h-10 w-10 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors border border-zinc-700 group"
                    aria-label="Voice mode"
                  >
                    {/* Audio wave bars */}
                    <div className="flex items-center gap-0.5">
                      {[0.4, 0.7, 1, 0.7, 0.4].map((scale, i) => (
                        <div
                          key={i}
                          className="w-0.5 bg-zinc-400 group-hover:bg-white rounded-full transition-colors"
                          style={{ height: `${scale * 14}px` }}
                        />
                      ))}
                    </div>
                  </button>
                  <Button
                    type="submit"
                    disabled={!input?.trim() && attachedFiles.length === 0}
                    className="h-10 w-10 bg-[#C15F3C] dark:bg-[#d97757] hover:bg-[#A04B2E] dark:hover:bg-[#d97757] text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-lg p-0 shadow-sm"
                  >
                    {isLoading && !input?.trim() ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </div>
              
              {/* Footer text - minimal */}
              <p className="text-xs text-center text-slate-500 dark:text-slate-600 mt-3">
                QBOT can make mistakes • 1,010+ research papers
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  )
}