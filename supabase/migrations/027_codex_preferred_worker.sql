-- 027: allow 'codex' as a preferred worker (Codex builder lane, decisions.md 2026-09-05).
-- The inline CHECK from 017 was auto-named mc_requests_preferred_worker_check.
ALTER TABLE mc_requests DROP CONSTRAINT IF EXISTS mc_requests_preferred_worker_check;
ALTER TABLE mc_requests ADD CONSTRAINT mc_requests_preferred_worker_check
  CHECK (preferred_worker IN ('auto','hermes','claude','codex'));
