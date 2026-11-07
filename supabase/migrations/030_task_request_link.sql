-- Migration 030: link dashboard tasks to the agent queue
-- "Send to agent" on a project page creates an mc_requests row that points back
-- at its task, so the task card can read the request's live status.
-- Spec: specs/2026-11-06-mc-dashboard-agent-bridge.md (step 1).

ALTER TABLE mc_requests
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- At most one live request per task. Finished rows don't count, so a task can be re-sent.
CREATE UNIQUE INDEX IF NOT EXISTS mc_requests_live_task_key
  ON mc_requests (task_id)
  WHERE task_id IS NOT NULL AND status NOT IN ('completed','failed','cancelled');
