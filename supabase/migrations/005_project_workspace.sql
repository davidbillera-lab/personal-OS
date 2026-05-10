ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS lead_model              TEXT,
  ADD COLUMN IF NOT EXISTS lead_suggestions        TEXT,
  ADD COLUMN IF NOT EXISTS suggestions_updated_at  TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS project_chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  model       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON project_chats
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
