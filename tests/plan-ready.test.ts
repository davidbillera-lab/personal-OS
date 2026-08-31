import { describe, it, expect } from 'vitest'
import { buildPlanReadyMessage } from '../lib/alerts/plan-ready'

const ID = '7d100592-45ab-4d3b-9542-866f40e131fb'

describe('buildPlanReadyMessage', () => {
  it('includes the title and the short id', () => {
    const msg = buildPlanReadyMessage('Diagnose and repair Hermes-to-Claude dispatch handoff', ID)
    expect(msg).toContain('Diagnose and repair Hermes-to-Claude dispatch handoff')
    expect(msg).toContain('7d100592')
  })

  it('falls back to the full id when title is null or blank', () => {
    expect(buildPlanReadyMessage(null, ID)).toContain(ID)
    expect(buildPlanReadyMessage('   ', ID)).toContain(ID)
  })

  it('includes the wake instruction', () => {
    const msg = buildPlanReadyMessage('Anything', ID)
    expect(msg).toContain('npm run rig:wake')
  })
})
