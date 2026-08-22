import { createAdminSupabaseClient } from '@/lib/supabase'
import { decrypt, encrypt } from '@/lib/crypto'
import { fetchGitHubDiff } from '@/lib/github'
import { runCodexQC, rerunCodexQCOnSpec } from '@/app/(app)/projects/[id]/actions'
import { captureToVault } from '@/lib/vault'
import { applyApprovalDecision } from '@/scripts/lib/approval-binding.mjs'
import {
  buildWorkflowRequestText,
  JARVIS_WORKFLOW_TYPE,
  LIAISON_WORKERS,
  planRequestResume,
  validateLiaisonAssignment,
  workflowTitle,
  workflowTypeFromRequestText,
} from '@/lib/liaison-workflows'

// 'read' = safe to expose to low-trust clients (e.g. a phone connector).
// 'write' = mutates state OR returns secrets (mc_get_credential); full token only.
export type McpScope = 'read' | 'write'

// The privilege a presented token grants. 'full' can call everything;
// 'read' is restricted to read-scoped tools; 'liaison' is the narrow ChatGPT
// chief-of-staff surface — exactly the request-queue tools below, nothing else
// (no vault, no credentials, no worker mutations). 'orchestrator' is Hermes's
// dispatcher role: every read tool PLUS exactly three routing/planning writes
// (claim + reassign + submit-plan) — it can pick up and route a request, and
// deposit a planning artifact on its own submitted work, but never execute,
// complete, fail, promote to queued, or touch the vault/credentials. Execution
// stays with real workers. 'chief' is the Hermes chief-of-staff surface: read +
// exactly mc_submit_plan, with NO routing writes at all (see CHIEF_TOOLS).
export type McpTokenScope = 'full' | 'read' | 'liaison' | 'orchestrator' | 'chief'

// The only write tools an 'orchestrator' token adds on top of the read set.
// Widen ONLY by adding a name here — never by loosening the checks below.
export const ORCHESTRATOR_EXTRA_TOOLS = new Set<string>([
  'mc_claim_request',
  'mc_reassign_request',
  'mc_submit_plan',
])

// The exact tool set a 'liaison' token may see and call. Deliberately tiny:
// submit a request + read its status/list/stalled/result. Widen only by adding
// a name here, never by loosening the scope check.
export const LIAISON_TOOLS = new Set<string>([
  'mc_submit_request',
  'mc_get_request_status',
  'mc_get_request',
  'mc_list_recent_requests',
  'mc_queue_status',
  'mc_list_workers',
  'mc_whats_stalled',
  'mc_get_result',
  'mc_respond_approval',
  'mc_list_projects',
  'mc_get_project_summary',
  'mc_start_workflow',
  'mc_get_workflow_status',
  'mc_list_pending_approvals',
  'mc_get_workflow_result',
  'mc_assign_request',
  'mc_resume_request',
])

// The exact tool set a 'chief' token may see and call — the Hermes chief-of-staff
// surface. It is 'orchestrator' MINUS the routing writes: every read tool the role
// actually needs, plus mc_submit_plan as the single bounded transport exception.
// mc_claim_request and mc_reassign_request are deliberately ABSENT: routing is done
// server-side by /api/queue/dispatch (CRON_SECRET-gated), so the chief role never
// needs them.
//
// Deliberately an explicit name list, NOT `scope === 'read' || extras`. A tool newly
// added to MCP_TOOLS — even a read one — stays denied to 'chief' until someone adds
// its name here on purpose. Widen only by adding a name; never by loosening the check.
export const CHIEF_TOOLS = new Set<string>([
  // reads
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
  // the one bounded write: deposit a plan on its own submitted request
  'mc_submit_plan',
])

