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
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'mc-dispatcher'

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
  }
}

/** Is the rig awake? Only a running dispatcher counts; everything else is a failed wake. */
export function wakeOk(state) {
  return !!state && state.present === true && state.status === 'online'
}

/**
 * What must the wake path do to get there?
 *   'none'    — online, or launching: leave it alone. It may be mid-build, and a build runs
 *               in a blocking spawn, so restarting it would kill work in flight.
 *   'restart' — present but stopped/errored: the resurrect-leaves-it-stopped case, i.e.
 *               every normal wake after an idle sleep.
 *   'start'   — no entry at all, or no readable state: start FROM ecosystem.config.cjs,
 *               which is what carries autorestart:false and the idle-sleep env. Never
 *               `pm2 start scripts/dispatcher.mjs`, which silently restores autorestart:true.
 */
export function wakeAction(state) {
  if (!state || !state.present) return 'start'
  if (state.status === 'online' || state.status === 'launching') return 'none'
  return 'restart'
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
    process.exitCode = wakeOk(state) ? 0 : 1
  })
}
