import { Suspense } from 'react'
import { ChatInterface } from '@/components/chat-interface'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-teal-50 via-coral-50 to-purple-50">
      <Suspense fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="text-slate-500">Loading...</div>
        </div>
      }>
        <ChatInterface />
      </Suspense>
    </main>
  )
}
