// `npm run rig:wake` must leave mc-dispatcher ONLINE — or say so loudly and fail.
//
// rig-sleep.ps1 stops the pm2 entry and ecosystem.config.cjs sets autorestart:false on
// purpose, so `pm2 resurrect` restores a saved-stopped dispatcher STILL STOPPED. The wake
// path used to end there and log "done": success over a relay that would never build
// anything — the 2026-08-13 shape again, where the thing that reports health is down.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ecosystemDefinition, readDispatcher, staleKeys, wakeAction, wakeOk,
} from '../scripts/lib/rig-wake.mjs'

const current = ecosystemDefinition()

/** A pm2 entry whose definition matches ecosystem.config.cjs as it stands today. */
const jlist = (status: string, pm2_env: Record<string, unknown> = {}) =>
  JSON.stringify([{
    name: 'mc-dispatcher',
    pm2_env: {
      status,
      restart_time: 0,
      autorestart: current.autorestart,
      ...current.env,
      ...pm2_env,
    },
  }])

/** What the live rig actually had: a dump saved before the on-demand relay existed. */
const STALE_PRE_ON_DEMAND = {
  autorestart: true,
  DISPATCHER_IDLE_SLEEP_MS: undefined,
  DISPATCHER_SLEEP_TEARDOWN: undefined,
  DISPATCHER_CLAIM_PLANNED: undefined,
}

describe('readDispatcher', () => {
  it('reads through the "[PM2] Spawning PM2 daemon" banner', () => {
    const state = readDispatcher(`[PM2] Spawning PM2 daemon with pm2_home=...\n${jlist('online')}`)
    expect(state).toMatchObject({ present: true, status: 'online', restarts: 0 })
  })

  it('reports absence as absence, not as health', () => {
    expect(readDispatcher(JSON.stringify([{ name: 'something-else' }]))?.present).toBe(false)
  })

  it('returns null when the state cannot be read — unknown is not "fine"', () => {
    for (const junk of ['', 'pm2: command not found', '[not json']) {
      expect(readDispatcher(junk), junk).toBeNull()
    }
  })
})

describe('wakeAction', () => {
  it('THE REGRESSION: a resurrected-but-stopped dispatcher must be started', () => {
    // pm2 resurrect brings the saved entry back stopped and autorestart:false leaves it
    // there. Doing nothing here is what made rig:wake report done over a dead relay.
    expect(wakeAction(readDispatcher(jlist('stopped')))).toBe('reconcile')
  })

  it('restarts an errored dispatcher too', () => {
    expect(wakeAction(readDispatcher(jlist('errored')))).toBe('reconcile')
  })

  it('THE SECOND REGRESSION: a STALE stopped entry reconciles, it does not just restart', () => {
    // The live rig's saved entry was stopped AND pre-on-demand. `pm2 restart` would have
    // re-launched autorestart:true with no idle sleep — a dispatcher that never sleeps and
    // that pm2 restarts back out of every rig-sleep. 'reconcile' means: delete the saved
    // definition, start from ecosystem.config.cjs, save.
    const stale = readDispatcher(jlist('stopped', STALE_PRE_ON_DEMAND))
    expect(staleKeys(stale).length).toBeGreaterThan(0)
    expect(wakeAction(stale)).toBe('reconcile')
  })

  it('leaves a running dispatcher alone — it may be mid-build', () => {
    expect(wakeAction(readDispatcher(jlist('online')))).toBe('none')
    expect(wakeAction(readDispatcher(jlist('launching')))).toBe('none')
  })

  it('leaves an ONLINE dispatcher alone even when its definition is stale', () => {
    // Stale-and-running still builds; killing it to fix the env would kill the build. It
    // reconciles on the next sleep/wake. `verify` warns so it is not silently stale.
    expect(wakeAction(readDispatcher(jlist('online', STALE_PRE_ON_DEMAND)))).toBe('none')
  })

  it('starts from config when there is no entry, or no readable state', () => {
    expect(wakeAction(readDispatcher(JSON.stringify([])))).toBe('start')
    expect(wakeAction(null)).toBe('start')
  })
})

describe('wakeOk', () => {
  it('only an online dispatcher counts as awake', () => {
    expect(wakeOk(readDispatcher(jlist('online')))).toBe(true)
    for (const status of ['stopped', 'errored', 'launching', 'stopping', 'unknown']) {
      expect(wakeOk(readDispatcher(jlist(status))), status).toBe(false)
    }
    expect(wakeOk(readDispatcher(JSON.stringify([])))).toBe(false)
    expect(wakeOk(null)).toBe(false)
  })
})

