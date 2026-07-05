# decisions.md — Mission Control (Personal OS)

Canonical log of meaningful decisions and why. Append-only. Every architectural change gets an entry.

---

## Format

```
### [YYYY-MM-DD] — Decision title
**Decision:** What was decided.
**Reasoning:** Why.
**Made by:** operator | agent | operator + agent
```

---

## Pre-Build Decisions (2026-05-02)

### 2026-05-02 — Tech stack: Next.js + Supabase + Vercel

**Decision:** Build the OS on Next.js 14+ (App Router), Supabase (Postgres + auth + edge functions + storage), deployed to Vercel.
**Reasoning:** Operator has familiarity with this stack from VZT and other projects. Supabase gives auth, real-time, and edge functions in one managed service. Vercel gives zero-config deploys with Next.js. Lovable rejected for the core OS because it clashes with multi-agent GitHub pushes.
**Made by:** operator

---

### 2026-05-02 — Three core surfaces for v1 (Dashboard, Inbox, Orchestration)

**Decision:** v1 ships three and only three surfaces: Project Status Dashboard, Brain Dump Inbox, Build Orchestration. Email and calendar integrations deferred to v2.
**Reasoning:** Email/calendar volume is not high enough to stress about; existing assistant (Marblism EVA) covers the gap. OS muscle should be built on project orchestration first. Scope discipline enforced.
**Made by:** operator

---

### 2026-05-02 — Model routing tiers (1–4) defined globally

**Decision:** All model calls across the OS are routed by complexity tier: Tier 1 (Haiku/Flash/GPT-5 mini), Tier 2 (Sonnet/GPT-5/Gemini Pro), Tier 3 (Opus/o3, sparingly), Tier 4 (specialty). Implemented via `/api/route-task`. Fallback rule: on model failure, fall back ONE tier DOWN — never up, never silently spend more.
**Reasoning:** Cost discipline is a hard constraint, not a preference. Every model call must be justified by complexity. The classifier (`/api/classify`) is always Haiku — high volume, low stakes.
**Made by:** operator

---

### 2026-05-02 — Project context lives in repos; OS database reflects state, does not own it

**Decision:** Every project's source of truth is its repo (`CLAUDE.md`, `kill-criteria.md`, `decisions.md`, `model-routing.md`). The OS reads these files but does not write to them. The OS database (`projects`, `tasks`, etc.) is a cache/reflection, not the authority.
**Reasoning:** Keeps the OS swappable. If a better tool emerges in 18 months, the context survives because it lives in git, not in a proprietary database.
**Made by:** operator

---

### 2026-05-02 — VZT protection locked at Medium now, escalates to Heavy before first paying tenant

**Decision:** VZT flagged `tier: 1, protected: true`. Medium protection active: Codex second-opinion review before merge, staging Supabase env, automated tests on listing generation + image processing pipelines, mandatory `decisions.md`. Heavy protection (feature flags, manual approval gate, daily health monitoring, tenant data isolation testing, incident response playbook) triggers before first paying tenant.
**Reasoning:** VZT is pre-revenue but income-adjacent (internal time-saver and production multiplier). Recoverable if broken, but not worth testing. Mobile-recoverable via Claude Cowork.
**Made by:** operator

---

### 2026-05-02 — VZT bus factor succession plan adopted (JJ tier 1, Vinnie tier 2)

**Decision:** Two-tier succession plan. JJ (16, AI-capable, building AI businesses) is Tier 1 secondary — with proper architecture docs, a legitimate emergency maintainer. Vinnie (capable beginner, AI-novice) is Tier 2 execution-only — pre-defined recovery procedures, no code modifications. Before first paying tenant, both doc flavors must exist: `docs/operator/` (architecture, decisions, code-level, audience JJ) and `docs/runbooks/` (step-by-step, screenshots, AI-idiot-proof, audience Vinnie).
**Reasoning:** Operator is currently the only person who can maintain VZT. Bus factor of 1 is unacceptable before paying tenants. JJ doubles as his training ground for holdco involvement.
**Made by:** operator

---

### 2026-05-02 — College Climb workflow locked at Light, validation-gated to ship

