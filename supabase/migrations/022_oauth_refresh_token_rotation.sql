-- Migration 022: OAuth refresh-token rotation hardening for the ChatGPT liaison.
-- 021 shipped the table (already applied); the rotation logic that was mistakenly
-- edited into 021 in place (and therefore never reached the DB) lives here instead.
--
-- What this adds on top of 021's table:
--   * chain_started_at column (absolute-cap anchor for a rotation chain)
--   * a guarded FK from oauth_refresh_tokens.client_id → oauth_clients.client_id
--   * a backfill so pre-refresh DCR clients advertise the refresh_token grant
--   * oauth_rotate_refresh_token(): a single-transaction, DB-clock rotation RPC
--     with a grace window (benign retries), (client_id, sub)-scoped reuse
--     revocation, and an absolute chain cap.

-- ---- chain_started_at (absolute-cap anchor) --------------------------------
-- A rotation chain keeps ONE chain_started_at from its first issue through every
-- successor. issueRefreshToken relies on the DEFAULT for a fresh chain; the RPC
-- copies the parent's value onto each successor so the cap measures the whole
-- chain's age, not the current link's.
ALTER TABLE oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS chain_started_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill any pre-existing rows (chain start == original issue time).
UPDATE oauth_refresh_tokens
SET chain_started_at = issued_at
WHERE chain_started_at IS NULL;

-- ---- Guarded FK on client_id -----------------------------------------------
-- 021's committed table dropped the inline REFERENCES. Add it here, but first
-- clear any orphan rows (client_id with no oauth_clients row) or the ADD fails,
-- and skip the ADD if the constraint already exists (idempotent re-run).
DO $$
BEGIN
  DELETE FROM oauth_refresh_tokens rt
  WHERE NOT EXISTS (SELECT 1 FROM oauth_clients c WHERE c.client_id = rt.client_id);

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'oauth_refresh_tokens_client_fk'
      AND table_name = 'oauth_refresh_tokens'
  ) THEN
    ALTER TABLE oauth_refresh_tokens
      ADD CONSTRAINT oauth_refresh_tokens_client_fk
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---- grant_types backfill (M6) ---------------------------------------------
-- public.oauth_clients.grant_types is jsonb, so the `?` (has-key) operator is
-- valid. NULL is guarded explicitly because `NOT (NULL ? 'x')` is NULL, not true.
UPDATE oauth_clients
SET grant_types = '["authorization_code", "refresh_token"]'::jsonb
WHERE grant_types IS NULL OR NOT (grant_types ? 'refresh_token');

-- ---- Rotation RPC ----------------------------------------------------------
-- Single transaction, all timestamps from the DB clock (never a Node-computed
-- expiry). The successor hash is passed in; the plaintext lives only in the
-- caller. Branch order is load-bearing — see the numbered comments.
CREATE OR REPLACE FUNCTION oauth_rotate_refresh_token(
  p_old_hash        TEXT,
  p_client_id       TEXT,
  p_new_hash        TEXT,
  p_ttl_seconds     INT,
  p_grace_seconds   INT,
  p_abs_cap_seconds INT
)
RETURNS TABLE(status TEXT, resource TEXT, chain_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r oauth_refresh_tokens%ROWTYPE;
BEGIN
  SELECT * INTO r
  FROM oauth_refresh_tokens
  WHERE token_hash = p_old_hash
  FOR UPDATE;

  -- 1. Unknown token.
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 2. Wrong client → inert. A token presented under the wrong client_id must
  --    have NO side effects (never chain-revoke the real client's tokens).
  IF r.client_id <> p_client_id THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 3. Already revoked/rotated.
  IF r.revoked_at IS NOT NULL THEN
    -- 3a. Grace retry — a just-rotated token replayed inside the grace window
    --     (rotated_to set proves it was a clean rotation, not a reuse/kill-switch
    --     revoke). Treat as a benign retry: drop the prior successor, reissue a
    --     fresh one, and re-point rotated_to so repeated retries collapse to a
    --     single active successor (no successor leak).
    IF r.revoked_at > now() - (p_grace_seconds * interval '1 second')
       AND r.rotated_to IS NOT NULL THEN
      UPDATE oauth_refresh_tokens
      SET revoked_at = now()
      WHERE token_hash = r.rotated_to AND revoked_at IS NULL;

      INSERT INTO oauth_refresh_tokens (
        token_hash, client_id, sub, scope, resource, chain_started_at, expires_at
      ) VALUES (
        p_new_hash, r.client_id, r.sub, 'liaison', r.resource,
        r.chain_started_at, now() + p_ttl_seconds * interval '1 second'
      );

      UPDATE oauth_refresh_tokens
      SET rotated_to = p_new_hash
      WHERE token_hash = p_old_hash;

      RETURN QUERY SELECT 'retry_reissue'::TEXT, r.resource, r.chain_started_at;
      RETURN;
    END IF;

    -- 3b. Genuine reuse (revoked outside the grace window, or a non-rotation
    --     revoke). Chain-revoke every active token for THIS (client_id, sub) —
    --     scoped to the sub so one identity's reuse can't nuke another's tokens.
    UPDATE oauth_refresh_tokens
    SET revoked_at = now()
    WHERE client_id = r.client_id AND sub = r.sub AND revoked_at IS NULL;

    RETURN QUERY SELECT 'reused'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 4. Expired but never reused → invalid, NOT a reuse (no chain-revoke).
  IF r.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 5. Absolute cap — the chain has lived longer than the cap. Revoke this token
  --    and do NOT reissue, forcing one clean re-consent.
  IF r.chain_started_at <= now() - (p_abs_cap_seconds * interval '1 second') THEN
    UPDATE oauth_refresh_tokens
    SET revoked_at = now(), last_used_at = now()
    WHERE token_hash = p_old_hash;
    RETURN QUERY SELECT 'cap_exceeded'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 6. Valid, active, within cap → rotate. Revoke the current token and insert
  --    the successor, inheriting the chain's start so the cap keeps measuring
  --    the whole chain.
  UPDATE oauth_refresh_tokens
  SET revoked_at = now(), rotated_to = p_new_hash, last_used_at = now()
  WHERE token_hash = p_old_hash;

  INSERT INTO oauth_refresh_tokens (
    token_hash, client_id, sub, scope, resource, chain_started_at, expires_at
  ) VALUES (
    p_new_hash, r.client_id, r.sub, 'liaison', r.resource,
    r.chain_started_at, now() + p_ttl_seconds * interval '1 second'
  );

  RETURN QUERY SELECT 'rotated'::TEXT, r.resource, r.chain_started_at;
END;
$$;

-- Invariant (M8): NEVER grant EXECUTE to anon/authenticated. This is a
-- SECURITY DEFINER function that bypasses RLS; only the service role (server,
-- behind the token endpoint) may call it. Re-assert this on every CREATE OR
-- REPLACE — a replace does not reset grants, but a fresh DB must get them.
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon + authenticated
-- explicitly at creation, so those roles MUST be revoked by name — a bare
-- REVOKE ... FROM PUBLIC does not remove an explicit role grant.
REVOKE ALL ON FUNCTION oauth_rotate_refresh_token(TEXT, TEXT, TEXT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION oauth_rotate_refresh_token(TEXT, TEXT, TEXT, INT, INT, INT) TO service_role;
