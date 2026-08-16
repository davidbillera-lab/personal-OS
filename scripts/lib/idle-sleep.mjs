// On-demand relay: decide when the rig has nothing left to do and may put itself to sleep.
//
// WHY THIS EXISTS
// The dispatcher used to run forever. While Docker was down it probed the daemon on a fixed
// interval with no backoff, and each probe pokes Docker Desktop into showing its
// "cannot connect / starting" UI — which is what made the operator shut Docker off entirely
// on 2026-08-13, taking the relay down for three days. An always-on poller with no work to
// do is pure cost: it nags, and it can only ever nag.
//
// The relay is now woken deliberately (Hermes asks over Telegram, the operator says yes) and
// goes back to sleep on its own once the work set is empty. Nothing polls when there is
// nothing to poll for.
//
// THE SAFETY RULE, and it is the whole point of this file: never sleep on outstanding work.
// A row in awaiting_approval is the dangerous one — the operator approves it later, and the
// gated push is done BY THE DISPATCHER. Sleeping with an approval pending would strand a
// finished build exactly the way the assigned_to filter did. Staying awake through the
// approval window costs nothing: Docker is up during it, so there is no nagging to avoid.

// Statuses that mean "this rig still owes someone something".
// - queued / submitted+planned : work waiting to be claimed
// - claimed / in_progress      : a build running, or a push approved and pending
// - awaiting_approval          : the operator's decision is pending, and WE do the push
const OUTSTANDING = new Set(['queued', 'claimed', 'in_progress', 'awaiting_approval'])

/**
 * Does this row still require the dispatcher to be awake?
 * `submitted` counts ONLY when Hermes has deposited a plan — a submitted row with no plan is
 * waiting on Hermes, not on us, and is precisely the state we must be allowed to sleep
 * through (it can sit for days; 26d1849b sat for two).
 */
export function isOutstanding(row) {
  if (!row || typeof row.status !== 'string') return false
  if (row.status === 'submitted') return row.phase === 'planned' && row.plan != null
  return OUTSTANDING.has(row.status)
}

/** Is the rig's entire work set empty? */
export function workSetEmpty(rows) {
  if (!Array.isArray(rows)) return false // unknown ⇒ stay awake (fail safe)
  return !rows.some(isOutstanding)
}

/**
 * Should the dispatcher sleep now?
 *
 * `idleSinceMs` is when the work set was last observed empty (null ⇒ not idle yet).
 * Returns false whenever anything is unknown, in flight, or the feature is off — sleeping
 * is only ever chosen from a positively-confirmed idle state.
 */
export function shouldSleep({ idleSinceMs, now, thresholdMs, buildInFlight = false }) {
  if (!thresholdMs || thresholdMs <= 0) return false // feature off
  if (buildInFlight) return false
  if (idleSinceMs == null) return false
  return now - idleSinceMs >= thresholdMs
}