**Decision:** College Climb stays in Light workflow until validation completes. Phase 1: JJ smoke test with real data. Phase 2: 5–10 high schoolers + 2–3 parents beta cohort, 2-week time box. Phase 3: iteration on top issues. Phase 4: ship workflow activates (landing page, App Store assets, analytics, first 100 users plan). VZT keeps priority on operator attention; College Climb runs on JJ + beta tester bandwidth until Phase 3.
**Reasoning:** App is unvalidated — no real high schoolers, no real parents, no real end-to-end usage. Smoke tests only. Shipping before validation risks burning the opportunity.
**Made by:** operator

---

### 2026-05-02 — GitHub integration: read-only in v1, no webhooks until v2

**Decision:** v1 GitHub integration is read-only via Octokit + PAT. The OS reads `CLAUDE.md` and context files from project repos on demand. No webhooks, no bidirectional sync, no write operations until v2.
**Reasoning:** Webhooks add operational complexity (secret validation, retry logic, delivery guarantees). Read-on-demand is sufficient for v1. GITHUB_USERNAME is hardcoded as `davidbillera-lab`.
**Made by:** operator + agent

---

### 2026-05-02 — OS itself follows its own rules (kill-criteria.md, decisions.md, model cost logging)

**Decision:** The OS is not exempt from the rules it enforces on other projects. It has a `kill-criteria.md`. It logs decisions here. It logs its own model costs to `model_costs`.
**Reasoning:** Prevents the OS from becoming a sacred cow. If the OS stops delivering value, the kill criteria process should surface that — not operator sentiment.
**Made by:** operator

---

## Build-Time Decisions

### 2026-05-07 — Route group `(app)` pattern for auth-protected layout

**Decision:** Authenticated pages live under `app/(app)/` using Next.js route group convention. Root `app/layout.tsx` is the bare shell (fonts, globals, Toaster). `app/(app)/layout.tsx` runs the server-side auth check and renders Nav. `app/login/` lives outside the group, unprotected.
**Reasoning:** Avoids duplicating the auth check in every page. The route group gives a clean layout boundary without affecting URLs. Login page stays at `/login`, dashboard at `/`, inbox at `/inbox`, orchestrate at `/orchestrate` — no path nesting.
**Made by:** agent

---

### 2026-05-07 — `middleware.ts` → `proxy.ts` (Next.js 16 breaking rename)

**Decision:** Auth session refresh uses `proxy.ts` with exported `proxy()` function, not the legacy `middleware.ts` / `middleware()` convention. The Supabase SSR cookie-refresh pattern is preserved exactly.
**Reasoning:** Next.js 16.2.6 deprecated the `middleware` file convention in favor of `proxy`. The rename is required to avoid the build warning. No behavior change — only the filename and export name changed.
**Made by:** agent

---

### 2026-05-07 — Single `authenticated_full_access` RLS policy per table (single-user v1)

**Decision:** Each table gets one RLS policy named `authenticated_full_access` granting full CRUD to all authenticated users. No per-row ownership checks.
**Reasoning:** v1 is single-operator. The only authenticated user is the operator. Adding owner-column checks now would be premature; they belong in v1.3 (Vinnie + JJ multi-user). Simple policy is reviewable in seconds; complex policies are auditable nightmares.
**Made by:** agent

---

### 2026-05-08 — Phase C: model router + brain dump classifier (Option B architecture)

**Decision:** AI layer wired via `lib/models/` (pricing, adapters, router) and `lib/classify.ts`. API routes at `/api/route-task` and `/api/classify` are thin POST wrappers. `quickDump` server action calls `classifyBrainDump()` directly — no HTTP self-call.
**Reasoning:** Option B keeps logic in lib/ so it's testable and reusable without HTTP overhead. Server actions are already in the server runtime, so calling classify() directly is correct and ~30ms faster than a loopback fetch.
**Made by:** operator + agent

---

### 2026-05-08 — GPT-4o-mini as accountability partner on low-confidence classifications

