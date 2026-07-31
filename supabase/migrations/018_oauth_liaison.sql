-- Migration 018: OAuth 2.1 + PKCE liaison facade (Phase 1 piece 3)
-- Storage for the ChatGPT-facing OAuth front door. Only two things need to
-- persist: dynamically-registered clients (DCR, RFC 7591) and short-lived,
-- single-use authorization codes. Access tokens are stateless signed JWTs
-- (HS256, verified in app/api/mcp-liaison) — no token table by design.
-- A valid token maps ONLY to the chatgpt-liaison identity + liaison scope;
-- workers/vault/credentials stay unreachable (enforced in code, not here).

-- Dynamically-registered OAuth clients. ChatGPT registers itself via DCR and is
-- a PUBLIC client (PKCE, no client secret). redirect_uris is the exact set this
-- client may use; /authorize validates the requested redirect_uri against it.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                    TEXT        PRIMARY KEY,
  client_secret                TEXT,                        -- null for public PKCE clients
  client_name                  TEXT,
  redirect_uris                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  grant_types                  JSONB       NOT NULL DEFAULT '["authorization_code"]'::jsonb,
  response_types               JSONB       NOT NULL DEFAULT '["code"]'::jsonb,
  token_endpoint_auth_method   TEXT        NOT NULL DEFAULT 'none',
  scope                        TEXT        NOT NULL DEFAULT 'liaison',
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authorization codes. Short TTL (expires_at) and single-use (consumed_at set
-- on first redemption). /token rejects any code that is missing, expired, or
-- already consumed — preventing auth-code replay.
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code                   TEXT        PRIMARY KEY,
  client_id              TEXT        NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri           TEXT        NOT NULL,
  code_challenge         TEXT        NOT NULL,
  code_challenge_method  TEXT        NOT NULL DEFAULT 'S256'
                                       CHECK (code_challenge_method = 'S256'),
  scope                  TEXT        NOT NULL DEFAULT 'liaison',
  resource               TEXT,                              -- RFC 8707 resource → token aud
  expires_at             TIMESTAMPTZ NOT NULL,
  consumed_at            TIMESTAMPTZ,                        -- single-use marker
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_auth_codes_expires_at_idx ON oauth_auth_codes (expires_at);
CREATE INDEX IF NOT EXISTS oauth_auth_codes_client_id_idx  ON oauth_auth_codes (client_id);

-- Both tables are written only by the service role (createAdminSupabaseClient,
-- which bypasses RLS). RLS on with no policy = deny-all to anon/authenticated,
-- so these secrets are never reachable through the public client.
ALTER TABLE oauth_clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;
