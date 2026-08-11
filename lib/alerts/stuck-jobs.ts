// Pure, deterministic builder for the twice-daily "jobs needing you" sweep.
// The serverless backstop to the dispatcher: it doesn't execute anything, it
// tells the operator which requests fell out of the autonomous path so nothing
// rots silently. No Supabase, no network, no clock reads except the injected
// `now` — fully unit-testable. The route (app/api/alerts/stuck-jobs) supplies
// rows and delivers the returned string to Telegram.

export interface StuckRequest {
  id: string
  title: string | null
  status: string
  phase: string | null
  blocker: string | null
  updated_at: string
}

// A planned request that the dispatcher hasn't picked up within this window is
// treated as "not picked up" (dispatcher may be down). Fresh planned rows are
// claimed in seconds, so 2h is comfortably past normal.
const STALE_PLANNED_MS = 2 * 60 * 60 * 1000

const clean = (s: string | null | undefined): string => (s ?? '').trim()
const oneLine = (s: string | null | undefined): string => clean(s).replace(/\s+/g, ' ')
const short = (s: string | null | undefined, n = 70): string => {
  const t = oneLine(s)
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function isStale(r: StuckRequest, now: Date): boolean {
  const t = Date.parse(r.updated_at)
  if (Number.isNaN(t)) return false // unparseable → not stale (fail safe, not noisy)
  return now.getTime() - t > STALE_PLANNED_MS
}

function isStalePlanned(r: StuckRequest, now: Date): boolean {
  if (r.status !== 'submitted' || r.phase !== 'planned') return false
  return isStale(r, now)
}

// A workflow sitting in 'submitted' with no plan yet is waiting on Hermes to PLAN it —
// and nothing in the system consumes that state automatically, so it waits forever unless
// someone assigns it by hand. It was invisible here too (the old filter required
// phase==='planned'), which is how request 26d1849b sat silent for two days. The stall is
// upstream of the dispatcher, so the fix is to make it loud, not to auto-claim it.
function isStaleAwaitingPlan(r: StuckRequest, now: Date): boolean {
  if (r.status !== 'submitted' || r.phase === 'planned') return false
  return isStale(r, now)
}

const bullet = (r: StuckRequest): string => {
  const b = short(r.blocker)
  return `• ${clean(r.title) || r.id} (${r.id.slice(0, 8)})${b ? ` — ${b}` : ''}`
}

/**
 * Deterministic, non-secret identity for "this request is actionable for this
 * reason". Stable across sweeps so a row that hasn't changed produces the same
 * key (and is suppressed); a row that moves to a new state produces a new key
 * (and legitimately re-alerts).
 *
 * `blocker` is deliberately part of the blocked key: the classifier can re-hold
 * the same request for a different reason, and that is worth telling the
 * operator about. It is normalised to one line so cosmetic whitespace churn
 * can't manufacture a new key.
 */
export function transitionKey(r: StuckRequest, now: Date = new Date()): string {
  const bucket = alertBucket(r, now)
  if (bucket === null) return ''
  // stale_planned is a property of time, not of a state change, so it keys on
  // the plan deposit alone -- one "never picked up" nudge per planned request.
  if (bucket === 'stale_planned') return `${r.id}:stale_planned`
  if (bucket === 'stale_unplanned') return `${r.id}:stale_unplanned`
  if (bucket === 'blocked') return `${r.id}:blocked:${oneLine(r.blocker)}`
  return `${r.id}:${bucket}`
}

export type AlertBucket = 'failed' | 'blocked' | 'awaiting' | 'stale_planned' | 'stale_unplanned'

/** Which bucket a row belongs to, or null when it is not actionable. */
export function alertBucket(r: StuckRequest, now: Date = new Date()): AlertBucket | null {
  if (r.status === 'failed') return 'failed'
  if (r.status === 'blocked') return 'blocked'
  if (r.status === 'awaiting_approval') return 'awaiting'
  if (isStalePlanned(r, now)) return 'stale_planned'
  if (isStaleAwaitingPlan(r, now)) return 'stale_unplanned'
  return null
}

/**
 * Drop rows whose transition has already been announced. `alreadySent` is the
 * set of transition keys read from mc_alert_sends.
 *
 * Fail-safe direction is deliberate: if the ledger read fails the caller passes
 * an empty set, so the operator gets a duplicate rather than silence. A missed
 * alert is worse than a repeated one.
 */
export function suppressAlreadySent(
  rows: StuckRequest[],
  alreadySent: ReadonlySet<string>,
  now: Date = new Date(),
): StuckRequest[] {
  return rows.filter((r) => {
    const key = transitionKey(r, now)
    if (key === '') return false
    return !alreadySent.has(key)
  })
}

/**
 * Build the sweep message, or return null when nothing is actionable
 * (all-clear → the route sends nothing, matching the daily digest). Buckets:
 *   🛑 failed        — build errored/timed out; run it interactively
 *   ⚠️ blocked       — classifier-held or parked; needs review/release
 *   📝 not planned   — submitted but Hermes never planned it (nothing auto-claims this)
 *   🕒 stale planned — deposited but never picked up (dispatcher may be down)
 *   🔔 awaiting      — built, waiting on your push approval
 */
export function buildStuckJobsDigest(
  rows: StuckRequest[],
  now: Date = new Date(),
): string | null {
  const failed = rows.filter((r) => r.status === 'failed').map(bullet)
  const blocked = rows.filter((r) => r.status === 'blocked').map(bullet)
  const awaiting = rows.filter((r) => r.status === 'awaiting_approval').map(bullet)
  const stalePlanned = rows.filter((r) => isStalePlanned(r, now)).map(bullet)
  const staleUnplanned = rows.filter((r) => isStaleAwaitingPlan(r, now)).map(bullet)

  const sections: string[] = []
  if (failed.length) sections.push(`🛑 FAILED — too big / errored, run here:\n${failed.join('\n')}`)
  if (blocked.length) sections.push(`⚠️ HELD — need review/release:\n${blocked.join('\n')}`)
  if (staleUnplanned.length) sections.push(`📝 NOT PLANNED — waiting on Hermes to plan it:\n${staleUnplanned.join('\n')}`)
  if (stalePlanned.length) sections.push(`🕒 NOT PICKED UP — dispatcher may be down:\n${stalePlanned.join('\n')}`)
  if (awaiting.length) sections.push(`🔔 AWAITING YOUR APPROVAL:\n${awaiting.join('\n')}`)

  if (sections.length === 0) return null

  return [
    '🗂️ Mission Control — jobs needing you',
    '',
    sections.join('\n\n'),
    '',
    "Open a Claude window and say: \"check MC and build the pending jobs\".",
  ].join('\n')
}
