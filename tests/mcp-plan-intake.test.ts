import { describe, expect, it } from 'vitest'
import {
  isToolAllowed,
  MC_SUBMIT_PLAN_MAX_LENGTH,
  MCP_TOOLS,
  toolsForScope,
  validatePlanArg,
  validatePlanPrecondition,
} from '@/lib/mcp-tools'

describe('mc_submit_plan scope wiring', () => {
  it('is callable by orchestrator and full, never by liaison or read', () => {
    expect(isToolAllowed('mc_submit_plan', 'orchestrator')).toBe(true)
    expect(isToolAllowed('mc_submit_plan', 'full')).toBe(true)
    expect(isToolAllowed('mc_submit_plan', 'liaison')).toBe(false)
    expect(isToolAllowed('mc_submit_plan', 'read')).toBe(false)
  })

  it('is advertised to orchestrator but not to liaison', () => {
    const orchestratorNames = toolsForScope('orchestrator').map(t => t.name)
    const liaisonNames = toolsForScope('liaison').map(t => t.name)
    expect(orchestratorNames).toContain('mc_submit_plan')
    expect(liaisonNames).not.toContain('mc_submit_plan')
  })

  it('is defined as a write tool requiring request_id and plan', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'mc_submit_plan')
    expect(tool).toBeDefined()
    expect(tool?.scope).toBe('write')
    expect(tool?.inputSchema.required).toEqual(['request_id', 'plan'])
  })
})

describe('validatePlanArg (pure)', () => {
  it('accepts a non-empty plan within the size cap', () => {
    expect(validatePlanArg('do the thing')).toBe('do the thing')
  })

  it('rejects missing or empty plan', () => {
    expect(() => validatePlanArg(undefined)).toThrow('plan is required')
    expect(() => validatePlanArg('')).toThrow('plan is required')
    expect(() => validatePlanArg('   ')).toThrow('plan is required')
  })

  it('rejects a plan over the hard size cap', () => {
    const oversized = 'a'.repeat(MC_SUBMIT_PLAN_MAX_LENGTH + 1)
    expect(() => validatePlanArg(oversized)).toThrow(/exceeds max length/)
  })

  it('accepts a plan exactly at the size cap', () => {
    const atCap = 'a'.repeat(MC_SUBMIT_PLAN_MAX_LENGTH)
    expect(() => validatePlanArg(atCap)).not.toThrow()
  })
})

describe('validatePlanPrecondition (pure)', () => {
  it('allows a submitted request assigned to hermes with no existing plan', () => {
    expect(() =>
      validatePlanPrecondition({ status: 'submitted', assigned_to: 'hermes', plan: null }),
    ).not.toThrow()
  })

  it('rejects a non-submitted status', () => {
    expect(() =>
      validatePlanPrecondition({ status: 'queued', assigned_to: 'hermes', plan: null }),
    ).toThrow('Plan intake requires a submitted request assigned to hermes')
    expect(() =>
      validatePlanPrecondition({ status: 'blocked', assigned_to: 'hermes', plan: null }),
    ).toThrow('Plan intake requires a submitted request assigned to hermes')
    expect(() =>
      validatePlanPrecondition({ status: 'completed', assigned_to: 'hermes', plan: null }),
    ).toThrow('Plan intake requires a submitted request assigned to hermes')
  })

  it('rejects an assignee other than hermes', () => {
    expect(() =>
      validatePlanPrecondition({ status: 'submitted', assigned_to: 'claude', plan: null }),
    ).toThrow('Plan intake requires a submitted request assigned to hermes')
    expect(() =>
      validatePlanPrecondition({ status: 'submitted', assigned_to: null, plan: null }),
    ).toThrow('Plan intake requires a submitted request assigned to hermes')
  })

  it('rejects write-once when a plan already exists', () => {
    expect(() =>
      validatePlanPrecondition({ status: 'submitted', assigned_to: 'hermes', plan: 'already here' }),
    ).toThrow('plan already submitted')
  })
})
