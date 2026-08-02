'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Polls the server component on an interval so the queue list stays live
// without wiring Supabase realtime. Simple and reliable.
export function QueueAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(interval)
  }, [router])

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      live
    </span>
  )
}
