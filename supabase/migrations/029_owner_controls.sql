-- Migration 029: owner request controls
-- (1) mcp_audit_log.detail: before/after context for owner actions. Additive and
--     nullable, so existing writers are unaffected.
-- (2) mc_requests gets the set_updated_at() trigger (from 001) so the database
--     bumps updated_at, the row's version token, on every write.

ALTER TABLE mcp_audit_log ADD COLUMN IF NOT EXISTS detail JSONB;

DROP TRIGGER IF EXISTS trg_mc_requests_updated_at ON mc_requests;
CREATE TRIGGER trg_mc_requests_updated_at
  BEFORE UPDATE ON mc_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
