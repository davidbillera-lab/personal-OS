'use client'

import { useTransition, useRef } from 'react'
import { submitDump } from '@/app/(app)/inbox/actions'

export function InboxCapture() {
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLTextAreaElement>(null)

  function handleSubmit() {
    const text = ref.current?.value ?? ''
    if (!text.trim()) return
    startTransition(async () => {
      await submitDump(text)
      if (ref.current) ref.current.value = ''
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        disabled={isPending}
        placeholder="Brain dump anything — idea, task, bug, decision…"
        rows={3}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">⌘↵ to submit</span>
        <button
          disabled={isPending}
          onClick={handleSubmit}
          className="rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background hover:bg-foreground/80 disabled:opacity-50"
        >
          {isPending ? 'Classifying…' : 'Capture'}
        </button>
      </div>
    </div>
  )
}
