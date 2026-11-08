import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ createAdminSupabaseClient: () => { throw new Error('db must not be touched') } }))
vi.mock('@/lib/models/router', () => ({ routeTask: vi.fn(async () => { throw new Error('model must not be called') }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { MAX_DIFF_CHARS, parseVerdict, qcStatusFor, runCodexQCCore } from '../lib/codex-qc'
import { parsePrUrl } from '../lib/github'

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
