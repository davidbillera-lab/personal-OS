#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { createInterface } from 'readline'
import crypto from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env.local into process.env (keys not already set only)
try {
  const envPath = join(__dirname, '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
} catch {
  // .env.local absent — rely on environment variables already set
}

function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// AES-256-GCM decrypt — format: iv(24 hex) + authTag(32 hex) + ciphertext(hex) — no separators, matches lib/crypto.ts
function decrypt(encrypted) {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY, 'hex')
  const iv = Buffer.from(encrypted.slice(0, 24), 'hex')
  const tag = Buffer.from(encrypted.slice(24, 56), 'hex')
  const cipher = Buffer.from(encrypted.slice(56), 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8')
}

// AES-256-GCM encrypt — format: iv(24 hex) + authTag(32 hex) + ciphertext(hex) — no separators, matches lib/crypto.ts
function encrypt(plaintext) {
  const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex')
}

// OpenAI text-embedding-3-small via fetch (no SDK dependency)
async function embed(text) {
  const input = String(text).slice(0, 8000)
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input }),
  })
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${res.statusText}`)
  const json = await res.json()
  return json.data[0].embedding
}

// Two-step vault capture (insert → embed update). Mirrors lib/vault.ts captureToVault. Non-fatal.
async function captureToVault({ type, title, content, project_id = null, source_table, source_id, capture_source, tags = [], metadata = {} }) {
  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('vault_items')
      .insert({
        type, title, content, encrypted: false, tags,
        project_id,
        source_table: source_table ?? null,
        source_id: source_id ?? null,
        is_mcp_accessible: false,
        metadata,
        capture_source,
      })
      .select('id')
      .single()

    if (error || !data) {
      process.stderr.write(`[captureToVault] insert failed: ${error?.message ?? 'no data'}\n`)
      return
    }

    try {
      const embedding = await embed(`${title} ${content}`)
      await supabase.from('vault_items').update({ embedding }).eq('id', data.id)
    } catch (embErr) {
      process.stderr.write(`[captureToVault] embed failed (non-fatal): ${embErr}\n`)
    }
  } catch (err) {
    process.stderr.write(`[captureToVault] unexpected error: ${err}\n`)
  }
}

// Tool definitions — exact parity with MCP_TOOLS in lib/mcp-tools.ts
const MCP_TOOLS = [
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
        github_commit_url: { type: 'string', description: 'GitHub commit URL' },
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
    description: "Update a project's status, next_action, and/or blockers at the end of a session.",
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
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mc_get_skill',
    description: 'Fetch the full content of a skill by name. Use mc_list_skills first to discover available skill names.',
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
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mc_get_agent',
    description: 'Fetch the full definition (frontmatter + system prompt) of a subagent by name. Use mc_list_agents first to discover available agent names.',
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
    description: 'Enumerate vault items in reverse-chronological order (most recent first). Unlike mc_get_vault_context (semantic search), this is a plain listing for browsing what exists. Optionally filter by type. Never returns encrypted or personal items.',
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
    description: "Insert a new vault_items row with embedding. Use to push specs, decisions, agent sessions, or knowledge from any project agent into Mission Control's vault.",
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

async function callTool(name, args) {
  const supabase = createAdminSupabaseClient()

  if (name === 'mc_get_pending_tasks') {
    let query = supabase
      .from('tasks')
      .select('id, title, description, generated_spec, recommended_tool, recommended_model, complexity_tier, agent_assigned_to, project_id, status')
      .not('generated_spec', 'is', null)
      .not('status', 'in', '("done","killed")')
      .order('created_at', { ascending: false })

    if (args.project_id) query = query.eq('project_id', args.project_id)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return JSON.stringify(data ?? [])
  }

  if (name === 'mc_claim_task') {
    const { task_id, agent_name } = args
    if (!task_id || !agent_name) throw new Error('task_id and agent_name are required')

    const { data: task } = await supabase
      .from('tasks').select('project_id, title').eq('id', task_id).single()

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
      .from('tasks').select('project_id, agent_assigned_to').eq('id', task_id).single()

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

    await captureToVault({
      type: 'agent_session',
      title: `${handoff?.agent_name ?? 'agent'}: ${outcome.slice(0, 80)}`,
      content: [
        `Outcome: ${outcome}`,
        'Status: done',
        github_commit_url ? `Commit: ${github_commit_url}` : '',
      ].filter(Boolean).join('\n\n'),
      project_id: handoff?.project_id ?? task?.project_id ?? null,
      source_table: 'agent_handoffs',
      source_id: handoff?.id,
      capture_source: 'agent_handoff',
      tags: ['agent', handoff?.agent_name, 'done'].filter(Boolean),
      metadata: { agent_name: handoff?.agent_name, task_id, github_commit_url },
    })

    // Auto-QC requires Next.js server actions — not available in local stdio server
    if (github_commit_url) {
      return JSON.stringify({ ok: true, completed_at: now, qc: 'not_available_in_local_server' })
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

    const update = { last_update: new Date().toISOString() }
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

    const parsedLimit = limit ? Math.min(Number(limit), 20) : 8
    const queryEmbedding = await embed(query)

    const { data, error } = await supabase.rpc('match_vault_items', {
      query_embedding: queryEmbedding,
      match_count: parsedLimit,
    })

    if (error) throw new Error(error.message)
    return JSON.stringify(
      (data ?? []).map(r => ({
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
        description: r.metadata?.description ?? '',
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
      description: data.metadata?.description ?? '',
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
        description: r.metadata?.description ?? '',
        crew: r.metadata?.crew ?? '',
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
      description: data.metadata?.description ?? '',
      crew: data.metadata?.crew ?? '',
      tags: data.tags ?? [],
      content: data.content,
    })
  }

  if (name === 'mc_browse_vault') {
    const { type, limit, offset } = args
    const parsedLimit = limit ? Math.min(Math.max(Number(limit), 1), 100) : 25
    const parsedOffset = offset ? Math.max(Number(offset), 0) : 0

    let q = supabase
      .from('vault_items')
      .select('id, type, title, tags, created_at')
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

    let tags = []
    let metadata = {}
    try { if (args.tags) tags = JSON.parse(args.tags) } catch { /* ignore */ }
    try { if (args.metadata) metadata = JSON.parse(args.metadata) } catch { /* ignore */ }

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
      const embedding = await embed(`${title} ${content}`)
      await supabase.from('vault_items').update({ embedding }).eq('id', data.id)
    } catch (embErr) {
      process.stderr.write(`[mc_write_vault] embed failed (non-fatal): ${embErr}\n`)
    }

    return JSON.stringify({ id: data.id, title: data.title, type: data.type })
  }

  if (name === 'mc_update_vault') {
    const { id, title, content, type: itemType } = args

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

    const updates = {}
    if (content !== undefined) updates.content = content
    if (args.tags !== undefined) {
      try { updates.tags = JSON.parse(args.tags) } catch { /* ignore */ }
    }
    if (args.metadata !== undefined) {
      try { updates.metadata = JSON.parse(args.metadata) } catch { /* ignore */ }
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
        const embTitle = updates.title ?? updated.title
        const embedding = await embed(`${embTitle} ${content}`)
        await supabase.from('vault_items').update({ embedding }).eq('id', targetId)
      } catch (embErr) {
        process.stderr.write(`[mc_update_vault] embed failed (non-fatal): ${embErr}\n`)
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
        // DB check constraint allows only 'global' | 'project' — derive from scope.
        tier: project_id ? 'project' : 'global',
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

// Stdio JSON-RPC 2.0 transport
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }

  const { id, method, params } = msg

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mission-control', version: '1.0.0' },
      },
    })
    return
  }

  if (method === 'notifications/initialized') {
    // Notifications require no response
    return
  }

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } })
    return
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const toolArgs = params?.arguments ?? {}

    if (!toolName) {
      send({ jsonrpc: '2.0', id: id ?? null, error: { code: -32602, message: 'Missing tool name' } })
      return
    }

    _inflight++
    try {
      const text = await callTool(toolName, toolArgs)
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${message}` }], isError: true } })
    } finally {
      _inflight--
      if (_stdinClosed && _inflight === 0) process.exit(0)
    }
    return
  }

  send({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } })
})

// Track in-flight async ops so we don't exit mid-request when stdin closes
let _stdinClosed = false
let _inflight = 0
rl.on('close', () => {
  _stdinClosed = true
  if (_inflight === 0) process.exit(0)
})

process.stderr.write('[mcp-server] Mission Control stdio server ready\n')
