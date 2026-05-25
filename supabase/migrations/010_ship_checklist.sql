-- Ship checklist state per project (JSON map of key→boolean)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ship_checklist JSONB DEFAULT '{}'::jsonb;
