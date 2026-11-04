import { afterEach, describe, expect, it, vi } from 'vitest'

const { getUser, admin } = vi.hoisted(() => ({ getUser: vi.fn(), admin: { client: undefined as unknown } }))

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => admin.client,
}))

import { callTool } from '@/lib/mcp-tools'
import { requireOwner } from '@/lib/owner'
import {
  applyOwnerAction,
  CONFLICT_MESSAGE,
  OWNER_WORKERS,
  planOwnerClose,
  planOwnerReassign,
  planOwnerReopen,
  validateEvidence,
  validateReason,
  validateRequestId,
  type OwnerRequestRow,
} from '@/lib/owner-requests'
import { isClaimablePlanned, isDispatcherRow } from '../scripts/lib/planned-claim.mjs'

const NOW = new Date('2026-11-03T12:00:00.000Z')
const STATUSES = ['submitted', 'queued', 'claimed', 'in_progress', 'blocked', 'awaiting_approval', 'completed', 'failed', 'cancelled']

const row = (over: Partial<OwnerRequestRow> = {}): OwnerRequestRow => ({
  id: '13df18cf-8d09-4fac-ae35-245131b0685f',
  status: 'queued',
  updated_at: '2026-11-03T10:00:00.123456+00:00',
  assigned_to: null,
  attempt_id: null,
  phase: null,
  plan: null,
  plan_submitted_at: null,
  plan_by: null,
  blocker: null,
  result_summary: null,
  approval_required: false,
  reviewed_sha: null,
  workspace_ref: null,
  ...over,
})

describe('requireOwner', () => {
  const saved = process.env.MC_OWNER_USER_ID
  afterEach(() => {
    if (saved === undefined) delete process.env.MC_OWNER_USER_ID
    else process.env.MC_OWNER_USER_ID = saved
    getUser.mockReset()
  })

  it('throws when the owner variable is unset', async () => {
    delete process.env.MC_OWNER_USER_ID
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('throws when the owner variable is empty', async () => {
    process.env.MC_OWNER_USER_ID = ''
    getUser.mockResolvedValue({ data: { user: { id: '' } }, error: null })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('throws on mismatch, without echoing either id', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: { id: 'other-2' } }, error: null })
    await expect(requireOwner()).rejects.toThrow(/^Not authorized$/)
  })

  it('throws when there is no user', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('throws when getUser errors', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: { message: 'boom' } })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('returns the userId on match', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null })
    await expect(requireOwner()).resolves.toEqual({ actor: 'owner', userId: 'owner-1' })
  })
})

describe('planOwnerClose', () => {
  it('refuses a claim with a dispatcher run in flight', () => {
    const r = planOwnerClose(row({ status: 'claimed', attempt_id: 'a1', updated_at: '2026-11-03T01:00:00Z' }), 'cancelled', 'x', undefined, NOW)
    expect(r).toMatchObject({ ok: false })
    expect((r as { reason: string }).reason).toMatch(/dispatcher run is in flight/)
  })

  it('refuses a fresh interactive claim, allows a stale one', () => {
    for (const status of ['claimed', 'in_progress']) {
      const fresh = planOwnerClose(row({ status, updated_at: '2026-11-03T10:30:00Z' }), 'cancelled', 'x', undefined, NOW)
      expect(fresh.ok).toBe(false)
      expect((fresh as { reason: string }).reason).toMatch(/less than 2 h/)
      expect(planOwnerClose(row({ status, updated_at: '2026-11-03T09:59:00Z' }), 'cancelled', 'x', undefined, NOW).ok).toBe(true)
    }
  })

  it('works for awaiting_approval with a null attempt', () => {
    expect(planOwnerClose(row({ status: 'awaiting_approval' }), 'cancelled', 'x', undefined, NOW).ok).toBe(true)
  })

  it('refuses terminal rows', () => {
    for (const status of ['completed', 'cancelled']) {
      expect(planOwnerClose(row({ status }), 'cancelled', 'x', undefined, NOW).ok).toBe(false)
    }
  })

  it('builds the closing update and detail', () => {
    const r = planOwnerClose(row({ blocker: 'b', phase: 'planned', attempt_id: null }), 'completed', ' done ', 'proof', NOW)
    expect(r).toMatchObject({
      ok: true,
      updates: {
        status: 'completed',
        result_summary: 'Closed by owner: done\nEvidence: proof',
        blocker: null,
        phase: null,
        attempt_id: null,
        approval_required: false,
        completed_at: NOW.toISOString(),
      },
      detail: { from_status: 'queued', to_status: 'completed', reason: 'done', evidence: 'proof' },
    })
    const c = planOwnerClose(row(), 'cancelled', 'no', undefined, NOW)
    expect(c.ok && 'completed_at' in c.updates).toBe(false)
  })

  it('rejects bad input', () => {
    expect(planOwnerClose(row(), 'cancelled', '  ', undefined, NOW).ok).toBe(false)
    expect(planOwnerClose(row(), 'cancelled', 'x', 'e'.repeat(2001), NOW).ok).toBe(false)
  })
})

