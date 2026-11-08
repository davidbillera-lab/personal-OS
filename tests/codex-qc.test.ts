import { describe, expect, it, vi } from 'vitest'

// Per-test fakes. Default: any DB or model touch throws.
const { state } = vi.hoisted(() => ({
  state: {
    db: () => { throw new Error('db must not be touched') },
    route: async (): Promise<unknown> => { throw new Error('model must not be called') },
  } as { db: () => unknown; route: (input: unknown) => Promise<unknown> },
}))
vi.mock('@/lib/supabase', () => ({ createAdminSupabaseClient: () => state.db() }))
vi.mock('@/lib/models/router', () => ({ routeTask: (input: unknown) => state.route(input) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { MAX_DIFF_CHARS, parseVerdict, qcStatusFor, runCodexQCCore } from '../lib/codex-qc'
import { fetchGitHubPrDiff, parsePrUrl } from '../lib/github'

// tasks: the lookup returns a task; the first update is the run claim (`claimResult`), the next the save (`saveResult`).
// Records every update payload.
function fakeTasksDb(saveResult: { data: unknown; error: unknown }, claimResult: { data: unknown; error: unknown } = { data: { id: 't' }, error: null }) {
  const updates: unknown[] = []
  const from = () => {
    let op: 'select' | 'update' = 'select'
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      or: () => b,
      not: () => b,
      update: (p: unknown) => { op = 'update'; updates.push(p); return b },
      maybeSingle: async () => (op === 'select'
        ? { data: { title: 'T', generated_spec: '# spec', codex_qc_status: null }, error: null }
        : updates.length === 1 ? claimResult : saveResult),
      then: (res: (v: unknown) => void) => res({ data: null, error: null, count: 1 }),
    }
    return b
  }
  state.db = () => ({ from })
  return updates
}

const report = (line: string) => `# Codex QC Review\n${line}\n**One-line summary:** ok\n`

describe('QC verdict parsing', () => {
  it('SHIP passes', () => {
    expect(parseVerdict(report('**Verdict:** SHIP ✅'))).toBe('SHIP')
    expect(qcStatusFor(report('**Verdict:** SHIP ✅'))).toBe('passed')
  })
  it('FIX-FIRST and RECONSIDER are issues_found', () => {
    expect(parseVerdict(report('**Verdict:** FIX-FIRST ⚠️'))).toBe('FIX-FIRST')
    expect(qcStatusFor(report('**Verdict:** FIX-FIRST ⚠️'))).toBe('issues_found')
    expect(parseVerdict(report('**Verdict:** RECONSIDER ⛔'))).toBe('RECONSIDER')
    expect(qcStatusFor(report('**Verdict:** RECONSIDER ⛔'))).toBe('issues_found')
  })
  it('garbage, a missing line, or an echoed template never passes', () => {
    for (const text of ['not markdown at all', '{"status":"passed"}', report('**Verdict:** SHIP ✅  |  FIX-FIRST ⚠️  |  RECONSIDER ⛔  (pick one)'), report('**Verdict:** shipping soon')]) {
      expect(parseVerdict(text)).toBeNull()
      expect(qcStatusFor(text)).toBe('issues_found')
    }
  })
})

describe('parsePrUrl', () => {
  it('accepts a GitHub PR URL, with or without a trailing tab path', () => {
    expect(parsePrUrl('https://github.com/davidbillera-lab/personal-OS/pull/31')).toEqual({ owner: 'davidbillera-lab', repo: 'personal-OS', number: 31 })
    expect(parsePrUrl('https://github.com/o/r.js/pull/7/files')).toEqual({ owner: 'o', repo: 'r.js', number: 7 })
  })
  it('rejects commits, other hosts and junk', () => {
    expect(parsePrUrl('https://github.com/o/r/commit/abc123')).toBeNull()
    expect(parsePrUrl('https://evil.example/github.com/o/r/pull/1')).toBeNull()
    expect(parsePrUrl('https://github.com/o/r/pull/x')).toBeNull()
  })
})

describe('diff size cap', () => {
  it('refuses an oversized diff before any DB or model call', async () => {
    const res = await runCodexQCCore('t', 'p', 'x'.repeat(MAX_DIFF_CHARS + 1))
    expect(res).toMatchObject({ error: expect.stringContaining('over the 300,000 limit') })
  })
})

describe('runCodexQCCore safety', () => {
  const SHIP = '# Codex QC Review — SHIP\n**Verdict:** SHIP ✅\n'

  it('never records a report cut off at the token cap, even with a SHIP header', async () => {
    const updates = fakeTasksDb({ data: { id: 't' }, error: null })
    state.route = async () => ({ text: SHIP, model: 'gpt-6.1-sol', cost_usd: 0, finish_reason: 'length' })
    const res = await runCodexQCCore('t', 'p', 'diff')
    expect(res).toMatchObject({ error: expect.stringContaining('incomplete') })
    expect(updates.some(u => (u as Record<string, unknown>).codex_qc_status)).toBe(false)
    expect(updates.at(-1)).toEqual({ codex_qc_run_started_at: null })
  })

  it('refuses a second run while one holds the task, without calling the model', async () => {
    const updates = fakeTasksDb({ data: { id: 't' }, error: null }, { data: null, error: null })
    state.route = async () => { throw new Error('model must not be called') }
    const res = await runCodexQCCore('t', 'p', 'diff')
    expect(res).toMatchObject({ error: expect.stringContaining('already running') })
    expect(updates).toHaveLength(1)
  })

  it('reports a failed save as an error, not a successful review', async () => {
    fakeTasksDb({ data: null, error: { message: 'boom' } })
    state.route = async () => ({ text: SHIP, model: 'gpt-6.1-sol', cost_usd: 0, finish_reason: 'stop' })
    const res = await runCodexQCCore('t', 'p', 'diff')
    expect(res).toMatchObject({ error: expect.stringContaining('saving it failed: boom') })
  })

  it('a complete SHIP report passes and records the reviewed SHA', async () => {
    const updates = fakeTasksDb({ data: { id: 't' }, error: null })
    state.route = async () => ({ text: SHIP, model: 'gpt-6.1-sol', cost_usd: 0, finish_reason: 'stop' })
    const res = await runCodexQCCore('t', 'p', 'diff', 'https://github.com/o/r/pull/1', 'abcdef1234567')
    expect(res).toMatchObject({ status: 'passed', verdict: 'SHIP', model: 'gpt-6.1-sol' })
    expect(updates[1]).toMatchObject({ codex_qc_status: 'passed', status: 'done', codex_qc_notes: expect.stringMatching(/^_Reviewed by gpt-6\.1-sol at abcdef1_/) })
  })
})

describe('fetchGitHubPrDiff', () => {
  it('diffs the PR by base and head SHA, not the mutable PR', async () => {
    process.env.GITHUB_PAT = 'test-pat'
    const urls: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url))
      return new Response(urls.length === 1 ? JSON.stringify({ base: { sha: 'b1' }, head: { sha: 'h2' } }) : 'DIFF')
    })
    await expect(fetchGitHubPrDiff('https://github.com/o/r/pull/7')).resolves.toEqual({ diff: 'DIFF', headSha: 'h2' })
    expect(urls).toEqual(['https://api.github.com/repos/o/r/pulls/7', 'https://api.github.com/repos/o/r/compare/b1...h2'])
    fetchSpy.mockRestore()
    delete process.env.GITHUB_PAT
  })
})
