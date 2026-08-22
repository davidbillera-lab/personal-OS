// The 'chief' token scope — the Hermes chief-of-staff surface.
//
// Context: the 2026-08-21 bot-mode security review found the Hermes profiles on the
// 'orchestrator' scope (24 tools = 21 reads + claim + reassign + submit_plan). The
// chief-of-staff role does not need the two routing writes — /api/queue/dispatch does
// routing server-side under CRON_SECRET — so 'chief' is orchestrator minus claim and
// reassign. These tests pin the boundary so it can't drift open.
import { describe, expect, it } from 'vitest'
import { CHIEF_TOOLS, isToolAllowed, MCP_TOOLS, toolsForScope, type McpTool } from '@/lib/mcp-tools'

const names = (scope: Parameters<typeof toolsForScope>[0]) => toolsForScope(scope).map(t => t.name)

// The exact surface, spelled out independently of the implementation set so a typo or
// a well-meaning widening in lib/mcp-tools.ts fails here instead of shipping.
const EXPECTED_CHIEF_SURFACE = [
  'mc_browse_vault',
  'mc_get_agent',
  'mc_get_pending_tasks',
  'mc_get_project_context',
  'mc_get_project_summary',
  'mc_get_request',
  'mc_get_request_status',
  'mc_get_result',
  'mc_get_skill',
  'mc_get_vault_context',
  'mc_get_vault_item',
  'mc_get_workflow_result',
  'mc_get_workflow_status',
  'mc_list_agents',
  'mc_list_pending_approvals',
  'mc_list_projects',
  'mc_list_recent_requests',
  'mc_list_skills',
  'mc_list_workers',
  'mc_queue_status',
  'mc_whats_stalled',
  'mc_submit_plan',
]

// Anything that mutates worker state, returns secrets, or touches the vault/queue.
const MUST_NEVER_BE_REACHABLE = [
  'mc_claim_request',
  'mc_reassign_request',
  'mc_get_credential',
  'mc_capture_credential',
  'mc_write_vault',
  'mc_update_vault',
  'mc_complete_request',
  'mc_mark_failed',
  'mc_respond_approval',
  'mc_assign_request',
  'mc_resume_request',
  'mc_start_workflow',
  'mc_submit_request',
  'mc_claim_task',
  'mc_complete_task',
  'mc_update_project_status',
  'mc_post_progress',
  'mc_mark_blocked',
  'mc_request_approval',
]

describe('chief scope — the allowlist itself', () => {
  it('is exactly the agreed 22-tool surface', () => {
    expect([...CHIEF_TOOLS].sort()).toEqual([...EXPECTED_CHIEF_SURFACE].sort())
  })

  it('names only tools that actually exist in MCP_TOOLS', () => {
    const real = new Set(MCP_TOOLS.map(t => t.name))
    const phantom = [...CHIEF_TOOLS].filter(n => !real.has(n))
    expect(phantom, 'allowlist references a tool that does not exist').toEqual([])
  })

  it('contains exactly one write tool: mc_submit_plan', () => {
    const byName = new Map(MCP_TOOLS.map(t => [t.name, t] as const))
    const writes = [...CHIEF_TOOLS].filter(n => (byName.get(n) as McpTool | undefined)?.scope === 'write')
    expect(writes).toEqual(['mc_submit_plan'])
  })
})

describe('chief scope — discovery (tools/list)', () => {
  it('advertises every allowlisted tool', () => {
    expect(names('chief').sort()).toEqual([...EXPECTED_CHIEF_SURFACE].sort())
  })

  it('does not advertise the routing writes the orchestrator scope has', () => {
    expect(names('orchestrator')).toContain('mc_claim_request')
    expect(names('orchestrator')).toContain('mc_reassign_request')
    expect(names('chief')).not.toContain('mc_claim_request')
    expect(names('chief')).not.toContain('mc_reassign_request')
  })

  it('is strictly narrower than orchestrator', () => {
    const orch = new Set(names('orchestrator'))
    expect(names('chief').every(n => orch.has(n)), 'chief must be a subset of orchestrator').toBe(true)
    expect(names('chief').length).toBeLessThan(orch.size)
  })

  it('hides every credential, vault-write and worker-mutation tool', () => {
    for (const forbidden of MUST_NEVER_BE_REACHABLE) {
      expect(names('chief'), `${forbidden} must not be discoverable`).not.toContain(forbidden)
    }
  })
})

describe('chief scope — execution (tools/call)', () => {
  it('permits each allowlisted tool', () => {
    for (const allowed of EXPECTED_CHIEF_SURFACE) {
      expect(isToolAllowed(allowed, 'chief'), `${allowed} should be permitted`).toBe(true)
    }
  })

  it('rejects a guessed forbidden tool even though the name is real', () => {
    for (const forbidden of MUST_NEVER_BE_REACHABLE) {
      expect(isToolAllowed(forbidden, 'chief'), `${forbidden} must be rejected`).toBe(false)
    }
  })

  it('rejects an unknown tool name outright', () => {
    expect(isToolAllowed('mc_definitely_not_a_tool', 'chief')).toBe(false)
    expect(isToolAllowed('', 'chief')).toBe(false)
  })

  // THE INVARIANT: deny-by-default. 'chief' resolves through an explicit name set, not
  // through `scope === 'read'`, so adding a new read tool to MCP_TOOLS does NOT silently
  // hand it to Hermes. Contrast with 'orchestrator'/'read', which do expand automatically.
  it('a newly registered read tool stays denied until explicitly allowlisted', () => {
    const brandNew = 'mc_some_future_read_tool'
    expect(MCP_TOOLS.find(t => t.name === brandNew), 'fixture name must not already exist').toBeUndefined()
    expect(CHIEF_TOOLS.has(brandNew)).toBe(false)
    expect(isToolAllowed(brandNew, 'chief')).toBe(false)
  })
})

describe('chief scope — no cross-scope leakage', () => {
  it('does not widen any other scope', () => {
    expect(isToolAllowed('mc_submit_plan', 'read')).toBe(false)
    expect(isToolAllowed('mc_submit_plan', 'liaison')).toBe(false)
    expect(isToolAllowed('mc_claim_request', 'orchestrator')).toBe(true)
  })

  it('cannot reach the liaison-only request-submission tools', () => {
    expect(isToolAllowed('mc_submit_request', 'liaison')).toBe(true)
    expect(isToolAllowed('mc_submit_request', 'chief')).toBe(false)
  })
})