describe('planOwnerReopen', () => {
  it('only reopens terminal-ish rows and never yields queued/submitted', () => {
    for (const status of STATUSES) {
      const r = planOwnerReopen(row({ status, plan: 'p', plan_by: 'hermes', plan_submitted_at: 't' }), 'why')
      if (['completed', 'cancelled', 'failed'].includes(status)) {
        expect(r).toMatchObject({
          ok: true,
          updates: {
            status: 'blocked',
            blocker: 'owner-hold: reopened by owner: why',
            plan: null, plan_by: null, plan_submitted_at: null, phase: null, attempt_id: null, completed_at: null,
            approval_required: false,
          },
          detail: { old_plan: 'p', old_plan_by: 'hermes', old_plan_submitted_at: 't' },
        })
        expect((r as { updates: Record<string, unknown> }).updates).not.toHaveProperty('result_summary')
      } else {
        expect(r.ok).toBe(false)
      }
    }
  })
})

describe('planOwnerReassign', () => {
  it('refuses claimed/in_progress/awaiting_approval/terminal rows', () => {
    for (const status of ['claimed', 'in_progress', 'awaiting_approval', 'completed', 'failed', 'cancelled']) {
      expect(planOwnerReassign(row({ status, assigned_to: 'codex' }), 'claude').ok).toBe(false)
    }
  })

  it('refuses unknown workers and no-ops', () => {
    expect(planOwnerReassign(row({ assigned_to: 'codex' }), 'bogus' as never).ok).toBe(false)
    expect(planOwnerReassign(row({ assigned_to: 'codex' }), 'codex').ok).toBe(false)
    expect(planOwnerReassign(row({ assigned_to: null }), null).ok).toBe(false)
  })

  it('explains the dispatcher refusal', () => {
    const r = planOwnerReassign(row({ status: 'queued', assigned_to: 'codex' }), 'claude')
    expect(r).toEqual({ ok: false, reason: 'Reassigning would let the rig run this' })
  })

  it('never yields a row matching either dispatcher predicate', () => {
    const variants: Partial<OwnerRequestRow>[] = [
      {}, { phase: 'planned', plan: 'p' }, { phase: 'planned', plan: null }, { phase: 'review', plan: 'p' },
    ]
    for (const status of STATUSES) {
      for (const v of variants) {
        for (const from of [...OWNER_WORKERS, 'codex-qc']) {
          for (const to of OWNER_WORKERS) {
            const before = row({ ...v, status, assigned_to: from })
            const r = planOwnerReassign(before, to)
            if (!r.ok) continue
            const after = { ...before, ...r.updates }
            expect(after.status === 'queued' && isDispatcherRow(after)).toBe(false)
            expect(isClaimablePlanned(after, true)).toBe(false)
            expect(r.updates).toEqual({ assigned_to: to })
          }
        }
      }
    }
  })

  it('allows a safe reassign', () => {
    expect(planOwnerReassign(row({ status: 'queued', assigned_to: null }), 'codex')).toMatchObject({
      ok: true,
      updates: { assigned_to: 'codex' },
      detail: { from_assigned: null, to_assigned: 'codex' },
    })
  })
})

