// Pure rules binding an operator approval to exactly ONE reviewed commit.
//
// WHY THIS EXISTS: mc_respond_approval recorded who approved and when, never what. Consent
// was a pointer into a mutable column — anything able to rewrite mc_requests.reviewed_sha
// after the approval landed retargeted a live approval at a different commit, and the gated
// push pushed it. approved_sha freezes the commit at decision time, and the sha the decision
// was computed against is re-asserted as a filter on the UPDATE so the database, not a
// read-then-check, decides whether the approval still applies.
//
// Shared on purpose. lib/mcp-tools.ts (the real MCP tool) and scripts/rig-test.mjs (the
// operator CLI that simulates a voice approval) must enforce identical rules: rig-test holds
// the service-role key, so a looser approve path there is a real bypass of this gate, not a
// test-only shortcut. Keep both call sites thin — the rules live here.

export const SHA_RE = /^[0-9a-f]{40}$/

/**
 * The subset of an mc_requests row this module reasons about.
 * @typedef {{ status?: string|null, attempt_id?: string|null, reviewed_sha?: string|null }} ApprovalRow
 * @typedef {{ attemptId?: string|null, decision?: string, actor?: string, note?: string|null, now?: string }} DecisionOpts
 * @typedef {{ updates: Record<string, any>, guards: Record<string, string> }} Decision
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSha(value) {
  return typeof value === 'string' && SHA_RE.test(value)
}

// Build the guarded UPDATE for an approve/reject decision.
//
// `current` MUST be the row as read from the server this instant. The approved sha is taken
// from there and never from caller input, so a client cannot nominate the commit it claims
// to be consenting to.
//
// Returns { updates, guards }. Callers MUST apply every guard as an equality filter on the
// UPDATE: they re-assert, atomically, the exact state this decision was computed against.
// 0 rows back means something moved — refuse, never retry blind.
/**
 * @param {ApprovalRow|null|undefined} current
 * @param {DecisionOpts} [opts]
 * @returns {Decision}
 */
export function buildApprovalDecision(current, { attemptId, decision, actor, note = null, now } = {}) {
  if (decision !== 'approve' && decision !== 'reject') {
    throw new Error("decision must be 'approve' or 'reject'")
  }
  if (!attemptId) throw new Error('attempt_id is required (binds approval to the reviewed attempt)')
  if (!current?.attempt_id) {
    throw new Error('Request has no attempt_id — nothing reviewed to bind this decision to')
  }
  if (current.attempt_id !== attemptId) {
    throw new Error(`Attempt superseded: approval targets ${attemptId} but current attempt is ${current.attempt_id}`)
  }

  const stamped = now ?? new Date().toISOString()
  // Always re-assert the from-state and the attempt. Approve additionally re-asserts the
  // sha below, so a reviewed_sha rewritten between the read and the write matches 0 rows
  // instead of quietly moving what the operator said yes to.
  const guards = { status: 'awaiting_approval', attempt_id: attemptId }

  if (decision === 'reject') {
    return {
      guards,
      updates: {
        status: 'blocked', phase: null, approval_required: false,
        approved_by: actor, approved_at: stamped,
        // A rejection must leave no consent behind for a later attempt to inherit.
        approved_sha: null,
        blocker: note ?? 'rejected by operator', updated_at: stamped,
      },
    }
  }

  if (!isSha(current.reviewed_sha)) {
    throw new Error(
      `Cannot approve: request has no reviewed commit to bind to (reviewed_sha=${current.reviewed_sha ?? 'null'})`,
    )
  }
  guards.reviewed_sha = current.reviewed_sha
  return {
    guards,
    updates: {
      status: 'in_progress', phase: 'pushing', approval_required: false,
      approved_by: actor, approved_at: stamped,
      approved_sha: current.reviewed_sha,
      blocker: null, updated_at: stamped,
    },
  }
}

// Apply the decision through a supabase-js-shaped client. Lives here rather than at the call
// sites so the guard list cannot drift between the MCP tool and the operator CLI.
/**
 * @param {any} sb supabase-js-shaped client
 * @param {string} requestId
 * @param {ApprovalRow|null|undefined} current
 * @param {DecisionOpts} opts
 * @returns {Promise<{ data: any, error: any, updates: Record<string, any>, guards: Record<string, string> }>}
 */
export async function applyApprovalDecision(sb, requestId, current, opts) {
  const { updates, guards } = buildApprovalDecision(current, opts)
  let q = sb.from('mc_requests').update(updates).eq('id', requestId)
  for (const [column, value] of Object.entries(guards)) q = q.eq(column, value)
  const { data, error } = await q.select('*').maybeSingle()
  return { data, error, updates, guards }
}

// Fields that either carry operator consent or scope it. A change to any one of them between
// the push gate and the push itself means the approval about to be acted on is no longer the
// approval that was checked.
export const CONSENT_FIELDS = [
  'status', 'phase', 'attempt_id', 'approved_at', 'approved_by',
  'approved_sha', 'reviewed_sha', 'workspace_ref',
]

// Compare the row the gate validated against a fresh authoritative read taken immediately
// before the push. Returns the reason it drifted, or null when nothing moved.
export function consentDrift(gated, fresh) {
  if (!fresh) return 'row disappeared between gate and push'
  for (const field of CONSENT_FIELDS) {
    const before = gated?.[field] ?? null
    const after = fresh[field] ?? null
    if (before !== after) return `${field} changed (${before ?? 'null'} → ${after ?? 'null'})`
  }
  return null
}
