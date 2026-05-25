'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import type { BrainDump, AbChat, BrainDumpType } from '@/lib/types'

const typeColors: Record<BrainDumpType, string> = {
  idea:           'bg-blue-100 text-blue-700',
  task:           'bg-yellow-100 text-yellow-700',
  bug:            'bg-red-100 text-red-700',
  decision:       'bg-purple-100 text-purple-700',
  kill_candidate: 'bg-orange-100 text-orange-700',
  unclassified:   'bg-slate-100 text-slate-600',
}

interface Props {
  dump: BrainDump & { project_name?: string | null }
  chats: AbChat[]
}

export function AdvisoryBoardChat({ dump, chats: initialChats }: Props) {
  const [chats, setChats] = useState<AbChat[]>(initialChats)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  async function callBoard(userMessage?: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/advisory-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brain_dump_id: dump.id, user_message: userMessage }),
      })
      const data = await res.json() as { content?: string; run_number?: number; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Something went wrong')
        return
      }
      if (userMessage) {
        setChats(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            brain_dump_id: dump.id,
            role: 'user',
            content: userMessage,
            is_board_run: false,
            run_number: data.run_number ?? 1,
            created_at: new Date().toISOString(),
          },
        ])
      }
      setChats(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          brain_dump_id: dump.id,
          role: 'assistant',
          content: data.content!,
          is_board_run: true,
          run_number: data.run_number ?? 1,
          created_at: new Date().toISOString(),
        },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  // Auto-run on first load if no existing chats
  useEffect(() => {
    if (!initialized.current && initialChats.length === 0) {
      initialized.current = true
      callBoard()
    } else {
      initialized.current = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll to bottom when chats change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chats, loading])

  function handleSend() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    callBoard(msg)
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto px-4">
      {/* Top nav */}
      <div className="py-4 flex items-center gap-3 border-b border-border/40">
        <Link href="/inbox" className="text-sm text-muted-foreground hover:text-foreground">
          ← Inbox
        </Link>
        <span className="text-muted-foreground/40">|</span>
        <span className="text-sm font-medium">Advisory Board</span>
      </div>

      {/* Dump card */}
      <div className="py-4 border-b border-border/40">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          {dump.classified_type && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeColors[dump.classified_type]}`}>
              {dump.classified_type.replace('_', ' ')}
            </span>
          )}
          {dump.project_name && (
            <span className="text-[10px] font-medium text-foreground/70">{dump.project_name}</span>
          )}
        </div>
        <p className="text-sm text-foreground leading-snug">
          {dump.ai_summary ?? dump.raw_text}
        </p>
      </div>

      {/* Chat thread */}
      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-4">
        {chats.map((chat) => (
          <div key={chat.id} className={chat.role === 'user' ? 'flex justify-end' : ''}>
            {chat.role === 'assistant' ? (
              <div className="border border-border rounded-lg p-4 relative">
                <span className="absolute top-2 right-3 text-[10px] text-muted-foreground/50">
                  Run {chat.run_number}
                </span>
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {chat.content}
                </pre>
              </div>
            ) : (
              <div className="bg-muted rounded-lg px-3 py-2 max-w-[75%]">
                <p className="text-sm">{chat.content}</p>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="border border-border/40 rounded-lg p-4 text-sm text-muted-foreground italic">
            The board is deliberating…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
            <button
              onClick={() => callBoard()}
              className="ml-3 underline text-red-600 hover:text-red-800"
            >
              Retry
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Sticky input bar */}
      <div className="py-4 border-t border-border/40 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          disabled={loading}
          placeholder="Push back, ask for more, or change the framing…"
          className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:opacity-40"
        >
          Send
        </button>
        <button
          onClick={() => callBoard()}
          disabled={loading}
          className="rounded border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-40"
        >
          Rerun Board
        </button>
      </div>
    </div>
  )
}
