// Which scope a token resolves to when it appears in MORE THAN ONE key map.
//
// Overlap is a configuration mistake, not an attack — and the likely one is the shortcut:
// pasting MCP_API_KEY into MCP_CHIEF_KEYS because "it already works". The question is which
// way that mistake fails. Widest-first fails SILENTLY OPEN: the chief-of-staff agent quietly
// holds all 40 tools including mc_get_credential, and nothing in the audit log looks unusual
// because the actor still resolves. Narrowest-first fails LOUDLY CLOSED: the full-token
// callers (Claude Code, the dashboard) start getting 403s on their next write, which is
// noticed in minutes.
//
// So resolution runs narrowest-first, and that includes beating the full key. These tests
// drive the real route handler over tools/list, so they judge what a caller can actually
// SEE rather than an internal helper's return value.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const FULL_KEY = 'full-key-0000000000000000'
const OTHER_KEY = 'other-key-111111111111111'

const ENV_VARS = [
  'MCP_API_KEY', 'MCP_CHIEF_KEYS', 'MCP_ORCHESTRATOR_KEYS',
  'MCP_LIAISON_KEYS', 'MCP_READONLY_KEYS', 'MCP_READONLY_API_KEY',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name]
})

afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  vi.resetModules()
})

// route.ts reads its key maps ONCE at module load, so each case needs a fresh import.
async function toolsVisibleTo(bearer: string, env: Partial<Record<(typeof ENV_VARS)[number], string>>) {
  for (const name of ENV_VARS) delete process.env[name]
  Object.assign(process.env, env)
  vi.resetModules()
  const { POST } = await import('@/app/api/mcp/route')
  const req = new NextRequest('https://mission-control.test/api/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  const res = await POST(req)
  const body = await res.json()
  return {
    status: res.status,
    names: (body.result?.tools ?? []).map((t: { name: string }) => t.name) as string[],
    body,
  }
}

// Fingerprints. mc_get_credential is full-only; mc_claim_request is the routing write that
// separates orchestrator from chief; mc_submit_plan is chief's single write.
const isChief = (names: string[]) =>
  names.includes('mc_submit_plan') &&
  !names.includes('mc_claim_request') &&
  !names.includes('mc_get_credential')

describe('overlapping keys resolve to the NARROWER scope', () => {
  it('THE INVARIANT: a key that is both the full key and a chief key resolves to chief', async () => {
    const { names } = await toolsVisibleTo(FULL_KEY, {
      MCP_API_KEY: FULL_KEY,
      MCP_CHIEF_KEYS: JSON.stringify({ hermes: FULL_KEY }),
    })
    expect(isChief(names), 'overlap must resolve down to chief, not up to full').toBe(true)
    expect(names, 'the credential tool is the one that must never leak this way')
      .not.toContain('mc_get_credential')
    expect(names).not.toContain('mc_write_vault')
  })

  it('a key that is both a chief key and an orchestrator key resolves to chief', async () => {
    const { names } = await toolsVisibleTo(OTHER_KEY, {
      MCP_API_KEY: FULL_KEY,
      MCP_CHIEF_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
      MCP_ORCHESTRATOR_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
    })
    expect(isChief(names)).toBe(true)
  })

  it('a key in chief + orchestrator + read still resolves to chief', async () => {
    const { names } = await toolsVisibleTo(OTHER_KEY, {
      MCP_API_KEY: FULL_KEY,
      MCP_CHIEF_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
      MCP_ORCHESTRATOR_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
      MCP_READONLY_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
    })
    expect(isChief(names)).toBe(true)
  })
})

describe('no overlap: every scope still resolves to itself', () => {
  it('the full key alone is still full', async () => {
    const { names } = await toolsVisibleTo(FULL_KEY, { MCP_API_KEY: FULL_KEY })
    expect(names, 'narrowing on overlap must not narrow the clean case')
      .toContain('mc_get_credential')
    expect(names).toContain('mc_claim_request')
  })

  it('the full key stays full when chief keys exist but differ', async () => {
    const { names } = await toolsVisibleTo(FULL_KEY, {
      MCP_API_KEY: FULL_KEY,
      MCP_CHIEF_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
    })
    expect(names).toContain('mc_get_credential')
  })

  it('a chief-only key is chief', async () => {
    const { names } = await toolsVisibleTo(OTHER_KEY, {
      MCP_API_KEY: FULL_KEY,
      MCP_CHIEF_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
    })
    expect(isChief(names)).toBe(true)
  })

  it('an orchestrator-only key keeps its routing writes', async () => {
    const { names } = await toolsVisibleTo(OTHER_KEY, {
      MCP_API_KEY: FULL_KEY,
      MCP_ORCHESTRATOR_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
    })
    expect(names).toContain('mc_claim_request')
    expect(names).not.toContain('mc_get_credential')
  })

  it('an unknown bearer is still rejected outright', async () => {
    const { status } = await toolsVisibleTo('not-a-key', {
      MCP_API_KEY: FULL_KEY,
      MCP_CHIEF_KEYS: JSON.stringify({ hermes: OTHER_KEY }),
    })
    expect(status).toBe(401)
  })
})
