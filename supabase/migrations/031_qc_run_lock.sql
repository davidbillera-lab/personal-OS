-- Migration 031: one Codex QC run per task at a time
-- A run claims the task by writing its id and start time; a second click is refused
-- until the first finishes or its lease (longer than the 300s function limit) expires.
-- Only the run holding the claim may record a verdict, so a stale run cannot overwrite a newer one.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS codex_qc_run_id UUID,
  ADD COLUMN IF NOT EXISTS codex_qc_run_started_at TIMESTAMPTZ;
