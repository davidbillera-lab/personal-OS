// Pure builder for the instant "Hermes finished a plan" Telegram ping, fired
// from mc_submit_plan (lib/mcp-tools.ts) the moment a plan lands. No network,
// no Supabase, no clock reads — fully unit-testable, mirroring the style of
// lib/alerts/stuck-jobs.ts.

export function buildPlanReadyMessage(title: string | null, id: string): string {
  const label = (title ?? '').trim() || id
  return [
    '🕒 Plan ready — wake the rig',
    `${label} (${id.slice(0, 8)})`,
    '',
    'Hermes finished planning this one. Run `npm run rig:wake` or log into the rig.',
  ].join('\n')
}
