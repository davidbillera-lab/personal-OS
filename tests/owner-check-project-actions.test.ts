import { describe, expect, it, vi } from 'vitest'

const { touched } = vi.hoisted(() => ({ touched: [] as string[] }))
// Any chain resolves to an empty result; we only record which tables were reached.
const chain: unknown = new Proxy(() => {}, {
  get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res({ data: null, error: null }) : chain),
  apply: () => chain,
})
vi.mock('@/lib/supabase', () => ({ createAdminSupabaseClient: () => ({ from: (t: string) => { touched.push(t); return chain } }) }))
vi.mock('@/lib/owner', () => ({ requireOwner: async () => { throw new Error('Not authorized') } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/models/router', () => ({ routeTask: vi.fn(async () => { throw new Error('model must not be called') }) }))
vi.mock('@/lib/classify', () => ({ classifyBrainDump: vi.fn() }))
vi.mock('@/lib/vault', () => ({ captureToVault: vi.fn() }))

import * as actions from '../app/(app)/projects/[id]/actions'

const ID = '0b7c2b1e-4c1a-4f7e-9d2a-1f3e5a7c9b11'
const calls: Record<string, () => Promise<unknown>> = {
  runAdvisoryBoard: () => actions.runAdvisoryBoard(ID, ID),
  generateSpec: () => actions.generateSpec(ID, ID, '', ''),
  approveSpec: () => actions.approveSpec(ID, ID),
  sendTaskToAgent: () => actions.sendTaskToAgent(ID, ID, 'codex'),
  runCodexQC: () => actions.runCodexQC(ID, ID, 'diff'),
  rerunCodexQCOnSpec: () => actions.rerunCodexQCOnSpec(ID, ID, 'diff'),
  fetchRepoContents: () => actions.fetchRepoContents('https://github.com/o/r'),
  updateAgentHandoff: () => actions.updateAgentHandoff(ID, ID, { status: 'done' }),
  markTaskDone: () => actions.markTaskDone(ID, ID),
  archiveProject: () => actions.archiveProject(ID),
  generateSuggestions: () => actions.generateSuggestions(ID),
  sendChatMessage: () => actions.sendChatMessage(ID, 'hi'),
  createProjectBrainDump: () => actions.createProjectBrainDump(ID, 'idea'),
}

describe('project actions refuse a non-owner', () => {
  it('covers every exported action', () => {
    const exported = Object.entries(actions).filter(([, v]) => typeof v === 'function').map(([k]) => k)
    expect(exported.sort()).toEqual(Object.keys(calls).sort())
  })

  it.each(Object.keys(calls))('%s', async name => {
    touched.length = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(calls[name]()).resolves.toMatchObject({ ok: false, error: 'Not authorized' })
    expect(touched.filter(t => t !== 'mcp_audit_log')).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
