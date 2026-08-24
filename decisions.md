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
**Consequence:** If `mc_*` tools fail to connect, check `settings.local.json` before anything else. Token is `[REDACTED — credential rotated 2026-08-23, see security incident entry]`. Do not move it to Windows env vars.
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

### 2026-07-12 — Venture Studio framework v1: `asset_class` becomes the second axis alongside `tier`

**Decision:** Added `projects.asset_class` (`venture` / `operating_tool` / `personal` / `web_property` / `client_service`; NOT NULL, default `venture`, check-constrained) to the Mission Control Supabase. `tier` is unchanged and remains the priority/protection axis. All 18 existing projects backfilled per the spec map; 4 web-property rows inserted (jsgliquidators.com, skincarebynicole.com, rodanheatingandair.com, jsgestatecleanouts.com — tier 3, stage ship). Dashboard groups cards by asset_class (five sections) with tier as a T1/T2/T3 badge on cards; `mc_get_project_context` returns `asset_class` in both MCP implementations (route.ts delegates, no edit needed).

**Reasoning:** Tier encoded priority, not asset class — the two were tangled (launch-ready College Climb at tier 3; live-billing Meridian at tier 2). A venture studio needs the axes separate: what kind of asset it is vs. how protected/prioritized it is. Additive-only; nothing destructive.

**Consequence:** Personal stays ONE class (live-vs-archive is already captured by `stage`). David-owned websites are `web_property`, distinct from Marblism `client_service` work. Financial roll-ups, entity/equity modeling, and studio P&L deferred to v2. jsgestatecleanouts.com was included by lead judgment from the Lovable published-projects list; blast-off-hvac and nicoles-side-hustle-hub read as prototypes and were excluded — operator may reclassify any row. Full design: docs/superpowers/specs/2026-07-12-venture-studio-framework-design.md.

**Made by:** operator (design locked 2026-07-12) + agent (implementation)

---

### 2026-07-12 — New agents/harnesses earn `mc_get_credential` access; no blanket credential exposure

