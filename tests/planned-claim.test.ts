// Gap A1 (second-half relay): flag off -> never eligible; flag on -> only rows that are
// status='submitted' AND phase='planned' AND plan!=null are eligible for planned-claim.
import { describe, it, expect } from 'vitest'
import { isClaimablePlanned } from '../scripts/lib/planned-claim.mjs'

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
})
