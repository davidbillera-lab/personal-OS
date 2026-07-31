-- Migration 019: OAuth facade hardening — rate limiting + token revocation.
-- The pre-live gate flagged by both reviewers: bound abuse on the public
-- authorize/register/token/mcp-liaison endpoints, and give a kill-switch for
-- already-issued (stateless) access tokens.

-- Fixed-window rate-limit counters. One row per (logical key, time window);
-- oauth_rate_check() increments atomically and reports whether the caller is
-- still within budget. Service-role only (RLS deny-all).
CREATE TABLE IF NOT EXISTS oauth_rate_limits (
  bucket      TEXT        PRIMARY KEY,
  count       INT         NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_rate_limits_expires_at_idx ON oauth_rate_limits (expires_at);
ALTER TABLE oauth_rate_limits ENABLE ROW LEVEL SECURITY;

-- Atomic fixed-window check. Returns TRUE if the call is allowed (count <= max
-- for the current window), FALSE if the budget is exceeded. On a fresh window
-- bucket it also sweeps expired rows so the table self-cleans without a cron.
CREATE OR REPLACE FUNCTION oauth_rate_check(p_key TEXT, p_max INT, p_window_sec INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_bucket TEXT;
  v_count  INT;
BEGIN
  v_bucket := p_key || ':' || floor(extract(epoch FROM now()) / p_window_sec)::text;
  INSERT INTO oauth_rate_limits (bucket, count, expires_at)
    VALUES (v_bucket, 1, now() + make_interval(secs => p_window_sec * 2))
  ON CONFLICT (bucket) DO UPDATE SET count = oauth_rate_limits.count + 1
  RETURNING count INTO v_count;

  IF v_count = 1 THEN
    DELETE FROM oauth_rate_limits WHERE expires_at < now();
  END IF;

  RETURN v_count <= p_max;
END;
$$;

-- Key/value config for the facade. Holds `revoked_before`: any access token with
-- iat earlier than this instant is rejected — a one-line kill-switch for all
-- outstanding liaison tokens (they are stateless JWTs, so there is no per-token
-- row to delete). Revoke everything issued so far:
--   UPDATE oauth_config SET value = now()::text WHERE key = 'revoked_before';
CREATE TABLE IF NOT EXISTS oauth_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
ALTER TABLE oauth_config ENABLE ROW LEVEL SECURITY;
INSERT INTO oauth_config (key, value) VALUES ('revoked_before', '1970-01-01T00:00:00Z')
  ON CONFLICT (key) DO NOTHING;
