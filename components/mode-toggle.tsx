'use client'

import { motion } from 'framer-motion'
import { Globe, School } from 'lucide-react'

type ChatMode = 'global' | 'kth'

interface ModeToggleProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="flex items-center justify-center gap-2 p-1 bg-gray-100 rounded-2xl max-w-md mx-auto">
      <button
        onClick={() => onModeChange?.('kth')}
        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all relative ${
          mode === 'kth'
            ? 'text-white'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }`}
      >
        {mode === 'kth' && (
          <motion.div
            layoutId="mode-bg"
            className="absolute inset-0 bg-gradient-to-r from-teal-500 to-teal-600 rounded-xl shadow-md"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        )}
        <School className="w-4 h-4 relative z-10" />
        <span className="text-sm relative z-10">Explore KTH</span>
      </button>
      <button
        onClick={() => onModeChange?.('global')}
        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all relative ${
          mode === 'global'
            ? 'text-white'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
        }`}
      >
        {mode === 'global' && (
          <motion.div
            layoutId="mode-bg"
            className="absolute inset-0 bg-gradient-to-r from-orange-500 to-coral-500 rounded-xl shadow-md"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        )}
        <Globe className="w-4 h-4 relative z-10" />
        <span className="text-sm relative z-10">Global Research</span>
      </button>
    </div>
  )
}
