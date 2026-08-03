-- Correlate MCP calls with the Mission Control request they read or mutate.
-- Nullable by design: initialize, tools/list, queue-wide reads, and historical
-- audit rows do not belong to one request.

ALTER TABLE mcp_audit_log
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE INDEX IF NOT EXISTS mcp_audit_log_request_created_idx
  ON mcp_audit_log (request_id, created_at ASC)
  WHERE request_id IS NOT NULL;