describe('staleKeys', () => {
  it('names every setting the pre-on-demand dump is missing', () => {
    const keys = staleKeys(readDispatcher(jlist('stopped', STALE_PRE_ON_DEMAND)))
    expect(keys).toEqual(expect.arrayContaining([
      'autorestart', 'DISPATCHER_IDLE_SLEEP_MS', 'DISPATCHER_SLEEP_TEARDOWN', 'DISPATCHER_CLAIM_PLANNED',
    ]))
  })

  it('an entry matching ecosystem.config.cjs is not stale', () => {
    expect(staleKeys(readDispatcher(jlist('online')))).toEqual([])
    expect(staleKeys(readDispatcher(jlist('stopped')))).toEqual([])
  })

  it('tracks the config file, so a new toggle cannot be silently missing from the dump', () => {
    // The expectation is derived from ecosystem.config.cjs, never a hardcoded copy.
    expect(Object.keys(current.env)).toContain('DISPATCHER_IDLE_SLEEP_MS')
    expect(current.autorestart).toBe(false)
    expect(staleKeys(readDispatcher(jlist('stopped', { NEW_TOGGLE: undefined })),
      { autorestart: false, env: { NEW_TOGGLE: '1' } })).toEqual(expect.arrayContaining(['NEW_TOGGLE']))
  })

  it('says nothing about an absent or unreadable entry — that is wakeAction\'s job', () => {
    expect(staleKeys(readDispatcher(JSON.stringify([])))).toEqual([])
    expect(staleKeys(null)).toEqual([])
  })

  it('flags a live DISPATCHER_* key ecosystem.config.cjs no longer defines', () => {
    // A toggle removed from the config still lingers in an old saved dump. That is stale
    // too, not just the reverse case (a config key missing from the dump).
    const state = readDispatcher(jlist('stopped', { DISPATCHER_RETIRED_TOGGLE: 'true' }))
    expect(staleKeys(state)).toEqual(expect.arrayContaining(['DISPATCHER_RETIRED_TOGGLE']))
  })

  it('ignores unrelated inherited environment keys — only DISPATCHER_* counts as stale', () => {
    // pm2_env carries the whole inherited process environment (PATH, USERNAME, ...). None
    // of that is part of the dispatcher's contract with ecosystem.config.cjs.
    const state = readDispatcher(jlist('stopped', { USERNAME: 'svc-account', PATH: 'C:\\Windows' }))
    expect(staleKeys(state)).toEqual([])
  })
})

