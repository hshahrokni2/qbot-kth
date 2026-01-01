import { cn } from '@/lib/utils'

interface SkeletonMessageProps {
  className?: string
}

export function SkeletonMessage({ className }: SkeletonMessageProps) {
  return (
    <div className={cn('animate-pulse', className)}>
      <div className="flex gap-3 mb-6">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 dark:from-violet-500/30 dark:to-purple-500/30" />
        <div className="flex-1 space-y-3">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-lg w-3/4" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-lg w-full" />
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-lg w-5/6" />
        </div>
      </div>
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      <div className="flex gap-1">
        <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-fuchsia-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="font-medium">Thinking...</span>
    </div>
  )
}
