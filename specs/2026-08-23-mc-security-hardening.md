# Mission Control — Security Hardening Spec

**Date:** 2026-08-23
**Author:** Security audit (read-only pass)
**Status:** Findings + remediation design. No code changed by this audit.
**Trigger:** Post-incident. The full-scope `MCP_API_KEY` sat as a literal in `decisions.md` in the **public** repo `github.com/davidbillera-lab/personal-OS` for 109 days. Key rotated in Vercel Production; this spec covers everything the rotation did **not** fix.

---

## 1. Executive Summary (operator language)

The leaked key is the smoke, not the fire. The fire is that **our MCP authentication cannot be revoked.** The key is checked against a value baked into each Vercel deployment at build time. Vercel deployments are frozen forever, so every old deployment URL still carries — and still accepts — the old leaked key. Rotating the key produced a new deployment that takes the new key; it did nothing to the dozens of historical URLs that still take the old one. That was already verified: 4 of 4 old deployments accepted the leaked key. **You cannot rotate your way out of this. The design has to change.**

What that key unlocks is the whole business: `mc_get_credential` returns any MCP-flagged secret **in plaintext**, plus every write tool (vault, project status, queue). So for 109 days, anyone who read the public repo could have pulled the credential vault. We cannot prove they did (log retention won't reach back 109 days) and we cannot prove they didn't. **Assume the credential vault was exposed and rotate its contents accordingly.**

Two more holes are as bad as the key leak and are **not** gated by any key at all:

- **The `vault_items` table has no row-level security whatsoever** — despite a code comment claiming it does. The public "anon" key that ships inside the website's own JavaScript can, in all likelihood, read and write the entire knowledge vault (specs, decisions, agent sessions) directly. This needs live confirmation but the migration history is unambiguous: the lock was never installed.
- **Three API endpoints have no authentication** and run with full database power. One of them, `/api/route-task`, is an open door to our paid Anthropic/OpenAI/Gemini accounts — anyone on the internet can spend our model budget through it.

**Cost/risk framing.** The remediation is roughly a **2–4 day build** across three phases, most of it low-risk and additive. The risk of *not* doing it: an unrevocable admin key, an internet-readable knowledge vault, and an unmetered spend endpoint — any one of which is a "reportable to an acquirer" defect that suppresses valuation and, in the spend case, costs real money starting now. **Time-to-fix is short; the downside is uncapped.** Do Phase 0 (contain) today.

**What is already good** (do not undo these — see §6): the OAuth 2.1 facade for the ChatGPT liaison (PKCE, hashed single-use codes, revocation kill-switch, rate limiting), the executor sandbox's zero-secret environment, AES-256-GCM credential encryption at rest, and the dispatcher's SHA-bound push gate. The problems are concentrated in the static-key auth model, the Supabase RLS posture, and secret sprawl on the rig — not in the crypto or the autonomous-build safety rails.

---

## 2. Findings (ranked)

Evidence is `file:line` I read directly. Anything I could not confirm against the live system is marked **UNVERIFIED** with the check that would confirm it.

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| F1 | **P0** | **Build-time-baked key = no revocation.** Auth compares the bearer to `process.env.MCP_API_KEY`, read at module load and frozen into every immutable deployment. Old deployment URLs keep their old baked value and accept the old key forever; rotation only affects new builds. | `app/api/mcp/route.ts:27` (`const MCP_API_KEY = process.env.MCP_API_KEY`), `:118` (`bearerMatches(req, MCP_API_KEY)`). Confirmed by incident: 4/4 old deployments returned 200 with the leaked key. |
| F2 | **P0** | **Leaked full key → entire plaintext credential vault + all writes.** The full scope can call `mc_get_credential`, which decrypts and returns the secret value over MCP. Key was public for 109 days. | `lib/mcp-tools.ts:846-865` (`decrypt(data.value)` then `return JSON.stringify({ key_name, value })`); scope `full` allows every tool `lib/mcp-tools.ts:606,614`. Repo public: `git remote` = `github.com/davidbillera-lab/personal-OS`. |
| F3 | **P0** | **`vault_items` has NO RLS enabled and NO policy** — while `lib/supabase.ts:12` explicitly claims it has "deny-all policies for non-service-role." Supabase grants `anon`/`authenticated` table privileges by default; with RLS off, those grants are enforced with no row filter. The anon key ships publicly in the client bundle (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Likely full read/write of all specs, decisions, agent sessions, knowledge — and any `credential`/`personal`-typed rows — directly via PostgREST, no login. | `supabase/migrations/012_vault_items.sql` (table created; grep of **all** migrations finds zero `enable row level security` / `create policy` for `vault_items`). Contradicts `lib/supabase.ts:12-15`. **UNVERIFIED against live DB** — confirm with `get_advisors` (security lint flags "RLS disabled in public") or an anon-key `GET /rest/v1/vault_items?select=id&limit=1`. |
| F4 | **P1** | **Unauthenticated, service-role-backed API routes.** No token check; all use `createAdminSupabaseClient()` (bypasses RLS). `/api/route-task` is an **open LLM proxy** — unmetered spend on Anthropic/OpenAI/Gemini for any caller. `/api/classify` spends Anthropic + writes `brain_dumps`. `/api/kill-criteria` writes checks + mutates `projects`. All reachable on every deployment URL. | `app/api/route-task/route.ts:5-38` (POST, no auth); `app/api/classify/route.ts:5-25` (POST, no auth); `app/api/kill-criteria/route.ts:5` (POST, no auth). Contrast: alerts/queue routes correctly gate on `CRON_SECRET`. |
| F5 | **P1** | **`credentials` (and all v1 tables) = `authenticated_full_access` FOR ALL.** Any Supabase user with the `authenticated` role can `SELECT` all credential ciphertext + `is_mcp_accessible` flags and, because `WITH CHECK (true)`, `INSERT/UPDATE/DELETE` — e.g. flip `is_mcp_accessible` true or overwrite/delete values. Values stay confidential (AES-GCM needs `CREDENTIAL_ENCRYPTION_KEY`), but integrity/availability do not. Same policy exposes `projects`, `brain_dumps`, `decisions`, `tasks`, `model_costs`, `agent_handoffs`, `credential_access_log` for full read/write. Exploitability depends on whether Supabase Auth self-signup is open. | `supabase/migrations/007_phase_i_second_brain.sql:26-27` and `001_initial_schema.sql:144-160`. **UNVERIFIED**: confirm signup posture in Supabase Auth settings (Dashboard → Authentication → Providers → "Allow new users to sign up"). |
| F6 | **P1** | **Local stdio MCP server is a full, unauthenticated trust boundary.** `mcp-server.mjs` loads `SUPABASE_SERVICE_ROLE_KEY` + `CREDENTIAL_ENCRYPTION_KEY` from `.env.local` and exposes the full tool set — including `mc_get_credential` (plaintext) and all writes — over stdio with **no token check** (the HTTP `resolveAuth` path does not exist here). Anything that can run/attach this server on the rig gets the whole vault. It also writes **no** `mcp_audit_log` rows (only `credential_access_log` on cred reads), so stdio tool use is largely unaudited. | `mcp-server.mjs:33-40` (service role), `:44` (`CREDENTIAL_ENCRYPTION_KEY`), `:463-483` (`mc_get_credential` decrypt+return, no auth), `:829-850` (`tools/call` dispatch, no auth gate). No `logAudit` in file. |
| F7 | **P1** | **Supabase Management-API token passed as `--access-token` CLI arg** to the Supabase MCP server (global `~/.claude.json`). CLI args are visible to any local process/user via the process list (Task Manager, `wmic`, `Get-CimInstance Win32_Process`). A management token = full control of the Supabase project (DB, keys, migrations). | Confirmed flag present in `~/.claude.json` (`"--access-token"`, `"supabase"`, `mcp-server-supabase`). Value not read. |
| F8 | **P2** | **No rate limiting on `/api/mcp`.** The full/read/orchestrator bearer endpoint has no throttle, unlike `/api/mcp-liaison` (60/min/jti). A leaked bearer can enumerate credentials / scrape the vault at full speed. | `app/api/mcp/route.ts:153-226` (no rate check); contrast `app/api/mcp-liaison/route.ts:99-104`. |
| F9 | **P2** | **Secret sprawl on the rig.** `.env.local` holds 24 secrets in plaintext (incl. `SUPABASE_SERVICE_ROLE_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, `OAUTH_JWT_SECRET`, all provider keys) next to the dispatcher, stdio server, and autonomous build workspaces. Any host-side code (or a mis-scoped local agent) reads all of them. Two GitHub PATs coexist (`GITHUB_PAT` + `GITHUB_PERSONAL_ACCESS_TOKEN`). The executor *sandbox* correctly strips env (good, §6) — but host scripts do not. Matches the standing "Hermes rig secret exposure" memory flag. | `.env.local` names only (not values). `scripts/dispatcher.mjs:59-76` + `mcp-server.mjs:13-31` both read `.env.local` into `process.env`. |
| F10 | **P2** | **Leaked key still lives in git history + `.codex/config.toml`.** Rotation removed the literal from `decisions.md` HEAD, but git history (public) retains the leak window; a history purge is required regardless of rotation. `.codex/config.toml` stores `MCP_API_KEY` as a literal in `[shell_environment_policy.set]` (now gitignored; `git log` shows it was never committed — local-only), so it must be updated on every rotation and grants Codex sessions the full key. | `git remote` public; `.gitignore` now lists `.codex/`; `.codex/config.toml` structure (value not read). |
| F11 | **P2** | **Liaison scope holds push-approval authority.** `mc_respond_approval`, `mc_assign_request`, `mc_resume_request` are in `LIAISON_TOOLS`, so the ChatGPT liaison token approves the dispatcher's gated pushes. By design (operator approves via ChatGPT voice) and blast radius is bounded to the sandbox repo `mc-spike-test` + working-branch push only — but the entire autonomous-push gate rests on the liaison token + consent passcode staying secret. | `lib/mcp-tools.ts:42-60` (LIAISON_TOOLS includes `mc_respond_approval`); dispatcher never self-approves `scripts/dispatcher.mjs:18-19,315-358`. |
| F12 | **P2** | **Full-key `mc_write_vault` writes `is_mcp_accessible: true`.** A full-key holder (or the leaked key) can inject vault rows that the read-scoped ambient layer (Hermes) then surfaces and acts on — a prompt-injection path into the always-on agent. | `lib/mcp-tools.ts:1028` (`is_mcp_accessible: true` on insert). |
| F13 | info | **Minor timing leak.** `bearerMatches` returns early on length mismatch before the constant-time compare, revealing token length via timing. Low risk (length isn't sensitive). Note only. | `app/api/mcp/route.ts:106-110`. |

---

## 3. Central Flaw — Remediation Design (F1)

### 3.1 Why rotation and even a datastore alone are not enough

Two independent facts combine into the trap:

1. **Vercel deployments are immutable.** Each deployment URL (`personal-<hash>-jsg1.vercel.app`) is frozen with the *code and env values* present at build time.
2. **Old deployments run old code.** Even after we move validation to a database, historical deployments still execute the *old* `route.ts` that compares against their *own baked* `MCP_API_KEY`. They will accept the old key regardless of anything we change going forward.

**Conclusion:** revocability requires attacking this from both ends.

- **Forward (new deployments must be revocable):** replace the static env compare with a **datastore-backed key check** so any future key can be killed globally and instantly.
- **Backward (old deployments must stop being reachable):** the only ways to neutralize a key baked into frozen old code are to **make those URLs unreachable anonymously** (Vercel Deployment Protection on *all* generated URLs) and/or **delete the old deployments**. A datastore cannot help code that never calls it.

Both are required. Neither alone closes F1.

### 3.2 Datastore-backed validation (the forward fix)

**New table** (migration, RLS deny-all like the OAuth tables):

```
mcp_api_keys(
  id           uuid pk default gen_random_uuid(),
  actor        text not null,          -- 'full' | 'hermes' | 'chatgpt-...' etc. (audit identity)
  scope        text not null check (scope in ('full','read','liaison','orchestrator')),
  token_sha256 text not null unique,   -- store ONLY the hash; never the token
  created_at   timestamptz default now(),
  expires_at   timestamptz,            -- null = no expiry
  revoked_at   timestamptz,            -- set = dead, globally, within cache TTL
  last_used_at timestamptz
)
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY;  (no policy = service-role only)
```

**Validation path** in `resolveAuth` (replacing the env compares): hash the presented bearer with SHA-256, look up a row where `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, and return `{ scope, actor }` from the row. Reuse the existing `hashCode()` pattern from `lib/oauth.ts:115`. Cache lookups ~30–60s in-process (mirror the `getRevokedBefore` cache in `lib/oauth.ts:311-328`) so steady-state adds ~no latency. **Revoke = `UPDATE mcp_api_keys SET revoked_at = now()`** — effective on every deployment that runs the new code, within the cache TTL. Store only the hash so a future DB/log leak yields no usable key (same property the OAuth codes already have).

**Fail closed:** if the DB is unreachable, refuse (503), exactly like today's `misconfigured()`. MCP already needs the DB for every tool, so this adds no new availability dependency.

**Timing:** keep the length-guarded `timingSafeEqual` shape out of the hot path — a hash lookup is constant-time by nature; no per-key loop needed (removes F13 too).

### 3.3 Backward fix (neutralize frozen old deployments)

- **Extend Vercel Deployment Protection to all generated deployment URLs** (Standard Protection / Vercel Authentication, not just the apex). The apex `personal-os.vercel.app` is already protected (per project CLAUDE.md); the `personal-<hash>` URLs are what accept the leaked key. Once they require Vercel SSO or a protection-bypass token, anonymous MCP calls to old deployments fail before reaching the baked compare. **This is the single highest-leverage backward action.**
- **Delete stale deployments** you don't need for rollback (Vercel Dashboard/API). Fewer frozen copies = smaller surface.
- **Re-point the client alias** (`personal-os-git-main-jsg1.vercel.app`, currently pinned to an 18-day-old deployment per F-context and the "Vercel git-main alias pinned" memo) to a *current* protected deployment as part of the cutover, so real clients follow the new code.

### 3.4 Cover every place that trusts `MCP_API_KEY`

The datastore check must replace the static compare in **all** of these, or the baked key still works somewhere:

- `app/api/mcp/route.ts:118` (main).
- `app/api/admin/backfill-ab-vault/route.ts:6-8`, `app/api/admin/backfill-vault/route.ts:31-34`, `app/api/admin/seed-skills/route.ts:774-775` — all compare to `process.env.MCP_API_KEY`. Migrate to the same lookup, or move them behind `CRON_SECRET`/removed if one-shot.
- `mcp-server.mjs` (stdio) does **not** use `MCP_API_KEY` — it trusts the OS boundary + service role. Handle under F6 separately (add a local token or explicitly accept rig-only trust and document it).

### 3.5 Migration path and what breaks

| Phase | Change | What breaks / who must move |
|-------|--------|------------------------------|
| **M0 additive** | Add `mcp_api_keys` table. Insert SHA-256 of the *current* valid keys. Ship `resolveAuth` that checks the table **OR** falls back to the env compare. | Nothing. Both paths valid. Fully backward-compatible. |
| **M1 cutover** | Mint brand-new keys that exist **only** as hashes in the table — never placed in any Vercel env var, so never baked into a build. Update every client: Claude Code (`.claude/settings.local.json`), Hermes profile config (read key), `.codex/config.toml`, any admin curl scripts. Re-point the git-main alias to a current protected deployment. | Each client is down until its key is swapped. The ChatGPT liaison is unaffected (it uses the OAuth facade, not this key). Coordinate the swap. |
| **M2 remove fallback** | Delete the env-var fallback branch and remove `MCP_API_KEY` from Vercel env. Now no *new* deployment can validate anything except via the table. | Old frozen deployments still self-validate their baked key — this is why **M2 must be paired with §3.3 Deployment Protection**, which is the actual kill for old URLs. |
| **M3 hygiene** | Purge the leaked literal from git history (`git filter-repo`) and force-push; rotate every credential that was MCP-flagged during the 109-day window (assume-exposed). | History rewrite invalidates old clones/PRs; coordinate. This is a protected-repo force-push — explicit operator approval required. |

---

## 4. Phased Execution Plan

Each phase names what changes, what could break, and its approval gate. Phases are ordered by risk-reduction per hour.

### Phase 0 — Contain (today, minutes-to-hours)
- **Add auth to the 3 open routes (F4).** Gate `/api/route-task`, `/api/classify`, `/api/kill-criteria` behind an existing secret (`CRON_SECRET` or the new key check). `route-task` first — it spends money.
- **Turn on Vercel Deployment Protection for all generated deployment URLs (F1 backward).** Highest-leverage single action against the leaked key.
- **Confirm F3/F5 exploitability:** run Supabase `get_advisors` (security) and check Auth "allow new signups." This tells you whether F3/F5 are actively internet-exploitable right now.
- *Could break:* any legitimate caller of the 3 routes (know your callers first — grep shows they're internal). Deployment Protection can block a client that used a raw hash URL — re-point it (§3.3).
- **Gate:** Phase 0 changes are reversible and in-scope → proceed without waiting. Deployment Protection scope change is an infra toggle — operator does it in the Vercel dashboard.

### Phase 1 — Close the RLS holes (0.5–1 day)
- **Enable RLS on `vault_items`** with a deny-all-to-anon/authenticated posture (service-role only), matching what `lib/supabase.ts:12` already *claims*. Verify the dashboard and every `createAdminSupabaseClient()` path still work (they use service role → unaffected). Fix the false comment.
- **Tighten `credentials` + sensitive tables (F5):** drop `authenticated_full_access` on `credentials`, `credential_access_log`, `model_costs`; replace with service-role-only (or read-only-select where the dashboard genuinely needs it). Re-evaluate `projects`/`brain_dumps`/`tasks`/`decisions` for least privilege.
- *Could break:* any dashboard read that silently relied on the `authenticated` role instead of service role. The app already standardizes on `createAdminSupabaseClient()` (service role) per project CLAUDE.md, so risk is low — but smoke-test the dashboard after.
- **Gate:** these are migrations against the OS's own DB. Test on a branch/staging first; operator approval to apply to prod (protected-project rule).

### Phase 2 — Datastore-backed keys (1–2 days)
- Implement §3.2 + §3.4 (M0 → M1 → M2). Keep M0 additive and shippable on its own.
- Add rate limiting to `/api/mcp` (F8), reusing `checkRateLimit` from `lib/oauth.ts:291`.
- *Could break:* every full/read/orchestrator client at the M1 swap; the git-main alias if not re-pointed. Sequence the swaps; keep the M0 fallback until all clients confirm green.
- **Gate:** M1 (client cutover) and M2 (remove fallback + delete env var) each need operator go — they intentionally break-then-restore live clients.

### Phase 3 — Rig + history hygiene (0.5–1 day)
- **F6:** decide the stdio boundary — add a local token check to `mcp-server.mjs`, or formally accept "rig OS access = full trust" and document it. Add `mcp_audit_log` writes to the stdio path so local tool use is auditable.
- **F7:** stop passing the Supabase management token as `--access-token`; move it to an env var the MCP server reads, or scope it down. (Config change in `~/.claude.json`.)
- **F9:** minimize `.env.local` on the rig — consolidate the two GitHub PATs into one fine-grained token; move what can move into the encrypted `credentials` table fetched at runtime.
- **F10 / M3:** purge git history + rotate assume-exposed credentials; update `.codex/config.toml` to the new key.
- *Could break:* history rewrite invalidates existing clones/open PRs; PAT consolidation breaks anything using the retired token.
- **Gate:** git history force-push on a protected repo and any production credential rotation require explicit operator approval.

---

## 5. Do NOT Do This (would break functionality)

- **Do not remove `MCP_API_KEY` from Vercel env before M1/M2 land.** The current live clients still authenticate with it; pulling it early hard-breaks Claude Code, Hermes, and the admin routes. Remove only after the datastore path is proven and clients are swapped.
- **Do not switch server routes to `createServerSupabaseClient()` to "add RLS."** Project rule #8 and `lib/supabase.ts:23-26`: that client forwards user cookies and silently fails behind RLS in server contexts. Server routes must keep using `createAdminSupabaseClient()` (service role) and rely on route-level auth + table RLS for defense.
- **Do not enable RLS on `vault_items` without confirming the service-role path.** Every MCP tool and the dashboard read the vault through the service role, which *bypasses* RLS — so deny-all-to-anon is safe. But do not add an over-broad policy that also blocks service role, or you take the whole OS down.
- **Do not add an env-var "break-glass" fallback that survives past M2.** It reintroduces the exact unrevocable-baked-key flaw. Fail closed on DB outage instead.
- **Do not touch the OAuth liaison facade's crypto or flow** (`lib/oauth.ts`, `app/oauth/*`, `app/api/mcp-liaison/route.ts`). It is correctly built (PKCE S256, hashed single-use codes, aud/iss/scope checks, revocation kill-switch, rate limiting). Changing it risks breaking the ChatGPT connector for no security gain.
- **Do not weaken the executor sandbox env allowlist** (`scripts/lib/claude-executor-adapter.mjs:272` `ALLOWED_ENV`, and the docker "no host env crosses" path). This is what keeps autonomous builds from seeing secrets. Leave it strict.
- **Do not loosen the dispatcher push gate** (`scripts/dispatcher.mjs:386-447`) or its "never self-approve" rule. The SHA-binding, repo allowlist, and from-state guards are load-bearing safety.
- **Do not `git filter-repo` / force-push without operator sign-off.** Protected-repo history rewrite is destructive to existing clones and PRs.

---

## 6. Confirmed-Good (protect these)

- **OAuth 2.1 + PKCE liaison facade** — `lib/oauth.ts`: S256 mandatory (`:188-197`), auth codes stored as SHA-256 (`:115`, `:270`), single-use atomic redemption (`:345-369`), JWT `aud`/`iss`/`scope`/`exp` all checked (`:160-183`), global revocation kill-switch (`:308-333`), rate limiting (`:291-301`), non-rotating refresh with sliding + absolute caps (`:412-463`).
- **Executor sandbox zero-secret env** — `scripts/lib/claude-executor-adapter.mjs:272-274` (host adapter env allowlist) and the docker adapter (`:317`, `:450-451`, no host env crosses); clones are shallow + credential files scrubbed (`:64-111`).
- **Credential encryption at rest** — real AES-256-GCM, per-record random IV, auth tag verified (`lib/crypto.ts:14-31`).
- **Dispatcher push gate** — SHA-bound, repo-allowlisted, from-state-guarded, never self-approves (`scripts/dispatcher.mjs:18-24, 386-447`).
- **GitHub webhook** — HMAC-SHA256, timing-safe compare, fails closed with no secret (`app/api/github-webhook/route.ts:39-53`).
- **Cron routes** — `CRON_SECRET`-gated, fail closed (`app/api/alerts/*`, `app/api/queue/dispatch/route.ts:36-41`).
- **Scope gate is defense-in-depth** — `isToolAllowed` re-checked at call time beyond the filtered `tools/list` (`app/api/mcp/route.ts:207`, `lib/mcp-tools.ts:613-619`).

---

## 7. Verification Checklist (before closing this out)

- [ ] F3: `get_advisors(security)` shows no "RLS disabled" for `vault_items` after Phase 1.
- [ ] F5: `credentials` no longer selectable by the `authenticated` role (test with an anon/user JWT).
- [ ] F4: the 3 routes return 401 without a valid secret.
- [ ] F1: a revoked row in `mcp_api_keys` is rejected on a *current* deployment within the cache TTL; and an anonymous call to an old `personal-<hash>` URL is blocked by Deployment Protection.
- [ ] F10: leaked literal absent from all git history after `filter-repo`; assume-exposed credentials rotated.
- [ ] Regression: dashboard loads, Claude Code MCP works with the new key, Hermes read path works, ChatGPT liaison unaffected.
