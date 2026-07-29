-- Migration 016: MCP actor audit log
-- Append-only record of every tool call through the HTTP /api/mcp route.
-- Phase 0 enabler for the ChatGPT read-only liaison: proves which actor
-- (full / hermes / chatgpt-liaison / ...) called which tool, and whether it
-- succeeded. No dashboards, no correlation IDs yet — that's M2+.

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor      TEXT        NOT NULL,
  tool       TEXT        NOT NULL,
  ok         BOOLEAN     NOT NULL,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mcp_audit_log_created_at_idx ON mcp_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_log_actor_idx      ON mcp_audit_log (actor);

ALTER TABLE mcp_audit_log ENABLE ROW LEVEL SECURITY;

-- Writes come from the service role (createAdminSupabaseClient), which bypasses
-- RLS. Append-only in practice: no UPDATE/DELETE policy exists, so authenticated
-- users can read history but never mutate it.
CREATE POLICY "authenticated_read" ON mcp_audit_log
  FOR SELECT TO authenticated USING (true);
