-- Migration 020: minimal voice-slice columns + realtime for the dispatcher.
-- Observability (phase) + the approval/attempt binding the v0 loop needs. The
-- status enum is intentionally unchanged; finer states live in `phase`.
ALTER TABLE mc_requests
  ADD COLUMN IF NOT EXISTS phase         TEXT,         -- building|qc|fixing|review|pushing (observability)
  ADD COLUMN IF NOT EXISTS approved_by   TEXT,
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workspace_ref TEXT,         -- path/URL of the scratch workspace
  ADD COLUMN IF NOT EXISTS attempt_id    UUID,         -- current workflow attempt; approval binds to this
  ADD COLUMN IF NOT EXISTS reviewed_sha  TEXT;         -- the commit QC'd + shown for approval; push must match

-- Dispatcher event source (no cron): subscribe to row changes. Idempotent —
-- ALTER PUBLICATION ADD TABLE errors if the table is already a member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mc_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE mc_requests;
  END IF;
END $$;