export interface McpTool {
  name: string
  description: string
  scope: McpScope
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
  // MCP behavioural hints surfaced to clients via tools/list. Read-scoped tools
  // carry readOnlyHint: true so a liaison connector knows they cause no mutation.
  annotations?: { readOnlyHint?: boolean }
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'mc_get_pending_tasks',
    description: 'Returns tasks that have a generated spec and are not yet completed. Optionally filter by project_id.',
    scope: 'read',
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: true },
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
    description: 'Semantic search over vault items. Pass the current task description to get relevant skills, agent roles, and knowledge items back as 200-char previews with ids. Call mc_get_vault_item with an id to fetch full content — do NOT re-search with broader queries to see more text. Never returns encrypted or personal items.',
    scope: 'read',
    annotations: { readOnlyHint: true },
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
    name: 'mc_get_vault_item',
    description: 'Fetch ONE vault item\'s full content by id. Token-lean pattern: search with mc_get_vault_context or list with mc_browse_vault (cheap previews), then call this for the single item you actually need. Never returns encrypted or personal items.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Vault item UUID from a prior search or browse result' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mc_list_skills',
    description: 'List all operator workflow skills stored in the vault. Returns title, description, and tags for each skill. Call this at session start to discover which skills apply to your task, then call mc_get_skill to fetch full content.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mc_get_skill',
    description: 'Fetch the full content of a skill by name. Use mc_list_skills first to discover available skill names.',
    scope: 'read',
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mc_get_agent',
    description: 'Fetch the full definition (frontmatter + system prompt) of a subagent by name. Use mc_list_agents first to discover available agent names.',
    scope: 'read',
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: true },
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
  {
    name: 'mc_submit_request',
    description: 'Submit a legacy direct request into the Mission Control worker queue. Do NOT use this for the Hermes-plan, Claude-build, Codex-review route; use mc_start_workflow instead. Creates a queue record only — it never runs code, deploys, sends messages, or spends money.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_text:      { type: 'string', description: 'What Mission Control should do, in plain language.' },
        title:             { type: 'string', description: 'Optional short title for the request.' },
        priority:          { type: 'string', description: 'low | normal | high | urgent (default normal).' },
        preferred_worker:  { type: 'string', description: 'auto | hermes | claude (default auto).' },
        source:            { type: 'string', description: 'Origin, e.g. chatgpt_voice or chatgpt_text (default chatgpt_liaison).' },
        client_request_id: { type: 'string', description: 'Optional idempotency key — resubmitting the same id returns the existing request instead of a duplicate.' },
      },
      required: ['request_text'],
    },
  },
  {
    name: 'mc_get_request_status',
    description: 'Get the current status of one Mission Control request: state, assignee, latest progress, blocker, whether approval is required, and last-updated time.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string', description: 'The request_id returned by mc_submit_request.' } },
      required: ['request_id'],
    },
  },
  {
    name: 'mc_get_request',
    description: 'Get allowlisted Mission Control request details plus its request-linked MCP audit trail. Audit correlation begins with the request-context migration; older audit calls cannot be attributed retroactively.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string', description: 'Exact Mission Control request UUID.' } },
      required: ['request_id'],
    },
  },
  {
    name: 'mc_list_recent_requests',
    description: 'List recent Mission Control requests (most recent first). Optionally filter by status. Concise fields only.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status filter (e.g. queued, in_progress, completed).' },
        limit:  { type: 'string', description: 'Max rows to return (default 20, max 50).' },
      },
    },
  },
  {
    name: 'mc_queue_status',
    description: 'Summarize the Mission Control request queue by state, including total active work, attention-needed work, and the oldest active request. Does not mutate the queue.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mc_list_workers',
    description: 'List the fixed worker identities that the Liaison may assign, with their roles and capabilities. This is a policy allowlist, not a claim that a worker is currently online.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mc_whats_stalled',
    description: 'List Mission Control requests that need attention: blocked, awaiting approval, failed, or with no progress in 30 minutes. Returns a reason for each.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mc_get_result',
    description: 'Get the completed result of a Mission Control request: whether it is done, the result summary, artifact references, and completion time.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string', description: 'The request_id to fetch the result for.' } },
      required: ['request_id'],
    },
  },
  {
    name: 'mc_list_projects',
    description: 'List safe Mission Control project identifiers and concise status fields so a liaison can resolve a spoken project name without guessing. Never returns vault items or credentials.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max projects to return (default 30, max 50).' },
      },
    },
  },
  {
    name: 'mc_get_project_summary',
    description: 'Get a redacted Mission Control project summary by exact project UUID. Use mc_list_projects first when the user spoke a project name; never guess the UUID.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Exact project UUID returned by mc_list_projects.' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'mc_start_workflow',
    description: 'Record a spec_build_qc_push workflow for one exact project. It enters submitted state for Hermes planning and DOES NOT claim work, run code, push, merge, or deploy. Returns a workflow/request ID for tracking.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        project_id:       { type: 'string', description: 'Exact project UUID returned by mc_list_projects.' },
        outcome:          { type: 'string', description: 'The concrete result David wants.' },
        constraints:      { type: 'string', description: 'Optional scope, safety, timing, or implementation constraints.' },
        title:            { type: 'string', description: 'Optional short workflow title.' },
        priority:         { type: 'string', description: 'low | normal | high | urgent (default normal).' },
        source:           { type: 'string', description: 'chatgpt_voice or chatgpt_text (default chatgpt_voice).' },
        client_request_id:{ type: 'string', description: 'Strongly recommended idempotency key for voice retries.' },
      },
      required: ['project_id', 'outcome'],
    },
  },
  {
    name: 'mc_get_workflow_status',
    description: 'Read the evidence-backed state of one Jarvis workflow, including stage, worker, progress, blocker, current attempt, reviewed SHA, and approval state. Call before reporting progress or accepting approval.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { workflow_id: { type: 'string', description: 'The workflow_id returned by mc_start_workflow.' } },
      required: ['workflow_id'],
    },
  },
  {
    name: 'mc_list_pending_approvals',
    description: 'List current Mission Control approvals requiring David. Returns exact workflow, attempt, action context, and reviewed SHA when available; never executes the action.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Max approvals to return (default 20, max 50).' },
      },
    },
  },
  {
    name: 'mc_get_workflow_result',
    description: 'Get the evidence-backed final result and artifacts for one Jarvis workflow. A non-completed workflow is returned as not complete; no result is inferred.',
    scope: 'read',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { workflow_id: { type: 'string', description: 'The workflow_id returned by mc_start_workflow.' } },
      required: ['workflow_id'],
    },
  },
  {
    name: 'mc_assign_request',
    description: 'Assign a non-terminal Mission Control request to one allowlisted worker without changing its state. Cannot bypass a pending approval or alter completed, failed, or cancelled work.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Exact Mission Control request UUID.' },
        worker: { type: 'string', description: 'One of hermes, claude, or codex-qc.' },
      },
      required: ['request_id', 'worker'],
    },
  },
  {
    name: 'mc_resume_request',
    description: 'Resume blocked or failed work using fail-safe routing. Jarvis workflows return to submitted/Hermes planning; legacy requests return to the ordinary queue. Never resolves approvals, restarts terminal work, pushes, merges, or deploys.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Exact blocked or failed Mission Control request UUID.' },
        reason: { type: 'string', description: 'Short operator-provided reason for resuming the work.' },
      },
      required: ['request_id', 'reason'],
    },
  },
  {
    name: 'mc_submit_plan',
    description: 'Hermes deposits a planning artifact on its own submitted+assigned request. Sets phase to planned; never changes status, assignment, or approval fields, and can never produce a queued (executable) request.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'The submitted, hermes-assigned Mission Control request UUID.' },
        plan: { type: 'string', description: 'The planning artifact text (max 32768 characters). Write-once — rejected if a plan is already stored.' },
      },
      required: ['request_id', 'plan'],
    },
  },
  // --- Worker interface (Phase 1) ---------------------------------------------
  // Full-key only (scope 'write'); NEVER exposed to the liaison. Operated by real
  // Claude/Codex sessions. Every call is state-machine-validated + audited.
  {
    name: 'mc_claim_request',
    description: 'Worker claims a queued request. Sets assignee and moves it to claimed. Only valid from status queued.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request to claim.' },
        worker:     { type: 'string', description: 'Claiming worker identity (e.g. claude, codex-qc).' },
      },
      required: ['request_id', 'worker'],
    },
  },
  {
    name: 'mc_reassign_request',
    description: 'Reassign a non-terminal request to a different worker. Does not change its status.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request to reassign.' },
        worker:     { type: 'string', description: 'New assignee (hermes, claude, codex-qc).' },
      },
      required: ['request_id', 'worker'],
    },
  },
  {
    name: 'mc_post_progress',
    description: 'Post a progress update on a claimed/in-progress request. Moves it to in_progress.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request to update.' },
        progress:   { type: 'string', description: 'Short progress note.' },
      },
      required: ['request_id', 'progress'],
    },
  },
  {
    name: 'mc_mark_blocked',
    description: 'Mark a request blocked with a reason. Valid from claimed or in_progress.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request to block.' },
        blocker:    { type: 'string', description: 'What is blocking it.' },
      },
      required: ['request_id', 'blocker'],
    },
  },
  {
    name: 'mc_request_approval',
    description: "Move a request to awaiting_approval and set approval_required. Use before any materially risky action (deploy, protected push, external send, spend, credential change). Does NOT execute the action.",
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request needing approval.' },
        reason:     { type: 'string', description: 'What is being requested and why it needs David.' },
      },
      required: ['request_id', 'reason'],
    },
  },
  {
    name: 'mc_respond_approval',
    description: "MC-only approval relay: record the operator's approve/reject decision on an awaiting_approval request and flip its state. NEVER executes the push — the dispatcher's separate gated step does that. Call mc_get_request_status first to obtain attempt_id.",
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request awaiting approval.' },
        decision:   { type: 'string', description: 'approve or reject' },
        attempt_id: { type: 'string', description: 'The attempt_id from mc_get_request_status; binds this approval to the reviewed attempt.' },
        note:       { type: 'string', description: 'Optional note (e.g. reason for rejection).' },
      },
      required: ['request_id', 'decision', 'attempt_id'],
    },
  },
  {
    name: 'mc_complete_request',
    description: 'Complete a request with a result summary and optional artifact references. Sets completed_at.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id:     { type: 'string', description: 'Request to complete.' },
        result_summary: { type: 'string', description: 'Human-readable summary of what was done / the result.' },
        artifact_refs:  { type: 'string', description: 'Optional JSON array of links/references (commits, PRs, files).' },
      },
      required: ['request_id', 'result_summary'],
    },
  },
  {
    name: 'mc_mark_failed',
    description: 'Mark a request failed with a reason.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'Request that failed.' },
        reason:     { type: 'string', description: 'Why it failed.' },
      },
      required: ['request_id', 'reason'],
    },
  },
]

