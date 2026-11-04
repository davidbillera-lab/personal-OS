'use server'

import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { requireOwner } from '@/lib/owner'
import {
  applyOwnerAction,
  CONFLICT_MESSAGE,
  planOwnerClose,
  planOwnerReassign,
  planOwnerReopen,
  recordOwnerAudit,
  validateEvidence,
  validateReason,
  validateRequestId,
  type OwnerPlan,
  type OwnerRequestRow,
  type OwnerWorker,
} from '@/lib/owner-requests'

export type OwnerActionResult = { ok: true } | { ok: false; error: string }

type Base = { id: string; expectedStatus: string; expectedUpdatedAt: string; reason: string }

const ROW_COLUMNS =
  'id,status,updated_at,assigned_to,attempt_id,phase,plan,plan_submitted_at,plan_by,blocker,result_summary,approval_required,reviewed_sha,workspace_ref'

// Shared sequence: id -> owner -> inputs -> fetch -> stale check -> plan -> compare-and-set apply.
// Never throws: Next redacts thrown server-action errors in production.
// An invalid id is refused unaudited: mcp_audit_log.request_id is a nullable UUID, so a non-UUID cannot be stored.
async function runOwnerAction(
  tool: string,
  input: Base,
  validate: () => void,
  plan: (row: OwnerRequestRow, reason: string) => OwnerPlan,
): Promise<OwnerActionResult> {
  let id: string
  try {
    id = validateRequestId(input?.id)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  try {
    const supabase = createAdminSupabaseClient()
    const refuse = async (error: string): Promise<OwnerActionResult> => {
      await recordOwnerAudit(supabase, { tool, ok: false, error, request_id: id })
      return { ok: false, error }
    }

    try {
      await requireOwner()
    } catch {
      return refuse('Not authorized')
    }

    let reason: string
    try {
      reason = validateReason(input.reason)
      if (typeof input.expectedStatus !== 'string' || !input.expectedStatus) throw new Error('Missing expected status')
      if (typeof input.expectedUpdatedAt !== 'string' || !input.expectedUpdatedAt) throw new Error('Missing expected version')
      validate()
    } catch (err) {
      return refuse((err as Error).message)
    }

    const { data, error } = await supabase.from('mc_requests').select(ROW_COLUMNS).eq('id', id).maybeSingle()
    if (error) return refuse(`Lookup failed: ${error.message}`)
    if (!data) return refuse('Request not found')
    const row = data as unknown as OwnerRequestRow

    // Raw string compare: Date parsing would drop microseconds.
    if (row.status !== input.expectedStatus || row.updated_at !== input.expectedUpdatedAt) return refuse(CONFLICT_MESSAGE)

    const planned = plan(row, reason)
    if (!planned.ok) return refuse(planned.reason)

    // Audits its own success and conflict.
    const applied = await applyOwnerAction(supabase, id, input.expectedStatus, input.expectedUpdatedAt, planned.updates, {
      tool,
      detail: planned.detail,
    })
    if (!applied.ok) return { ok: false, error: applied.error }
    revalidatePath('/queue')
    return { ok: true }
  } catch (err) {
    console.error(`[owner] ${tool} failed:`, err)
    return { ok: false, error: 'Action failed unexpectedly; refresh and try again.' }
  }
}

export async function closeRequest(
  input: Base & { outcome: 'completed' | 'cancelled'; evidence?: string },
): Promise<OwnerActionResult> {
  return runOwnerAction(
    'owner_close_request',
    input,
    () => {
      if (input.outcome !== 'completed' && input.outcome !== 'cancelled') throw new Error('Outcome must be completed or cancelled')
      validateEvidence(input.evidence)
    },
    (row, reason) => planOwnerClose(row, input.outcome, reason, input.evidence),
  )
}

export async function reopenRequest(input: Base): Promise<OwnerActionResult> {
  return runOwnerAction('owner_reopen_request', input, () => {}, (row, reason) => planOwnerReopen(row, reason))
}

export async function reassignRequest(input: Base & { worker: string | null }): Promise<OwnerActionResult> {
  // A select sends '' for "unassigned"; only '' maps to null.
  const worker = (input?.worker === '' ? null : input?.worker) as OwnerWorker
  return runOwnerAction(
    'owner_reassign_request',
    input,
    () => {},
    (row, reason) => {
      const p = planOwnerReassign(row, worker)
      // The planner's detail carries a placeholder reason; the spec requires the real one.
      return p.ok ? { ...p, detail: { ...p.detail, reason } } : p
    },
  )
}