**Decision:** Hermes Agent (Nous Research's open-source MCP-capable harness, self-hosted, stood up 2026-07-12) will NOT be given blanket credential access via the shared `MCP_API_KEY` token, despite hitting `is_mcp_accessible=false` blocks and requiring manual `.env.local` entry a few times. Credential access stays case-by-case: individual keys get `is_mcp_accessible` flipped to `true` only after review; Stripe secrets, Supabase service role keys, and webhook secrets stay permanently agent-blocked regardless of friction. New agents/harnesses generally must prove trust over time before broader vault access, rather than being granted parity with established agents (Claude Code, Codex) on day one.
**Reasoning:** There is currently one shared full-scope `MCP_API_KEY` token used by every agent and project — no per-agent or per-project credential scoping exists yet. Opening `is_mcp_accessible` broadly would expose every secret in the vault (including VZT's, which is locked at Medium-escalating-to-Heavy protection) to whichever agent holds that token, including a harness with zero track record. This directly matches the existing 2026-07-01 convention (sensitive creds default `is_mcp_accessible=false`) — the friction was working as designed, not a bug.
**Consequence:** When Hermes (or any future harness) hits a blocked credential, resolve it per-key: evaluate whether that specific credential is safe to expose, flip only that row, and leave the sensitive tier locked. If Hermes becomes a regular tool-caller, consider issuing it a separate `'read'`-scope token instead of reusing the `'full'` token, so it can browse without ever reaching `mc_get_credential`. Revisit this policy once Hermes has an established track record.
**Made by:** operator + agent

---

### 2026-07-05 - Codex skill layer mirrors David's Claude workflow

**Decision:** Add Codex-native workflow skills under `codex-skills/` and sync them globally to `C:\Users\david\.codex\skills` with `npm run sync:codex-skills`. The initial set is `jsg-build-routing`, `mission-control-context`, `davids-way`, `codex-relay`, `checkpoint`, `decisions-sync`, `advisoryboard`, `self-improving-ai`, and `claude-qc`. `AGENTS.md` now tells future Codex sessions to treat Claude-style commands such as `/davids-way`, `/davids-agents`, `/phase-relay`, `/checkpoint`, `/handoff`, `/advisoryboard`, and `/ClaudeQC` as triggers for the matching Codex skills.
**Reasoning:** David's core Claude Code skills encode valuable operating discipline: model-tier routing, targeted context reads, MC/vault recall, serial relay to avoid context thrash, durable decision capture, and independent review. Codex needs the same reusable behavior without copying one giant Claude-specific prompt into every session. Separate small Codex skills preserve progressive disclosure and make the repo copy the source of truth while the global `.codex/skills` copy is the active install.
**Consequence:** Future Codex sessions can jump into Mission Control or any JSG project with the same working context and can run the reciprocal QC pattern: Codex builds, Claude reviews through `claude-qc`; Claude builds, Codex reviews through existing CodexQC. After editing any Codex skill, run `npm run sync:codex-skills` to refresh the global install. The official Codex skill validator currently cannot run in this Python environment because `PyYAML` is missing, so structural validation was performed with local frontmatter/name/secret checks.
**Made by:** operator + Codex

---

### 2026-07-08 — Output Token Discipline adopted (Ponytail adaptation) + context files trimmed

**Decision:** Global `~/.claude/CLAUDE.md` gains an always-on "Output Token Discipline" section — the pre-write ladder adapted from Ponytail (github.com/DietrichGebert/ponytail) plus output-side rules Ponytail lacks: edit-never-rewrite, no code echo into chat, one implementation not a menu, no unrequested artifacts, right-sized plans/summaries, one-runnable-check testing. A callable version is installed as the `lean-code` skill (`~/.claude/skills/lean-code/`, pushed to the skills repo, synced to vault) adding a review mode that flags over-engineering ranked by lines saved. `AGENTS.md` carries the same rules so Codex and any non-Claude tool stay aligned. In the same pass, both CLAUDE.md files were de-bloated: global file lost its duplicate standing rules (cost-log, model-match, confirmation-prompt) and self-describing header, with the listing-description rule compressed in place; the project file's "Open Questions" section (both items LOCKED since 2026-05-02, detail already in this log) collapsed to two summary pointers.
**Reasoning:** Existing skills (davids-way, checkpoint, phase-relay, davids-agents) discipline input-side spend, but input is the cheap direction — output tokens cost ~5x ($50 vs $10 per MTok on Fable 5 usage-credit billing, live 2026-07-07). Nothing gated output before generation; simplify/CodexQC catch over-engineering only after the tokens are spent, paying for bloat twice. Bloated instruction files additionally dilute per-rule instruction-following.
**Consequence:** Global standing rules renumbered (old rules 2 and 8 deleted as duplicates; old 12 is now 10). VZT/JSG repos deliberately untouched. Keep the Output Token Discipline section lean — it is itself always-loaded input.
**Made by:** operator + agent

---

### 2026-07-16 — Hermes joins as the ambient layer; MC health digest ships; read-scope transport

**Decision:** Hermes is incorporated as Mission Control's **ambient layer** — the always-on role Claude Code and Codex structurally cannot fill (session-bound). It is NOT a peer builder and NOT a portfolio asset (open-source infra, nothing to exit). First job shipped: a **daily MC health digest** to Telegram. Delivery is split into two lanes that share the Telegram bot but no code: (1) **Vercel cron** (`/api/alerts/digest`, `0 14 * * *`) owns delivery — serverless, fires even when the local rig is off; (2) **Hermes** owns best-effort replies from the vault. Digest is daily-suppressed (sends only when a project is failing/blocked/stale >14d; silence = all-clear). Hermes's MC access is downgraded from the **full** token to a **read-scope** token via a transport switch: its `mission-control` server moves from local stdio (`node ./mcp-server.mjs`, which enforces NO auth/scope) to the production HTTPS endpoint `personal-os-git-main-jsg1.vercel.app/api/mcp` with `Authorization: Bearer <MCP_READONLY_API_KEY>`.

**Reasoning:** Standing Rule #3 ("kill-criteria fails surfaced within 24h") had no mechanism — nothing could reach the operator outside an open window. A Hermes-owned delivery loop would silently fail whenever the PC is off, so delivery must be serverless; Hermes earns its place on the reply path (a cron can't answer "why is VZT blocked?"). The read-scope downgrade honors the 2026-07-12 credential decision as written — Hermes gets a bigger job and less access the same day. Discovery: the read-scope layer was fully built but dormant (`MCP_READONLY_API_KEY` unset); the HTTPS endpoint had never been used (all agents were on stdio), which hid that the apex `personal-os.vercel.app` is behind Deployment Protection — hence the git-main alias.

**Consequence:** `MCP_READONLY_API_KEY` set in Vercel Production (also stored encrypted in the vault + gitignored `.env.local`); Hermes on read scope cannot call `mc_get_credential` or any write tool (403). New files: `lib/alerts/digest.ts` (+tests), `app/api/alerts/digest/route.ts`, `vercel.json`. Still requires operator to add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET` to Vercel prod. Seasonal 1h drift (8am MDT / 7am MST) accepted for Hobby single-daily cron. Bonus fix: `mc_capture_credential` HTTP path used invalid `tier: 'standard'` (constraint allows only `global|project`) — corrected to match the stdio impl. Out of scope (future, more trust each): inbound Telegram→brain-dump capture, autonomous Hermes cron work. Full detail: `specs/2026-07-16-hermes-ambient-layer-design.md`.
**Made by:** operator + agent

---

### 2026-07-18 — Ideation/execution workflow locked: Hermes drafts, Claude Code executes, each cross-checks the other

**Decision:** Canonical operating workflow adopted for all portfolio projects. Ideate/research/draft in **Hermes** (front door, read-only MC, flat-rate ChatGPT sub); execute/validate/persist in **Claude Code** (repo-aware, full MC). **Whoever drafts an artifact, the other agent attacks it** before it ships — mandatory for new projects, architecture changes, Tier 1/protected projects, trust-boundary changes, and anything touching production. Hermes emits exactly two artifacts, in the EXISTING `spec-writer` and `handoff` formats — never parallel ones. Full doc: `specs/2026-07-18-ideation-execution-workflow.md`; vault copy `fb27cf0d-f7bc-429e-ac4b-0752f305dc6d`.

**Reasoning:** The 2026-07-16 ambient-layer build proved the cross-check is the highest-value mechanism, not ceremony: Claude Code wrote the spec and Hermes caught a fatal flaw (the token-repoint step was meaningless because Hermes connected over stdio, which enforces no auth/scope); Hermes wrote the plan and Claude Code caught two defects (Telegram poller collision; production work assigned to an unproven harness). Neither agent gets there alone — the reviewer's edge is a different vantage point (repo vs live machine). A pure waterfall (Hermes plans → Claude builds) discards exactly that. Separately, Hermes ideation runs flat-rate while the same conversation in Claude Code burns Opus tokens, so moving messy front-end thinking to Hermes is a genuine saving.

**Consequence:** Two constraints are now explicit. (1) **Persistence contract** — Hermes cannot write to MC, so every handoff MUST instruct Claude Code to save the spec to `specs/`, capture to the vault, log decisions, and update MC; an unpersisted Hermes artifact does not exist. (2) **Specs for existing codebases are drafts until validated against the repo** — a blind spec proposes building what may already exist (the read-scope layer was already fully built and dormant). Twelve guardrails codified to protect MC as source of truth, chiefly: Hermes stores nothing durable, stays read-only, and uses existing skills rather than reinventing them.
**Made by:** operator + agent

---

### 2026-07-19 — Advisory-board gate added to the workflow (new ventures & pivots, Hermes-side, before build)

**Decision:** The `advisoryboard` four-persona panel becomes a formal **go/no-go gate** on the finished Hermes handoff, before anything crosses to a Claude Code build window. It is a SECOND, distinct gate from the technical cross-check: the cross-check asks "will it work?", the AB gate asks "should we build it at all?" (strategic/behavioral, verdict-first, names avoidance/shiny-object, doesn't rescue bad ideas). **Scope:** new ventures + significant pivots only (mirrors advisoryboard's own triggers) — routine features/fixes skip it. **Placement:** Hermes-side; Hermes runs the panel by pulling `advisoryboard` via `mc_get_skill`, David engages the four personas. **Verdicts:** GO → verdict rides inside the handoff, Claude persists it as an `ab_conversation` at finalize; KILL → David carries the verdict to a Claude/HQ session to log (Hermes can't write to the vault); MODIFY → back to develop.

**Reasoning:** The handoff is the last cheap checkpoint before expensive Claude Code execution — scope, time-to-revenue, and kill criteria are concrete by then, so the panel reacts to specifics rather than a vague idea, and Hermes ideation was flat-rate so nothing costly is yet spent. Running it Hermes-side (David's original instinct, corrected from an initial Claude-side placement) puts the go/no-go where David already is, before he commits to opening a build window at all. Scoping to new ventures/pivots keeps the panel meaningful — a gate that fires on every routine feature becomes a rubber stamp and gets skipped.

**Consequence:** One accepted tradeoff — because Hermes is read-only, a KILL verdict does not auto-persist and requires one manual logging step in a Claude session. This is deliberate: kills are rare and are the highest-value verdict to keep (prevents re-proposing dead ideas), so the small friction is worth the durability. Encoded in the canonical workflow spec, the `davids-rules` skill, and vault item fb27cf0d.
**Made by:** operator + agent

---

### 2026-07-19 — Specialist model escalation & swappable execution added to the workflow

**Decision:** The execution model is chosen **per task, not permanently assigned by platform** — the operational expression of the tool-agnostic thesis. Defaults hold (Hermes plans on Codex OAuth, Claude Code is the default implementation environment, Codex QCs). Hermes may recommend a different model when current evidence shows a real task-specific advantage (capability, cost, speed, privacy, context window, tool use, local fit). **Metered API use requires an upfront route + cost assessment AND David's approval.** MoA (Mixture-of-Agents) planning may consult specialists as advisors only — the Hermes aggregator owns canonical compliance; no unpinned/default metered MoA preset. An approved outside model may implement a **bounded** task in an **isolated branch/worktree** with **no MC write, no merge authority, no unnecessary prod creds**, and never in a protected repo outside the full gate. Claude Code reviews/tests/integrates/**owns** the result; Codex independently reviews the actual diff + verification evidence; Claude rebuts or remediates each material finding; David makes the final call; **Claude Code alone persists to GitHub + MC.**

**Reasoning:** Locks in "match the model to the task" without letting a swappable executor erode the invariants the last several months bought — source-of-truth, the persistence contract, least-privilege, cost discipline, and the Codex cross-check all survive intact. It codifies a *safe* path for outside-model execution (isolated worktree, no durable authority, Claude Code as integrator/owner) so specialist capability can be used without handing an unproven or external model any state ownership.

**Consequence:** New guardrail #13 — models perform work but never own project state; only Claude Code persists to Git + MC. Encoded in the canonical workflow spec, the `davids-rules` skill (re-synced to vault), and vault item fb27cf0d. Metered/outside-model use folds into the existing model-tier + approval discipline (guardrail #6). Came via Hermes draft → Claude validation → persistence, i.e. the workflow exercising itself.
**Made by:** operator + agent (Hermes draft, Claude validation)

---

### 2026-07-22 — Brain-dump capture: manual bridge now, Hermes write tool deferred

**Decision:** Hermes brain dumps reach Mission Control via a **manual bridge**, not a Hermes write privilege — for now. Hermes captures each dump verbatim into a local rolling buffer (survives compaction), emits a `BRAIN DUMP HANDOFF` block on request, David pastes it into Claude Code, and Claude runs a Haiku classification pass → routes each dump to the right project → writes to the MC brain-dump inbox → surfaces decisions/kill-candidates/new-project candidates for David. Hermes stays fully read-only; it archives + clears its buffer on David's confirmation. The scoped-write approach (a `capture` token + `mc_write_brain_dump` tool) is designed and **deferred to step 2**.

**Reasoning:** The bridge is the persistence contract applied to capture (Hermes drafts → David transports → Claude persists). It does capture AND triage in one pass — a raw auto-write would only drop unclassified text into the inbox, leaving routing for later. It keeps Hermes read-only while it keeps earning track record, and it teaches us the real classification/routing rules before we automate them. Building the write tool first would mean automating a flow we've never run. Bridge-first IS the trust ladder.

**Consequence:** Hermes gets a local capture buffer (`AppData/Local/hermes/brain-dumps/buffer.md`) — transient, not durable portfolio state, so it doesn't cross the source-of-truth boundary. Classification runs on Haiku (Tier 1), routing on Opus with live project context. No MCP brain-dump tool exists yet, so Claude persists via the brain_dumps inbox directly until step 2 builds `mc_write_brain_dump` + a `capture` token scope (read tools + that one write tool; credentials/project-writes/vault-writes stay 403). Encoded in the workflow spec.
**Made by:** operator + agent

---

### 2026-07-23 — SOUL.md adopted as the portfolio intake gate

**Decision:** `SOUL.md` (JSG Holdco Charter) is the canonical **intake gate** — the test an idea must pass to become a JSG asset, upstream of the advisory board and kill-criteria. Gate order: **SOUL (does it belong?) → advisory board (should we build it now?) → kill-criteria (is it still viable in flight?).** Locked with David's inputs: Mars = an empire holding multiple flagship "Mars-driven" assets *plus* a factory producing assets sold at significant multiples (origin: estate-sale/reselling → VZT → operator confidence); JSG is a **permanent cash-flowing parent that spins out and sells assets, not itself for sale**; "won't build" adds **single-client service businesses** and **regulated verticals without a partner** to the existing exclusions.

**Reasoning:** The advisory board and kill-criteria both evaluate a project *already in flight*; nothing governed whether an idea belonged in the portfolio in the first place — that lived only in the operator's gut. The charter makes it explicit, portable to every agent, and durable across tool/model/project swaps (the "context is the moat" thesis applied to the company). Scoped deliberately as a decision filter, not a mission-vibes page — every line is a filter or a fact.

**Consequence:** `SOUL.md` committed to the repo, written to the vault (`0a82b249`, agent-readable at intake), and wired into the `davids-rules` skill as the first gate. The permanent-cash-parent exit thesis makes clean per-asset separability non-negotiable (each asset sellable without unwinding JSG).
**Made by:** operator + agent

---

### 2026-07-22 — Branch-push-always + break-glass persistence failover

**Decision:** Split "push to GitHub" from "make it canonical," and add a rate-limit-proof failover for the persistence lane. (a) **Branch-push always:** every build/major change/spec gets its working **branch** pushed to GitHub by whoever holds the task (Claude Code, Hermes, an outside model like Kimi K3, or David) — never gated, so work is never stranded on a local disk. (b) **Merge to `main` + `decisions.md` + vault + `mc_update_project_status` stays the reviewed step** — happens only after cross-check + Codex QC, and does not bend for rate limits or a busy reviewer. (c) **Break-glass failover:** if the Claude subscription is maxed/down, persisting is mechanical — the *executor* swaps while the *authority* holds. Work is already safe on its branch; canonical persistence either waits for the window to reset, or **Codex (or David with the full-scope token) runs the *already-reviewed* result**. **Never skip review because the reviewer is rate-limited; never let an outside model push straight to `main` to dodge the wait.** When Claude is restored, the lane reverts to normal — Codex is failover, not a new default.

**Reasoning:** The prior rule ("Claude Code alone performs final persistence") created a single point of failure: an outside model could build end-to-end and then have nowhere to land the result if the Claude sub was capped at that moment. The fix separates the mechanical act (git push, MC write — needs the write token + a completed review, not a specific model) from the intelligence act (the review itself). This preserves the moat — one authority, reviewed before canonical, git+MC as sole source of truth — while removing the failure mode. It also operationalizes the tool-agnostic thesis: the write authority is welded to "a trusted persistence lane," not to Claude specifically, so a permanent Claude outage means re-homing the token, not rebuilding the moat. Motivated by the concrete case of routing full builds to a cheap capable open model (Kimi K3 / GLM 5.2) when economics favor it — especially once the local rig makes them free-at-margin.

**Consequence:** Folded into the canonical workflow spec (`specs/2026-07-18-ideation-execution-workflow.md` → "Persistence resilience") and the `davids-rules` skill (re-synced to the vault). Two related tightenings — explicit build-size tiers (greenfield end-to-end vs existing-repo bounded vs protected-repo gated) and a metered-model cost gate — were deliberately **parked** until the local rig is live, to be revisited together with the hosting economics.
**Made by:** operator + agent

---

### 2026-07-28 — ChatGPT voice adopted as Chief-of-Staff relay; MC is the mailbox

**Decision:** ChatGPT voice becomes the mobile **front door / relay** for the portfolio — David's proxy when he's away from the keyboard. It reads MC for briefings, captures voice brain dumps and build intents into MC, and relays agent pushback/status back to David. It does **not** build, merge, or hold broad write authority — David explicitly withdrew the "access anything I can" ask in favor of the relay model. Roles stay separated: Hermes keeps spec drafting + the Telegram digest lane; Claude Code keeps build + persistence authority; Codex keeps QC. **All coordination flows through MC as the mailbox** — no direct ChatGPT→Hermes or ChatGPT→Claude channels. Access ladder: per-agent read token first (M1), then the narrow `capture` write scope (brain-dump + task-queue tools only) designed in the 2026-07-22 brain-dump decision — the full token never.

**Reasoning:** The goal is a bridge between the portfolio and David's geographical location, not a fourth builder. The relay model delivers the full Chief-of-Staff UX (talk → capture → spec → build → hear pushback → approve) while every durable action still crosses the existing gates. MC-as-mailbox keeps one auditable channel, avoids exposing Hermes's local gateway to the internet, and reuses the live task queue instead of inventing agent-to-agent plumbing.

**Consequence:** Resolves amendments #1 and #4 of `specs/2026-07-28-mc-ai-orchestration-layer.md`. The deferred `mc_write_brain_dump` + `capture` token scope becomes the Phase 2 build, issued to ChatGPT (and later Hermes) on separate per-agent keys. The planned "inbound Telegram→brain-dump capture" ambient sub-project is absorbed: ChatGPT voice is the capture path; Hermes's Telegram lane stays digest/alerts. Phase 0 (ChatGPT voice can invoke MCP connector tools + static Bearer auth compatibility) still gates all build work. Unattended headless builds (Phase 4) remain a separate future trust decision.
**Made by:** operator + agent

---

### 2026-07-30 — Phase 0 CLOSED (voice proven); ChatGPT connector needs OAuth, not a static key

**Decision:** Phase 0 is closed — **ChatGPT Work Voice provably invokes a custom MCP tool** on our server (throwaway `/api/mcp-probe`, No-Auth + Streamable HTTP; Vercel log confirms `mc_probe_echo` executed at `2026-07-30T21:26:37.357Z`, protocol `2025-11-25`). Two facts now govern the build: **(a) ChatGPT cannot present a static Bearer/API key** as a connector credential — the connector offers only OAuth / No-Auth / Mixed, so authenticated ChatGPT access **requires an OAuth 2.1 auth-code + PKCE facade**; a no-auth write endpoint is off the table. **(b)** the real `/api/mcp` must negotiate protocol version (echo the client's) — it hard-codes `2024-11-05` and would fail ChatGPT's handshake.

**Reasoning:** The premise the whole cockpit rests on (voice → custom tool) was undocumented/rollout-dependent, so it was validated cheapest-first with a fake read-only probe before any OAuth investment — which the doc-check then proved would have been wasted if voice couldn't reach tools. The auth finding came from ChatGPT's own OpenAI-docs check (vault `d80be519`) + the live probe.

**Consequence:** Product baseline + confirmed connector requirements persisted to the vault (`59bbf2b2`, `d80be519`, `0b6bb199`). OAuth facade moves onto the Phase 1 critical path; the static `chatgpt-liaison` key is demoted to curl/internal use only. Probe stays live until Phase 1 passes, then removed.
**Made by:** operator + agent

---

### 2026-07-30 — Phase 1 ChatGPT-liaison relay: architecture + scope

**Decision:** Build the ChatGPT liaison as a controlled Mission Control relay in four pieces. **(1)** `mc_requests` queue (state machine `submitted→queued→claimed→in_progress→{blocked,awaiting_approval,completed,failed,cancelled}`) + a narrow **`liaison` token scope** exposing exactly five tools — `mc_submit_request` (write) plus `mc_get_request_status` / `mc_list_recent_requests` / `mc_whats_stalled` / `mc_get_result` (read). No vault, no credentials, no worker mutations. **(2)** A **worker interface** (`mc_claim_request`, `mc_reassign_request`, `mc_post_progress`, `mc_mark_blocked`, `mc_request_approval`, `mc_complete_request`, `mc_mark_failed`), full-key-gated, state-machine-validated, never exposed to the liaison. **(3)** The OAuth 2.1 PKCE facade mapping a ChatGPT token → the `chatgpt-liaison` identity + `liaison` scope. **(4)** Publish + acceptance tests. **Phase 1 = the plumbing, operated by real Claude/Codex sessions manually** — the autonomous auto-route/auto-claim engine is Phase 2. **Hermes stays read-only** (drafts specs in its own env; ChatGPT relays the MC hand-off; Claude executes; Codex QCs; Claude final-checks; push to GitHub/MC). An end-to-end Hermes build (spec→push when several projects run concurrently) is a **future call reserved to David**, not a default.

**Reasoning:** Cross-check against repo reality flagged three conflicts with the raw handoff: Hermes-write reverses a locked decision (guardrail #2); the handoff's Definition-of-Done implied an autonomous engine we deferred; and the rich request model doesn't fit `brain_dumps`/`tasks`. Splitting liaison (submit+read) from workers (mutations) with a dedicated scope keeps ChatGPT least-privileged and auditable while the trusted builders retain full access. Building the pipes before the automation lets Test 3 (relay) pass with manual worker steps, deferring the unattended runner's real trust cost.

**Consequence:** Pieces 1+2 shipped + curl-verified (`fd04608` and this commit): liaison sees only its 5 tools; full sees 28; end-to-end submit→claim→progress→complete→read-back works; blocked/approval surface via `mc_whats_stalled`/status; invalid transitions rejected; liaison walled from worker tools + vault + credentials (403). Every call stamped in `mcp_audit_log`. Worker tools are HTTP-only for now (stdio `mcp-server.mjs` parity deferred — not the active path); per-worker-key isolation (vs the current full-key + `worker` param) is a Phase 2 hardening. OAuth facade (piece 3) is next and gates any ChatGPT write exposure — if it can't be completed cleanly, stop before exposing write.
**Made by:** operator + agent

---

### 2026-07-31 — Piece 3 OAuth facade SHIPPED + live with ChatGPT; Hermes → limited-write orchestrator; queue watcher

**Decision:** The OAuth 2.1 + PKCE liaison facade is built, deployed, and **proven end-to-end with the real ChatGPT connector** (authenticated `mc_list_recent_requests` + full write relay `mc_submit_request`→claim→route→`mc_complete_request` MC-WRITE-OK, all audited). Migrations 018 (oauth_clients/auth_codes) + 019 (rate limits + revocation kill-switch) applied. Three rounds of dual review (code-reviewer + Codex QC) caught + closed a critical hole (unauthenticated consent → operator `OAUTH_CONSENT_PASSCODE` gate, fail-closed). DCR locked to the exact ChatGPT callback; throwaway probe removed. **Separately, Hermes graduated from read-only to a tightly-scoped `orchestrator` role** — every read tool plus exactly `mc_claim_request` + `mc_reassign_request` (403 on complete/fail/submit/vault/credentials). All 5 Hermes profiles switched from the ungated local stdio `mcp-server.mjs` (service-role key, broad write) to the HTTPS endpoint + `MCP_ORCHESTRATOR_KEYS` scoped key. A serverless **queue watcher** (`/api/queue/dispatch`) auto-claims + routes queued requests to a worker and pings Telegram — **execution stays human-gated** (workers execute/complete; the watcher never does).

**Reasoning:** ChatGPT's connector offers no static-bearer mode, so OAuth was required; the passcode gate exists because the auth code is otherwise scrapeable off the redirect (both reviewers found this independently). Hermes-as-orchestrator with limited write (approved by operator + ChatGPT 2026-07-31) keeps the least-trusted always-on component from holding credential/vault-write power it never used (audit of its logs + `credential_access_log` showed zero MC writes ever). The watcher is serverless (matches the alerts-digest ambient model) so pickup works even when the rig is off.

**Consequence:** ChatGPT Voice/text is a live conversational layer over Mission Control, safely walled from code/deploy/credentials/spend. Commits `dbd050a`→`82ad888` on main. **Two open items:** (1) **Layer-2 rig exposure** — Hermes's local `terminal` + the repo `.env.local` on the same machine can read all secrets regardless of MCP scope; the MCP tightening is defense-in-depth, real fix is rig-architecture (see memory `hermes-rig-secret-exposure`). (2) **Watcher cadence** — Vercel Hobby caps crons at daily, so `/api/queue/dispatch` runs daily as a backstop; real-time pickup needs an external trigger (free, e.g. cron-job.org hitting the CRON_SECRET-gated endpoint) or a Vercel Pro upgrade. Refresh tokens (`offline_access`) for ChatGPT still deferred — 15-min access tokens mean periodic re-consent.
**Made by:** operator + agent

---

### 2026-07-31 — Minimal Voice Slice v0 built (autonomous execution engine, Claude-only) — code-complete, rig-DoD-pending

**Decision:** Built the smallest vertical slice that makes the voice loop real: **voice → ChatGPT → queued → rig dispatcher builds in an isolated workspace → CodexQC → commit (no push) → Telegram ping → approve-by-voice → SHA-bound gated push to a sandbox**. Scope held to Claude-as-the-only-worker; Hermes/multi-model builder, capability registry, and spend tracking stayed deferred (parent spec `2026-07-31-autonomous-execution-engine.md`). Four pieces, phased (phase-relay, one subagent per piece, dual review on each security boundary): **(1)** migration 020 (`phase, approved_by, approved_at, workspace_ref, attempt_id, reviewed_sha` on `mc_requests` + realtime enrollment; status enum unchanged); **(2)** `mc_respond_approval` — HTTP/liaison-only approval relay, actor-bound (`approved_by` from the resolved token, not the client), **atomic** attempt-binding + idempotency (never runs git); **(3)** `scripts/lib/telegram-notify.mjs` reusable `awaiting_approval` ping; **(4)** `scripts/dispatcher.mjs` + `claude-executor-adapter.mjs` — deterministic rig service: atomic claim (conditional UPDATE, race-safe), isolated push-denied workspace, SHA-bound gated push (verifies status/attempt, allowlist, no-newer-reject, `HEAD===reviewed_sha`), fault recovery. Sandbox = fixed `davidbillera-lab/mc-spike-test` + per-request branch `mc-build-<id>`, never a portfolio repo. **The `/api/queue/dispatch` daily cron was retired** — the rig dispatcher now owns queue pickup, and the non-atomic cron claiming the same pool was found to silently strand requests when the rig is offline (resolves open item #2 of the prior entry differently than planned).

**Reasoning:** Each boundary got `code-reviewer` + `/CodexQC`. The dual review earned its keep: it caught a production-path actor bug (`/api/mcp-liaison` recorded `approved_by='system'`), that `--dangerously-skip-permissions` **nullifies** the workspace deny-list (so the "executor structurally cannot push" guarantee was weaker than the comments claimed), a repo-allowlist that checked a constant against itself with a `SANDBOX_REMOTE` redirect bypass, a CodexQC step that reviewed an empty diff, and the cron-orphan silent-loss bug. All were remediated (commit `00a220a`): minimal executor env (secrets stripped), skip-permissions made opt-in (default OFF, trust-stamp enforces the deny-list), real allowlist + `SANDBOX_REMOTE` mock-only, dispatcher transitions now write `mcp_audit_log`, fail-closed adapter selection. Verified with a mock executor + local bare remote (10 checks incl. all three gate-blocks) — the real headless-Claude path can't run inside a classifier-gated session (Phase 0 finding), so it's deferred to the operator's rig.

**Consequence:** Six commits on branch **`voice-slice-v0`** (NOT merged to main — merge deploys the MCP tool + drops the cron, and the end-to-end DoD hasn't run). **Two rig-gated items before the first real autonomous push:** (1) verify headless `claude -p` runs trust-only (deny-list enforced without skip-permissions); if it hangs, `DISPATCHER_SKIP_PERMISSIONS=1` is the documented-risk fallback. (2) add `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` to the rig `.env.local` (only in Vercel today) or the ping no-ops. **Debt ledger (v0-acceptable for a single trusted-operator rig, disqualifying once `request_text` is untrusted):** OS/filesystem sandbox for the executor (it can still `Read` rig files / network via `node`) · immutable `approved_sha` capture · push/claim leases + heartbeat · async spawn · Windows process-tree kill · `stampTrust` unbounded `~/.claude.json` growth · dispatcher identity scope-split. DoD test = David speaks a build request to ChatGPT, approves by voice, confirms the sandbox push.
**Made by:** operator + agent

---

### 2026-08-01 — Voice slice v0 DEPLOYED + rig-proven end-to-end; OAuth refresh tokens now the #1 gap

**Decision/Result:** Merged `voice-slice-v0` → `main` (`46647be`, Vercel prod deploy READY) and ran the real rig DoD. The full loop works: **ChatGPT `mc_submit_request` → queued → rig dispatcher atomic-claim → real headless Claude build → CodexQC SHIP → commit (no executor push) → awaiting_approval → Telegram ping (received) → approval → SHA-bound gated push (all 4 gates) → `mc-spike-test@mc-build-0cd0ad9d`, commit `273c7505` → completed.**

**Rig findings (now settled):**
1. **Headless `claude -p` does NOT use tools with the trust-stamp alone** — it requires `--dangerously-skip-permissions` (`DISPATCHER_SKIP_PERMISSIONS=1`), which **nullifies the workspace deny-list**. The "executor structurally cannot push" guarantee held anyway in practice (fresh `git init` workspace has no remote + the prompt instruction held — verified GitHub stayed clean pre-approval), but restoring the *strong* guarantee needs headless allow-list enforcement (`--permission-mode`) — top code-hardening item.
2. **Windows:** `spawnSync('claude', …)` can't launch the npm `.cmd` shim (instant null exit); fixed by resolving the real `claude.exe` binary (`46647be`).
3. **The auto-mode classifier correctly blocks the agent session from BOTH running the executor AND self-approving a push** — confirming the design premise: the executor + the approval must be a human / plain service, never a classifier-gated agent session.
4. **The one hop not done by pure ChatGPT-voice:** the final `mc_respond_approval` — ChatGPT's **15-min OAuth access token expired mid-approval** and the reconnect stalled. ChatGPT DID make real `mc_submit_request` + `mc_get_request_status` calls (integration proven); David approved via the `rig-test` helper (human authority — correct).

**Consequence:** v0 voice slice is LIVE and proven. **Top priority: OAuth refresh tokens (`offline_access`)** — the 15-min expiry is the primary UX blocker for hands-free voice (forces mid-flow re-consent). Other follow-ups: headless allow-list enforcement to drop skip-permissions and restore the deny-list; dispatcher as an always-on background service (currently foreground — dies on terminal close); `TELEGRAM_*` now on the rig `.env.local` + stored in the MC vault (encrypted). Tooling added: `scripts/rig-test.mjs` (seed/status/approve/reject/list/cleanup). Test artifacts live on the private `mc-spike-test` sandbox (throwaway `mc-build-*` branches).
**Made by:** operator + agent

---

### 2026-08-01 — ChatGPT connector hands-free: three root causes fixed; adopted Codex's sliding-window refresh token

**Result:** The ChatGPT↔Mission Control connector now completes the OAuth handshake and stays connected without re-consent — **the full loop is hands-free, DB-verified.** The days-long "reconnect stalls" symptom had **three stacked root causes**, none of which was the refresh token itself:

1. **Missing RFC 9207 `iss` param (THE bug).** `/oauth/authorize` redirected the auth code back to ChatGPT with `code`+`state` but no `iss`. ChatGPT's connector is strict — it silently aborts an authorization response without `iss` and never calls `/oauth/token`. Proof was in prod logs: **5 `/oauth/authorize` hits, 0 `/oauth/token` hits**; auth codes were minted but never consumed. Fix: emit `iss=issuer` on the success redirect **and** every `redirectError` (commit `1b7e573`, `app/oauth/authorize/route.ts`).
2. **The `personal-os-git-main-jsg1.vercel.app` alias was frozen on a stale deploy.** It does NOT auto-follow pushes — every deploy this whole saga built fine but the alias ChatGPT actually hits stayed on old code, so *every* prior fix (incl. refresh tokens) was invisible to ChatGPT. Confirmed by diffing the alias vs. the fresh deploy URL. Fix (recurring): `npx vercel alias set <fresh-deploy-url> personal-os-git-main-jsg1.vercel.app --scope jsg1` after each deploy.
3. **`OAUTH_CONSENT_PASSCODE` was a Vercel "sensitive" var → unrecoverable.** `vercel env pull` returns `""` for it and the dashboard won't reveal it, so the real passcode couldn't be retrieved. Reset to a new operator-owned value (redacted here — this is a public repo; the value lives only in `.env.local` line 46 + the MC vault, encrypted credential `OAUTH_CONSENT_PASSCODE`, id `e6a3e7eb`). Note: reading/writing prod env from the agent session is classifier-blocked (correct) — the operator runs `vercel env` in their own terminal.

**Verification:** After the fixes, DB showed for the first time ever: 1 auth code **consumed** + 1 **live refresh token issued** (03:54 UTC). Operator ran a real MC read via ChatGPT ("list 5 most recent requests, no guessing" → returned the 2 genuine rows), then ran it again 15 min later with **no re-consent** — the refresh token silently renewed the access token. Hands-free confirmed.

**Decision (refresh-token design):** **Adopted Codex's sliding-window refresh token.** The credential stays non-rotating (stable value), but its `expires_at` is renewed to a fresh 90-day inactivity window on every successful refresh, bounded by a 1-year absolute cap from issuance (`OAUTH_REFRESH_TOKEN_MAX_TTL`, default 31536000s). The renewal is **awaited and predicate-bound** (`UPDATE … WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL AND expires_at > now()`) so a concurrent revoke/expiry can't be extended between the read and the write, and a dropped detached serverless write can't silently skip the renewal. Operator **reversed** the initial "lock in what works" call in favor of the better hands-free outcome: an active connector effectively never reconnects (vs. a forced reconnect every 90 days under plain non-rotating), with the annual cap as the theft ceiling. Adopted by re-applying Codex's reverted diff (`lib/oauth.ts` + `app/oauth/token/route.ts`) and **live-verifying the full flow before trust** (PKCE auth-code exchange → refresh grant returns a new access token → DB `expires_at` slid forward). The plain non-rotating 90-day-absolute version (`492892f`) remains the proven fallback. No migration needed — `issued_at` already exists (021); no env change required (cap defaults to 1 year).

**Open items:** (1) **Alias-pin is a live recurring hazard** — the git-main alias must be manually repointed after every `main` deploy or ChatGPT silently runs stale code. Permanent fix = auto-promote step in CI, or point ChatGPT's issuer at a stable production alias instead of the branch alias. (2) **Voice-out is a ChatGPT platform limit** — Advanced Voice Mode doesn't support connectors, so the tool-enabled chat replies in text; true talk-back needs Read-Aloud / standard Voice mode, or a custom voice client against the MC MCP (tool-agnostic, deferred build). (3) Dispatcher still foreground-only (background-service setup pending). (4) `OAUTH_REFRESH_TOKEN_MAX_TTL` unset in prod → the 1-year cap uses the code default; set it explicitly if a different ceiling is ever wanted.
**Made by:** operator + agent (Claude); sliding-window refresh design by Codex

---

### 2026-08-02 - Jarvis Liaison uses a fail-safe submitted-state bridge and native Remote Voice

**Decision:** Expanded the OAuth-gated ChatGPT Liaison from six to twelve narrowly scoped tools: safe project resolution, `mc_start_workflow`, workflow status/result reads, and pending-approval reads, while preserving the six legacy request tools. `mc_start_workflow` creates the `spec_build_qc_push` handoff as `status='submitted'`, `assigned_to='hermes'`, and `preferred_worker='hermes'`. It does not queue or claim execution. The Liaison MCP handshake now instructs ChatGPT to resolve project names from Mission Control, report only current evidence, re-read state before approval, and never equate a working-branch push with merge or deploy. Native paired ChatGPT Remote Voice is the mobile interface; a custom Realtime voice client remains deferred.

**Reasoning:** The current v0 desktop dispatcher claims every `queued` request directly for Claude. Sending the new multi-agent workflow to `queued` would silently bypass the required Hermes planning and Claude repository-validation stages. Parking the handoff in the existing legal `submitted` state freezes a usable, backward-compatible contract while failing safely until Claude's planner-capable backend promotes it. The active ChatGPT surface remains the OAuth HTTP Liaison; the legacy local stdio MCP server was intentionally not widened because it does not implement the Liaison authorization boundary and is not the connected ChatGPT endpoint.

**Consequence:** Voice can now resolve projects without guessing, create one idempotent durable Jarvis handoff, inspect evidence-backed progress/results, and discover approvals through the narrow Liaison. Until Claude implements and deploys the planning-stage transition, new Jarvis workflows intentionally remain `submitted` and no build starts. Existing `mc_submit_request` remains for backward compatibility but is explicitly documented as the legacy direct-queue path. No schema migration, deployment, merge, or production workflow enablement occurred in this Codex build.

**Made by:** Codex

---

### 2026-08-02 - Liaison queue operations remain policy-bound and request-audited

**Decision:** Add five narrowly scoped OAuth Liaison tools: `mc_queue_status`, `mc_list_workers`, `mc_get_request`, `mc_assign_request`, and `mc_resume_request`. Assignment accepts only the fixed worker identities `hermes`, `claude`, and `codex-qc`. Resume is limited to blocked or failed requests; Jarvis workflows return to `submitted` under Hermes, while legacy work returns to `queued`. Awaiting-approval, completed, cancelled, active, and `auto-classifier:` safety-held requests cannot use resume to bypass their state gates. Add nullable request correlation to `mcp_audit_log` so `mc_get_request` can return request-specific MCP history from migration 024 forward. The Liaison receives an explicit request-column allowlist and audit event metadata without raw audit error strings.

**Reasoning:** The Chief-of-Staff surface needs enough control to inspect the queue, understand ownership, retrieve a complete request record, route authorized work, and recover interrupted work. Those capabilities must not become generic worker mutation or a shortcut around Hermes planning, exact approvals, terminal states, merge, or deployment. Historical audit rows have no reliable request identity, so the API reports the correlation boundary instead of inferring an inaccurate history.

**Consequence:** The Liaison contract grows from 12 to 17 tools without exposing credentials, vault writes, arbitrary workers, direct code execution, merge, or deployment. Migration 024 must be applied before deploying the route changes. Claude's initial FIX-FIRST review identified the classifier-hold bypass and request/audit overexposure; both were fixed, full verification passed, and Claude's re-QC approved release on 2026-08-03.

**Made by:** Codex

---

### 2026-08-05 - Ops-classifier: read-only intent-gating, not bare-noun blocking

**Decision:** The dispatcher's ops-classifier now distinguishes read-only analysis from action. Categories `spend` and `live-deploy` are suppressed (allowed) when the request shows affirmative read-only intent (measure/analyze/estimate/report/forecast/audit/"read-only"/"do not change") AND contains no action signal. Action detection is two-tier: unambiguous verbs fire bare (purchase, deploy, rotate, authorize…); ambiguous words (lower, set, increase, change…) fire only when governing an object ("lower **the** price", not "lower-cost"). `secrets` is NEVER suppressed. All other categories (dns-domain, infra-account, protected-git, external-comms, destructive) stay hard.

**Reasoning:** The bare-noun blocklist false-positived read-only cost/audit requests that merely mention "spend"/"production". But `secrets` is the one category where read-only ≠ safe — "report the API keys, read-only" is itself exfiltration — so it stays always-held. `live-deploy` read-only *mentions* are safe to allow because analysis can't deploy (executor is sandboxed + push is host-gated). The classifier is a content heuristic, not the security boundary; that boundary is C6.

**Consequence:** Of four blocked read-only FlipRadar cost requests, two auto-cleared; two remain held only because they contain "credential" (the preserved `secrets` safeguard) and can be operator-cleared by hand. The classifier stays front-line until C6 lands, then relaxes to defense-in-depth. Commits: fcd6396 → 6b3534 → b794704. 64/64 tests.

**Made by:** David (policy) / Claude (implementation + independent verification)

---

### 2026-08-05 - C6 executor sandbox: full container boundary approved

**Decision:** C6 (the executor sandbox) will be a full **OS-level container boundary**, not app-level hardening alone. The headless build executor runs in a locked, throwaway container per attempt: workspace-only mount, no host secrets, deny-by-default network egress (allowlist Anthropic + npm only). CodexQC moves host-side (removing the last secret, `OPENAI_API_KEY`, from the executor). A new `dockerClaudeExecutorAdapter` slots into the existing `pickAdapter` seam. Spec: `specs/2026-08-05-c6-executor-sandbox.md`.

**Reasoning:** Today's deny-list is app-level (Claude enforcing its own permissions), `--dangerously-skip-permissions` nullifies it, and the injected `OPENAI_API_KEY` plus open `node` is a real exfil path. A container is a true boundary a confused/adversarial build cannot cross regardless of what the model decides. Only a real boundary lets us safely run the dispatcher always-on AND relax the classifier `secrets`/`live-deploy` categories to intent-gating.

**Consequence:** Build proceeds in phases P1–P6 (de-secret → containerize → egress lockdown → retire skip-permissions → result sanitization → red-team verification). Gated on a Claude-auth-in-container spike (the one unknown). The dispatcher stays stopped and the classifier stays front-line until the red-team suite proves containment.

**Made by:** David

---

### 2026-08-05 - mc_submit_plan shipped (Hermes planning-artifact intake)

**Decision:** Built + deployed `mc_submit_plan` (spec `specs/2026-08-05-hermes-plan-intake.md`, option A / bounded `plan` column, migration 025). Adds exactly one orchestrator-scope write so Hermes can deposit a plan on its own `submitted`+assigned request (→ `phase='planned'`, write-once). It structurally cannot set `status='queued'`, touch other fields, or be reached by the liaison scope — verified live end-to-end (status stayed `submitted`, write-once enforced, server-set actor, liaison excluded). Promotion `planned → queued` remains a full-scope/human action. Commit 93d7744. **Made by:** David (call to build now) / Claude (implementation + verification).

---

### 2026-08-06 - C6 Case 7 closed + certified; autonomous second-half wired (go-live gated)

**Decision:** Under operator `/goal`, drove the full remaining build. **(1) C6 Case 7 closed:** replaced the blind tinyproxy tunnel with a TLS-terminating mitmproxy (destination-keyed, SNI-lie-proof) that fail-closed blocks `web_fetch`/`web_search` tool blocks + web-tool beta headers + `/v1/files` + `/api/oauth/profile`, with a pinned CA (private key in the proxy image only, gitignored; public cert in the executor image). Independently re-ran the red-team: boundary all CONTAINED (no regression), `redteam:c6:api` Case 7 now CONTAINED (all four sinks 403), legit `claude -p` inference still works through the MITM. **(2) Second-half wired:** executor builds from the deposited `plan`; dispatcher is now event-driven (Supabase Realtime, 5s poll as backstop) and can claim `submitted`/`planned` rows — gated behind `DISPATCHER_CLAIM_PLANNED` (default OFF). Commits 7e7b5f0, 06e70f5, f793dc8.

**Reasoning:** Case 7 was the red-team's one NOT-CONTAINED finding and the explicit gate on going always-on. Closing it makes autonomous execution genuinely safe (a build cannot reach infra OR exfil). The second-half is built but left OFF so enabling autonomous execution stays a deliberate operator flip, not a side effect.

**Consequence:** The Rayetta class AND the exfil hole are closed and certified. Go-live is one flag flip — `DISPATCHER_CLAIM_PLANNED='1'` + `pm2 restart` (runbook: `docs/runbooks/go-live-autonomous-relay.md`). One accepted residual: a build can still spend inference on the mounted token (inherent; not exfil) — the classifier stays ON as the compensating control, NOT relaxed. Still open: gap D (real-repo push target — needs operator decision on which repos + checkout-vs-empty-workspace). **Made by:** David (goal + close-it-properly) / Claude (build + independent red-team certification).


---

### 2026-08-07 - C6 CLOSED: re-certified, and the classifier relaxation permanently cancelled

**Decision:** C6 is **closed**. Both red-team suites were re-run today from a cold session — `npm run redteam:c6` (boundary) and `npm run redteam:c6:api` (the Case 7 relay probe) — and both returned zero NOT-CONTAINED findings. Runtime verified live, not just on paper: `mc-dispatcher` online under PM2 (15h uptime), `DISPATCHER_EXECUTOR='docker'`, `DISPATCHER_SKIP_PERMISSIONS='0'`, `DISPATCHER_CLAIM_PLANNED='1'`, `mc-executor-net` internal network present, `mc-executor-proxy` up 23h. The spec header and the Mission Control project status were the only things still describing C6 as pending work; both are now reconciled.

**The substantive decision:** the final DoD line item — *"relax the classifier `secrets`/`live-deploy` categories to intent-gating"* — is **permanently cancelled, not deferred.** The red-team's residual finding overrides the original plan: the mounted OAuth credential still authorizes plain `/v1/messages` inference (probe [A] returns 200 by design), and that cannot be closed without removing the credential the executor needs to run at all. The word-blocks are therefore the standing compensating control against small-payload relay through normal inference text.

**Reasoning:** C6 was finished on 2026-08-06, but three records still read as though it were mid-build — the spec header said "Ready for build window," and MC's status/next_action listed the whole P1–P6 sequence as the next action and claimed the dispatcher was stopped. That stale paperwork cost real operator attention twice: it made a working autonomous pipeline look broken, and it left the classifier relaxation sitting in the DoD looking like an unfinished task when it is in fact a thing we have decided never to do. Documentation that describes finished work as pending is worse than no documentation, because it manufactures phantom work.

**Consequence:** C6 does not get reopened. The spec now carries six post-closure standing rules (no classifier relaxation; never introduce an npm token; the sanitizer is not a boundary; executor image integrity is an untested host-side assumption; `executor:net` must be up or the dispatcher fails closed; re-run both suites after any proxy/image/allowlist change). MC status and next_action rewritten to describe the live system instead of the finished build. The two Hermes requests that appeared "stuck" were never dispatcher failures — one was a correct classifier hold, the other a 600s build timeout. **Made by:** David ("seal this and put it to bed") / Claude (re-certification + record reconciliation).


---

### 2026-08-10 - The autonomous relay was finishing builds and throwing them away

**Decision:** Fixed four defects on the path between "build finished" and "operator can see it," plus the alerting blind spot that hid them. Branch `fix/dispatcher-durable-attempts` (commits 0c7fd6a, ccffbfd). The 2026-08-07 entry recorded the two apparently-stuck Hermes requests as "never dispatcher failures — one a correct classifier hold, the other a 600s build timeout." The classifier half was right. **The timeout half was wrong, and the write-off cost us three days.** Request `e0afb33a` had built *cleanly* — 684s, real commit `43f49d6`, CodexQC FIX-FIRST — and the result was destroyed by a single `TypeError: fetch failed` on the Supabase write-back. The throw unwound the tick, and the row sat in `claimed`/`building` with a finished commit stranded on disk that nothing would ever look at again.

**What was actually broken:**
1. **No retry, and a throw, on the write-back.** One flaky HTTP call discarded 11 minutes of paid compute. Now retried with backoff; a final failure returns instead of throwing, so the tick survives.
2. **No durable record of a finished build.** The adapter result is now written to a sidecar *next to* the workspace (never inside it — that directory is the untrusted build's rw mount) before any network call, and replayed until MC accepts it.
3. **Recovery ran at startup only.** The dispatcher had been up since 08-06, so the 08-08 strandings were never re-examined. Now sweeps every 5 min, inside the tick gate so it can never overlap a build.
4. **Recovery destroyed salvageable work.** Any mid-build row without `reviewed_sha` was marked failed. It now checks disk first — sidecar, else a commit in the workspace. The executor commits as its *last* step, so a container SIGKILLed at the wall usually still has the work: `268a0c76` did, commit `8b73b991`.

Also: executor timeout 10min → 30min (two builds were killed at exactly 600s, a third survived at 684s — the timeout was running through the middle of normal work, not above it); and reconcile no longer filters on `assigned_to`, because `mc_assign_request` can rewrite it mid-build (`e0afb33a` was flipped to `hermes` while the dispatcher was building it, making the row invisible to its own recovery). Ownership is now proven by the build workspace on disk, which no external write can forge.

**The blind spot:** a workflow awaiting Hermes planning sits in `submitted`/`phase=null` — the one state with no automatic consumer *and* the one state the stuck-jobs sweep could not see, since both the fetch filter and `isStalePlanned()` required `phase==='planned'`. That is how `26d1849b` stalled silently for two days. Added a `stale_unplanned` bucket with its own dedup key.

**Reasoning:** Every one of these turned a recoverable situation into a permanent loss, and each was individually invisible — a row stuck in `claimed`/`building` looks identical whether the build died or finished, so the symptom read as a broken handoff. It was not. Hermes writes plans to MC fine (`mc_submit_plan`, actor `hermes`, twice on 08-06, ~30k chars each) and the dispatcher claims them fine (three `dispatcher.claim_planned` events). The failure was always downstream, in the last inch.

**Consequence:** Proven live, not on paper. On restart the sweep salvaged `e0afb33a` (commit `43f49d6` → `awaiting_approval`), and the full loop closed end to end on `268a0c76`: salvage → operator approval via ChatGPT voice → gated push → `completed`. Zero rows now sit in `claimed`/`in_progress`. Suite 144 → 150 passing.

**Deliberately NOT done:** auto-starting Hermes planning. Nothing consumes a `submitted` workflow automatically, and making the dispatcher wake Hermes is a trust-ladder step (`specs/2026-07-16-hermes-ambient-layer-design.md`), not a side effect of a bug fix. The stall is now loud; who closes it is the operator's call. **Made by:** David ("finish the job end to end") / Claude (diagnosis, fix, live verification).


---

### 2026-08-11 - The operator's approval was the last thing that could vanish silently

**Decision:** Fixed the final gap on the autonomous relay — an approved build could never be pushed if the row had been reassigned — and shipped the Hermes planning wakeup that the 2026-08-10 entry deliberately left out. Branch `fix/dispatcher-durable-attempts`, commit `56ccc51`. Suite 150 → 167 passing.

**What was broken:** `findPushable()` filtered `assigned_to='claude'`. That is the *same hole* the previous entry had just fixed in `reconcile()`, in the same file, for the same reason — and it was left in place. `mc_assign_request` rewrites `assigned_to` at any time, and both `e0afb33a` and `713f6980` were sitting at `assigned_to='hermes'` with a real reviewed commit on disk. The filter made them invisible to the only code that can push. Worse, `reconcile()` looked straight at them every sweep and logged *"approved+pushing → leaving for path B resume"* — handing off to a path that could not see them. The operator approves, nothing pushes, nothing fails, nothing alerts. Ownership now comes from disk evidence (`isOurAttempt`), which no external write can forge.

**The blind spot that kept it quiet:** `alertBucket()` returned `null` for every `in_progress` row, and the stuck-jobs route never fetched `in_progress` at all. So the one state that meant "your approval is stranded" was the one state the sweep was structurally incapable of reporting. Added a `stuck_pushing` bucket *and* the missing status in the route query — either alone would have been dead code.

**The pattern worth naming:** three consecutive sessions have now found the same class of bug — a filter that looks like a safety narrowing but is actually a blind spot (`assigned_to` in reconcile, `assigned_to` in findPushable, `phase==='planned'` in the alert sweep). Filtering by *who claims to own a row* is unsound in a system where ownership is externally mutable. Filter on evidence, not on labels.

**Hermes planning wakeup (reversing the previous entry's deferral):** Both halves of the relay already worked — `mc_submit_plan` sets `phase='planned'`, `claimPlannedOne()` builds from `row.plan`, and `buildPrompt()` already prefers the plan over `request_text`. Nothing was missing except a signal. The dispatcher sweep now announces a `submitted`/`phase=null` row within ~30 min, deduped through `mc_alert_sends`, naming the exact `mc_submit_plan` call that unsticks it. This is a nudge over a shared channel, **not an ingress into Hermes** — the dispatcher still cannot call Hermes, and building an inbound path remains a trust-ladder step. What changed is the detection gap: ~14h (twice-daily serverless sweep) → minutes.

**Verified:** dispatcher restarted on the new code and immediately claimed and rebuilt `20d5c8af`. Not yet observed live: the plan nudge fires from the reconcile sweep, which rides the same tick gate as an in-flight build, so it is unit-tested (10 cases) but has not yet been seen in production logs.

**Also decided:** approval remains operator-only. An attempt to record the two pending approvals from this session was correctly refused, and left refused — recording an approval is the one action this architecture reserves for a human, and an agent writing it would defeat the control regardless of intent.

**Consequence:** Queue reconciled — 5 stale requests cancelled (one duplicate, one superseded by a shipped project, three rewordings of a single FlipRadar question that each tripped a different classifier rule), 4 dead tasks closed, 2 unpushable builds requeued and rebuilding. **Made by:** David (queue triage approvals, "fix the dispatcher... firm up its functionality") / Claude (diagnosis, fix, live verification).


---

### 2026-08-11 (later) - Three builds, three FIX-FIRST, and the sandbox can't see your code

**Decision:** Rejected `e0afb33a` and `713f6980` after reading the CodexQC reports, and recorded the findings in each row's `blocker` rather than a generic label. Recommending rejection of `20d5c8af` on the same grounds.

**The correction that mattered:** `e0afb33a`'s DB verdict read `UNKNOWN`, and the prior entry treated that as "QC never ran, review it manually." Wrong. **QC ran and returned FIX-FIRST**; only the verdict *parse* was lost along with the write-back. `parseVerdict()` returns `UNKNOWN` when it cannot find SHIP/FIX-FIRST/RECONSIDER in the output — it is a parse failure, not an absence. The full report was on disk at `.codex-qc/` the entire time. **Standing rule: a DB verdict of UNKNOWN means read the report on disk, never that QC was skipped.**

**What the reports found — three for three, every blocker privacy or credentials:**
- `e0afb33a` — `tools/inspect-reelflow.mjs` advertised "never reads credential files" while its denylist missed `.npmrc`, `.netrc`, `secrets.yml`, `client_secret.json`, `id_ed25519`, `kubeconfig`, `firebase-adminsdk*.json`, `.p8` — all opened by `readFileSync()` during content scans, in a tool built to run against the production REELFLOW repo. Direct Rule #10 violation. Its regression test only covered `.env`, which is how the safety claim passed.
- `713f6980` — privacy guard runs at step 3 but optional context is collected at step 6 (later free text never scanned); telemetry logs raw `reason_text` against a "no learner data, ever" promise; the ingest-guard execution boundary is undefined, so an implementer could comply exactly and still POST a child's homework screenshot to a third-party vision API.
- `20d5c8af` (rebuild) — the Gate C enforcement layer itself: `validateEvent()` only PII-scans top-level strings, so `page:{email:'child@example.com'}` persists; and child events are gated on `destination.kind==='first_party'`, a string *label* rather than identity, so a registry entry can route child data off the first-party store.

**Reasoning:** CodexQC is the load-bearing control on this pipeline, not a formality. Every one of these would have shipped a privacy or credential defect into a product with paid child accounts, and each was invisible from the request text alone. The pattern across three independent builds is that autonomous output is *structurally* strong and *specifically* unsafe — good architecture, sound docs, and a concrete hole in exactly the boundary the task was about.

**The scope finding:** `gitInitRepo()` runs `git init` on an empty directory. **The sandbox never clones anything.** Every autonomous build starts from zero. `e0afb33a` was commissioned as a gap analysis of *existing* REELFLOW code and was therefore unsatisfiable by construction — to the build agent's credit it inspected the empty workspace, documented the uniform negative, and refused to fabricate verdicts. But the request should never have been sent. **The autonomous builder produces standalone greenfield artifacts only; it cannot see, review, or modify any portfolio repo.** Anything phrased "analyze/fix/extend existing X" must go to a real session.

**Verified live this session:** the plan nudge fired in production — `[nudge] plan needed 26d1849b (4841min) {"sent":true}` — closing the one thing the earlier entry listed as unproven. The 600s→1800s timeout was vindicated too: the `20d5c8af` rebuild ran 1379s and would have been SIGKILLed under the old wall.

**Consequence:** Approval remains operator-only; an agent attempt to record one was refused this session and left refused. Rejections carry the real QC findings in `blocker` so a resubmit starts from the defect list. **Made by:** David ("go ahead and reject, I agree with your assessment") / Claude (QC recovery, diagnosis, scope finding).


---

### 2026-08-11 (later still) - The sandbox can see real code now, and a shebang had been hiding a broken security test

**Decision:** Two changes, both on main (`aa6d9d6`, `cb9d844`). Suite 167 → **183 passing**.

**1. The autonomous builder can now be given a working copy of a real repo — default OFF.**

`gitInitRepo()` git-inits an *empty* directory, so every build started from zero and could only produce greenfield artifacts. That is why `e0afb33a` — commissioned as a gap analysis of *existing* REELFLOW code — was unsatisfiable by construction.

`provisionWorkspace()` keeps that behaviour byte-for-byte when there is no clone target. With one, the **host** clones (the dispatcher already holds git credentials, so the container never receives a token and C6's zero-secrets `childEnv` invariant is untouched), `--depth 1 --single-branch` so committed history never enters the box, credential-shaped files are stripped from the working tree and the scrub is committed, and HEAD is detached so a build cannot fast-forward a real branch name.

The scrub list comes **straight from the CodexQC finding on `e0afb33a`** — the one that caught an inspector advertising "never reads credential files" while missing `.npmrc`, `.netrc`, `secrets.yml`, `client_secret.json`, `id_ed25519`, `kubeconfig`, `.p8`. Committed `.env.example`/`.sample`/`.template` are deliberately **kept**, because the same review flagged treating templates as secrets as a false positive. A rejected build's QC directly hardened the thing that replaced it.

`buildPrompt()` now states the true workspace shape. Telling a build the repo is empty when it is not is exactly the failure that produced `e0afb33a`, and the inverse would be worse. `runHostQc()` needed no change — it already bases on `sha^`, so it reviews only the build's own commit against the clone base.

**Residual risk, on the record:** C6's red team found the mounted OAuth credential still authorizes plain `/v1/messages` inference, so a build can relay small payloads out as ordinary model text. With an empty workspace there was nothing worth taking; with a repo cloned in, that residual is material. This is why `DISPATCHER_CLONEABLE_REPOS` **starts empty and every ambiguity fails closed to an empty repo**. Enabling a repo is a security decision, documented as such in `ecosystem.config.cjs`.

**2. A shebang had been silently breaking the C6-P5 test.**

`tests/sanitize-dispatcher-path.test.ts` — the test proving secret scrubbing on the live return path — was failing with a bare `SyntaxError: Invalid or unexpected token` that named `dispatcher.mjs` but no cause. Root cause: `#!/usr/bin/env node` on line 1. **Node strips a shebang when it runs or imports a file; vitest's module evaluator inlines the source and hands it to `new Script()` verbatim, where `#!` is a hard parse error.** pm2 launches the dispatcher with an explicit node interpreter, so the shebang bought nothing and cost the security test that guards this file.

Diagnosis cost far more than the fix, for a reason worth remembering: several probes appeared to *pass* because they caught the error in a `catch` whose `console.log` vitest hides for passing tests. **Vitest only shows console output for failing tests** — a diagnostic that swallows the error it is hunting will lie to you.

Also removed the reason that test had to race module side effects at all. Importing the dispatcher **used to start it**, so an `import` ran the live dispatcher against production Mission Control. `main()` is now behind an entry-point check and the internals are exported, so the test calls `runAttempt()` directly. Verified: pm2 restarts clean, 0 unstable restarts.

**Consequence:** the sandbox-never-clones limit is lifted but stays closed by default; the C6-P5 proof is live again; and importing the dispatcher is no longer dangerous. **Made by:** David ("start with the clone and then move on to C6, don't stop till done with both") / Claude.


---

### 2026-08-11 (launch-confidence pass) - Four things stood between the relay and "trust it unattended"

**Decision:** Verification pass over the autonomous relay before treating it as launched. Found and fixed three real defects — one of them mine, introduced hours earlier — plus one operational blind spot. Commits `1129cdd`, `f88c26c`. Suite 183 → **191 passing**.

**1. My own clone scrub leaked the secrets it was scrubbing.** `provisionWorkspace()` deleted credential files from the working tree and committed the deletion. That removes the *paths*, not the *blobs* — `git clone --depth 1` still ships the base commit's trees and objects, so a build could read every "scrubbed" secret straight back with `git show <base>:.env.local`. Confirmed against a fixture: it returned the plaintext. This would have shipped a credential-exposure hole inside the feature whose only purpose is to prevent one, and only on the cloned path — the one path that has real source in it. The cloned `.git` is now discarded and re-initialised after the scrub. **The general lesson: "removed the file and committed" is not removal in a version-controlled tree.**

**2. The clone target trusted a non-GitHub host.** `resolveCloneTarget()` always clones from github.com, so a `repo_url` of `gitlab.com/owner/repo` would have resolved to a slug and then cloned `github.com/owner/repo` — a different repo that merely shares a name, and one anyone can register. Non-GitHub hosts now fail closed.

**3. Docker Desktop was down for hours and nothing said so.** `pm2 status` showed online, Realtime was subscribed, the queue looked healthy — and `executor:net:status` reported network and proxy MISSING, because both live in Docker. The relay was dead. Every claimed build would have failed individually with a "too big / errored" alert pointing at the wrong problem. The dispatcher now checks `adapter.health()` **before claiming**: while the sandbox is down it claims nothing (queued work waits rather than being burned into failed rows) and sends one alert on the down edge. Path B is deliberately not gated — an outage must never strand a finished commit.

**4. The approval-stranding bug had no regression test.** It does now, and only because the dispatcher exports its internals after the shebang work: `findPushable()` must find an approved row whatever `assigned_to` says, and must ignore a row with no workspace on disk. That is the exact shape `e0afb33a` and `713f6980` were in.

**Evidence gathered, not asserted:**
- Both C6 red-team suites re-run after the executor change (the standing rule requires it): **CONTAINED**, no NOT-CONTAINED findings. Case 7 sinks all still blocked — `web_fetch`, `web_search`, `files`, `profile` all 403.
- Clone path proven **end to end through the real docker executor** against `mc-spike-test`: the build was asked to name a file it found already present and wrote `calc.js` (it genuinely saw the source), history came out exactly 2 commits, and CodexQC diffed only the build's own commit — `CLONE-SELFTEST.md | 1 +` — so review stays correct and cost stays bounded on a real repo.
- Dispatcher restarted clean, `pm2 save`, 0 unstable restarts.

**Open, not closed:** one full-suite run failed a single test and I did not capture which; seven subsequent runs (three shuffled) are green and I cannot reproduce it. It landed on a cold-transform run while Docker Desktop was starting, so contention is the likely cause — recorded as unreproduced rather than fixed. Separately, `findPushable`'s fix is proven by unit test but has not yet pushed a real reassigned row, because recording an approval is operator-only.

**Made by:** David ("take care of what needs to be done so we can be 100% confident in the launch") / Claude.

---

## 2026-08-23 — Public credential leak: MCP_API_KEY rotated, deployment surface contained

**Decision:** Treat the full-scope `MCP_API_KEY` as compromised and rotate it end to end, then delete the historical deployment surface that made rotation ineffective.

**What happened:** The live full-scope `MCP_API_KEY` was committed as a literal in this file on 2026-05-06 (`a6e373e`) and sat in a PUBLIC GitHub repo for 109 days. Hermes detected it; Claude Code executed the rotation under David's approval.

**Why rotation alone was not enough:** `app/api/mcp/route.ts` compares the bearer to a build-time `process.env.MCP_API_KEY`. Vercel freezes env vars into immutable deployments, so every historical production deployment kept accepting the old key at its permanent URL. Verified live: the leaked key returned HTTP 200 on every deployment tested. Changing the env var closes nothing already built — 58 stale production deployments had to be deleted to actually contain it.

**Actions taken:**
- Rotated `MCP_API_KEY`; it is now stored **Encrypted** in Vercel (it was previously **plaintext**).
- Deployed `personal-t0g6t94h1` with `--skip-domain` and repointed the pinned `git-main` alias, which had been stuck on an 18-day-old deployment and was NOT following production.
- Deleted 58 stale production deployments.
- Gated `/api/route-task` and `/api/classify`, which ran on the service role with **no authentication** — `/api/route-task` was an open LLM proxy billable to our own API keys.
- Added a pre-commit secret scanner and CI secret scanning; `.codex/` held the same key and was untracked but NOT gitignored.

**Forensics:** `mcp_audit_log` only starts 2026-07-29, leaving 84 of the 109 exposure days unlogged. Within the logged window all six actors are known and legitimate, and the `full` actor made **zero** `mc_get_credential` calls. `credential_access_log` reaches back to 2026-05-23 and shows only recognized internal accessors. No evidence of compromise; absence of evidence is not proof, because an attacker using the leaked key would have been logged as the same `full` actor.

**Residual risk / still open:**
- The old value remains in git history. History was NOT rewritten; rotation is the remediation.
- `personal-9thzhq3ae` (apex) still accepts the old key and needs the new deployment promoted before it can be deleted.
- `/api/kill-criteria` is still unauthenticated; it has a browser caller, so it needs session auth plus a click-test.
- `credentials` and `credential_access_log` use `authenticated_full_access FOR ALL`, so any authenticated user could read ciphertext and erase the access trail. Only 1 user exists today.
- Auth remains a static shared secret. The durable fix is datastore-backed key validation with instant global revocation — designed in `specs/2026-08-23-mc-security-hardening.md`.

