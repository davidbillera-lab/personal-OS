// Gap A1 (second-half relay): pure eligibility check for claiming a Hermes-deposited
// plan row. Kept dependency-free (no supabase client) so it can be unit-tested without a
// live DB. The dispatcher only calls the DB-touching claim path when this would be true —
// see claimPlannedOne() in dispatcher.mjs.
export function isClaimablePlanned(row, claimPlanned) {
  if (!claimPlanned) return false
  if (!row) return false
  if (!isDispatcherRow(row)) return false
  return row.status === 'submitted' && row.phase === 'planned' && row.plan != null
}

// The dispatcher only ever owns rows assigned to nobody, to claude, or to hermes
// (Hermes-planned rows are still assigned_to='hermes' at claim time). Any other worker
// identity (codex, codex-qc, future lanes) is claimed by that worker itself, never here.
export const DISPATCHER_WORKERS = ['claude', 'hermes']
// PostgREST filter expressing the same rule; apply to both the select and the conditional update.
export const DISPATCHER_ROW_FILTER = 'assigned_to.is.null,assigned_to.in.(claude,hermes)'
export function isDispatcherRow(row) { return !!row && (row.assigned_to == null || DISPATCHER_WORKERS.includes(row.assigned_to)) }
