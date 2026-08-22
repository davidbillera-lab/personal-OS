// mc_respond_approval recorded WHO approved and WHEN, but never WHAT.
//
// THE BUG: consent was a pointer into a mutable column. The approval stamped approved_by /
// approved_at and nothing else, so anything able to rewrite mc_requests.reviewed_sha after
// the operator said yes silently retargeted a live approval at a different commit — and the
// dispatcher's gated push, which only compared HEAD to reviewed_sha, pushed it.
//
// THE FIX: approved_sha, frozen from the SERVER-READ reviewed_sha at decision time, plus that
// same sha re-asserted as an equality filter on the UPDATE so the database (not a
// read-then-check) decides whether the approval still applies.
//
// These tests pin the binding rules and the guard set. The push side is in
// tests/gated-push-binding.test.ts.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildApprovalDecision, consentDrift, isSha, CONSENT_FIELDS,
} from '../scripts/lib/approval-binding.mjs'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const ATTEMPT = '22222222-2222-2222-2222-222222222222'
const OTHER_ATTEMPT = '99999999-9999-9999-9999-999999999999'
const NOW = '2026-08-21T00:00:00.000Z'

// ---------------------------------------------------------------------------
// The shared rules (scripts/lib/approval-binding.mjs)
// ---------------------------------------------------------------------------

const awaiting = (over: any = {}) => ({
  status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: SHA_A, ...over,
})

describe('buildApprovalDecision — an approval names exactly one commit', () => {
  it('freezes approved_sha from the server-read reviewed_sha', () => {
    const { updates } = buildApprovalDecision(awaiting(), {
      attemptId: ATTEMPT, decision: 'approve', actor: 'david', now: NOW,
    })
    expect(updates.approved_sha).toBe(SHA_A)
    expect(updates.status).toBe('in_progress')
    expect(updates.phase).toBe('pushing')
  })

  it('re-asserts that exact sha as an UPDATE guard, not just a read-then-check', () => {
    const { guards } = buildApprovalDecision(awaiting(), {
      attemptId: ATTEMPT, decision: 'approve', actor: 'david', now: NOW,
    })
    // All three together are what make the write atomic: from-state, attempt, and commit.
    expect(guards).toEqual({
      status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: SHA_A,
    })
  })

  it('THE REGRESSION: a reviewed_sha changed after review cannot be approved into', () => {
    // The operator reviewed SHA_A; the row now carries SHA_B. The decision must bind to
    // what the server says right now, and guard on it — never on a remembered value.
    const { updates, guards } = buildApprovalDecision(awaiting({ reviewed_sha: SHA_B }), {
      attemptId: ATTEMPT, decision: 'approve', actor: 'david', now: NOW,
    })
    expect(updates.approved_sha).toBe(SHA_B)
    expect(guards.reviewed_sha).toBe(SHA_B)
    // ...so an UPDATE computed against SHA_A can never land on a row now holding SHA_B.
    expect(guards.reviewed_sha).not.toBe(SHA_A)
  })

  it('refuses to approve a request with no reviewed commit at all', () => {
    for (const bad of [null, undefined, '', 'not-a-sha', SHA_A.slice(0, 12), SHA_A.toUpperCase()]) {
      expect(() => buildApprovalDecision(awaiting({ reviewed_sha: bad }), {
        attemptId: ATTEMPT, decision: 'approve', actor: 'david', now: NOW,
      }), `reviewed_sha=${bad}`).toThrow(/no reviewed commit/)
    }
  })

  it('refuses when the attempt was superseded', () => {
    expect(() => buildApprovalDecision(awaiting({ attempt_id: OTHER_ATTEMPT }), {
      attemptId: ATTEMPT, decision: 'approve', actor: 'david', now: NOW,
    })).toThrow(/Attempt superseded/)
  })

  it('refuses when the row has no attempt to bind to (null never matches → fails safe)', () => {
    expect(() => buildApprovalDecision(awaiting({ attempt_id: null }), {
      attemptId: ATTEMPT, decision: 'approve', actor: 'david', now: NOW,
    })).toThrow(/no attempt_id/)
  })

  it('requires an attempt_id from the caller and a real decision', () => {
    expect(() => buildApprovalDecision(awaiting(), {
      attemptId: null, decision: 'approve', actor: 'david', now: NOW,
    })).toThrow(/attempt_id is required/)
    expect(() => buildApprovalDecision(awaiting(), {
      attemptId: ATTEMPT, decision: 'maybe', actor: 'david', now: NOW,
    })).toThrow(/must be 'approve' or 'reject'/)
  })

  it('reject CLEARS approved_sha so a later attempt cannot inherit consent', () => {
    const { updates, guards } = buildApprovalDecision(awaiting(), {
      attemptId: ATTEMPT, decision: 'reject', actor: 'david', note: 'no', now: NOW,
    })
    expect(updates.approved_sha).toBeNull()
    expect(updates.status).toBe('blocked')
    expect(updates.blocker).toBe('no')
    // Reject must stay possible even for a row with no reviewed commit, so it does NOT
    // guard on the sha — otherwise a half-built request could never be cleared.
    expect(guards).toEqual({ status: 'awaiting_approval', attempt_id: ATTEMPT })
  })

  it('can reject a request that has no reviewed commit (never traps a row)', () => {
    expect(() => buildApprovalDecision(awaiting({ reviewed_sha: null }), {
      attemptId: ATTEMPT, decision: 'reject', actor: 'david', now: NOW,
    })).not.toThrow()
  })

  it('isSha accepts only a full 40-hex lowercase sha', () => {
    expect(isSha(SHA_A)).toBe(true)
    for (const bad of [null, undefined, 42, SHA_A + 'a', SHA_A.slice(0, 39), SHA_A.toUpperCase()]) {
      expect(isSha(bad as any), String(bad)).toBe(false)
    }
  })
})