describe('rig-boot.ps1', () => {
  const ps1 = readFileSync(fileURLToPath(new URL('../scripts/rig-boot.ps1', import.meta.url)), 'utf8')
  // Assert on what the script RUNS. Comments explain the very commands being banned below,
  // so matching the raw file would pass or fail on prose.
  const code = ps1.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  const at = (needle: RegExp) => code.search(needle)

  it('acts on the wake decision AFTER resurrecting pm2', () => {
    expect(at(/pm2 resurrect/)).toBeLessThan(at(/rig-wake\.mjs/))
    expect(code).toMatch(/'reconcile' \{/)
  })

  it('THE FIX: reconcile deletes the stale definition, then starts from the config, then saves', () => {
    const del = at(/pm2 delete mc-dispatcher/)
    const start = at(/pm2 start ecosystem\.config\.cjs --only mc-dispatcher/)
    const save = code.indexOf('pm2 save', start)
    expect(del).toBeGreaterThan(at(/'reconcile' \{/))
    expect(del).toBeLessThan(start)
    expect(save).toBeGreaterThan(start)
  })

  it('never restarts the saved definition — that is what re-launched the stale env', () => {
    // `pm2 restart` (with or without --update-env) re-launches pm2's stored definition and
    // never reads ecosystem.config.cjs. It is the bug, not the fix.
    expect(code).not.toMatch(/pm2 restart mc-dispatcher/)
    expect(code).not.toMatch(/--update-env/)
  })

  it('starts from ecosystem.config.cjs, never the bare script (keeps autorestart:false)', () => {
    expect(code).toMatch(/pm2 start ecosystem\.config\.cjs --only mc-dispatcher/)
    expect(code).not.toMatch(/pm2 start scripts[\\/]dispatcher\.mjs/)
  })

  it('persists the corrected dump on every path that starts something', () => {
    // Two start paths (reconcile + start-from-absent); each must `pm2 save` or the next
    // resurrect brings the stale definition straight back.
    expect(code.match(/Invoke-Pm2Step 'pm2 start ecosystem\.config\.cjs --only mc-dispatcher'/g)).toHaveLength(2)
    expect(code.match(/Invoke-Pm2Step 'pm2 save'/g)).toHaveLength(2)
  })

  it('does not touch pm2 at all on the already-online path', () => {
    expect(code.slice(at(/'none' \{/), at(/'reconcile' \{/))).not.toMatch(/pm2 (start|restart|delete|stop)/)
  })

  it('fails instead of logging done when the dispatcher is not online', () => {
    expect(code).toMatch(/exit 1/)
  })

  describe('pm2 delete/start/save failures cannot fall through to success', () => {
    // Codex QC on 57a3cec: reconcile/start ran pm2 delete/start/save without ever checking
    // whether they succeeded, so a failed `pm2 save` (stale dump persists) could still end
    // in the already-online verify check reporting overall success. These assertions are
    // static/textual on purpose — no live pm2 daemon is invoked to prove the control-flow
    // shape below.
    const stepFn = code.match(/function Invoke-Pm2Step[\s\S]*?\n\}/)?.[0] ?? ''

    it('defines a step wrapper', () => {
      expect(stepFn).not.toBe('')
    })

    it('captures $LASTEXITCODE on the line immediately after the native call — before any other native command can overwrite it', () => {
      const callAt = stepFn.search(/\$output\s*=\s*cmd \/c \$cmdLine/)
      const captureAt = stepFn.search(/\$exit\s*=\s*\$LASTEXITCODE/)
      expect(callAt).toBeGreaterThan(-1)
      expect(captureAt).toBeGreaterThan(callAt)
      // The capture is the immediately following statement, so no native call can overwrite it.
      expect(stepFn).toMatch(/\$output\s*=\s*cmd \/c \$cmdLine 2>&1\s*\$exit\s*=\s*\$LASTEXITCODE/)
    })

    it('logs bounded output regardless of outcome, then fails nonzero with an actionable line on failure', () => {
      expect(stepFn).toMatch(/Select-Object -First \$maxLines/)
      expect(stepFn).toMatch(/if \(\$exit -ne 0\)/)
      expect(stepFn).toMatch(/exit 1/)
      // actionable: names the failing step and where to look, not just "failed"
      expect(stepFn).toMatch(/\$desc exited \$exit/)
      expect(stepFn).toMatch(/pm2 logs mc-dispatcher/)
    })

    it('routes every pm2 delete/start/save call through the checked wrapper, not a raw unchecked pipe', () => {
      expect(code.match(/Invoke-Pm2Step 'pm2 delete mc-dispatcher'/g)).toHaveLength(1)
      expect(code.match(/Invoke-Pm2Step 'pm2 start ecosystem\.config\.cjs --only mc-dispatcher'/g)).toHaveLength(2)
      expect(code.match(/Invoke-Pm2Step 'pm2 save'/g)).toHaveLength(2)
      // the old shape — output piped straight into logging with no exit-code gate at all —
      // must be gone for every mutating pm2 call; a failed step must not look identical to
      // a successful one.
      expect(code).not.toMatch(/cmd \/c "npx pm2 (delete mc-dispatcher|start ecosystem\.config\.cjs[^"]*|save)" 2>&1 \| Select-Object/)
    })

    it('preserves the original bounded line counts per step (delete/save: 3, start: 8)', () => {
      expect(code).toMatch(/Invoke-Pm2Step 'pm2 delete mc-dispatcher' 'npx pm2 delete mc-dispatcher' 3/)
      expect(code.match(/Invoke-Pm2Step 'pm2 start ecosystem\.config\.cjs --only mc-dispatcher' 'npx pm2 start ecosystem\.config\.cjs --only mc-dispatcher' 8/g)).toHaveLength(2)
      expect(code.match(/Invoke-Pm2Step 'pm2 save' 'npx pm2 save' 3/g)).toHaveLength(2)
    })

    it('does not touch pm2 at all on the already-online path (unchanged by this fix)', () => {
      expect(code.slice(at(/'none' \{/), at(/'reconcile' \{/))).not.toMatch(/pm2 (start|restart|delete|stop)/)
      expect(code.slice(at(/'none' \{/), at(/'reconcile' \{/))).not.toMatch(/Invoke-Pm2Step/)
    })
  })
})
