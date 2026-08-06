// Gap B (second-half relay): the executor must build FROM the deposited Hermes plan
// (mc_requests.plan), not the one-line voice ask it was submitted against.
import { describe, it, expect } from 'vitest'
import { buildTaskSpec } from '../scripts/lib/claude-executor-adapter.mjs'

describe('buildTaskSpec', () => {
  it('uses the plan (trimmed) when present', () => {
    expect(buildTaskSpec({ plan: '  full build spec  ', request_text: 'one-liner', title: 't' }))
      .toBe('full build spec')
  })

  it('falls back to request_text when plan is null/empty/whitespace', () => {
    expect(buildTaskSpec({ plan: null, request_text: 'do the thing', title: 't' })).toBe('do the thing')
    expect(buildTaskSpec({ plan: '', request_text: 'do the thing', title: 't' })).toBe('do the thing')
    expect(buildTaskSpec({ plan: '   ', request_text: 'do the thing', title: 't' })).toBe('do the thing')
  })

  it('falls back to title when plan and request_text are absent', () => {
    expect(buildTaskSpec({ title: 'short title' })).toBe('short title')
  })

  it('falls back to a default string when nothing is present', () => {
    expect(buildTaskSpec({})).toBe('the requested build')
  })
})
