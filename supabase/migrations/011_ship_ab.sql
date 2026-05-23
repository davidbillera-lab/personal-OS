ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ship_ab_verdict TEXT,
  ADD COLUMN IF NOT EXISTS ship_ab_reasoning TEXT;