describe('consentDrift — what counts as the approval moving underneath us', () => {
  const gated = {
    status: 'in_progress', phase: 'pushing', attempt_id: ATTEMPT,
    approved_at: NOW, approved_by: 'david', approved_sha: SHA_A,
    reviewed_sha: SHA_A, workspace_ref: '/builds/x',
  }

  it('is null when nothing moved', () => {
    expect(consentDrift(gated, { ...gated })).toBeNull()
  })

  it('catches a change to every consent-bearing field', () => {
    for (const field of CONSENT_FIELDS) {
      const drifted = { ...gated, [field]: 'CHANGED' }
      expect(consentDrift(gated, drifted), field).toContain(field)
    }
  })

  it('treats a vanished row as drift', () => {
    expect(consentDrift(gated, null)).toMatch(/disappeared/)
  })

  it('ignores fields that carry no consent (a progress note is not a retraction)', () => {
    expect(consentDrift(gated, { ...gated, latest_progress: 'still going' })).toBeNull()
  })

  it('treats null and undefined as the same absence, not as drift', () => {
    const a = { ...gated, workspace_ref: null }
    const b = { ...gated, workspace_ref: undefined }
    expect(consentDrift(a, b)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The MCP tool (lib/mcp-tools.ts) — same rules, applied through supabase
// ---------------------------------------------------------------------------

const state: { current: any; updateResult: any } = { current: null, updateResult: null }
let updateFilters: string[] = []
let updatePayload: any = null

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => ({
    from: () => {
      let isUpdate = false
      const chain: any = {}
      chain.update = (p: any) => { isUpdate = true; updatePayload = p; return chain }
      chain.select = () => chain
      chain.eq = (col: string, val: any) => {
        if (isUpdate) updateFilters.push(`eq:${col}=${val}`)
        return chain
      }
      chain.is = (col: string) => { if (isUpdate) updateFilters.push(`is:${col}`); return chain }
      chain.single = async () =>
        state.current ? { data: state.current, error: null } : { data: null, error: { message: 'no rows' } }
      chain.maybeSingle = async () => ({ data: state.updateResult, error: null })
      return chain
    },
  }),
}))

const REQ = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  updateFilters = []
  updatePayload = null
  state.current = { status: 'awaiting_approval', attempt_id: ATTEMPT, approved_at: null, reviewed_sha: SHA_A }
  state.updateResult = { id: REQ, status: 'in_progress', phase: 'pushing', approved_sha: SHA_A }
})

