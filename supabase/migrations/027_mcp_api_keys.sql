-- Migration 027: datastore-backed MCP API keys (specs/2026-08-23-mc-security-hardening.md §3.2).
-- The static MCP_API_KEY env compare made every issued key unrevocable: env vars
-- bake into immutable deployments, so killing a leaked key took a rotation, a
-- redeploy, and deleting every old deployment. Keys now live here, and revoking is
--   UPDATE mcp_api_keys SET revoked_at = now() WHERE name = '<name>';
-- effective on every deployment running the lookup code within its 60s cache.
--
-- Only the SHA-256 hash is stored, so a DB or log leak yields no usable key.
-- Server-only: RLS enabled with no policies, so only the service role
-- (createAdminSupabaseClient) can read or write.
CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  key_hash   TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scope      TEXT NOT NULL CHECK (scope IN ('full', 'read', 'liaison', 'orchestrator')),
  actor      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

ALTER TABLE mcp_api_keys ENABLE ROW LEVEL SECURITY;
