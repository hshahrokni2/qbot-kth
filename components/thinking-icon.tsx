'use client'

import { motion } from 'framer-motion'

interface ThinkingIconProps {
  size?: number
  color?: string
  isSpinning?: boolean
}

// Claude-style animated thinking indicator (orange starburst)
export function ThinkingIcon({ size = 24, color = '#FF6B35', isSpinning = true }: ThinkingIconProps) {
  return (
    <motion.div
      className="relative"
      style={{ width: size, height: size }}
      animate={isSpinning ? { rotate: 360 } : {}}
      transition={isSpinning ? {
        duration: 2,
        repeat: Infinity,
        ease: 'linear'
      } : {}}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Center circle */}
        <circle cx="12" cy="12" r="2" fill={color} />
        
        {/* Rays radiating outward (12 rays like a starburst) */}
        {[...Array(12)].map((_, i) => {
          const angle = (i * 30) * Math.PI / 180
          const startX = 12 + Math.cos(angle) * 3
          const startY = 12 + Math.sin(angle) * 3
          const endX = 12 + Math.cos(angle) * 10
          const endY = 12 + Math.sin(angle) * 10
          
          return (
            <line
              key={i}
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke={color}
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity={0.8}
            />
          )
        })}
      </svg>
    </motion.div>
  )
}