**Decision:** When Haiku classification confidence < 0.75, GPT-4o-mini runs the same classify prompt. If they disagree on type, the result is forced to `unclassified` and confidence is set to `Math.min(haiku_conf, gpt_conf)`. GPT call always logged to `model_costs` with `purpose: 'accountability_check'`.
**Reasoning:** Haiku is cheap and fast but can be uncertain on ambiguous brain dumps. GPT-4o-mini is a different model family — disagreement is a real signal, not noise. Forcing `unclassified` on disagreement is conservative but honest; the operator can review and reclassify. Cost: ~$0.0001 per accountability check — negligible.
**Made by:** operator + agent

---

### 2026-05-18 — Phase I: Credentials vault uses AES-256-GCM encryption at rest, never stored plain

**Decision:** All credential values in the `credentials` table are encrypted with AES-256-GCM before write and decrypted on reveal. Encryption key is `CREDENTIAL_ENCRYPTION_KEY` (64-char hex, 32 bytes) stored in env only — never in the database. List view shows masked values only (`••••••••` + last 4 chars). Reveal is a separate server action that decrypts on demand and auto-clears after 30 seconds in the UI.
**Reasoning:** API keys in plaintext in Postgres are a critical exposure risk — Supabase dashboard, service role access, and any future RLS misconfiguration would expose them. AES-256-GCM provides authenticated encryption; the auth tag prevents tampering. Masking by default means no accidental screen-share leaks.
**Consequence:** `CREDENTIAL_ENCRYPTION_KEY` must exist in env before any credential write. Loss of the key means all stored credentials are permanently unreadable. Back it up to a secrets manager. Do not rotate without re-encrypting all rows.

---

### 2026-05-18 — Health monitoring uses cached results (5-min TTL) not live checks per page load

**Decision:** `getProjectHealth()` in `lib/health.ts` upserts results into `project_health` table and returns cached rows if age < 5 minutes. Live checks hit GitHub API and the project's Vercel URL; Supabase health is inferred from whether a `supabase_project_id` is recorded (no management API call).
**Reasoning:** Health checks on every page load would hammer the GitHub API rate limit (60 req/hr unauthenticated, 5000/hr with PAT). With ~10 projects each checked on dashboard load, we'd burn rate limits in minutes. Cache-then-refresh is the right pattern. Supabase management API requires an OAuth token we don't have; presence of a project ID is sufficient signal for v1.
**Consequence:** Health status can be up to 5 minutes stale. That's intentional. Do not remove the cache TTL to get "real-time" health — add a manual refresh button instead if needed.

---

### 2026-05-18 — Tier-3 (Opus) calls race GPT-4o in parallel

**Decision:** When `complexity_tier: 3` is routed, Opus and GPT-4o fire simultaneously via `Promise.allSettled`. Whichever resolves first is the winner. Both calls are logged to `model_costs`. GPT result logged with `purpose: 'accountability_partner'`.
**Reasoning:** Tier-3 tasks are the highest-stakes calls. Having a second model in flight costs ~2× but adds meaningful error protection and a cross-check on correctness. Latency does not increase since both run in parallel. Operator explicitly requested this pattern.
**Made by:** operator + agent

---

### 2026-06-08 — MCP server at `/api/mcp` for agent tool access

**Decision:** Mission Control exposes a Model Context Protocol server at `/api/mcp` (deployed on Vercel). Agents authenticate via `Bearer MCP_API_KEY`. On Windows, the token must live in `.claude/settings.local.json` as an `env` entry — not as a Windows environment variable. OS env propagation on Windows is unreliable and silently fails.
**Reasoning:** Direct Supabase REST calls from agents required passing service role keys across sessions, which is a security exposure. The MCP server proxies all agent-to-MC communication behind a single bearer token and a controlled API surface. The token can be rotated without touching Supabase credentials.
**Consequence:** If `mc_*` tools fail to connect, check `settings.local.json` before anything else. Token is `mc-api-key-personal-os-2026`. Do not move it to Windows env vars.
**Made by:** operator + agent

---

### 2026-06-08 — Brain dump capture (InboxCapture) with voice input shipped

