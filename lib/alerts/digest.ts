// Pure, deterministic builder for the daily Mission Control health digest.
// No Supabase, no network, no clock reads except the injected `now` — so it is
// fully unit-testable. The route layer (app/api/alerts/digest) supplies rows
// and delivers the returned string to Telegram.

export interface DigestProject {
  name: string
  tier: number
  stage: string
  status: string | null
  kill_criteria_status: string | null
  blockers: string | null
  last_update: string
  next_action: string | null
}

const STALE_MS = 14 * 24 * 60 * 60 * 1000

const clean = (s: string | null | undefined): string => (s ?? '').trim()
// Collapse internal line breaks so each project occupies exactly one bullet.
const oneLine = (s: string | null | undefined): string => clean(s).replace(/\s+/g, ' ')

// Strictly older than 14 days AND still carrying a next action. Invalid or
// unparseable timestamps are never treated as stale (fail safe, not noisy).
function isStale(p: DigestProject, now: Date): boolean {
  if (!clean(p.next_action)) return false
  const t = Date.parse(p.last_update)
  if (Number.isNaN(t)) return false
  return now.getTime() - t > STALE_MS
}

const byTierThenName = (a: DigestProject, b: DigestProject): number =>
  a.tier - b.tier || a.name.localeCompare(b.name)

const bullet = (p: DigestProject, detail: string): string =>
  `• [T${p.tier}] ${p.name} — ${detail}`

/**
 * Build the digest message, or return null when nothing is actionable
 * (all-clear → the route sends nothing). Killed projects are excluded from
 * every bucket. A project may appear in more than one bucket.
 */
export function buildProjectDigest(
  projects: DigestProject[],
  now: Date = new Date(),
): string | null {
  const live = projects.filter((p) => p.stage !== 'kill')

  const killRisk = live
    .filter((p) => p.kill_criteria_status === 'fail')
    .sort(byTierThenName)
    .map((p) => bullet(p, clean(p.status) || 'kill criteria failing'))

  const blocked = live
    .filter((p) => clean(p.blockers) !== '')
    .sort(byTierThenName)
    .map((p) => bullet(p, oneLine(p.blockers)))

  const stale = live
    .filter((p) => isStale(p, now))
    .sort(byTierThenName)
    .map((p) => bullet(p, `Next: ${oneLine(p.next_action)}`))

  const sections: string[] = []
  if (killRisk.length) sections.push(`🔴 KILL RISK\n${killRisk.join('\n')}`)
  if (blocked.length) sections.push(`⛔ BLOCKED\n${blocked.join('\n')}`)
  if (stale.length) sections.push(`🕰 STALE >14 DAYS\n${stale.join('\n')}`)

  if (sections.length === 0) return null

  return `🚨 Mission Control Daily Digest\n\n${sections.join('\n\n')}`
}
