import { createServerSupabaseClient } from '@/lib/supabase'
import { decrypt } from '@/lib/crypto'
import { fetchGitHubDiff } from '@/lib/github'
import { runCodexQC, rerunCodexQCOnSpec } from '@/app/(app)/projects/[id]/actions'

export interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'mc_get_pending_tasks',
    description: 'Returns tasks that have a generated spec and are not yet completed. Optionally filter by project_id.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Optional project UUID to filter tasks' },
      },
    },
  },
  {
    name: 'mc_claim_task',
    description: 'Claim a task for an agent. Sets agent_assigned_to and claimed_at, creates an agent_handoffs row.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:    { type: 'string', description: 'UUID of the task to claim' },
        agent_name: { type: 'string', description: 'Name of the agent claiming the task (e.g. "Claude Code")' },
      },
      required: ['task_id', 'agent_name'],
    },
  },
  {
    name: 'mc_complete_task',
    description: 'Mark a claimed task as complete. Updates agent_handoffs with outcome and optional commit URL, sets task status to review.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:           { type: 'string', description: 'UUID of the task to complete' },
        outcome:           { type: 'string', description: 'Short description of what was done' },
        github_commit_url: { type: 'string', description: 'Optional GitHub commit or PR URL' },
      },
      required: ['task_id', 'outcome'],
    },
  },
  {
    name: 'mc_get_project_context',
    description: 'Returns the current context for a project: status, next_action, blockers, lead_model, and current_agent.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'UUID of the project' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'mc_get_credential',
    description: 'Fetch a credential value by key name. Only returns credentials marked as MCP-accessible. Access is logged.',
    inputSchema: {
      type: 'object',
      properties: {
        key_name:   { type: 'string', description: 'The credential key name (e.g. ANTHROPIC_API_KEY)' },
        agent_name: { type: 'string', description: 'Name of the agent requesting the credential (for audit log)' },
      },
      required: ['key_name'],
    },
  },
  {
    name: 'mc_update_project_status',
    description: 'Update a project\'s status, next_action, and/or blockers at the end of a session.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id:  { type: 'string', description: 'UUID of the project' },
        status:      { type: 'string', description: 'New status string (e.g. "in progress — auth wired up")' },
        next_action: { type: 'string', description: 'What should happen next' },
        blockers:    { type: 'string', description: 'Current blockers, if any' },
      },
      required: ['project_id'],
    },
  },
]

type ToolArgs = Record<string, string | undefined>

export async function callTool(name: string, args: ToolArgs): Promise<string> {
  const supabase = await createServerSupabaseClient()

  if (name === 'mc_get_pending_tasks') {
    let query = supabase
      .from('tasks')
      .select('id, title, description, generated_spec, recommended_tool, recommended_model, complexity_tier, agent_assigned_to, project_id, status')
      .not('generated_spec', 'is', null)
      .not('status', 'in', '("done","killed")')
      .order('created_at', { ascending: false })

    if (args.project_id) {
      query = query.eq('project_id', args.project_id)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return JSON.stringify(data ?? [])
  }

  if (name === 'mc_claim_task') {
    const { task_id, agent_name } = args
    if (!task_id || !agent_name) throw new Error('task_id and agent_name are required')

    const { data: task } = await supabase
      .from('tasks')
      .select('project_id, title')
      .eq('id', task_id)
      .single()

    const now = new Date().toISOString()

    await supabase.from('tasks').update({ agent_assigned_to: agent_name, claimed_at: now }).eq('id', task_id)

    if (task?.project_id) {
      await supabase.from('projects').update({ current_agent: agent_name }).eq('id', task.project_id)
    }

    await supabase.from('agent_handoffs').insert({
      project_id: task?.project_id ?? undefined,
      task_id,
      agent_name,
      task_description: task?.title ?? null,
      status: 'in_progress',
    })

    return JSON.stringify({ ok: true, claimed_at: now })
  }

  if (name === 'mc_complete_task') {
    const { task_id, outcome, github_commit_url } = args
    if (!task_id || !outcome) throw new Error('task_id and outcome are required')

    const { data: task } = await supabase
      .from('tasks')
      .select('project_id, agent_assigned_to, codex_qc_status')
      .eq('id', task_id)
      .single()

    const now = new Date().toISOString()

    await supabase.from('tasks').update({ status: 'review', completed_at: now }).eq('id', task_id)

    if (task?.project_id) {
      await supabase.from('projects').update({ current_agent: null }).eq('id', task.project_id)
    }

    await supabase
      .from('agent_handoffs')
      .update({
        status: 'done',
        github_commit_url: github_commit_url ?? null,
        completed_at: now,
        outcome,
      })
      .eq('task_id', task_id)
      .eq('status', 'in_progress')

    // Auto-QC: fetch diff and run QC when a commit URL is provided
    if (github_commit_url && task?.project_id) {
      const currentQcStatus = (task as { codex_qc_status?: string | null }).codex_qc_status

      // Skip if loop already detected — terminal state
      if (currentQcStatus !== 'loop_detected') {
        try {
          const diff = await fetchGitHubDiff(github_commit_url)

          const isRerun = currentQcStatus === 'issues_found'
          const qcResult = isRerun
            ? await rerunCodexQCOnSpec(task_id, task.project_id, diff, github_commit_url)
            : await runCodexQC(task_id, task.project_id, diff, github_commit_url)

          if ('error' in qcResult && qcResult.error) {
            return JSON.stringify({ ok: true, completed_at: now, qc_error: qcResult.error })
          }

          return JSON.stringify({ ok: true, completed_at: now, qc_status: (qcResult as { status: string }).status })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return JSON.stringify({ ok: true, completed_at: now, qc_error: msg })
        }
      }
    }

    return JSON.stringify({ ok: true, completed_at: now })
  }

  if (name === 'mc_get_project_context') {
    const { project_id } = args
    if (!project_id) throw new Error('project_id is required')

    const { data, error } = await supabase
      .from('projects')
      .select('name, status, next_action, blockers, lead_model, current_agent, stage')
      .eq('id', project_id)
      .single()

    if (error) throw new Error(error.message)
    return JSON.stringify(data)
  }

  if (name === 'mc_update_project_status') {
    const { project_id, status, next_action, blockers } = args
    if (!project_id) throw new Error('project_id is required')

    const update: Record<string, string> = { last_update: new Date().toISOString() }
    if (status)      update.status      = status
    if (next_action) update.next_action = next_action
    if (blockers)    update.blockers    = blockers

    const { error } = await supabase.from('projects').update(update).eq('id', project_id)
    if (error) throw new Error(error.message)
    return JSON.stringify({ ok: true })
  }

  if (name === 'mc_get_credential') {
    const { key_name, agent_name } = args
    if (!key_name) throw new Error('key_name is required')

    const { data, error } = await supabase
      .from('credentials')
      .select('value, is_mcp_accessible')
      .eq('key_name', key_name)
      .single()

    if (error || !data) throw new Error(`Credential not found: ${key_name}`)
    if (!data.is_mcp_accessible) throw new Error(`Credential ${key_name} is not MCP-accessible`)

    await supabase.from('credential_access_log').insert({
      key_name,
      accessed_by: agent_name ?? 'mcp',
    })

    const value = decrypt(data.value)
    return JSON.stringify({ key_name, value })
  }

  throw new Error(`Unknown tool: ${name}`)
}
