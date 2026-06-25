import { createAdminSupabaseClient } from '@/lib/supabase'
import { decrypt, encrypt } from '@/lib/crypto'
import { fetchGitHubDiff } from '@/lib/github'
import { runCodexQC, rerunCodexQCOnSpec } from '@/app/(app)/projects/[id]/actions'
import { captureToVault } from '@/lib/vault'

// 'read' = safe to expose to low-trust clients (e.g. a phone connector).
// 'write' = mutates state OR returns secrets (mc_get_credential); full token only.
export type McpScope = 'read' | 'write'

// The privilege a presented token grants. 'full' can call everything;
// 'read' is restricted to read-scoped tools.
export type McpTokenScope = 'full' | 'read'

export interface McpTool {
  name: string
  description: string
  scope: McpScope
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
    scope: 'read',
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
    scope: 'write',
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
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:           { type: 'string', description: 'UUID of the task to complete' },
        outcome:           { type: 'string', description: 'Short description of what was done' },
        github_commit_url: { type: 'string', description: 'GitHub commit URL' },
      },
      required: ['task_id', 'outcome'],
    },
  },
  {
    name: 'mc_get_project_context',
    description: 'Returns the current context for a project: status, next_action, blockers, lead_model, and current_agent.',
    scope: 'read',
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
    scope: 'write', // returns secrets — privileged, never exposed to a read-only client
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
    scope: 'write',
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
  {
    name: 'mc_get_vault_context',
    description: 'Semantic search over vault items. Pass the current task description to get relevant skills, agent roles, and knowledge items back. Never returns encrypted or personal items.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Task description or question to match against vault knowledge' },
        limit: { type: 'number', description: 'Max items to return (default 8, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'mc_list_skills',
    description: 'List all operator workflow skills stored in the vault. Returns title, description, and tags for each skill. Call this at session start to discover which skills apply to your task, then call mc_get_skill to fetch full content.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mc_get_skill',
    description: 'Fetch the full content of a skill by name. Use mc_list_skills first to discover available skill names.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill title exactly as returned by mc_list_skills' },
      },
      required: ['name'],
    },
  },
  {
    name: 'mc_list_agents',
    description: 'List all reusable subagent definitions stored in the vault. Returns name, description, crew, and tags for each agent. Call this to discover which agents are available for delegation, then call mc_get_agent to fetch the full definition.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mc_get_agent',
    description: 'Fetch the full definition (frontmatter + system prompt) of a subagent by name. Use mc_list_agents first to discover available agent names.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The agent name exactly as returned by mc_list_agents' },
      },
      required: ['name'],
    },
  },
  {
    name: 'mc_browse_vault',
    description: 'Enumerate vault items in reverse-chronological order (most recent first). Unlike mc_get_vault_context (semantic search), this is a plain listing for browsing what exists. Optionally filter by type. Returns id, type, title, tags, and created_at. Never returns encrypted or personal items.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        type:   { type: 'string', description: 'Optional vault item type to filter by (e.g. agent_session, build_spec, decision_log, brain_dump_mirror, knowledge)' },
        limit:  { type: 'number', description: 'Max items to return (default 25, max 100)' },
        offset: { type: 'number', description: 'Number of items to skip, for paging (default 0)' },
      },
    },
  },
  {
    name: 'mc_write_vault',
    description: 'Insert a new vault_items row with embedding. Use to push specs, decisions, agent sessions, or knowledge from any project agent into Mission Control\'s vault.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        title:    { type: 'string', description: 'Title for the vault item' },
        content:  { type: 'string', description: 'Full content body to store and embed' },
        type:     { type: 'string', description: 'Vault item type (e.g. spec, decision, agent-session, knowledge)' },
        tags:     { type: 'string', description: 'JSON array of string tags, e.g. ["build","flipradar"]' },
        metadata: { type: 'string', description: 'JSON object of additional metadata' },
      },
      required: ['title', 'content', 'type'],
    },
  },
  {
    name: 'mc_update_vault',
    description: 'Update an existing vault_items row. Looks up by id, or by title+type if id is not provided. Re-embeds if content changes.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        id:       { type: 'string', description: 'UUID of the vault item to update (preferred)' },
        title:    { type: 'string', description: 'Title of the item (used for lookup when id is absent; also updated if provided alongside id)' },
        type:     { type: 'string', description: 'Type of the item (required for title+type lookup when id is absent)' },
        content:  { type: 'string', description: 'New content body (triggers re-embedding)' },
        tags:     { type: 'string', description: 'JSON array of string tags to replace existing tags' },
        metadata: { type: 'string', description: 'JSON object to replace existing metadata' },
      },
    },
  },
  {
    name: 'mc_capture_credential',
    description: 'Write an AES-256-GCM encrypted credential to the credentials table. Use to store API keys and secrets from any project. NEVER writes to vault_items.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Human-readable credential name (e.g. "FlipRadar OpenAI Key")' },
        value:       { type: 'string', description: 'The secret value to encrypt and store' },
        description: { type: 'string', description: 'Optional notes about the credential' },
        project_id:  { type: 'string', description: 'Optional project UUID to associate with this credential' },
      },
      required: ['name', 'value'],
    },
  },
]

