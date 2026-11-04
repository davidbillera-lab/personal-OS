import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// Fake admin client that records every query-builder call, so the test can see which filters ran.
const { admin, calls } = vi.hoisted(() => {
  const calls: unknown[][] = []
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'order', 'range']) {
    b[m] = (...a: unknown[]) => { calls.push([m, ...a]); return b }
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  const admin = vi.fn(() => ({ from: (t: string) => { calls.push(['from', t]); return b } }))
  return { admin, calls }
})

vi.mock('@/lib/supabase', () => ({ createAdminSupabaseClient: admin }))

import { callTool } from '@/lib/mcp-tools'

describe('mc_browse_vault hides items not marked MCP-accessible', () => {
  it('lib/mcp-tools.ts filters on is_mcp_accessible = true', async () => {
    await callTool('mc_browse_vault', { type: 'knowledge' })
    expect(calls).toContainEqual(['from', 'vault_items'])
    expect(calls).toContainEqual(['eq', 'is_mcp_accessible', true])
  })

  // mcp-server.mjs starts a stdio server on import, so check its source instead of running it.
  it('mcp-server.mjs applies the same filter', () => {
    const src = readFileSync(new URL('../mcp-server.mjs', import.meta.url), 'utf8')
    const block = src.split("if (name === 'mc_browse_vault')")[1]?.split('if (name ===')[0] ?? ''
    expect(block).toContain(".eq('is_mcp_accessible', true)")
  })
})