**Decision:** `InboxCapture` component (`components/InboxCapture.tsx`) is the primary capture surface. Submits via `submitDump` server action in `app/(app)/inbox/actions.ts`. Triggers synchronous Haiku classification (`classifyBrainDump`) before returning. Voice input uses the Web Speech API — appends to existing textarea content, does not replace. ⌘↵ keyboard shortcut wired.
**Reasoning:** The brain dump inbox is the OS's highest-frequency user interaction. Classification must be synchronous so the operator sees a result immediately. Voice captures ideas without typing friction. Existing content is preserved on voice input so the operator can combine typed and spoken context.
**Consequence:** Classification happens on every submit — do not move it to async fire-and-forget without a deliberate decision. Voice only works in browsers supporting `SpeechRecognition`/`webkitSpeechRecognition`; no error is thrown if unsupported.
**Made by:** agent

---

### 2026-06-08 — Vault auto-capture integrated into spec generation

**Decision:** When a spec is generated from a brain dump (`generateSpecAction` in `inbox/actions.ts`), the spec text is automatically captured to `vault_items` via `captureToVault()` with type `build_spec`. This happens after the task row is updated, before `revalidatePath`.
**Reasoning:** Specs are the most valuable artifacts in the OS. Storing them in the vault makes them retrievable by future agents via semantic search (`mc_get_vault_context`) without the agent needing to know the task ID or query Supabase directly.
**Consequence:** Every generated spec appears in vault searches. If `captureToVault` fails, the spec is still saved to the `tasks` row — vault capture is additive, not load-bearing.
**Made by:** agent

---

### 2026-06-08 — Active Skills (Claude Code Superpowers) adopted across all sessions

**Decision:** Seven skills are active for all Claude Code sessions on this project: `davids-way` (build methodology), `vault-recall` (recall before code), `session-context` (session start protocol), `mission-control` (MC read/write bookends), `decisions-sync` (decisions.md + push at session end), `CodexQC` (GPT-5.x second-opinion review), `advisoryboard` (accountability panel for business decisions). All documented in the "Active Skills" section of `CLAUDE.md`.
**Reasoning:** Skills encode operator workflow discipline in a form any agent can read. Without them, each new session starts cold on methodology. With them, any agent picks up the build methodology automatically.
**Consequence:** Agents must invoke `davids-way` before any non-trivial build task. `session-context` or `vault-recall` before touching code. `decisions-sync` + `mc_update_project_status` at session end. Standing rule, not optional.
**Made by:** operator + agent

---

### 2026-06-08 — `createAdminSupabaseClient()` is the universal server-side pattern

**Decision:** All server actions, API routes, and server components in this repo use `createAdminSupabaseClient()` (service role key, bypasses RLS). `createServerSupabaseClient()` is not used on the server side.
**Reasoning:** The OS is a single-operator app. Server-side code runs as a service, not as an authenticated user — using the anon key causes silent failures when RLS blocks the query with no error. The admin client is explicit and correct for all server-side use.
**Consequence:** Do not introduce `createServerSupabaseClient()` in server actions or API routes. If a future multi-user feature requires per-user RLS enforcement, that requires a separate decision and explicit scope.
**Made by:** agent

---

### 2026-06-09 — Local stdio MCP server replaces Vercel HTTP transport

**Decision:** `mcp-server.mjs` (project root, Node.js ESM) is now the Claude Code MCP transport. `.mcp.json` switched from `type: "http"` to `type: "stdio"` with `command: "node", args: ["./mcp-server.mjs"]`. All 10 `mc_*` tools are implemented inline — no Next.js imports, no `@/` aliases. Vercel HTTP endpoint at `/api/mcp` stays unchanged as a fallback for non-Claude Code clients (e.g., web-based agents, Manus).
**Reasoning:** Vercel serverless functions sleep between invocations, causing 2–5s cold-start delays. Claude Code's MCP client times out during the `initialize` handshake, leaving all `mc_*` tools unavailable for the entire session. The local stdio server is launched directly by Claude Code as a child process — no network hop, no cold start, always available from first message.
**Consequence:** Claude Code must be restarted to pick up the new `.mcp.json` config. `mc_complete_task` skips auto-QC in the stdio server (requires Next.js server actions) — returns `qc: "not_available_in_local_server"` when a commit URL is provided. `CREDENTIAL_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` must be in `.env.local` at project root (already are); the server reads them at startup.
**Made by:** operator + agent

