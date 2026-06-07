'use client'

import { useTransition, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { submitDump } from '@/app/(app)/inbox/actions'

export function InboxCapture() {
  const [isPending, startTransition] = useTransition()
  const [isListening, setIsListening] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  function handleSubmit() {
    const text = ref.current?.value ?? ''
    if (!text.trim()) return
    startTransition(async () => {
      await submitDump(text)
      if (ref.current) ref.current.value = ''
    })
  }

  function handleMic() {
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = typeof window !== 'undefined'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null

    if (!Ctor) return

    const recognition = new Ctor()
    recognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcript = Array.from(e.results as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript)
        .join(' ')
      if (ref.current) {
        const existing = ref.current.value.trim()
        ref.current.value = existing ? `${existing} ${transcript}` : transcript
      }
    }

    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
    }

    recognition.onerror = () => {
      setIsListening(false)
      recognitionRef.current = null
    }

    recognition.start()
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMic}
            disabled={isPending}
            title={isListening ? 'Stop recording' : 'Voice input'}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              isListening
                ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                : 'border border-input text-muted-foreground hover:text-foreground hover:border-foreground/30'
            }`}
          >
            {isListening ? <Square size={11} /> : <Mic size={11} />}
            {isListening ? 'Stop' : 'Voice'}
          </button>
          <button
            disabled={isPending}
            onClick={handleSubmit}
            className="rounded bg-foreground px-4 py-1.5 text-xs font-medium text-background hover:bg-foreground/80 disabled:opacity-50"
          >
            {isPending ? 'Classifying…' : 'Capture'}
          </button>
        </div>
      </div>
    </div>
  )
}