describe('mc_respond_approval — stamps and guards the approved commit', () => {
  it('stamps approved_sha from the server row and returns it', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    const out = await callTool('mc_respond_approval',
      { request_id: REQ, decision: 'approve', attempt_id: ATTEMPT }, 'david')

    expect(updatePayload.approved_sha).toBe(SHA_A)
    expect(updatePayload.approved_by).toBe('david')
    expect(JSON.parse(out).approved_sha).toBe(SHA_A)
  })

  it('guards the UPDATE on status AND attempt AND reviewed_sha', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    await callTool('mc_respond_approval',
      { request_id: REQ, decision: 'approve', attempt_id: ATTEMPT }, 'david')

    expect(updateFilters).toContain(`eq:id=${REQ}`)
    expect(updateFilters).toContain('eq:status=awaiting_approval')
    expect(updateFilters).toContain(`eq:attempt_id=${ATTEMPT}`)
    expect(updateFilters, 'the reviewed commit must be re-asserted atomically')
      .toContain(`eq:reviewed_sha=${SHA_A}`)
  })

  it('never lets the CALLER nominate the commit being approved', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    // A caller-supplied reviewed_sha/approved_sha must be ignored entirely.
    await callTool('mc_respond_approval',
      { request_id: REQ, decision: 'approve', attempt_id: ATTEMPT, reviewed_sha: SHA_B, approved_sha: SHA_B } as any,
      'david')

    expect(updatePayload.approved_sha).toBe(SHA_A)
    expect(updateFilters).toContain(`eq:reviewed_sha=${SHA_A}`)
  })

  it('THE STALE APPROVAL: 0 rows back (sha moved) is refused, never retried blind', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.updateResult = null // the guarded UPDATE matched nothing

    await expect(
      callTool('mc_respond_approval', { request_id: REQ, decision: 'approve', attempt_id: ATTEMPT }, 'david'),
    ).rejects.toThrow(/reviewed commit changed under the approval/)
  })

  it('refuses to approve a request with no reviewed commit, before any UPDATE', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.current = { status: 'awaiting_approval', attempt_id: ATTEMPT, approved_at: null, reviewed_sha: null }

    await expect(
      callTool('mc_respond_approval', { request_id: REQ, decision: 'approve', attempt_id: ATTEMPT }, 'david'),
    ).rejects.toThrow(/no reviewed commit/)
    expect(updateFilters, 'no UPDATE should have been attempted').toEqual([])
  })

  it('refuses a superseded attempt before any UPDATE', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.current = { status: 'awaiting_approval', attempt_id: OTHER_ATTEMPT, approved_at: null, reviewed_sha: SHA_A }

    await expect(
      callTool('mc_respond_approval', { request_id: REQ, decision: 'approve', attempt_id: ATTEMPT }, 'david'),
    ).rejects.toThrow(/Attempt superseded/)
    expect(updateFilters).toEqual([])
  })

  it('reject clears approved_sha and does not guard on the sha', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.updateResult = { id: REQ, status: 'blocked', approved_sha: null }

    await callTool('mc_respond_approval',
      { request_id: REQ, decision: 'reject', attempt_id: ATTEMPT, note: 'not this one' }, 'david')

    expect(updatePayload.approved_sha).toBeNull()
    expect(updatePayload.blocker).toBe('not this one')
    expect(updateFilters).toContain(`eq:attempt_id=${ATTEMPT}`)
    expect(updateFilters.some((f) => f.startsWith('eq:reviewed_sha'))).toBe(false)
  })
})

describe('mc_resume_request — consent dies with the attempt', () => {
  it('clears approved_sha alongside reviewed_sha and the attempt', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.current = { status: 'blocked', request_text: 'do a thing', blocker: 'stuck' }
    state.updateResult = { id: REQ, status: 'queued' }

    await callTool('mc_resume_request', { request_id: REQ, reason: 'unblocked' }, 'david')

    expect(updatePayload.approved_sha).toBeNull()
    expect(updatePayload.reviewed_sha).toBeNull()
    expect(updatePayload.attempt_id).toBeNull()
    expect(updatePayload.approved_at).toBeNull()
    expect(updatePayload.workspace_ref).toBeNull()
  })
})
