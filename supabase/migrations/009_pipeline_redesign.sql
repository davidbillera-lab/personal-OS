-- Pipeline redesign: tool selection and model tier on tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tool        TEXT CHECK (tool IN ('claude_code', 'codex', 'cursor')),
  ADD COLUMN IF NOT EXISTS model_tier  INTEGER CHECK (model_tier BETWEEN 1 AND 4);
