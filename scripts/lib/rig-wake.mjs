// Wake decision for the Mission Control rig: after `pm2 resurrect`, is mc-dispatcher
// actually running — and if not, what should the wake path do about it?
//
// WHY THIS EXISTS
// rig-sleep.ps1 stops the pm2 entry when the rig goes idle, and ecosystem.config.cjs sets
// autorestart:false deliberately (a crash-loop against a dead Docker is the exact nagging
// the on-demand design exists to prevent). `pm2 resurrect` restores the SAVED state, so a
// saved-stopped dispatcher comes back stopped and stays stopped. rig-boot.ps1 ended there
// and still logged 'done': `npm run rig:wake` returned success over a relay that would never
// claim a row — the same failure shape as 2026-08-13, where the thing that reports health
// was the thing that was down.
//
// The decision is pure so the wake contract is testable without a pm2 daemon and without
// starting a live dispatcher (tests/rig-wake.test.ts). rig-boot.ps1 pipes `pm2 jlist` into
// the CLI at the bottom and does what it says. node parses, not PowerShell: 5.1's
// ConvertFrom-Json is case-insensitive about keys and throws on pm2's env dump, which
// carries both `username` and `USERNAME`.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'mc-dispatcher'

/**
 * The definition the wake path must converge on: whatever ecosystem.config.cjs says TODAY.
 * Read from the file rather than duplicated here, so this never drifts from the config.
 */
export function ecosystemDefinition() {
  const app = createRequire(import.meta.url)('../../ecosystem.config.cjs')
    .apps.find(a => a.name === NAME)
  return { autorestart: app.autorestart, env: app.env }
}

/**
 * Which parts of the LIVE pm2 definition no longer match ecosystem.config.cjs?
 *
 * pm2 keeps a process DEFINITION, not just a process. A dump saved before the on-demand
 * relay landed carries autorestart:true and no DISPATCHER_IDLE_SLEEP_MS, and `pm2 restart`
 * re-launches THAT — the config file is never consulted. A dispatcher woken from a stale
 * definition would never sleep, and pm2 would fight rig-sleep.ps1 by restarting it. Returns
 * the differing keys; empty means the live entry is current.
 *
 * Checks both directions: a config key missing/changed on the live side (below), AND a live
 * DISPATCHER_* key ecosystem.config.cjs no longer defines at all — a toggle that was removed
 * from the config still lingers in an old saved dump otherwise. Scoped to DISPATCHER_* only:
 * pm2_env also carries the whole inherited process environment (PATH, USERNAME, ...), and
 * flagging every one of those as "stale" would drown the real signal in noise.
 */
export function staleKeys(state, expected = ecosystemDefinition()) {
  if (!state || !state.present) return []
  const keys = state.autorestart !== expected.autorestart ? ['autorestart'] : []
  // pm2_env carries the process env flattened alongside pm2's own metadata.
  for (const [k, v] of Object.entries(expected.env ?? {})) {
    if (state.env?.[k] !== String(v)) keys.push(k)
  }
  for (const k of Object.keys(state.env ?? {})) {
    if (k.startsWith('DISPATCHER_') && !(k in (expected.env ?? {}))) keys.push(k)
  }
  return keys
}

/**
 * Pull mc-dispatcher's entry out of `pm2 jlist` output.
 * Tolerates the "[PM2] Spawning PM2 daemon…" banner pm2 prints before the JSON when the
 * daemon was gone. Returns null when the state could not be read at all — unknown is not
 * the same as healthy, and never treated as such.
 */
export function readDispatcher(jlistText) {
  const text = typeof jlistText === 'string' ? jlistText : ''
  // Anchor on the array itself (`[{` or `[]`), not on the first `[` — the banner IS
  // `[PM2] Spawning…`, so first-bracket parsing chokes on exactly the case it was meant
  // to survive: a pm2 daemon that had to be respawned, i.e. a rig that was fully down.
  const start = /\[\s*(?:\{|\])/.exec(text)
  if (!start) return null
  let list
  try { list = JSON.parse(text.slice(start.index)) } catch { return null }
  if (!Array.isArray(list)) return null
  const proc = list.find(p => p && p.name === NAME)
  if (!proc) return { present: false, status: 'absent', restarts: 0 }
  return {
    present: true,
    status: proc.pm2_env?.status ?? 'unknown',
    restarts: proc.pm2_env?.restart_time ?? 0,
    autorestart: proc.pm2_env?.autorestart ?? null,
    env: proc.pm2_env ?? {},
  }
}

/** Is the rig awake? Only a running dispatcher counts; everything else is a failed wake. */
export function wakeOk(state) {
  return !!state && state.present === true && state.status === 'online'
}

/**
 * What must the wake path do to get there?
 *   'none'      — online, or launching: leave it alone. It may be mid-build, and a build runs
 *                 in a blocking spawn, so restarting it would kill work in flight. (Even if
 *                 its definition is stale — see staleKeys; that is a warning, not a reason to
 *                 kill a build. It reconciles on the next sleep/wake cycle.)
 *   'reconcile' — present but stopped/errored: the resurrect-leaves-it-stopped case, i.e.
 *                 every normal wake after an idle sleep. DELETE the saved definition and
 *                 start again FROM ecosystem.config.cjs. `pm2 restart` — even with
 *                 --update-env — re-launches the stored definition, which on this rig is a
 *                 pre-on-demand dump (autorestart:true, no idle-sleep env). Nothing running
 *                 is lost: it is stopped, by definition.
 *   'start'     — no entry at all, or no readable state: start FROM ecosystem.config.cjs.
 *                 No delete here — if the state was unreadable the dispatcher could still be
 *                 up and mid-build, and pm2 refusing "already launched" is the safe outcome.
 *
 * Both non-'none' paths start from ecosystem.config.cjs, never `pm2 start
 * scripts/dispatcher.mjs` (which silently restores autorestart:true), and both must be
 * followed by `pm2 save` so the corrected definition survives the next resurrect.
 */
export function wakeAction(state) {
  if (!state || !state.present) return 'start'
  if (state.status === 'online' || state.status === 'launching') return 'none'
  return 'reconcile'
}

// ---- CLI: `npx pm2 jlist | node scripts/lib/rig-wake.mjs action|verify` ----
// Guarded on entrypoint so importing this module never reads stdin or sets an exit code.
const isEntrypoint = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  } catch { return false }
})()

if (isEntrypoint) {
  const mode = process.argv[2]
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { raw += chunk })
  process.stdin.on('end', () => {
    const state = readDispatcher(raw)
    if (mode === 'action') { console.log(wakeAction(state)); return }
    // verify: one line for rig-boot.log, and the exit code carries the verdict.
    console.log(!state ? 'pm2 state unreadable'
      : !state.present ? `${NAME} NOT in pm2`
      : `${NAME} status=${state.status} restarts=${state.restarts}`)
    // A stale definition that is nonetheless ONLINE is not a failed wake — the relay works,
    // it just won't sleep. Say so instead of leaving it silent; it reconciles next wake.
    const stale = staleKeys(state)
    if (stale.length) console.log(`WARNING: ${NAME} definition is stale vs ecosystem.config.cjs: ${stale.join(', ')}`)
    process.exitCode = wakeOk(state) ? 0 : 1
  })
}
