// `npm run rig:wake` must leave mc-dispatcher ONLINE — or say so loudly and fail.
//
// rig-sleep.ps1 stops the pm2 entry and ecosystem.config.cjs sets autorestart:false on
// purpose, so `pm2 resurrect` restores a saved-stopped dispatcher STILL STOPPED. The wake
// path used to end there and log "done": success over a relay that would never build
// anything — the 2026-08-13 shape again, where the thing that reports health is down.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readDispatcher, wakeAction, wakeOk } from '../scripts/lib/rig-wake.mjs'

const jlist = (status: string) =>
  JSON.stringify([{ name: 'mc-dispatcher', pm2_env: { status, restart_time: 0 } }])

describe('readDispatcher', () => {
  it('reads through the "[PM2] Spawning PM2 daemon" banner', () => {
    const state = readDispatcher(`[PM2] Spawning PM2 daemon with pm2_home=...\n${jlist('online')}`)
    expect(state).toEqual({ present: true, status: 'online', restarts: 0 })
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
    expect(wakeAction(readDispatcher(jlist('stopped')))).toBe('restart')
  })

  it('restarts an errored dispatcher too', () => {
    expect(wakeAction(readDispatcher(jlist('errored')))).toBe('restart')
  })

  it('leaves a running dispatcher alone — it may be mid-build', () => {
    expect(wakeAction(readDispatcher(jlist('online')))).toBe('none')
    expect(wakeAction(readDispatcher(jlist('launching')))).toBe('none')
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

describe('rig-boot.ps1', () => {
  const ps1 = readFileSync(fileURLToPath(new URL('../scripts/rig-boot.ps1', import.meta.url)), 'utf8')

  it('acts on the wake decision AFTER resurrecting pm2', () => {
    expect(ps1.indexOf('pm2 resurrect')).toBeLessThan(ps1.indexOf('rig-wake.mjs'))
    expect(ps1).toMatch(/pm2 restart mc-dispatcher/)
  })

  it('starts from ecosystem.config.cjs, never the bare script (keeps autorestart:false)', () => {
    expect(ps1).toMatch(/pm2 start ecosystem\.config\.cjs --only mc-dispatcher/)
    expect(ps1).not.toMatch(/pm2 start scripts[\\/]dispatcher\.mjs/)
  })

  it('fails instead of logging done when the dispatcher is not online', () => {
    expect(ps1).toMatch(/exit 1/)
  })
})
