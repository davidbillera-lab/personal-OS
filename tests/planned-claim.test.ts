// Gap A1 (second-half relay): flag off -> never eligible; flag on -> only rows that are
// status='submitted' AND phase='planned' AND plan!=null are eligible for planned-claim.
import { describe, it, expect } from 'vitest'
import { isClaimablePlanned, isDispatcherRow, DISPATCHER_ROW_FILTER } from '../scripts/lib/planned-claim.mjs'

const PLANNED_ROW = { status: 'submitted', phase: 'planned', plan: 'full build spec' }

describe('isClaimablePlanned', () => {
  it('flag off -> never eligible, even for an otherwise-perfect planned row', () => {
    expect(isClaimablePlanned(PLANNED_ROW, false)).toBe(false)
  })

  it('flag on -> eligible when status/phase/plan all match', () => {
    expect(isClaimablePlanned(PLANNED_ROW, true)).toBe(true)
  })

  it('flag on -> not eligible when status is not submitted', () => {
    expect(isClaimablePlanned({ ...PLANNED_ROW, status: 'queued' }, true)).toBe(false)
  })

  it('flag on -> not eligible when phase is not planned', () => {
    expect(isClaimablePlanned({ ...PLANNED_ROW, phase: 'building' }, true)).toBe(false)
  })

  it('flag on -> not eligible when plan is null', () => {
    expect(isClaimablePlanned({ ...PLANNED_ROW, plan: null }, true)).toBe(false)
  })

  it('flag on -> not eligible for a missing row', () => {
    expect(isClaimablePlanned(null, true)).toBe(false)
  })

  it('flag on -> not eligible for a planned row assigned to codex', () => {
    expect(isClaimablePlanned({ ...PLANNED_ROW, assigned_to: 'codex' }, true)).toBe(false)
  })

  it('flag on -> eligible for a planned row assigned to hermes', () => {
    expect(isClaimablePlanned({ ...PLANNED_ROW, assigned_to: 'hermes' }, true)).toBe(true)
  })
})

describe('isDispatcherRow', () => {
  it('a missing row is not a dispatcher row', () => {
    expect(isDispatcherRow(null)).toBe(false)
  })

  it('a row assigned to codex is not a dispatcher row', () => {
    expect(isDispatcherRow({ assigned_to: 'codex' })).toBe(false)
  })

  it('a row assigned to codex-qc is not a dispatcher row', () => {
    expect(isDispatcherRow({ assigned_to: 'codex-qc' })).toBe(false)
  })

  it('a row with no assignee is a dispatcher row', () => {
    expect(isDispatcherRow({ assigned_to: null })).toBe(true)
  })

  it('a row with an undefined assignee is a dispatcher row', () => {
    expect(isDispatcherRow({ assigned_to: undefined })).toBe(true)
  })

  it('a row assigned to claude is a dispatcher row', () => {
    expect(isDispatcherRow({ assigned_to: 'claude' })).toBe(true)
  })

  it('a row assigned to hermes is a dispatcher row', () => {
    expect(isDispatcherRow({ assigned_to: 'hermes' })).toBe(true)
  })

  it('DISPATCHER_ROW_FILTER matches the PostgREST filter for the same rule', () => {
    expect(DISPATCHER_ROW_FILTER).toBe('assigned_to.is.null,assigned_to.in.(claude,hermes)')
  })
})
