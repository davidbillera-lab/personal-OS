// Pure builder for the instant "Hermes finished a plan" Telegram ping, fired
// from mc_submit_plan (lib/mcp-tools.ts) the moment a plan lands. No network,
// no Supabase, no clock reads — fully unit-testable, mirroring the style of
// lib/alerts/stuck-jobs.ts.

// Telegram rejects messages over 4096 chars; a title is DB/operator content,
// not adversarial, but cost-free to cap defensively.
const MAX_TITLE_LENGTH = 200

export function buildPlanReadyMessage(title: string | null, id: string): string {
  const trimmed = (title ?? '').trim()
  const shortId = id.slice(0, 8)
  const label = trimmed
    ? `${trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}…` : trimmed} (${shortId})`
    : `Request ${shortId}`
  return [
    '🕒 Plan ready — wake the rig',
    label,
    '',
    'Hermes finished planning this one. Run `npm run rig:wake` or log into the rig.',
  ].join('\n')
}
