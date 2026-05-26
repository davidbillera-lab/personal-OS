'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { quickDump } from '@/app/(app)/actions'

export function QuickDumpForm() {
  const [isPending, startTransition] = useTransition()
  const [dumped, setDumped] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await quickDump(formData)
      formRef.current?.reset()
      setDumped(true)
      setTimeout(() => setDumped(false), 5000)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <Textarea
          name="text"
          placeholder="Brain dump anything — idea, bug, task, decision… Haiku classifies it."
          className="min-h-[56px] flex-1 resize-none text-sm"
          required
        />
        <Button type="submit" disabled={isPending} className="shrink-0">
          {isPending ? 'Dumping…' : 'Dump it'}
        </Button>
      </form>
      {dumped && (
        <p className="text-xs text-green-400">
          Dumped and classified.{' '}
          <Link href="/inbox" className="underline hover:text-green-300">
            View in inbox →
          </Link>
        </p>
      )}
    </div>
  )
}
