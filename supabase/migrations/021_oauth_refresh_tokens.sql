-- Migration 021: OAuth refresh tokens (offline_access) for the ChatGPT liaison.
-- Adds a long-lived (30-day default) rotating refresh token so ChatGPT can
-- silently mint new short-lived access tokens without re-consent. Plaintext
-- tokens are never stored — only the SHA-256 hash, mirroring oauth_auth_codes.

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash   TEXT        PRIMARY KEY,        -- sha256 hex of the opaque token; plaintext never stored
  client_id    TEXT        NOT NULL,
  sub          TEXT        NOT NULL DEFAULT 'chatgpt-liaison',
  scope        TEXT        NOT NULL DEFAULT 'liaison',
  resource     TEXT,
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,                     -- set on rotation, reuse-detection, or kill-switch
  rotated_to   TEXT                             -- token_hash of the successor (rotation chain)
);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_client_idx  ON oauth_refresh_tokens (client_id);
CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_expires_idx ON oauth_refresh_tokens (expires_at);
ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;  -- deny-all; service role bypasses
