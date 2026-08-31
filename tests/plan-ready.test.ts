import { describe, it, expect } from 'vitest'
import { buildPlanReadyMessage } from '../lib/alerts/plan-ready'

const ID = '7d100592-45ab-4d3b-9542-866f40e131fb'

describe('buildPlanReadyMessage', () => {
  it('includes the title and the short id', () => {
    const msg = buildPlanReadyMessage('Diagnose and repair Hermes-to-Claude dispatch handoff', ID)
    expect(msg).toContain('Diagnose and repair Hermes-to-Claude dispatch handoff')
    expect(msg).toContain('7d100592')
  })

  it('falls back to a clean "Request <short-id>" label when title is null or blank', () => {
    expect(buildPlanReadyMessage(null, ID)).toContain('Request 7d100592')
    expect(buildPlanReadyMessage('   ', ID)).toContain('Request 7d100592')
    // does not redundantly show the full id alongside the short one
    expect(buildPlanReadyMessage(null, ID)).not.toContain(`(${ID.slice(0, 8)})`)
  })

  it('truncates an overlong title rather than sending it unbounded', () => {
    const longTitle = 'x'.repeat(300)
    const msg = buildPlanReadyMessage(longTitle, ID)
    expect(msg).not.toContain(longTitle)
    expect(msg).toContain('…')
  })

  it('includes the wake instruction', () => {
    const msg = buildPlanReadyMessage('Anything', ID)
    expect(msg).toContain('npm run rig:wake')
  })
})