describe('input validation', () => {
  it('reason limits', () => {
    expect(() => validateReason('')).toThrow()
    expect(() => validateReason('   ')).toThrow()
    expect(validateReason('a')).toBe('a')
    expect(validateReason('a'.repeat(1000))).toHaveLength(1000)
    expect(() => validateReason('a'.repeat(1001))).toThrow()
  })
  it('evidence limits', () => {
    expect(validateEvidence(undefined)).toBe('')
    expect(validateEvidence('e'.repeat(2000))).toHaveLength(2000)
    expect(() => validateEvidence('e'.repeat(2001))).toThrow()
  })
  it('request id must be a uuid', () => {
    expect(validateRequestId('13df18cf-8d09-4fac-ae35-245131b0685f')).toBeTruthy()
    expect(() => validateRequestId('nope')).toThrow()
    expect(() => validateRequestId(undefined)).toThrow()
  })
})

function fakeClient(result: { data: unknown; error: unknown }, auditResult: { error: unknown } | 'throw' = { error: null }) {
  const eqs: unknown[][] = []
  const audits: Record<string, unknown>[] = []
  let updatePayload: Record<string, unknown> | undefined
  const q: Record<string, unknown> = {}
  q.update = (p: Record<string, unknown>) => { updatePayload = p; return q }
  q.eq = (...a: unknown[]) => { eqs.push(a); return q }
  q.select = () => q
  q.maybeSingle = async () => result
  const client = {
    from: (t: string) => t === 'mcp_audit_log'
      ? { insert: async (r: Record<string, unknown>) => { audits.push(r); if (auditResult === 'throw') throw new Error('net'); return auditResult } }
      : q,
  }
  return { client: client as never, eqs, audits, payload: () => updatePayload }
}

describe('applyOwnerAction', () => {
  const RAW = '2026-11-03T10:00:00.123456+00:00'

  it('0 rows -> conflict, audited with ok false', async () => {
    const f = fakeClient({ data: null, error: null })
    const r = await applyOwnerAction(f.client, 'id1', 'queued', RAW, { status: 'cancelled' }, { tool: 'owner_close_request', detail: { reason: 'x' } })
    expect(r).toEqual({ ok: false, error: CONFLICT_MESSAGE })
    expect(f.audits).toHaveLength(1)
    expect(f.audits[0]).toMatchObject({ actor: 'owner', tool: 'owner_close_request', ok: false, error: CONFLICT_MESSAGE, request_id: 'id1' })
  })

  it('db error -> failure, audited', async () => {
    const f = fakeClient({ data: null, error: { message: 'boom' } })
    const r = await applyOwnerAction(f.client, 'id1', 'queued', RAW, {}, { tool: 't' })
    expect(r.ok).toBe(false)
    expect(f.audits[0]).toMatchObject({ ok: false })
  })

  it('success -> audited with detail; compares on raw status and updated_at; bumps updated_at', async () => {
    const f = fakeClient({ data: { id: 'id1', status: 'cancelled' }, error: null })
    const detail = { from_status: 'queued', to_status: 'cancelled' }
    const r = await applyOwnerAction(f.client, 'id1', 'queued', RAW, { status: 'cancelled' }, { tool: 'owner_close_request', detail })
    expect(r.ok).toBe(true)
    expect(f.eqs).toContainEqual(['updated_at', RAW])
    expect(f.eqs).toContainEqual(['status', 'queued'])
    expect(f.eqs).toContainEqual(['id', 'id1'])
    expect(f.payload()).toMatchObject({ status: 'cancelled' })
    expect(f.payload()?.updated_at).not.toBe(RAW)
    expect(f.audits[0]).toMatchObject({ ok: true, detail, request_id: 'id1' })
  })

  it('an audit insert failure does not throw', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const audit of ['throw', { error: { message: 'rls' } }] as const) {
      const f = fakeClient({ data: { id: 'id1' }, error: null }, audit)
      await expect(applyOwnerAction(f.client, 'id1', 'queued', RAW, {}, { tool: 't' })).resolves.toMatchObject({ ok: true })
    }
    spy.mockRestore()
  })
})

