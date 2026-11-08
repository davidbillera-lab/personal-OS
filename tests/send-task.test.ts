import { describe, expect, it, vi } from 'vitest'

const { admin } = vi.hoisted(() => ({ admin: { client: undefined as unknown } }))
vi.mock('@/lib/supabase', () => ({ createAdminSupabaseClient: () => admin.client }))
vi.mock('@/lib/owner', () => ({ requireOwner: async () => 'owner-1' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/models/router', () => ({ routeTask: vi.fn() }))
vi.mock('@/lib/classify', () => ({ classifyBrainDump: vi.fn() }))
vi.mock('@/lib/vault', () => ({ captureToVault: vi.fn() }))

import { sendTaskToAgent } from '../app/(app)/projects/[id]/actions'

const TASK = '0b7c2b1e-4c1a-4f7e-9d2a-1f3e5a7c9b11'
const PROJECT = '5d2e8f4a-6b3c-4e1d-8a9f-2c4b6d8e0f13'
type Row = Record<string, unknown>

// Minimal PostgREST-like chains over in-memory tables; beforeTaskUpdate runs once, just before the guarded task write.
function fakeDb(beforeTaskUpdate: (tables: Record<string, Row[]>) => void) {
  const tables: Record<string, Row[]> = {
    tasks: [{ id: TASK, project_id: PROJECT, title: 'T', status: 'spec_review', generated_spec: '# spec' }],
    projects: [{ id: PROJECT, name: 'P', repo_url: null }],
    mc_requests: [],
    mcp_audit_log: [],
  }
  let hooked = false
  const from = (t: string) => {
    const preds: [string, unknown][] = []
    let op: { kind: 'select' | 'update' | 'insert'; payload?: Row } = { kind: 'select' }
    const run = async () => {
      if (op.kind === 'insert') { const r = { id: `req-${tables[t].length + 1}`, ...op.payload }; tables[t].push(r); return { data: r, error: null } }
      if (op.kind === 'update' && t === 'tasks' && !hooked) { hooked = true; beforeTaskUpdate(tables) }
      const hit = tables[t].find(r => preds.every(([c, v]) => r[c] === v))
      if (hit && op.kind === 'update') Object.assign(hit, op.payload)
      return { data: hit ?? null, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { preds.push([c, v]); return b },
      update: (p: Row) => { op = { kind: 'update', payload: p }; return b },
      insert: (p: Row) => { op = { kind: 'insert', payload: p }; if (t === 'mcp_audit_log') tables[t].push(p); return t === 'mcp_audit_log' ? Promise.resolve({ error: null }) : b },
      single: run,
      maybeSingle: run,
    }
    return b
  }
  admin.client = { from }
  return tables
}

describe('sendTaskToAgent', () => {
  it('cancels the new request when the task is closed between the read and the task update', async () => {
    const tables = fakeDb(t => { t.tasks[0].status = 'killed' })
    const res = await sendTaskToAgent(TASK, PROJECT, 'codex')
    expect(res).toMatchObject({ ok: false, error: 'Task was closed while sending; the request was cancelled.', requestId: 'req-1' })
    expect(tables.mc_requests[0].status).toBe('cancelled')
    expect(tables.tasks[0].status).toBe('killed')
    expect(tables.mcp_audit_log.at(-1)).toMatchObject({ ok: false, request_id: 'req-1' })
  })

  it('a plain send moves the task to in_progress and leaves the request queued', async () => {
    const tables = fakeDb(() => {})
    const res = await sendTaskToAgent(TASK, PROJECT, 'codex')
    expect(res).toEqual({ ok: true, requestId: 'req-1' })
    expect(tables.mc_requests[0].status).toBe('queued')
    expect(tables.tasks[0]).toMatchObject({ status: 'in_progress', agent_assigned_to: 'codex' })
  })
})
