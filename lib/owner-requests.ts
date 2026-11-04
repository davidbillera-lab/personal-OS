import type { SupabaseClient } from '@supabase/supabase-js'
// Single source of truth for dispatcher eligibility; do not copy this logic.
import { isClaimablePlanned, isDispatcherRow } from '../scripts/lib/planned-claim.mjs'

export type OwnerRequestRow = {
  id: string
  status: string
  updated_at: string
  assigned_to: string | null
  attempt_id: string | null
  phase: string | null
  plan: string | null
  plan_submitted_at: string | null
  plan_by: string | null
  blocker: string | null
  result_summary: string | null
  approval_required: boolean | null
  reviewed_sha: string | null
  workspace_ref: string | null
}

export type OwnerWorker = 'claude' | 'hermes' | 'codex' | null
export const OWNER_WORKERS: OwnerWorker[] = ['claude', 'hermes', 'codex', null]

export type OwnerPlan =
  | { ok: true; updates: Record<string, unknown>; detail: Record<string, unknown> }
  | { ok: false; reason: string }

export const STALE_CLAIM_MS = 2 * 60 * 60 * 1000
export const CONFLICT_MESSAGE = 'Request changed since you loaded it; refresh and try again.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateRequestId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('Invalid request id')
  return id
}

export function validateReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (text.length < 1 || text.length > 1000) throw new Error('Reason must be 1 to 1000 characters')
  return text
}

export function validateEvidence(evidence: unknown): string {
  const text = typeof evidence === 'string' ? evidence.trim() : ''
  if (text.length > 2000) throw new Error('Evidence must be at most 2000 characters')
  return text
}

const fail = (reason: string): OwnerPlan => ({ ok: false, reason })

function cleanInputs(reason: unknown, evidence?: unknown): { reason: string; evidence: string } | string {
  try {
    return { reason: validateReason(reason), evidence: validateEvidence(evidence) }
  } catch (err) {
    return (err as Error).message
  }
}

const CLOSE_DIRECT = ['submitted', 'queued', 'blocked', 'failed', 'awaiting_approval']

export function planOwnerClose(
  row: OwnerRequestRow,
  outcome: 'completed' | 'cancelled',
  reason: string,
  evidence?: string,
  now: Date = new Date(),
): OwnerPlan {
  if (outcome !== 'completed' && outcome !== 'cancelled') return fail('Outcome must be completed or cancelled')
  const clean = cleanInputs(reason, evidence)
  if (typeof clean === 'string') return fail(clean)

  if (row.status === 'claimed' || row.status === 'in_progress') {
    if (row.attempt_id) return fail('A dispatcher run is in flight; it cannot be closed from here')
    const touched = Date.parse(row.updated_at)
    if (Number.isNaN(touched)) return fail('Cannot tell when this request was last touched')
    if (now.getTime() - touched <= STALE_CLAIM_MS) return fail('Claimed less than 2 h ago; wait until it is stale')
  } else if (!CLOSE_DIRECT.includes(row.status)) {
    return fail(`Cannot close a request that is ${row.status}`)
  }

  const updates: Record<string, unknown> = {
    status: outcome,
    result_summary: `Closed by owner: ${clean.reason}${clean.evidence ? `\nEvidence: ${clean.evidence}` : ''}`,
    blocker: null,
    phase: null,
    attempt_id: null,
    approval_required: false,
  }
  if (outcome === 'completed') updates.completed_at = now.toISOString()
  const detail: Record<string, unknown> = {
    from_status: row.status,
    to_status: outcome,
    from_assigned: row.assigned_to,
    to_assigned: row.assigned_to,
    reason: clean.reason,
  }
  if (clean.evidence) detail.evidence = clean.evidence
  return { ok: true, updates, detail }
}

export function planOwnerReopen(row: OwnerRequestRow, reason: string): OwnerPlan {
  const clean = cleanInputs(reason)
  if (typeof clean === 'string') return fail(clean)
  if (!['completed', 'cancelled', 'failed'].includes(row.status)) {
    return fail(`Can only reopen a completed, cancelled or failed request (this one is ${row.status})`)
  }
  return {
    ok: true,
    updates: {
      status: 'blocked',
      blocker: `owner-hold: reopened by owner: ${clean.reason}`,
      completed_at: null,
      attempt_id: null,
      phase: null,
      plan: null,
      plan_submitted_at: null,
      plan_by: null,
      approval_required: false,
    },
    detail: {
      from_status: row.status,
      to_status: 'blocked',
      from_assigned: row.assigned_to,
      to_assigned: row.assigned_to,
      reason: clean.reason,
      old_plan: row.plan,
      old_plan_by: row.plan_by,
      old_plan_submitted_at: row.plan_submitted_at,
    },
  }
}

export function planOwnerReassign(row: OwnerRequestRow, worker: OwnerWorker): OwnerPlan {
  if (!OWNER_WORKERS.includes(worker)) return fail('Unknown worker')
  if (!['submitted', 'queued', 'blocked'].includes(row.status)) {
    return fail(`Can only reassign a submitted, queued or blocked request (this one is ${row.status})`)
  }
  if ((row.assigned_to ?? null) === worker) return fail('Already assigned to that worker')
  const result = { ...row, assigned_to: worker }
  // claimPlanned is a runtime flag; assume it may be on.
  if ((result.status === 'queued' && isDispatcherRow(result)) || isClaimablePlanned(result, true)) {
    return fail('Reassigning would let the rig run this')
  }
  return {
    ok: true,
    updates: { assigned_to: worker },
    detail: {
      from_status: row.status,
      to_status: row.status,
      from_assigned: row.assigned_to,
      to_assigned: worker,
      reason: 'reassign',
    },
  }
}

export type OwnerAudit = {
  tool: string
  ok: boolean
  error?: string
  request_id: string
  detail?: Record<string, unknown>
}

// Best-effort, same contract as app/api/mcp/route.ts: never throws.
export async function recordOwnerAudit(supabase: SupabaseClient, audit: OwnerAudit): Promise<void> {
  try {
    const { error } = await supabase.from('mcp_audit_log').insert({
      actor: 'owner',
      tool: audit.tool,
      ok: audit.ok,
      error: audit.error ?? null,
      request_id: audit.request_id,
      detail: audit.detail ?? null,
    })
    if (error) console.error('[owner] audit log write rejected (non-fatal):', error.message)
  } catch (err) {
    console.error('[owner] audit log write failed (non-fatal):', err)
  }
}

export type ApplyResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string }

export async function applyOwnerAction(
  supabase: SupabaseClient,
  id: string,
  expectedStatus: string,
  expectedUpdatedAt: string,
  updates: Record<string, unknown>,
  audit: { tool: string; detail?: Record<string, unknown> },
): Promise<ApplyResult> {
  // updated_at is set by hand: the 029 trigger may not be applied yet, and it is the version token.
  const { data, error } = await supabase
    .from('mc_requests')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', expectedStatus)
    .eq('updated_at', expectedUpdatedAt)
    .select('id,status,updated_at,assigned_to,attempt_id,phase')
    .maybeSingle()

  const message = error ? `Update failed: ${error.message}` : !data ? CONFLICT_MESSAGE : null
  if (message) {
    await recordOwnerAudit(supabase, { tool: audit.tool, ok: false, error: message, request_id: id, detail: audit.detail })
    return { ok: false, error: message }
  }
  await recordOwnerAudit(supabase, { tool: audit.tool, ok: true, request_id: id, detail: audit.detail })
  return { ok: true, row: data as Record<string, unknown> }
}
