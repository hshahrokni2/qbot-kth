'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { User, ExternalLink, Building, Users, Tag, Copy, Check, ThumbsUp, ThumbsDown, RotateCw, X, MessageCircle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useState, useCallback } from 'react'
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
  onRegenerate?: (messageId: string) => void
  onFollowUp?: (question: string) => void
}

// Parse follow-up questions from message content
function extractFollowUpQuestions(content: string): string[] {
  // Look for "Want to explore more?" section with bullet points
  const followUpMatch = content.match(/🔍\s*\*?\*?Want to explore more\?\*?\*?\s*\n([\s\S]*?)(?:\n\n|$)/i)
  if (followUpMatch) {
    const bullets = followUpMatch[1].match(/[-•]\s*(.+?)(?:\n|$)/g)
    if (bullets) {
      return bullets.map(b => b.replace(/^[-•]\s*/, '').trim()).filter(q => q.length > 5).slice(0, 3)
    }
  }
  return []
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

// Feedback modal for thumbs down
function FeedbackModal({ 
  isOpen, 
  onClose, 
  onSubmit,
  messageId 
}: { 
  isOpen: boolean
  onClose: () => void
  onSubmit: (reason: string, comment: string) => void
  messageId: string
}) {
  const [selectedReason, setSelectedReason] = useState<string>('')
  const [comment, setComment] = useState('')

  const reasons = [
    { id: 'missing_article', label: 'Missing article/research', labelSv: 'Saknar artikel/forskning' },
    { id: 'wrong_info', label: 'Wrong information', labelSv: 'Fel information' },
    { id: 'bad_audio', label: 'Bad audio quality', labelSv: 'Dålig ljudkvalitet' },
    { id: 'not_helpful', label: 'Not helpful', labelSv: 'Inte till hjälp' },
    { id: 'inappropriate', label: 'Inappropriate response', labelSv: 'Olämpligt svar' },
    { id: 'other', label: 'Other', labelSv: 'Annat' },
  ]

  const handleSubmit = () => {
    onSubmit(selectedReason, comment)
    setSelectedReason('')
    setComment('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full p-6"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              What went wrong? / Vad var fel?
            </h3>
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          <div className="space-y-2 mb-4">
            {reasons.map(reason => (
              <button
                key={reason.id}
                onClick={() => setSelectedReason(reason.id)}
                className={`w-full text-left px-4 py-2 rounded-lg border transition-colors ${
                  selectedReason === reason.id
                    ? 'border-[#C15F3C] bg-[#C15F3C]/10 text-[#C15F3C]'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span className="text-sm">{reason.label}</span>
                <span className="text-xs text-slate-500 ml-2">/ {reason.labelSv}</span>
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Additional comments (optional) / Ytterligare kommentarer (valfritt)"
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[#C15F3C]/50"
          />

          <div className="flex gap-2 mt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel / Avbryt
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selectedReason}
              className="flex-1 px-4 py-2 text-sm bg-[#C15F3C] text-white rounded-lg hover:bg-[#a84e30] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit / Skicka
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Follow-up question buttons
function FollowUpButtons({ 
  questions, 
  onSelect 
}: { 
  questions: string[]
  onSelect: (question: string) => void 
}) {
  if (questions.length === 0) return null

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
        <MessageCircle className="w-3 h-3" />
        Follow-up questions
      </p>
      <div className="flex flex-wrap gap-2">
        {questions.map((question, idx) => (
          <button
            key={idx}
            onClick={() => onSelect(question)}
            className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}

// Feedback buttons component
function FeedbackButtons({ 
  messageId, 
  content,
  onRegenerate 
}: { 
  messageId: string
  content: string
  onRegenerate?: () => void
}) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)

  const sendFeedback = useCallback(async (type: 'up' | 'down', reason?: string, comment?: string) => {
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          type,
          reason,
          comment,
          messageContent: content.slice(0, 500),
          sessionId: typeof window !== 'undefined' ? sessionStorage.getItem('qbot-session') : null
        })
      })
    } catch (err) {
      console.error('Failed to send feedback:', err)
    }
  }, [messageId, content])

  const handleFeedback = (type: 'up' | 'down') => {
    if (type === 'down' && feedback !== 'down') {
      setShowFeedbackModal(true)
    } else {
      setFeedback(feedback === type ? null : type)
      if (feedback !== type) {
        sendFeedback(type)
      }
    }
  }

  const handleFeedbackSubmit = (reason: string, comment: string) => {
    setFeedback('down')
    sendFeedback('down', reason, comment)
  }

  return (
    <>
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
          onClick={onRegenerate}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-500 dark:text-slate-500"
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          <RotateCw className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        <CopyButton content={content} />
      </div>

      <FeedbackModal
        isOpen={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        onSubmit={handleFeedbackSubmit}
        messageId={messageId}
      />
    </>
  )
}

export function MessageList({ messages, isLoading, onRegenerate, onFollowUp }: MessageListProps) {
  return (
    <div className="space-y-12">
      {messages?.map?.((message, index) => {
        const followUpQuestions = message?.role === 'assistant' 
          ? extractFollowUpQuestions(message?.content ?? '') 
          : []
        
        // Clean content by removing the follow-up section for display
        const displayContent = message?.content?.replace(/🔍\s*\*?\*?Want to explore more\?\*?\*?\s*\n[\s\S]*?(?:\n\n|$)/i, '') ?? ''

        return (
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
                      {displayContent}
                    </ReactMarkdown>
                  </div>
                  
                  {/* Follow-up question buttons */}
                  {onFollowUp && followUpQuestions.length > 0 && (
                    <FollowUpButtons questions={followUpQuestions} onSelect={onFollowUp} />
                  )}
                  
                  {/* Feedback buttons bar */}
                  <div className="flex items-center pt-1">
                    <FeedbackButtons 
                      messageId={message?.id ?? ''} 
                      content={message?.content ?? ''} 
                      onRegenerate={onRegenerate ? () => onRegenerate(message?.id ?? '') : undefined}
                    />
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
