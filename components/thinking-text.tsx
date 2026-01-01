'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Claude-style thinking verbs mixed with climate/research themes
const THINKING_PHRASES = [
  // Claude's philosophical terms
  'Considering',
  'Reflecting',
  'Contemplating',
  'Analyzing',
  'Synthesizing',
  'Reasoning',
  'Pondering',
  'Deliberating',
  
  // Climate & research specific
  'Investigating',
  'Examining',
  'Evaluating',
  'Calculating',
  'Assessing',
  'Researching',
  'Exploring',
  'Discovering',
]

export function ThinkingText() {
  const [currentPhrase, setCurrentPhrase] = useState(THINKING_PHRASES[0])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    // Rotate through phrases every 1.8 seconds (Claude's timing)
    const interval = setInterval(() => {
      setIndex((prev) => {
        const nextIndex = (prev + 1) % THINKING_PHRASES.length
        setCurrentPhrase(THINKING_PHRASES[nextIndex])
        return nextIndex
      })
    }, 1800)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative w-32 h-6 flex items-center">
      <AnimatePresence mode="wait">
        <motion.span
          key={currentPhrase}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="absolute left-0 text-sm text-muted-foreground font-light tracking-wide"
        >
          {currentPhrase}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
