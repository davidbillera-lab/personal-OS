-- Migration 006: Agent handoffs and task claim/complete fields
-- Closes the loop: agents can claim tasks, complete them, and log sessions

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_agent TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS agent_assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS agent_handoffs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  task_id           UUID        REFERENCES tasks(id) ON DELETE SET NULL,
  agent_name        TEXT        NOT NULL,
  task_description  TEXT,
  outcome           TEXT,
  github_commit_url TEXT,
  status            TEXT        NOT NULL DEFAULT 'in_progress'
                                CHECK (status IN ('in_progress', 'done', 'failed', 'review')),
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agent_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON agent_handoffs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
