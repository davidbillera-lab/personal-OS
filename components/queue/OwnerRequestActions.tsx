'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { closeRequest, reassignRequest, reopenRequest } from '@/app/(app)/queue/actions'
import type { OwnerActionAvailability } from '@/lib/owner-requests'

type Action = 'close' | 'reopen' | 'reassign'

interface Props {
  id: string
  status: string
  updatedAt: string // raw PostgREST string: it is the version token, never round-trip it through Date
  assignedTo: string | null
  attemptId: string | null
  phase: string | null
  reviewedSha: string | null
  workspaceRef: string | null
  availability: OwnerActionAvailability
}

const LABELS: Record<Action, string> = { close: 'Close', reopen: 'Reopen', reassign: 'Reassign' }
const fieldClass =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function touchedLabel(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`
}

export function OwnerRequestActions({ id, status, updatedAt, assignedTo, attemptId, phase, reviewedSha, workspaceRef, availability }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstFieldRef = useRef<HTMLTextAreaElement>(null)
  const [action, setAction] = useState<Action | null>(null)
  // The version the owner was looking at when the dialog opened; sent as the compare-and-set token.
  const [snap, setSnap] = useState<{ status: string; updatedAt: string } | null>(null)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<'completed' | 'cancelled'>('completed')
  const [evidence, setEvidence] = useState('')
  const [worker, setWorker] = useState('')
  const [error, setError] = useState<string | null>(null)

  const legalWorkers = availability.reassign.filter(r => r.unavailable === null)
  const reassignWhy =
    legalWorkers.length === 0 ? (availability.reassign.find(r => r.unavailable)?.unavailable ?? 'No other worker') : null
  const terminal = ['completed', 'cancelled', 'failed'].includes(status)
  const allowed: Array<[Action, string | null]> = [
    ['close', availability.close],
    ['reopen', availability.reopen],
    ['reassign', reassignWhy],
  ]

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (action && !dialog.open) {
      dialog.showModal()
      firstFieldRef.current?.focus()
    } else if (!action && dialog.open) {
      dialog.close()
    }
  }, [action])

  function open(next: Action) {
    if (isPending) return
    setSnap({ status, updatedAt })
    setReason('')
    setEvidence('')
    setOutcome('completed')
    setWorker(legalWorkers[0]?.worker ?? '')
    setError(null)
    setAction(next)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!action || !snap) return
    const base = { id, expectedStatus: snap.status, expectedUpdatedAt: snap.updatedAt, reason }
    startTransition(async () => {
      let result
      try {
        result =
          action === 'close'
            ? await closeRequest({ ...base, outcome, evidence })
            : action === 'reopen'
              ? await reopenRequest(base)
              : await reassignRequest({ ...base, worker })
      } catch {
        // Never auto-retry: the change may have been applied.
        return setError("Couldn't confirm the result (connection or server error). Refresh before retrying; it may have been applied.")
      }
      if (!result.ok) return setError(result.error)
      setAction(null)
      setReason('')
      setEvidence('')
      router.refresh()
    })
  }

  const holder = status === 'claimed' || status === 'in_progress'

  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
      <p className="text-[10px] text-muted-foreground/70">
        last touched {touchedLabel(updatedAt)}
        {holder && ` · held by ${assignedTo ?? 'unknown'}${attemptId ? ' (dispatcher run)' : ''}`}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {allowed.map(([a, why]) => {
          if (why === null) {
            return <Button key={a} type="button" variant="outline" size="xs" onClick={() => open(a)}>{LABELS[a]}</Button>
          }
          // Refusals are noise on finished rows, and reopen's refusal is noise on open rows.
          if (terminal || a === 'reopen') return null
          return (
            <span key={a} className="text-[10px] text-muted-foreground/70">
              Can&apos;t {a}: {why}
            </span>
          )
        })}
      </div>

      <dialog
        ref={dialogRef}
        onCancel={e => { if (isPending) e.preventDefault() }}
        onClose={() => { if (!isPending) setAction(null) }}
        className="m-auto w-[min(32rem,92vw)] rounded-lg border border-border bg-card p-4 text-foreground backdrop:bg-black/50"
      >
        {action && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">{LABELS[action]} request</h2>
            <p className="text-[11px] text-muted-foreground">
              Currently {status.replace(/_/g, ' ')}
              {phase ? ` (${phase})` : ''}, assigned to {assignedTo ?? 'nobody'}.
            </p>

            <label className="flex flex-col gap-1 text-[11px] font-medium">
              Reason (required)
              <Textarea ref={firstFieldRef} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
            </label>

            {action === 'close' && (
              <>
                {status === 'awaiting_approval' && (reviewedSha || workspaceRef) && (
                  <p className="text-[11px] text-muted-foreground">
                    {reviewedSha && <>Reviewed sha {reviewedSha.slice(0, 7)}. </>}
                    {workspaceRef && <>Workspace {workspaceRef}.</>}
                  </p>
                )}
                <label className="flex flex-col gap-1 text-[11px] font-medium">
                  Outcome
                  <select
                    className={fieldClass}
                    value={outcome}
                    onChange={e => setOutcome(e.target.value as 'completed' | 'cancelled')}
                  >
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-medium">
                  Evidence (optional)
                  <Textarea maxLength={2000} value={evidence} onChange={e => setEvidence(e.target.value)} />
                </label>
              </>
            )}

            {action === 'reassign' && (
              <label className="flex flex-col gap-1 text-[11px] font-medium">
                Assign to
                <select className={fieldClass} value={worker} onChange={e => setWorker(e.target.value)}>
                  {legalWorkers.map(r => (
                    <option key={r.worker ?? ''} value={r.worker ?? ''}>
                      {r.worker ?? 'Unassigned'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {error && (
              <p role="alert" className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending || !reason.trim()}>
                {isPending ? 'Working…' : LABELS[action]}
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  )
}
