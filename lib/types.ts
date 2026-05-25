// ============================================================
// Database schema types — mirror of supabase/migrations/001_initial_schema.sql
// Update here whenever the schema changes.
// ============================================================

export type ProjectTier = 1 | 2 | 3
export type ProjectStage = 'idea' | 'spec' | 'build' | 'ship' | 'scale' | 'kill'
export type KillCriteriaStatus = 'pass' | 'warning' | 'fail' | 'exempt'
export type BrainDumpType = 'idea' | 'task' | 'bug' | 'decision' | 'kill_candidate' | 'unclassified'
export type BrainDumpStatus = 'inbox' | 'reviewed' | 'actioned' | 'archived' | 'spec_generated'
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'done' | 'killed'
export type AgentHandoffStatus = 'in_progress' | 'done' | 'failed' | 'review'
export type IdeaValidationVerdict = 'proceed' | 'flag'
export type KillVerdict = 'pass' | 'warning' | 'fail'
export type AbVerdict = 'keep' | 'kill' | 'pending'
export type CodexQcStatus = 'pending' | 'passed' | 'issues_found' | 'loop_detected'
export type TaskTool = 'claude_code' | 'codex' | 'cursor'

export type VaultItemType = 'credential' | 'skill' | 'agent' | 'personal' | 'knowledge'

export interface VaultItem {
  id: string
  type: VaultItemType
  title: string
  content: string
  encrypted: boolean
  tags: string[]
  project_id: string | null
  source_table: string | null
  source_id: string | null
  is_mcp_accessible: boolean
  metadata: Record<string, unknown>
  embedding: number[] | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  slug: string
  tier: ProjectTier
  protected: boolean
  stage: ProjectStage
  status: string | null
  description: string | null
  repo_url: string | null
  claude_md_url: string | null
  local_path: string | null
  last_update: string
  next_action: string | null
  blockers: string | null
  kill_criteria_status: KillCriteriaStatus | null
  exit_thesis: string | null
  lead_model: string | null
  lead_suggestions: string | null
  suggestions_updated_at: string | null
  current_agent: string | null
  vercel_url: string | null
  supabase_project_id: string | null
  github_repo: string | null
  ship_checklist: Record<string, boolean> | null
  ship_ab_verdict: AbVerdict | null
  ship_ab_reasoning: string | null
  created_at: string
  updated_at: string
}

export interface ProjectChat {
  id: string
  project_id: string
  role: 'user' | 'assistant'
  content: string
  model: string | null
  created_at: string
}

export interface BrainDump {
  id: string
  raw_text: string
  classified_type: BrainDumpType | null
  classification_confidence: number | null
  project_id: string | null
  status: BrainDumpStatus
  ai_summary: string | null
  ab_verdict: AbVerdict | null
  ab_reasoning: string | null
  source: string
  created_at: string
  updated_at: string
}

export interface Decision {
  id: string
  project_id: string | null
  decision: string
  reasoning: string | null
  decision_date: string
  made_by: string
  created_at: string
}

export interface Task {
  id: string
  project_id: string | null
  brain_dump_id: string | null
  title: string
  description: string | null
  complexity_tier: 1 | 2 | 3 | 4 | null
  recommended_tool: string | null
  recommended_model: string | null
  generated_spec: string | null
  spec_path: string | null
  tool: TaskTool | null
  model_tier: number | null
  codex_qc_status: CodexQcStatus | null
  codex_qc_notes: string | null
  status: TaskStatus
  agent_assigned_to: string | null
  claimed_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentHandoff {
  id: string
  project_id: string
  task_id: string | null
  agent_name: string
  task_description: string | null
  outcome: string | null
  github_commit_url: string | null
  spec_path: string | null
  status: AgentHandoffStatus
  started_at: string
  completed_at: string | null
  created_at: string
}

export interface IdeaValidationResult {
  verdict: IdeaValidationVerdict
  reason: string
  is_internal: boolean
}

export type CredentialTier = 'global' | 'project'
export type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown'

export interface Credential {
  id: string
  name: string
  key_name: string
  value: string
  tier: CredentialTier
  project_id: string | null
  is_mcp_accessible: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ProjectHealth {
  id: string
  project_id: string
  github_status: HealthStatus
  vercel_status: HealthStatus
  supabase_status: HealthStatus
  checked_at: string
}

export interface CredentialAccessLog {
  id: string
  key_name: string
  accessed_by: string
  accessed_at: string
}

export interface ModelCost {
  id: string
  project_id: string | null
  task_id: string | null
  brain_dump_id: string | null
  model: string
  provider: string
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  purpose: string | null
  created_at: string
}

export interface KillCriteriaCheck {
  id: string
  project_id: string
  check_date: string
  functionality_score: number | null
  efficiency_score: number | null
  scalability_score: number | null
  time_to_revenue_score: number | null
  verdict: KillVerdict | null
  notes: string | null
  created_at: string
}

// ============================================================
// Supabase generated types wrapper
// All four sections (Tables, Views, Functions, Enums) are required
// for Supabase's internal type inference to resolve correctly.
// ============================================================
export interface Database {
  public: {
    Tables: {
      projects: {
        Row: Project
        Insert: Omit<Project, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Project, 'id' | 'created_at'>>
        Relationships: []
      }
      brain_dumps: {
        Row: BrainDump
        Insert: Omit<BrainDump, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<BrainDump, 'id' | 'created_at'>>
        Relationships: []
      }
      decisions: {
        Row: Decision
        Insert: Omit<Decision, 'id' | 'created_at'>
        Update: Partial<Omit<Decision, 'id' | 'created_at'>>
        Relationships: []
      }
      tasks: {
        Row: Task
        Insert: Omit<Task, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Task, 'id' | 'created_at'>>
        Relationships: []
      }
      model_costs: {
        Row: ModelCost
        Insert: Omit<ModelCost, 'id' | 'created_at'>
        Update: never
        Relationships: []
      }
      kill_criteria_checks: {
        Row: KillCriteriaCheck
        Insert: Omit<KillCriteriaCheck, 'id' | 'created_at'>
        Update: Partial<Omit<KillCriteriaCheck, 'id' | 'created_at'>>
        Relationships: []
      }
      project_chats: {
        Row: ProjectChat
        Insert: Omit<ProjectChat, 'id' | 'created_at'>
        Update: never
        Relationships: []
      }
      agent_handoffs: {
        Row: AgentHandoff
        Insert: Omit<AgentHandoff, 'id' | 'created_at' | 'started_at'>
        Update: Partial<Omit<AgentHandoff, 'id' | 'created_at'>>
        Relationships: []
      }
      credentials: {
        Row: Credential
        Insert: Omit<Credential, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Credential, 'id' | 'created_at'>>
        Relationships: []
      }
      credential_access_log: {
        Row: CredentialAccessLog
        Insert: Omit<CredentialAccessLog, 'id' | 'accessed_at'>
        Update: never
        Relationships: []
      }
      project_health: {
        Row: ProjectHealth
        Insert: Omit<ProjectHealth, 'id' | 'checked_at'>
        Update: Partial<Omit<ProjectHealth, 'id'>>
        Relationships: []
      }
      vault_items: {
        Row: VaultItem
        Insert: Omit<VaultItem, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<VaultItem, 'id' | 'created_at'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
