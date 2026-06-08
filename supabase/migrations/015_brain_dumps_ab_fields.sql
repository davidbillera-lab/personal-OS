-- Add advisory board verdict fields to brain_dumps.
-- ab_verdict: 'keep' | 'kill' parsed from the Agreed Recommendation line.
-- ab_reasoning: the full Agreed Recommendation sentence for display.
ALTER TABLE brain_dumps
  ADD COLUMN IF NOT EXISTS ab_verdict text,
  ADD COLUMN IF NOT EXISTS ab_reasoning text;
