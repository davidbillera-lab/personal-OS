'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { sendChatMessage } from '@/app/(app)/projects/[id]/actions'
import type { ProjectChat as ProjectChatType } from '@/lib/types'

interface Props {
  projectId: string
  initialMessages: ProjectChatType[]
  focusedContext?: string
}

export function ProjectChat({ projectId, initialMessages, focusedContext }: Props) {
  const [messages, setMessages] = useState<ProjectChatType[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    const text = input.trim()
    if (!text || isPending) return

    setInput('')
    setError(null)

    const optimisticUser: ProjectChatType = {
      id: `optimistic-${Date.now()}`,
      project_id: projectId,
      role: 'user',
      content: text,
      model: null,
      created_at: new Date().toISOString(),
    }

    setMessages(prev => [...prev, optimisticUser])

    startTransition(async () => {
      const result = await sendChatMessage(projectId, text, focusedContext)
      if (result.error) {
        setError(result.error)
        setMessages(prev => prev.filter(m => m.id !== optimisticUser.id))
        setInput(text)
        return
      }
      if (result.reply) {
        const assistantMsg: ProjectChatType = {
          id: `reply-${Date.now()}`,
          project_id: projectId,
          role: 'assistant',
          content: result.reply,
          model: null,
          created_at: new Date().toISOString(),
        }
        setMessages(prev => [...prev, assistantMsg])
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col gap-4 h-[600px]">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            Start the conversation. Ask anything about this project.
          </p>
        )}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex flex-col gap-0.5 max-w-[85%] ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
          >
            <div
              className={[
                'rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap',
                msg.role === 'user'
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-foreground border border-border',
              ].join(' ')}
            >
              {msg.content}
            </div>
            {msg.role === 'assistant' && msg.model && (
              <span className="text-[10px] text-muted-foreground/60 px-1">{msg.model}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">{error}</p>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          rows={3}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={isPending || !input.trim()}
          className="rounded bg-foreground px-3 py-2 text-[11px] font-medium text-background hover:bg-foreground/80 disabled:opacity-50 shrink-0"
        >
          {isPending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
