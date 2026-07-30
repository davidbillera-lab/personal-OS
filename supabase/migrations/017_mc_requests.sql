-- Migration 017: mc_requests — ChatGPT-liaison request queue (Phase 1)
-- The mailbox between the ChatGPT liaison (submits + reads) and the workers
-- (Hermes/Claude claim + progress + complete via the worker interface). One
-- controlled state machine; every lifecycle change is also stamped in
-- mcp_audit_log by the HTTP route.

CREATE TABLE IF NOT EXISTS mc_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title              TEXT,
  request_text       TEXT        NOT NULL,
  priority           TEXT        NOT NULL DEFAULT 'normal'
                                   CHECK (priority IN ('low','normal','high','urgent')),
  preferred_worker   TEXT        NOT NULL DEFAULT 'auto'
                                   CHECK (preferred_worker IN ('auto','hermes','claude')),
  source             TEXT        NOT NULL DEFAULT 'chatgpt_liaison',
  created_by         TEXT        NOT NULL DEFAULT 'chatgpt-liaison',
  client_request_id  TEXT,                       -- caller idempotency key
  status             TEXT        NOT NULL DEFAULT 'queued'
                                   CHECK (status IN (
                                     'submitted','queued','claimed','in_progress',
                                     'blocked','awaiting_approval','completed','failed','cancelled'
                                   )),
  assigned_to        TEXT,                        -- worker identity: hermes | claude | null
  latest_progress    TEXT,
  blocker            TEXT,
  approval_required  BOOLEAN     NOT NULL DEFAULT false,
  result_summary     TEXT,
  artifact_refs      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  project_id         UUID        REFERENCES projects(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mc_requests_status_idx      ON mc_requests (status);
CREATE INDEX IF NOT EXISTS mc_requests_created_at_idx  ON mc_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS mc_requests_assigned_to_idx ON mc_requests (assigned_to);
-- Idempotency: a given client_request_id maps to at most one request.
CREATE UNIQUE INDEX IF NOT EXISTS mc_requests_client_request_id_key
  ON mc_requests (client_request_id) WHERE client_request_id IS NOT NULL;

ALTER TABLE mc_requests ENABLE ROW LEVEL SECURITY;

-- Writes come from the service role (createAdminSupabaseClient), which bypasses
-- RLS. Authenticated dashboard gets read-only.
CREATE POLICY "authenticated_read" ON mc_requests
  FOR SELECT TO authenticated USING (true);
