-- Migration 026: alert dedup ledger.
-- The twice-daily stuck-jobs sweep (app/api/alerts/stuck-jobs) rebuilt its
-- message from live state every run, so an unresolved row (e.g. a
-- classifier-held request) was re-sent in every sweep until cleared. This table
-- records which transitions have already been announced so each one produces at
-- most one Telegram message.
--
-- Key design: `transition_key` is a deterministic, non-secret string derived
-- from the request id + the state that made it actionable (see
-- transitionKey() in lib/alerts/stuck-jobs.ts). When a request changes state it
-- gets a NEW key and alerts again -- that is the intended re-notify.
--
-- Server-only: no RLS policies are added, so with RLS enabled only the service
-- role (createAdminSupabaseClient) can read or write. No token, chat id, or
-- request body is stored here.
CREATE TABLE IF NOT EXISTS mc_alert_sends (
  transition_key TEXT PRIMARY KEY,
  request_id     UUID NOT NULL REFERENCES mc_requests(id) ON DELETE CASCADE,
  bucket         TEXT NOT NULL,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mc_alert_sends ENABLE ROW LEVEL SECURITY;

-- Sweep reads "which of these keys did I already send" per run.
CREATE INDEX IF NOT EXISTS mc_alert_sends_request_idx ON mc_alert_sends (request_id);
-- Retention pruning is by age.
CREATE INDEX IF NOT EXISTS mc_alert_sends_sent_at_idx ON mc_alert_sends (sent_at);
