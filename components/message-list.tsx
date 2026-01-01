'use client'

import { motion } from 'framer-motion'
import { User, ExternalLink, Building, Users, Tag, Copy, Check, ThumbsUp, ThumbsDown, RotateCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useState } from 'react'
import Image from 'next/image'
import { ThinkingIcon } from '@/components/thinking-icon'
import { ThinkingText } from '@/components/thinking-text'

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

interface MessageListProps {
  messages: Message[]
  isLoading?: boolean
}

// Copy button component (Claude-style)
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
      title="Copy message"
      aria-label="Copy message to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" strokeWidth={2} />
      ) : (
        <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-500" strokeWidth={2} />
      )}
    </button>
  )
}

// Feedback buttons component (Claude-style - more minimal)
function FeedbackButtons({ messageId, content }: { messageId: string; content: string }) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const handleFeedback = (type: 'up' | 'down') => {
    setFeedback(feedback === type ? null : type)
    // TODO: Send feedback to analytics
    console.log(`Feedback ${type} for message ${messageId}`)
  }

  const handleRegenerate = () => {
    // TODO: Implement regenerate functionality
    console.log(`Regenerate message ${messageId}`)
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => handleFeedback('up')}
        className={`p-2 rounded-md ${
          feedback === 'up'
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-500'
        }`}
        title="Good response"
        aria-label="Good response"
      >
        <ThumbsUp className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <button
        onClick={() => handleFeedback('down')}
        className={`p-2 rounded-md ${
          feedback === 'down'
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-500'
        }`}
        title="Poor response"
        aria-label="Poor response"
      >
        <ThumbsDown className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <div className="w-px h-3.5 bg-slate-300 dark:bg-slate-600 mx-0.5" />
      <button
        onClick={handleRegenerate}
        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-500 dark:text-slate-500"
        title="Regenerate response"
        aria-label="Regenerate response"
      >
        <RotateCw className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <CopyButton content={content} />
    </div>
  )
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  return (
    <div className="space-y-12">
      {messages?.map?.((message, index) => (
        <motion.div
          key={message?.id ?? index}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.05 }}
          className={`flex gap-4 ${
            message?.role === 'user' ? 'flex-row-reverse' : 'flex-row'
          }`}
        >
          {/* Avatar - Claude style */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className={`flex-shrink-0 w-8 h-8 flex items-center justify-center ${
              message?.role === 'user'
                ? 'bg-slate-200 dark:bg-slate-700 rounded-md'
                : ''
            }`}
          >
            {message?.role === 'user' ? (
              <User className="w-4 h-4 text-slate-700 dark:text-slate-200" strokeWidth={2} />
            ) : (
              <ThinkingIcon size={24} color="#FF6B35" isSpinning={false} />
            )}
          </motion.div>

          {/* Message Content - Claude style */}
          <div className="flex-1 min-w-0 max-w-[48rem]">
            {message?.role === 'assistant' ? (
              <div className="space-y-3">
                {/* Assistant message - no bubble, just text on background */}
                <div className="prose prose-base max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-[#0F172A] dark:prose-headings:text-[#F1F5F9] prose-h3:text-[15px] prose-h3:mt-6 prose-h3:mb-3 prose-h3:font-semibold prose-a:text-[#C15F3C] dark:prose-a:text-[#d97757] prose-a:no-underline hover:prose-a:underline prose-strong:text-[#0F172A] dark:prose-strong:text-[#F1F5F9] prose-strong:font-semibold prose-p:leading-[1.75] prose-p:text-[15px] prose-p:text-[#334155] dark:prose-p:text-[#CBD5E1] prose-p:my-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-ul:my-4 prose-li:text-[#334155] dark:prose-li:text-[#CBD5E1] prose-li:leading-[1.75]">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => (
                        <p className="mb-4 last:mb-0">{children}</p>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-lg font-semibold mt-6 mb-4 first:mt-0">{children}</h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className="text-base font-semibold mt-5 mb-3">{children}</h4>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="ml-2">{children}</li>
                      ),
                    }}
                  >
                    {message?.content ?? ''}
                  </ReactMarkdown>
                </div>
                {/* Feedback buttons bar */}
                <div className="flex items-center pt-1">
                  <FeedbackButtons messageId={message?.id ?? ''} content={message?.content ?? ''} />
                </div>
              </div>
            ) : (
              /* User message - subtle gray box like Claude */
              <div className="px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <p className="text-[15px] whitespace-pre-wrap leading-[1.75] text-[#0F172A] dark:text-[#F1F5F9]">
                  {message?.content ?? ''}
                </p>
              </div>
            )}

            {/* Sources - Claude-style minimal */}
            {message?.sources && message?.sources?.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Sources ({message.sources.length})
                </p>
                <div className="space-y-2">
                  {message?.sources?.map?.((source, idx) => (
                    <a
                      key={idx}
                      href={source?.url ?? '#'}
                      target={source?.url ? '_blank' : undefined}
                      rel={source?.url ? 'noopener noreferrer' : undefined}
                      className={`group block p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg ${
                        source?.url ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 line-clamp-2 flex-1">
                            {source?.title ?? 'Untitled'}
                          </h4>
                          {source?.url && (
                            <ExternalLink className="w-3.5 h-3.5 text-[#C15F3C] dark:text-[#d97757] flex-shrink-0 opacity-0 group-hover:opacity-100" />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
                          {source?.authors && (
                            <div className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              <span className="truncate max-w-[200px]">{source.authors}</span>
                            </div>
                          )}
                          {source?.department && (
                            <>
                              {source?.authors && <span>•</span>}
                              <div className="flex items-center gap-1">
                                <Building className="w-3 h-3" />
                                <span>{source.department}</span>
                              </div>
                            </>
                          )}
                          {source?.year && (
                            <>
                              {(source?.authors || source?.department) && <span>•</span>}
                              <span>{source.year}</span>
                            </>
                          )}
                          {source?.category && (
                            <>
                              {(source?.authors || source?.department || source?.year) && <span>•</span>}
                              <div className="flex items-center gap-1">
                                <Tag className="w-3 h-3" />
                                <span>{source?.category?.replace(/_/g, ' ')}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </a>
                  )) ?? null}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )) ?? null}
      
      {/* Loading indicator - Spinning starburst + rotating flavor text */}
      {isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex gap-3 items-center"
        >
          <ThinkingIcon size={24} color="#FF6B35" isSpinning={true} />
          <ThinkingText />
        </motion.div>
      )}
    </div>
  )
}
