-- Advisory Board fields on brain_dumps
ALTER TABLE brain_dumps
  ADD COLUMN IF NOT EXISTS ab_verdict  TEXT CHECK (ab_verdict IN ('keep', 'kill', 'pending')),
  ADD COLUMN IF NOT EXISTS ab_reasoning TEXT;

-- Pipeline fields on tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS spec_path       TEXT,
  ADD COLUMN IF NOT EXISTS codex_qc_status TEXT CHECK (codex_qc_status IN ('pending', 'passed', 'issues_found', 'loop_detected')),
  ADD COLUMN IF NOT EXISTS codex_qc_notes  TEXT;

-- spec_path on agent_handoffs
ALTER TABLE agent_handoffs
  ADD COLUMN IF NOT EXISTS spec_path TEXT;