// A 'full' token sees every tool; 'liaison' sees only the request-queue tools;
// 'orchestrator' sees read tools + the two routing writes; 'read' sees read-scoped tools.
export function toolsForScope(tokenScope: McpTokenScope): McpTool[] {
  if (tokenScope === 'full') return MCP_TOOLS
  if (tokenScope === 'liaison') return MCP_TOOLS.filter(t => LIAISON_TOOLS.has(t.name))
  if (tokenScope === 'chief') return MCP_TOOLS.filter(t => CHIEF_TOOLS.has(t.name))
  if (tokenScope === 'orchestrator') return MCP_TOOLS.filter(t => t.scope === 'read' || ORCHESTRATOR_EXTRA_TOOLS.has(t.name))
  return MCP_TOOLS.filter(t => t.scope === 'read')
}

// Whether a token of the given scope is permitted to call the named tool.
export function isToolAllowed(name: string, tokenScope: McpTokenScope): boolean {
  if (tokenScope === 'full') return true
  if (tokenScope === 'liaison') return LIAISON_TOOLS.has(name)
  if (tokenScope === 'chief') return CHIEF_TOOLS.has(name)
  const tool = MCP_TOOLS.find(t => t.name === name)
  if (tokenScope === 'orchestrator') return tool?.scope === 'read' || ORCHESTRATOR_EXTRA_TOOLS.has(name)
  return tool?.scope === 'read'
}

type ToolArgs = Record<string, string | undefined>