// Minimal in-memory mc_requests with PostgREST-like chains. Emulates the 029
// trigger (every successful write gets a fresh unique updated_at) and runs a
// one-shot hook between a handler's read and its first write.
type MemRow = Record<string, unknown>
function memRequests(initial: MemRow) {
  const rows = new Map<string, MemRow>()
  let n = 0
  let hook: (() => Promise<void>) | null = null
  const stamp = () => `2026-11-03T11:00:00.${String(++n).padStart(6, '0')}+00:00`
  rows.set(initial.id as string, { ...initial, updated_at: stamp() })
  const pick = (r: MemRow, cols: string) =>
    cols.trim() === '*' ? { ...r } : Object.fromEntries(cols.split(',').map(c => c.trim()).map(c => [c, r[c] ?? null]))
  const builder = (mode: 'select' | 'update', payload: MemRow | undefined, selCols: string) => {
    const preds: [string, unknown][] = []
    let cols = selCols
    const run = async (single: boolean) => {
      if (mode === 'update' && hook) { const h = hook; hook = null; await h() }
      const hit = [...rows.values()].find(r => preds.every(([c, v]) => (r[c] ?? null) === v))
      if (!hit) return { data: null, error: single ? { message: 'no rows' } : null }
      if (mode === 'update') { Object.assign(hit, payload); hit.updated_at = stamp() }
      return { data: pick(hit, cols), error: null }
    }
    const b: Record<string, unknown> = {
      eq: (c: string, v: unknown) => { preds.push([c, v]); return b },
      is: (c: string, v: unknown) => { preds.push([c, v]); return b },
      select: (c: string) => { cols = c; return b },
      single: () => run(true),
      maybeSingle: () => run(false),
    }
    return b
  }
  const client = {
    from: (t: string) => t === 'mcp_audit_log'
      ? { insert: async () => ({ error: null }) }
      : { select: (c: string) => builder('select', undefined, c), update: (p: MemRow) => builder('update', p, '*') },
  }
  const id = initial.id as string
  return {
    client,
    get: () => ({ ...rows.get(id)! }) as unknown as OwnerRequestRow,
    touch: () => { rows.get(id)!.updated_at = stamp() },
    onFirstUpdate: (fn: () => Promise<void>) => { hook = fn },
  }
}
type Mem = ReturnType<typeof memRequests>

async function ownerApply(m: Mem, plan: (r: OwnerRequestRow) => ReturnType<typeof planOwnerClose>, tool: string) {
  const cur = m.get()
  const p = plan(cur)
  if (!p.ok) throw new Error(p.reason)
  const r = await applyOwnerAction(m.client as never, cur.id, cur.status, cur.updated_at, p.updates, { tool, detail: p.detail })
  if (!r.ok) throw new Error(r.error)
}

const ID = '13df18cf-8d09-4fac-ae35-245131b0685f'
const setup = (over: Partial<OwnerRequestRow> & Record<string, unknown> = {}) => {
  const m = memRequests({ ...row(over), title: 't' })
  admin.client = m.client
  return m
}