// A 'full' token sees every tool; a 'read' token only sees read-scoped tools.
export function toolsForScope(tokenScope: McpTokenScope): McpTool[] {
  if (tokenScope === 'full') return MCP_TOOLS
  return MCP_TOOLS.filter(t => t.scope === 'read')
}

// Whether a token of the given scope is permitted to call the named tool.
export function isToolAllowed(name: string, tokenScope: McpTokenScope): boolean {
  if (tokenScope === 'full') return true
  const tool = MCP_TOOLS.find(t => t.name === name)
  return tool?.scope === 'read'
}

type ToolArgs = Record<string, string | undefined>

export async function callTool(name: string, args: ToolArgs): Promise<string> {
  const supabase = createAdminSupabaseClient()

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

    const { data: handoff } = await supabase
      .from('agent_handoffs')
      .insert({
        project_id: task?.project_id ?? undefined,
        task_id,
        agent_name,
        task_description: task?.title ?? null,
        status: 'in_progress',
      })
      .select('id')
      .single()

    // Mirror the handoff into the vault so MCP-claimed work shows up in the
    // master view, same as the orchestrate UI claimTask path.
    await captureToVault({
      type: 'agent_session',
      title: `${agent_name}: ${(task?.title ?? '').slice(0, 80)}`,
      content: `Task: ${task?.title ?? ''}\n\nStatus: in_progress`,
      project_id: task?.project_id ?? null,
      source_table: 'agent_handoffs',
      source_id: handoff?.id,
      capture_source: 'agent_handoff',
      tags: ['agent', agent_name, 'in_progress'],
      metadata: { agent_name, task_id },
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

    const { data: handoff } = await supabase
      .from('agent_handoffs')
      .update({
        status: 'done',
        github_commit_url: github_commit_url ?? null,
        completed_at: now,
        outcome,
      })
      .eq('task_id', task_id)
      .eq('status', 'in_progress')
      .select('id, project_id, agent_name')
      .single()

    // Mirror completion into the vault so finished handoffs land in the master
    // view. Re-uses the same source_table/source_id as the claim capture, so a
    // backfill re-run won't duplicate it.
    await captureToVault({
      type: 'agent_session',
      title: `${handoff?.agent_name ?? 'agent'}: ${outcome.slice(0, 80)}`,
      content: [
        outcome ? `Outcome: ${outcome}` : '',
        'Status: done',
        github_commit_url ? `Commit: ${github_commit_url}` : '',
      ].filter(Boolean).join('\n\n'),
      project_id: handoff?.project_id ?? task?.project_id ?? null,
      source_table: 'agent_handoffs',
      source_id: handoff?.id,
      capture_source: 'agent_handoff',
      tags: ['agent', handoff?.agent_name, 'done'].filter((t): t is string => Boolean(t)),
      metadata: { agent_name: handoff?.agent_name, task_id, github_commit_url },
    })

    // Auto-QC: fetch diff and run QC when a commit URL is provided
    if (github_commit_url && task?.project_id) {
      const currentQcStatus = task?.codex_qc_status

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

  if (name === 'mc_get_vault_context') {
    const { query, limit } = args
    if (!query) throw new Error('query is required')
    const { queryVaultContext } = await import('@/lib/vault')
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 20) : 8
    const results = await queryVaultContext(query, parsedLimit)
    return JSON.stringify(
      results.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content.slice(0, 500),
        tags: r.tags,
      }))
    )
  }

  if (name === 'mc_list_skills') {
    const { data, error } = await supabase
      .from('vault_items')
      .select('id, title, metadata, tags')
      .eq('type', 'skill')
      .eq('is_mcp_accessible', true)
      .order('title', { ascending: true })

    if (error) throw new Error(error.message)
    return JSON.stringify(
      (data ?? []).map(r => ({
        name: r.title,
        description: (r.metadata as Record<string, string> | null)?.description ?? '',
        tags: r.tags ?? [],
      }))
    )
  }

  if (name === 'mc_get_skill') {
    const { name: skillName } = args
    if (!skillName) throw new Error('name is required')

    const { data, error } = await supabase
      .from('vault_items')
      .select('title, content, metadata, tags')
      .eq('type', 'skill')
      .eq('is_mcp_accessible', true)
      .ilike('title', skillName)
      .single()

    if (error || !data) throw new Error(`Skill not found: ${skillName}`)
    return JSON.stringify({
      name: data.title,
      description: (data.metadata as Record<string, string> | null)?.description ?? '',
      tags: data.tags ?? [],
      content: data.content,
    })
  }

  if (name === 'mc_list_agents') {
    const { data, error } = await supabase
      .from('vault_items')
      .select('id, title, metadata, tags')
      .eq('type', 'agent')
      .eq('is_mcp_accessible', true)
      .order('title', { ascending: true })

    if (error) throw new Error(error.message)
    return JSON.stringify(
      (data ?? []).map(r => ({
        name: r.title,
        description: (r.metadata as Record<string, string> | null)?.description ?? '',
        crew: (r.metadata as Record<string, string> | null)?.crew ?? '',
        tags: r.tags ?? [],
      }))
    )
  }

  if (name === 'mc_get_agent') {
    const { name: agentName } = args
    if (!agentName) throw new Error('name is required')

    const { data, error } = await supabase
      .from('vault_items')
      .select('title, content, metadata, tags')
      .eq('type', 'agent')
      .eq('is_mcp_accessible', true)
      .ilike('title', agentName)
      .single()

    if (error || !data) throw new Error(`Agent not found: ${agentName}`)
    return JSON.stringify({
      name: data.title,
      description: (data.metadata as Record<string, string> | null)?.description ?? '',
      crew: (data.metadata as Record<string, string> | null)?.crew ?? '',
      tags: data.tags ?? [],
      content: data.content,
    })
  }

  if (name === 'mc_browse_vault') {
    const { type, limit, offset } = args
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10), 1), 100) : 25
    const parsedOffset = offset ? Math.max(parseInt(offset, 10), 0) : 0

    let q = supabase
      .from('vault_items')
      .select('id, type, title, tags, created_at')
      // Never expose secrets or personal items through a plain listing.
      .eq('encrypted', false)
      .not('type', 'in', '(credential,personal)')
      .order('created_at', { ascending: false })
      .range(parsedOffset, parsedOffset + parsedLimit - 1)

    if (type) q = q.eq('type', type)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    return JSON.stringify(
      (data ?? []).map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        tags: r.tags ?? [],
        created_at: r.created_at,
      }))
    )
  }

  if (name === 'mc_write_vault') {
    const { title, content, type: itemType } = args
    if (!title || !content || !itemType) throw new Error('title, content, and type are required')

    let tags: string[] = []
    let metadata: Record<string, unknown> = {}
    try { if (args.tags) tags = JSON.parse(args.tags as string) } catch { /* ignore */ }
    try { if (args.metadata) metadata = JSON.parse(args.metadata as string) } catch { /* ignore */ }

    const { data, error } = await supabase
      .from('vault_items')
      .insert({
        type: itemType,
        title,
        content,
        encrypted: false,
        tags,
        metadata,
        is_mcp_accessible: true,
        capture_source: 'mcp_write',
      })
      .select('id, title, type')
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Insert failed')

    try {
      const { embedVaultItem } = await import('@/lib/vault')
      const embedding = await embedVaultItem(title, content, false)
      await supabase.from('vault_items').update({ embedding }).eq('id', data.id)
    } catch (embErr) {
      console.error('[mc_write_vault] embed failed (non-fatal):', embErr)
    }

    return JSON.stringify({ id: data.id, title: data.title, type: data.type })
  }

  if (name === 'mc_update_vault') {
    const { id, title, content, type: itemType } = args

    // Resolve the target row
    let targetId = id
    if (!targetId) {
      if (!title || !itemType) throw new Error('Provide id, or both title and type for lookup')
      const { data: found, error: findErr } = await supabase
        .from('vault_items')
        .select('id')
        .eq('title', title)
        .eq('type', itemType)
        .single()
      if (findErr || !found) throw new Error(`Vault item not found: type=${itemType} title=${title}`)
      targetId = found.id
    }

    const updates: Record<string, unknown> = {}
    if (content !== undefined) updates.content = content
    if (args.tags !== undefined) {
      try { updates.tags = JSON.parse(args.tags as string) } catch { /* ignore */ }
    }
    if (args.metadata !== undefined) {
      try { updates.metadata = JSON.parse(args.metadata as string) } catch { /* ignore */ }
    }
    if (title !== undefined) updates.title = title

    if (Object.keys(updates).length === 0) throw new Error('No fields provided to update')

    const { data: updated, error: updateErr } = await supabase
      .from('vault_items')
      .update(updates)
      .eq('id', targetId)
      .select('id, title, type')
      .single()

    if (updateErr || !updated) throw new Error(updateErr?.message ?? 'Update failed')

    if (content !== undefined) {
      try {
        const { embedVaultItem } = await import('@/lib/vault')
        const embTitle = (updates.title as string | undefined) ?? updated.title
        const embedding = await embedVaultItem(embTitle, content, false)
        await supabase.from('vault_items').update({ embedding }).eq('id', targetId)
      } catch (embErr) {
        console.error('[mc_update_vault] embed failed (non-fatal):', embErr)
      }
    }

    return JSON.stringify({ id: updated.id, title: updated.title, updated: true })
  }

  if (name === 'mc_capture_credential') {
    const { name: credName, value, description, project_id } = args
    if (!credName || !value) throw new Error('name and value are required')

    const encryptedValue = encrypt(value)

    const { data, error } = await supabase
      .from('credentials')
      .insert({
        name: credName,
        key_name: credName.toUpperCase().replace(/\s+/g, '_'),
        value: encryptedValue,
        tier: 'standard',
        project_id: project_id ?? null,
        is_mcp_accessible: false,
        notes: description ?? null,
      })
      .select('id, name')
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Insert failed')
    return JSON.stringify({ id: data.id, name: data.name })
  }

  throw new Error(`Unknown tool: ${name}`)
}
