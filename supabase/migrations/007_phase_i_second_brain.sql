-- Phase I: Second Brain Infrastructure
-- Adds credentials vault, credential access log, project health cache,
-- and new project columns for external service links.

-- ── New columns on projects ──────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS vercel_url TEXT,
  ADD COLUMN IF NOT EXISTS supabase_project_id TEXT,
  ADD COLUMN IF NOT EXISTS github_repo TEXT;

-- ── Credentials vault ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  key_name        TEXT NOT NULL UNIQUE,
  value           TEXT NOT NULL,       -- AES-256-GCM encrypted at rest
  tier            TEXT NOT NULL CHECK (tier IN ('global', 'project')),
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  is_mcp_accessible BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON credentials
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Credential access log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credential_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name    TEXT NOT NULL,
  accessed_by TEXT NOT NULL,   -- agent name or 'ui'
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE credential_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON credential_access_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Project health cache ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_health (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  github_status   TEXT CHECK (github_status   IN ('ok', 'warn', 'error', 'unknown')),
  vercel_status   TEXT CHECK (vercel_status   IN ('ok', 'warn', 'error', 'unknown')),
  supabase_status TEXT CHECK (supabase_status IN ('ok', 'warn', 'error', 'unknown')),
  checked_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON project_health
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- One cached health row per project (upserted on check)
CREATE UNIQUE INDEX IF NOT EXISTS project_health_project_id_idx ON project_health(project_id);
