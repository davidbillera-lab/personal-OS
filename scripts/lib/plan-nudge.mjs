// Hermes planning wakeup: decide when a submitted request has waited long enough for a
// plan that someone should be told. Kept dependency-free (no supabase, no clock read except
// the injected `now`) so it can be unit-tested without a live DB — same shape as
// planned-claim.mjs.
//
// WHY THIS EXISTS
// The relay's two halves both work: Hermes deposits a spec via mc_submit_plan (which sets
// phase='planned'), and the dispatcher's claimPlannedOne() picks it up and builds it from
// request.plan. The join between them is a human. Nothing in the system tells Hermes a
// request is waiting to be planned, so a submitted/phase=null row waits forever — 26d1849b
// sat that way for two days, and 0a3d6fc9 stranded the same way within nine minutes of
// being filed.
//
// SCOPE, HONESTLY: this is a NUDGE, not an ingress. The dispatcher cannot call into Hermes
// (Hermes is a local app that dials out to MC; there is no inbound endpoint to POST to).
// Building one is a trust-ladder step, not a bug fix — see
// specs/2026-07-16-hermes-ambient-layer-design.md. What this does is collapse the detection
// gap from ~14h (twice-daily serverless sweep, 2h stale threshold) to minutes, and name the
// exact call needed to unstick it. The serverless stuck-jobs sweep remains the backstop.

// A freshly-filed request needs a moment before it's "waiting" — Hermes may be planning it
// right now. 30min is far past a normal planning turnaround and far short of a lost day.
export const PLAN_NUDGE_AFTER_MS = 30 * 60 * 1000

/**
 * Is this row a submitted request that has been waiting on a plan past the threshold?
 *
 * Deliberately NOT filtered on assigned_to: the same rewrite-mid-flight hazard that hid
 * approved rows from findPushable() applies here. What matters is the state (submitted,
 * no plan), not who the row currently claims to belong to.
 */
export function needsPlanNudge(row, now = new Date(), thresholdMs = PLAN_NUDGE_AFTER_MS) {
  if (!row) return false
  if (row.status !== 'submitted') return false
  if (row.phase === 'planned' || row.plan != null) return false // already planned
  const t = Date.parse(row.updated_at ?? row.created_at ?? '')
  if (Number.isNaN(t)) return false // unparseable timestamp → stay quiet rather than spam
  return now.getTime() - t > thresholdMs
}

/**
 * Stable dedup identity for the mc_alert_sends ledger. One nudge per request per stall —
 * a row that gets planned and later re-stalls produces the same key, which is correct:
 * the ledger row is deleted when the request advances (see dispatcher clearPlanNudge).
 */
export function planNudgeKey(row) {
  return `${row.id}:plan_nudge`
}