// Worker state-machine transition: fetch current status, enforce the allowed
// source states, apply updates + bump updated_at. Rejects invalid transitions so
// a worker can't (e.g.) complete a request that was never claimed.
async function transitionRequest(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  requestId: string,
  allowedFrom: string[],
  updates: Record<string, unknown>,
) {
  const { data: cur, error } = await supabase.from('mc_requests').select('status').eq('id', requestId).single()
  if (error || !cur) throw new Error(`Request not found: ${requestId}`)
  if (!allowedFrom.includes(cur.status)) {
    throw new Error(`Not allowed from status '${cur.status}' (allowed: ${allowedFrom.join(', ')})`)
  }
  const { data, error: uerr } = await supabase
    .from('mc_requests')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .select('id, status, assigned_to')
    .single()
  if (uerr || !data) throw new Error(uerr?.message ?? 'Update failed')
  return data
}

// Hard size cap for a submitted planning artifact (mc_submit_plan). Kept as a
// named export so the limit is documented in one place and testable.
export const MC_SUBMIT_PLAN_MAX_LENGTH = 32768

// Pure input check for mc_submit_plan's `plan` argument — no DB access, so it's
// unit-testable on its own. Throws a clean Error; returns the validated plan.
export function validatePlanArg(plan: string | undefined): string {
  if (!plan || !plan.trim()) throw new Error('plan is required')
  if (plan.length > MC_SUBMIT_PLAN_MAX_LENGTH) {
    throw new Error(`plan exceeds max length of ${MC_SUBMIT_PLAN_MAX_LENGTH} characters`)
  }
  return plan
}

// Pure precondition + write-once check for mc_submit_plan, run against the
// fetched mc_requests row. No DB access, so it's unit-testable on its own.
export function validatePlanPrecondition(current: { status: string; assigned_to: string | null; plan?: string | null }): void {
  if (current.status !== 'submitted' || current.assigned_to !== 'hermes') {
    throw new Error('Plan intake requires a submitted request assigned to hermes')
  }
  if (current.plan) {
    throw new Error('plan already submitted')
  }
}