describe('transitionRequest write contract', () => {
  it('a 0-row update throws Request changed', async () => {
    const m = setup({ status: 'claimed', assigned_to: 'claude' })
    m.onFirstUpdate(async () => m.touch())
    await expect(callTool('mc_post_progress', { request_id: ID, progress: 'x' })).rejects.toThrow('Request changed')
    expect(m.get().status).toBe('claimed')
  })

  it('refuses owner-hold rows (progress and fail)', async () => {
    const m = setup({ status: 'blocked', blocker: 'owner-hold: reopened by owner: x' })
    await expect(callTool('mc_post_progress', { request_id: ID, progress: 'x' })).rejects.toThrow(/held by the owner/)
    await expect(callTool('mc_mark_failed', { request_id: ID, reason: 'x' })).rejects.toThrow(/held by the owner/)
    expect(m.get().status).toBe('blocked')
  })

  it('mc_complete_request refuses awaiting_approval', async () => {
    const m = setup({ status: 'awaiting_approval' })
    await expect(callTool('mc_complete_request', { request_id: ID, result_summary: 'done' })).rejects.toThrow(/Not allowed from status 'awaiting_approval'/)
    expect(m.get().status).toBe('awaiting_approval')
  })

  it.each(['completed', 'cancelled'] as const)('worker progress/complete fail against a row the owner closed as %s', async (outcome) => {
    const m = setup({ status: 'queued' })
    await ownerApply(m, r => planOwnerClose(r, outcome, 'done elsewhere'), 'owner_close_request')
    await expect(callTool('mc_post_progress', { request_id: ID, progress: 'x' })).rejects.toThrow(/Not allowed from status/)
    await expect(callTool('mc_complete_request', { request_id: ID, result_summary: 'x' })).rejects.toThrow(/Not allowed from status/)
    expect(m.get().status).toBe(outcome)
  })
})

describe('interleaving: owner vs worker', () => {
  it('A->B->A: owner close + reopen between a worker read and write refuses the write', async () => {
    const m = setup({ status: 'blocked', assigned_to: 'claude', blocker: 'waiting on a thing' })
    m.onFirstUpdate(async () => {
      await ownerApply(m, r => planOwnerClose(r, 'cancelled', 'dup'), 'owner_close_request')
      await ownerApply(m, r => planOwnerReopen(r, 'actually needed'), 'owner_reopen_request')
    })
    await expect(callTool('mc_post_progress', { request_id: ID, progress: 'x' })).rejects.toThrow('Request changed')
    expect(m.get().status).toBe('blocked')
    expect(m.get().blocker).toMatch(/^owner-hold:/)
  })
})

describe('interleaving: mc_submit_plan', () => {
  it('owner reassign between read and write refuses the plan; row stays unplanned and not dispatcher-eligible', async () => {
    const m = setup({ status: 'submitted', assigned_to: 'hermes' })
    m.onFirstUpdate(() => ownerApply(m, r => planOwnerReassign(r, 'claude'), 'owner_reassign_request'))
    await expect(callTool('mc_submit_plan', { request_id: ID, plan: 'the plan' }, 'full')).rejects.toThrow('Request changed')
    const after = m.get()
    expect(after.plan).toBeNull()
    expect(after.assigned_to).toBe('claude')
    expect(after.status === 'queued' && isDispatcherRow(after)).toBe(false)
    expect(isClaimablePlanned(after, true)).toBe(false)
  })

  it('two concurrent submissions: the second lands, the first is refused and does not overwrite', async () => {
    const m = setup({ status: 'submitted', assigned_to: 'hermes' })
    m.onFirstUpdate(async () => { await callTool('mc_submit_plan', { request_id: ID, plan: 'second' }, 'full') })
    await expect(callTool('mc_submit_plan', { request_id: ID, plan: 'first' }, 'full')).rejects.toThrow('Request changed')
    expect(m.get().plan).toBe('second')
  })
})

describe('assign/resume compare on updated_at', () => {
  it('resume based on an old read does not release a row changed since', async () => {
    const m = setup({ status: 'blocked', blocker: 'owner-hold: reopened by owner: x', request_text: 'do a thing' })
    m.onFirstUpdate(async () => m.touch())
    await expect(callTool('mc_resume_request', { request_id: ID, reason: 'go' })).rejects.toThrow('Request changed while resume')
    expect(m.get().blocker).toMatch(/^owner-hold:/)
  })

  it('assign based on an old read is refused when the row changed since', async () => {
    const m = setup({ status: 'queued', request_text: 'do a thing' })
    m.onFirstUpdate(async () => m.touch())
    await expect(callTool('mc_assign_request', { request_id: ID, worker: 'claude' })).rejects.toThrow('Request changed while assignment')
    expect(m.get().assigned_to).toBeNull()
  })
})
