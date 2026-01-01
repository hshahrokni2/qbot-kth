'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Redirect /voice to main page - voice mode is now integrated as an overlay
export default function VoicePage() {
  const router = useRouter()
  
  useEffect(() => {
    // Redirect to home with voice param to auto-open voice overlay
    router.replace('/?voice=1')
  }, [router])
  
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-white/50 text-lg">Redirecting to voice mode...</div>
    </div>
  )
}