---

### 2026-06-09 — Portfolio agent roster: repo-authored, vault-distributed, globally installed

**Decision:** Ten reusable subagents live in `agents/*.md` (canonical Claude Code subagent format: YAML frontmatter + system prompt). `scripts/sync-agents.mjs` (`npm run sync:agents`) distributes them two ways: upserts into `vault_items` as `type: 'agent'` (tagged by crew — build / revenue / holdco — `is_mcp_accessible: true`, embedded for semantic search), and copies to `~/.claude/agents/` so every Claude Code session on any project can dispatch them. Two new MCP tools — `mc_list_agents` and `mc_get_agent` — expose the roster to any MCP client, implemented in both the stdio server (`mcp-server.mjs`) and the Vercel HTTP server (`lib/mcp-tools.ts`).
**Reasoning:** Delegation is the structural fix for compact thrashing and context rot — subagents burn their own context and return only conclusions, keeping the main session lean. Vault distribution keeps the roster tool-agnostic (Codex, Manus, web agents fetch definitions via MCP), honoring the standing rule that the repo is the source of truth and the OS reflects state. Crew assignment lives in the sync script's `CREWS` map, not in frontmatter, so agent files stay canonical Claude Code format.
**Consequence:** After editing or adding an agent, run `npm run sync:agents`. Claude Code discovers `~/.claude/agents/` at session start — newly installed agents need a restart before the Agent tool can dispatch them by name. Roster table lives in CLAUDE.md ("Agent Roster" section).
**Made by:** operator + agent

---

### 2026-06-11 — video-optimizer-app relocated out of personal-os (gitlink removed)

**Decision:** video-optimizer-app moved from `projects/video-optimizer-app` (nested git repo tracked as a bare gitlink in personal-os) to `C:\Users\david\video-optimizer-app`, a standalone sibling repo beside VZT and FlipRadar. The gitlink was removed from the personal-os index (`git rm --cached`), and the VS Code workspace entry now points at the new path (a missing-comma JSON error in `personal-os.code-workspace` was fixed in the same change).
**Reasoning:** The nested-repo gitlink forced double commits — every nested change required a pointer-bump commit in personal-os — with none of the benefits of a real submodule (no `.gitmodules`, no pinning intent). The project has its own GitHub remote and release cadence; sibling-repo layout matches the rest of the portfolio and keeps personal-os a pure command layer (repos are the source of truth, the OS reflects state).
**Consequence:** Agents working on video-optimizer-app open `C:\Users\david\video-optimizer-app` directly; personal-os no longer tracks its state in git. Docs referencing the old `projects/` path were updated (`docs/video-optimizer-app.md`, `docs/lint-triage-video-optimizer.md`).
**Made by:** operator + agent

---

### 2026-07-01 — mc_capture_credential fixed: tier must derive from scope, not 'standard'

**Decision:** `mcp-server.mjs` `mc_capture_credential` now writes `tier: project_id ? 'project' : 'global'`. It previously hardcoded `tier: 'standard'`, which violates the `credentials_tier_check` DB constraint (`tier IN ('global','project')`) — every capture failed. Existing rows predate the drift.
**Reasoning:** Schema and server drifted; the constraint is the correct source of truth (global vs project scoping matches how credentials are actually used). Discovered when vaulting College Climb's SCORECARD_API_KEY. Interim rows (Scorecard key + campus-climb Supabase/Stripe creds) were written via direct SQL using the identical AES-256-GCM format and round-trip verified through the live server's `mc_get_credential`.
**Consequence:** The running MCP server process still has the old code — the fix takes effect on next Claude Code session (or MCP reconnect). Sensitive creds (service role, Stripe secrets, webhook) are stored `is_mcp_accessible=false`: vault-recorded but not agent-fetchable, matching existing convention.
**Made by:** agent (root-cause fix during College Climb credential sync)

---

### 2026-07-04 — Vault graph v2: tag-hub galaxy model, star/planet hierarchy, token-lean MCP vault access

