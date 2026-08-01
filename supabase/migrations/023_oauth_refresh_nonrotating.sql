-- Migration 023: OAuth refresh tokens → NON-ROTATING (operator decision, 2026-08-01).
-- After 4 review passes, rotation (022) kept producing retry/concurrency
-- reliability edge-cases for a single personal ChatGPT connector, where
-- auto-theft-detection buys little. Switch to a stable refresh token: theft is
-- mitigated instead by the kill-switch (revoked_at / oauth_config.revoked_before),
-- the 15-min access-token window, and a 90-day absolute expiry on the refresh
-- token itself (OAUTH_REFRESH_TOKEN_TTL). This removes complexity, not safety
-- margin, for this single-tenant use case.
--
-- The 022 rotation RPC is retired. The table + FK + extra columns from 021/022
-- stay as-is (non-destructive) — chain_started_at and rotated_to simply go
-- unused going forward. Revocation stays available per-token or in bulk
-- (kill-switch) via a plain UPDATE ... SET revoked_at = now().

DROP FUNCTION IF EXISTS oauth_rotate_refresh_token(TEXT, TEXT, TEXT, INT, INT, INT);