export async function callTool(name: string, args: ToolArgs, actor = 'system'): Promise<string> {
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
      .select('name, status, next_action, blockers, lead_model, current_agent, stage, asset_class')
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
        content: r.content.slice(0, 200),
        truncated: r.content.length > 200,
        tags: r.tags,
      }))
    )
  }

  if (name === 'mc_get_vault_item') {
    const { id } = args
    if (!id) throw new Error('id is required')
    const { data, error } = await supabase
      .from('vault_items')
      .select('id, type, title, content, tags, project_id, created_at, updated_at')
      .eq('id', id)
      .eq('encrypted', false)
      .eq('is_mcp_accessible', true)
      .not('type', 'in', '(credential,personal)')
      .single()
    if (error || !data) throw new Error(`Vault item not found or not MCP-accessible: ${id}`)
    return JSON.stringify(data)
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

  if (name === 'mc_list_projects') {
    const parsedLimit = args.limit ? Math.min(Math.max(parseInt(args.limit, 10) || 30, 1), 50) : 30
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, slug, tier, protected, stage, status, next_action, blockers, last_update')
      .order('tier', { ascending: true })
      .order('name', { ascending: true })
      .limit(parsedLimit)
    if (error) throw new Error(error.message)
    return JSON.stringify(data ?? [])
  }

  if (name === 'mc_get_project_summary') {
    const { project_id } = args
    if (!project_id) throw new Error('project_id is required')
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, slug, tier, protected, stage, status, description, repo_url, next_action, blockers, last_update')
      .eq('id', project_id)
      .single()
    if (error || !data) throw new Error(`Project not found: ${project_id}`)
    return JSON.stringify(data)
  }

  if (name === 'mc_start_workflow') {
    const { project_id, constraints, client_request_id } = args
    const outcome = args.outcome?.trim()
    if (!project_id) throw new Error('project_id is required')
    if (!outcome) throw new Error('outcome is required')
    if (outcome.length > 4000) throw new Error('outcome too long (max 4000 chars)')
    if ((constraints?.length ?? 0) > 4000) throw new Error('constraints too long (max 4000 chars)')

    const { data: project, error: projectError } = await supabase
      .from('projects').select('id, name, slug').eq('id', project_id).single()
    if (projectError || !project) throw new Error(`Project not found: ${project_id}`)

    const request_text = buildWorkflowRequestText(project, outcome, constraints)
    const title = workflowTitle(outcome, args.title)
    const priority = ['low', 'normal', 'high', 'urgent'].includes(args.priority ?? '') ? args.priority : 'normal'
    const source = ['chatgpt_voice', 'chatgpt_text'].includes(args.source ?? '') ? args.source : 'chatgpt_voice'
    const dupCols = 'id, status, created_at, assigned_to, project_id, request_text'

    if (client_request_id) {
      const { data: existing } = await supabase
        .from('mc_requests').select(dupCols).eq('client_request_id', client_request_id).maybeSingle()
      if (existing) {
        if (workflowTypeFromRequestText(existing.request_text) !== JARVIS_WORKFLOW_TYPE) {
          throw new Error('client_request_id already belongs to a non-Jarvis request')
        }
        return JSON.stringify({
          workflow_id: existing.id, request_id: existing.id, workflow_type: JARVIS_WORKFLOW_TYPE,
          status: existing.status, created_at: existing.created_at, assigned_to: existing.assigned_to,
          project_id: existing.project_id, duplicate: true,
          confirmation: 'Existing workflow returned (idempotent). No new execution was started.',
        })
      }
    } else {
      const twoMinAgo = new Date(Date.now() - 120_000).toISOString()
      const { data: recent } = await supabase
        .from('mc_requests').select(dupCols).eq('project_id', project_id).eq('request_text', request_text)
        .gte('created_at', twoMinAgo).order('created_at', { ascending: false }).limit(1)
      if (recent?.length) {
        const existing = recent[0]
        return JSON.stringify({
          workflow_id: existing.id, request_id: existing.id, workflow_type: JARVIS_WORKFLOW_TYPE,
          status: existing.status, created_at: existing.created_at, assigned_to: existing.assigned_to,
          project_id: existing.project_id, duplicate: true,
          confirmation: 'Duplicate voice workflow suppressed. No new execution was started.',
        })
      }
    }

    // Fail-safe bridge to Claude's planner-capable backend: the existing v0
    // dispatcher claims only `queued`, so `submitted` cannot skip Hermes planning.
    const { data, error } = await supabase
      .from('mc_requests')
      .insert({
        title, request_text, priority, preferred_worker: 'hermes', source,
        created_by: actor, client_request_id: client_request_id ?? null,
        status: 'submitted', assigned_to: 'hermes', project_id,
        latest_progress: 'Workflow submitted; waiting for the Hermes planning stage.',
      })
      .select('id, status, created_at, assigned_to, project_id')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Workflow insert failed')
    return JSON.stringify({
      workflow_id: data.id, request_id: data.id, workflow_type: JARVIS_WORKFLOW_TYPE,
      status: data.status, created_at: data.created_at, assigned_to: data.assigned_to,
      project_id: data.project_id, duplicate: false,
      confirmation: 'Workflow submitted for Hermes planning. No build, push, merge, or deployment has run.',
    })
  }

  if (name === 'mc_get_workflow_status') {
    const workflow_id = args.workflow_id
    if (!workflow_id) throw new Error('workflow_id is required')
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, project_id, title, request_text, status, phase, assigned_to, latest_progress, blocker, approval_required, attempt_id, reviewed_sha, approved_sha, approved_by, approved_at, updated_at')
      .eq('id', workflow_id).single()
    if (error || !data) throw new Error(`Workflow not found: ${workflow_id}`)
    return JSON.stringify({
      workflow_id: data.id, workflow_type: workflowTypeFromRequestText(data.request_text), project_id: data.project_id,
      title: data.title, status: data.status, phase: data.phase, assigned_to: data.assigned_to,
      latest_progress: data.latest_progress, blocker: data.blocker,
      approval_required: data.approval_required, attempt_id: data.attempt_id,
      reviewed_sha: data.reviewed_sha, approved_sha: data.approved_sha, approved_by: data.approved_by,
      approved_at: data.approved_at, updated_at: data.updated_at,
    })
  }

  if (name === 'mc_list_pending_approvals') {
    const parsedLimit = args.limit ? Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50) : 20
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, project_id, title, request_text, status, phase, assigned_to, blocker, attempt_id, reviewed_sha, updated_at')
      .eq('status', 'awaiting_approval').eq('approval_required', true)
      .order('updated_at', { ascending: true }).limit(parsedLimit)
    if (error) throw new Error(error.message)
    return JSON.stringify((data ?? []).map(row => ({
      workflow_id: row.id, workflow_type: workflowTypeFromRequestText(row.request_text), project_id: row.project_id,
      title: row.title, status: row.status, phase: row.phase, assigned_to: row.assigned_to,
      requested_action: row.blocker, attempt_id: row.attempt_id, reviewed_sha: row.reviewed_sha,
      updated_at: row.updated_at,
    })))
  }

  if (name === 'mc_get_workflow_result') {
    const workflow_id = args.workflow_id
    if (!workflow_id) throw new Error('workflow_id is required')
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, project_id, title, request_text, status, phase, result_summary, artifact_refs, latest_progress, reviewed_sha, completed_at, updated_at')
      .eq('id', workflow_id).single()
    if (error || !data) throw new Error(`Workflow not found: ${workflow_id}`)
    return JSON.stringify({
      workflow_id: data.id, workflow_type: workflowTypeFromRequestText(data.request_text), project_id: data.project_id,
      title: data.title, status: data.status, phase: data.phase, completed: data.status === 'completed',
      result_summary: data.result_summary, artifact_refs: data.artifact_refs,
      latest_progress: data.latest_progress, reviewed_sha: data.reviewed_sha,
      completed_at: data.completed_at, updated_at: data.updated_at,
    })
  }

  if (name === 'mc_submit_request') {
    const request_text = args.request_text
    if (!request_text || !request_text.trim()) throw new Error('request_text is required')
    if (request_text.length > 8000) throw new Error('request_text too long (max 8000 chars)')

    const title = args.title?.slice(0, 200) ?? null
    const priority = ['low', 'normal', 'high', 'urgent'].includes(args.priority ?? '') ? args.priority : 'normal'
    const preferred_worker = ['auto', 'hermes', 'claude'].includes(args.preferred_worker ?? '') ? args.preferred_worker : 'auto'
    const source = args.source?.slice(0, 40) ?? 'chatgpt_liaison'
    const client_request_id = args.client_request_id ?? null

    // Idempotency / duplicate-Voice protection. Explicit client_request_id is
    // authoritative; otherwise suppress an identical request_text within 2 min.
    const dupCols = 'id, status, created_at, assigned_to'
    if (client_request_id) {
      const { data: existing } = await supabase
        .from('mc_requests').select(dupCols).eq('client_request_id', client_request_id).maybeSingle()
      if (existing) {
        return JSON.stringify({ request_id: existing.id, status: existing.status, created_at: existing.created_at, assigned_to: existing.assigned_to, duplicate: true, confirmation: 'Existing request returned (idempotent).' })
      }
    } else {
      const twoMinAgo = new Date(Date.now() - 120_000).toISOString()
      const { data: recent } = await supabase
        .from('mc_requests').select(dupCols).eq('request_text', request_text).gte('created_at', twoMinAgo)
        .order('created_at', { ascending: false }).limit(1)
      if (recent && recent.length) {
        const e = recent[0]
        return JSON.stringify({ request_id: e.id, status: e.status, created_at: e.created_at, assigned_to: e.assigned_to, duplicate: true, confirmation: 'Duplicate suppressed (identical request within 2 minutes).' })
      }
    }

    const { data, error } = await supabase
      .from('mc_requests')
      .insert({
        request_text, title, priority, preferred_worker, source,
        created_by: 'chatgpt-liaison',
        client_request_id,
        status: 'queued',
        assigned_to: preferred_worker !== 'auto' ? preferred_worker : null,
      })
      .select('id, status, created_at, assigned_to')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'Insert failed')
    return JSON.stringify({ request_id: data.id, status: data.status, created_at: data.created_at, assigned_to: data.assigned_to, confirmation: `Request queued as ${data.id}.` })
  }

  if (name === 'mc_get_request_status') {
    const { request_id } = args
    if (!request_id) throw new Error('request_id is required')
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, status, assigned_to, latest_progress, blocker, approval_required, attempt_id, phase, updated_at')
      .eq('id', request_id).single()
    if (error || !data) throw new Error(`Request not found: ${request_id}`)
    return JSON.stringify({
      request_id: data.id, status: data.status, assigned_to: data.assigned_to,
      latest_progress: data.latest_progress, blocker: data.blocker,
      approval_required: data.approval_required, attempt_id: data.attempt_id, phase: data.phase,
      updated_at: data.updated_at,
    })
  }

  if (name === 'mc_get_request') {
    const { request_id } = args
    if (!request_id) throw new Error('request_id is required')
    const [{ data: request, error: requestError }, { data: audit, error: auditError }] = await Promise.all([
      supabase
        .from('mc_requests')
        .select('id, title, status, assigned_to, priority, source, created_at, updated_at, latest_progress, blocker, request_text')
        .eq('id', request_id)
        .single(),
      supabase
        .from('mcp_audit_log')
        .select('id, actor, tool, ok, created_at')
        .eq('request_id', request_id)
        .order('created_at', { ascending: true }),
    ])
    if (requestError || !request) throw new Error(`Request not found: ${request_id}`)
    if (auditError) throw new Error('Request audit unavailable')
    return JSON.stringify({
      request,
      audit_trail: audit ?? [],
      audit_scope: 'Request-linked MCP calls from the audit-correlation migration forward; historical unlinked calls are not inferred.',
    })
  }

  if (name === 'mc_list_recent_requests') {
    const parsedLimit = args.limit ? Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50) : 20
    let q = supabase
      .from('mc_requests')
      .select('id, title, status, priority, assigned_to, created_at, updated_at')
      .order('created_at', { ascending: false }).limit(parsedLimit)
    if (args.status) q = q.eq('status', args.status)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return JSON.stringify((data ?? []).map(r => ({
      request_id: r.id, title: r.title, status: r.status, priority: r.priority,
      assigned_to: r.assigned_to, created_at: r.created_at, updated_at: r.updated_at,
    })))
  }

  if (name === 'mc_queue_status') {
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, title, status, assigned_to, created_at, updated_at')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    const counts: Record<string, number> = {}
    for (const request of data ?? []) counts[request.status] = (counts[request.status] ?? 0) + 1
    const terminal = new Set(['completed', 'failed', 'cancelled'])
    const active = (data ?? []).filter(request => !terminal.has(request.status))
    const attention = (data ?? []).filter(request => ['blocked', 'awaiting_approval', 'failed'].includes(request.status))
    const oldest = active[0]
    return JSON.stringify({
      total: data?.length ?? 0,
      active: active.length,
      attention_needed: attention.length,
      by_status: counts,
      oldest_active: oldest ? {
        request_id: oldest.id,
        title: oldest.title,
        status: oldest.status,
        assigned_to: oldest.assigned_to,
        created_at: oldest.created_at,
        updated_at: oldest.updated_at,
      } : null,
    })
  }

  if (name === 'mc_list_workers') {
    return JSON.stringify({
      workers: LIAISON_WORKERS,
      availability: 'Not reported by this tool; these are the only identities the Liaison may assign.',
    })
  }

  if (name === 'mc_whats_stalled') {
    // Attention-needed: terminal-ish stuck states, or in-flight with no update in 30 min.
    const staleCutoff = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, title, status, assigned_to, blocker, approval_required, updated_at')
      .or(`status.in.(blocked,awaiting_approval,failed),and(status.in.(claimed,in_progress),updated_at.lt.${staleCutoff})`)
      .order('updated_at', { ascending: true })
    if (error) throw new Error(error.message)
    const reasonFor = (s: string) =>
      s === 'blocked' ? 'blocked' : s === 'awaiting_approval' ? 'awaiting approval' : s === 'failed' ? 'failed' : 'no progress in 30 min'
    return JSON.stringify((data ?? []).map(r => ({
      request_id: r.id, title: r.title, status: r.status, assigned_to: r.assigned_to,
      blocker: r.blocker, approval_required: r.approval_required, updated_at: r.updated_at, reason: reasonFor(r.status),
    })))
  }

  if (name === 'mc_get_result') {
    const { request_id } = args
    if (!request_id) throw new Error('request_id is required')
    const { data, error } = await supabase
      .from('mc_requests')
      .select('id, status, result_summary, artifact_refs, latest_progress, completed_at')
      .eq('id', request_id).single()
    if (error || !data) throw new Error(`Request not found: ${request_id}`)
    return JSON.stringify({
      request_id: data.id, status: data.status, completed: data.status === 'completed',
      result_summary: data.result_summary, artifact_refs: data.artifact_refs,
      latest_progress: data.latest_progress, completed_at: data.completed_at,
    })
  }

  if (name === 'mc_assign_request') {
    const { request_id, worker } = args
    if (!request_id || !worker) throw new Error('request_id and worker are required')
    const allowedStates = ['submitted', 'queued', 'claimed', 'in_progress', 'blocked']
    const { data: current, error: currentError } = await supabase
      .from('mc_requests')
      .select('status, request_text')
      .eq('id', request_id)
      .single()
    if (currentError || !current) throw new Error(`Request not found: ${request_id}`)
    if (!allowedStates.includes(current.status)) {
      throw new Error(`Not allowed from status '${current.status}' (allowed: ${allowedStates.join(', ')})`)
    }
    const assignedWorker = validateLiaisonAssignment(current.status, current.request_text, worker)
    const { data, error } = await supabase
      .from('mc_requests')
      .update({ assigned_to: assignedWorker, updated_at: new Date().toISOString() })
      .eq('id', request_id)
      .eq('status', current.status)
      .select('id, status, assigned_to')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Request changed while assignment was being applied; fetch current status and retry')
    return JSON.stringify({ request_id: data.id, status: data.status, assigned_to: data.assigned_to })
  }

  if (name === 'mc_resume_request') {
    const { request_id } = args
    const reason = args.reason?.trim()
    if (!request_id || !reason) throw new Error('request_id and reason are required')
    if (reason.length > 1000) throw new Error('reason too long (max 1000 chars)')

    const { data: current, error: currentError } = await supabase
      .from('mc_requests')
      .select('status, request_text, blocker')
      .eq('id', request_id)
      .single()
    if (currentError || !current) throw new Error(`Request not found: ${request_id}`)
    const plan = planRequestResume(current.status, current.request_text, current.blocker)
    const resumedAt = new Date().toISOString()
    const { data, error } = await supabase
      .from('mc_requests')
      .update({
        ...plan,
        blocker: null,
        approval_required: false,
        approved_by: null,
        approved_at: null,
        attempt_id: null,
        reviewed_sha: null,
        // Consent dies with the attempt it was bound to — a resumed request must be
        // reviewed and approved again from scratch.
        approved_sha: null,
        workspace_ref: null,
        latest_progress: `Resumed by ${actor}: ${reason}`,
        completed_at: null,
        updated_at: resumedAt,
      })
      .eq('id', request_id)
      .eq('status', current.status)
      .select('id, status, assigned_to, preferred_worker, latest_progress, updated_at')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Request changed while resume was being applied; fetch current status and retry')
    return JSON.stringify({
      request_id: data.id,
      status: data.status,
      assigned_to: data.assigned_to,
      preferred_worker: data.preferred_worker,
      latest_progress: data.latest_progress,
      updated_at: data.updated_at,
    })
  }

  if (name === 'mc_submit_plan') {
    const { request_id, plan: rawPlan } = args
    if (!request_id) throw new Error('request_id is required')
    const plan = validatePlanArg(rawPlan)

    const { data: current, error: currentError } = await supabase
      .from('mc_requests')
      .select('status, assigned_to, plan')
      .eq('id', request_id)
      .single()
    if (currentError || !current) throw new Error(`Request not found: ${request_id}`)

    validatePlanPrecondition(current)

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('mc_requests')
      .update({
        plan,
        phase: 'planned',
        plan_submitted_at: now,
        plan_by: actor,
        updated_at: now,
      })
      .eq('id', request_id)
      .eq('status', 'submitted')
      // Write-once, enforced ATOMICALLY here and not just by the read-then-check above.
      // Without this, two concurrent mc_submit_plan calls both read plan=null, both pass
      // validatePlanPrecondition, and the second silently overwrites the first. With it,
      // the loser matches 0 rows and is told to re-fetch.
      .is('plan', null)
      .select('id, phase, plan_submitted_at')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Request changed while plan was being submitted; re-fetch and retry')
    return JSON.stringify({ request_id: data.id, phase: data.phase, plan_submitted_at: data.plan_submitted_at })
  }

  if (name === 'mc_claim_request') {
    const { request_id, worker } = args
    if (!request_id || !worker) throw new Error('request_id and worker are required')
    const data = await transitionRequest(supabase, request_id, ['queued'], { status: 'claimed', assigned_to: worker })
    return JSON.stringify({ request_id: data.id, status: data.status, assigned_to: data.assigned_to })
  }

  if (name === 'mc_reassign_request') {
    const { request_id, worker } = args
    if (!request_id || !worker) throw new Error('request_id and worker are required')
    const data = await transitionRequest(
      supabase, request_id,
      ['submitted', 'queued', 'claimed', 'in_progress', 'blocked', 'awaiting_approval'],
      { assigned_to: worker },
    )
    return JSON.stringify({ request_id: data.id, status: data.status, assigned_to: data.assigned_to })
  }

  if (name === 'mc_post_progress') {
    const { request_id, progress } = args
    if (!request_id || !progress) throw new Error('request_id and progress are required')
    const data = await transitionRequest(
      supabase, request_id, ['claimed', 'in_progress', 'blocked'],
      { status: 'in_progress', latest_progress: progress },
    )
    return JSON.stringify({ request_id: data.id, status: data.status })
  }

  if (name === 'mc_mark_blocked') {
    const { request_id, blocker } = args
    if (!request_id || !blocker) throw new Error('request_id and blocker are required')
    const data = await transitionRequest(supabase, request_id, ['claimed', 'in_progress'], { status: 'blocked', blocker })
    return JSON.stringify({ request_id: data.id, status: data.status })
  }

  if (name === 'mc_request_approval') {
    const { request_id, reason } = args
    if (!request_id || !reason) throw new Error('request_id and reason are required')
    // Reason stored in `blocker` (what's holding it) — surfaces via mc_whats_stalled.
    const data = await transitionRequest(
      supabase, request_id, ['claimed', 'in_progress'],
      { status: 'awaiting_approval', approval_required: true, blocker: reason },
    )
    return JSON.stringify({ request_id: data.id, status: data.status, approval_required: true })
  }

  if (name === 'mc_respond_approval') {
    const { request_id, attempt_id, note } = args
    const decision = (args.decision ?? '').trim().toLowerCase()
    if (!request_id) throw new Error('request_id is required')
    if (decision !== 'approve' && decision !== 'reject') throw new Error("decision must be 'approve' or 'reject'")
    if (!attempt_id) throw new Error('attempt_id is required (binds approval to the reviewed attempt)')

    const { data: cur, error: curErr } = await supabase
      .from('mc_requests')
      .select('status, attempt_id, approved_at, reviewed_sha')
      .eq('id', request_id).single()
    if (curErr || !cur) throw new Error(`Request not found: ${request_id}`)

    // Attempt binding: a stale approval must never land on a superseded attempt —
    // enforced here for a clear error, and again atomically in the UPDATE below.
    if (cur.attempt_id && cur.attempt_id !== attempt_id) {
      throw new Error(`Attempt superseded: approval targets ${attempt_id} but current attempt is ${cur.attempt_id}`)
    }

    // Idempotency / conflict: request already resolved through the approval flow.
    // approved_at is the resolver-stamp — set on BOTH approve and reject below — so a
    // request blocked by mc_mark_blocked for unrelated reasons (approved_at null) is
    // never misread as "already rejected".
    if (cur.status !== 'awaiting_approval') {
      const resolved = cur.approved_at != null
      const priorApproved = resolved && (cur.status === 'in_progress' || cur.status === 'completed')
      const priorRejected = resolved && (cur.status === 'blocked' || cur.status === 'cancelled')
      if (decision === 'approve' && priorApproved) {
        return JSON.stringify({ request_id, status: cur.status, decision, attempt_id, note: 'no-op: already approved' })
      }
      if (decision === 'reject' && priorRejected) {
        return JSON.stringify({ request_id, status: cur.status, decision, attempt_id, note: 'no-op: already rejected' })
      }
      throw new Error(`Request already resolved (status '${cur.status}'); conflicting '${decision}' refused`)
    }

    // Fresh awaiting_approval → ATOMIC check-and-set, via the rules shared with the
    // operator CLI (scripts/lib/approval-binding.mjs). The UPDATE only lands if the row is
    // still awaiting_approval, still on the exact reviewed attempt, AND — on approve —
    // still on the exact commit this decision was computed against. 0 rows ⇒ a superseded
    // attempt, a stale/absent attempt_id (null never matches → fails safe), a reviewed_sha
    // rewritten under the approval, or a concurrent decision won the race → refuse.
    //
    // approved_sha is stamped from the server-read reviewed_sha, never from caller input:
    // recording WHO approved without recording WHAT left consent pointing at a mutable
    // column, so changing reviewed_sha afterwards retargeted a live approval.
    const { data, error: uerr, updates } = await applyApprovalDecision(supabase, request_id, cur, {
      attemptId: attempt_id, decision, actor, note, now: new Date().toISOString(),
    })
    if (uerr || !data) {
      throw new Error(`Approval did not apply: request superseded, attempt_id mismatch, reviewed commit changed under the approval, or already resolved (attempt ${attempt_id})`)
    }
    return JSON.stringify({
      request_id: data.id, status: data.status, decision, attempt_id,
      approved_sha: updates.approved_sha,
    })
  }

  if (name === 'mc_complete_request') {
    const { request_id, result_summary } = args
    if (!request_id || !result_summary) throw new Error('request_id and result_summary are required')
    let artifacts: unknown = []
    if (args.artifact_refs) {
      try { artifacts = JSON.parse(args.artifact_refs) } catch { throw new Error('artifact_refs must be a JSON array') }
    }
    const data = await transitionRequest(
      supabase, request_id, ['claimed', 'in_progress', 'awaiting_approval'],
      { status: 'completed', result_summary, artifact_refs: artifacts, completed_at: new Date().toISOString() },
    )
    return JSON.stringify({ request_id: data.id, status: data.status })
  }

  if (name === 'mc_mark_failed') {
    const { request_id, reason } = args
    if (!request_id || !reason) throw new Error('request_id and reason are required')
    const data = await transitionRequest(
      supabase, request_id, ['claimed', 'in_progress', 'blocked', 'awaiting_approval'],
      { status: 'failed', blocker: reason },
    )
    return JSON.stringify({ request_id: data.id, status: data.status })
  }

  throw new Error(`Unknown tool: ${name}`)
}