**Decision:** The Vault graph moved from pairwise shared-tag edges to a tag-hub model (items link to synthetic tag nodes — edges grow linearly, clusters form for free) rendered as a full-screen "living galaxy" at `/vault/graph`: significant items (knowledge, specs, decisions, brain dumps, credentials, skills, agents) are gradient "planets" (5–9px), auto-captured exhaust (pushes, sessions, snapshots, mcp events) stays as individual tiny "star" points (1.5–2.5px) — no aggregation, no hiding. Brightness derives from `updated_at` (smoothstep decay: full ≤3d → 0.35 floor at 90d for planets, 0.75 → 0.20 for stars); items touched within 7 days pulse. Ambient motion: star twinkle, planet sheen, ~6 min/rev centroid rotation that pauses on interaction; all disabled under `prefers-reduced-motion`. Pure graph logic lives in `lib/vault-graph.ts` (19 vitest unit tests — first test infra in this repo). A live-data guided tour (`VaultGraphTour`) explains the graph in plain English for non-operators. MCP side: new `mc_get_vault_item` (full single-item fetch by id) + `mc_get_vault_context` previews slimmed 500→200 chars with a `truncated` flag, establishing the two-step search-cheap-then-fetch-one pattern in both `lib/mcp-tools.ts` and `mcp-server.mjs`.
**Reasoning:** Pairwise tag edges scale quadratically (20 shared-tag items = 190 edges) and exhaust volume drowned real knowledge — the graph had become unreadable. The star/planet size hierarchy declutters without deleting history (operator chose this over aggregation after visual mockup comparison). Age-as-brightness makes the graph a heat map of attention. The old 500-char × 8 previews with no follow-up fetch forced agents to over-search; the two-step pattern cuts typical context pulls ~60% and gives full documents only on exact request. WebGL rewrite rejected: unneeded capacity at a few hundred items.
**Consequence:** `/vault` shows a preview card; the graph lives at `/vault/graph`. `npm test` now runs vitest. The running MCP stdio server picks up `mc_get_vault_item` on next session/reconnect; the Vercel endpoint on next deploy. Agents should be pointed at the two-step pattern (tool descriptions teach it). Spec: `docs/superpowers/specs/2026-07-04-vault-graph-v2-design.md`; plan: `docs/superpowers/plans/2026-07-04-vault-graph-v2.md`.
**Made by:** operator + agent (davids-agents serial relay: Sonnet×5, Opus×1, Haiku×1, Fable orchestrating)

---

### 2026-07-05 - Codex skill layer mirrors David's Claude workflow

**Decision:** Add Codex-native workflow skills under `codex-skills/` and sync them globally to `C:\Users\david\.codex\skills` with `npm run sync:codex-skills`. The initial set is `jsg-build-routing`, `mission-control-context`, `davids-way`, `codex-relay`, `checkpoint`, `decisions-sync`, `advisoryboard`, `self-improving-ai`, and `claude-qc`. `AGENTS.md` now tells future Codex sessions to treat Claude-style commands such as `/davids-way`, `/davids-agents`, `/phase-relay`, `/checkpoint`, `/handoff`, `/advisoryboard`, and `/ClaudeQC` as triggers for the matching Codex skills.
**Reasoning:** David's core Claude Code skills encode valuable operating discipline: model-tier routing, targeted context reads, MC/vault recall, serial relay to avoid context thrash, durable decision capture, and independent review. Codex needs the same reusable behavior without copying one giant Claude-specific prompt into every session. Separate small Codex skills preserve progressive disclosure and make the repo copy the source of truth while the global `.codex/skills` copy is the active install.
**Consequence:** Future Codex sessions can jump into Mission Control or any JSG project with the same working context and can run the reciprocal QC pattern: Codex builds, Claude reviews through `claude-qc`; Claude builds, Codex reviews through existing CodexQC. After editing any Codex skill, run `npm run sync:codex-skills` to refresh the global install. The official Codex skill validator currently cannot run in this Python environment because `PyYAML` is missing, so structural validation was performed with local frontmatter/name/secret checks.
**Made by:** operator + Codex
