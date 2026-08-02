# decisions.md â€” Mission Control (Personal OS)

Canonical log of meaningful decisions and why. Append-only. Every architectural change gets an entry.

---

## Format

```
### [YYYY-MM-DD] â€” Decision title
**Decision:** What was decided.
**Reasoning:** Why.
**Made by:** operator | agent | operator + agent
```

---

## Pre-Build Decisions (2026-05-02)

### 2026-05-02 â€” Tech stack: Next.js + Supabase + Vercel

**Decision:** Build the OS on Next.js 14+ (App Router), Supabase (Postgres + auth + edge functions + storage), deployed to Vercel.
**Reasoning:** Operator has familiarity with this stack from VZT and other projects. Supabase gives auth, real-time, and edge functions in one managed service. Vercel gives zero-config deploys with Next.js. Lovable rejected for the core OS because it clashes with multi-agent GitHub pushes.
**Made by:** operator

---

### 2026-05-02 â€” Three core surfaces for v1 (Dashboard, Inbox, Orchestration)

**Decision:** v1 ships three and only three surfaces: Project Status Dashboard, Brain Dump Inbox, Build Orchestration. Email and calendar integrations deferred to v2.
**Reasoning:** Email/calendar volume is not high enough to stress about; existing assistant (Marblism EVA) covers the gap. OS muscle should be built on project orchestration first. Scope discipline enforced.
**Made by:** operator

---

### 2026-05-02 â€” Model routing tiers (1â€“4) defined globally

**Decision:** All model calls across the OS are routed by complexity tier: Tier 1 (Haiku/Flash/GPT-5 mini), Tier 2 (Sonnet/GPT-5/Gemini Pro), Tier 3 (Opus/o3, sparingly), Tier 4 (specialty). Implemented via `/api/route-task`. Fallback rule: on model failure, fall back ONE tier DOWN â€” never up, never silently spend more.
**Reasoning:** Cost discipline is a hard constraint, not a preference. Every model call must be justified by complexity. The classifier (`/api/classify`) is always Haiku â€” high volume, low stakes.
**Made by:** operator

---

### 2026-05-02 â€” Project context lives in repos; OS database reflects state, does not own it

**Decision:** Every project's source of truth is its repo (`CLAUDE.md`, `kill-criteria.md`, `decisions.md`, `model-routing.md`). The OS reads these files but does not write to them. The OS database (`projects`, `tasks`, etc.) is a cache/reflection, not the authority.
**Reasoning:** Keeps the OS swappable. If a better tool emerges in 18 months, the context survives because it lives in git, not in a proprietary database.
**Made by:** operator

---

### 2026-05-02 â€” VZT protection locked at Medium now, escalates to Heavy before first paying tenant

**Decision:** VZT flagged `tier: 1, protected: true`. Medium protection active: Codex second-opinion review before merge, staging Supabase env, automated tests on listing generation + image processing pipelines, mandatory `decisions.md`. Heavy protection (feature flags, manual approval gate, daily health monitoring, tenant data isolation testing, incident response playbook) triggers before first paying tenant.
**Reasoning:** VZT is pre-revenue but income-adjacent (internal time-saver and production multiplier). Recoverable if broken, but not worth testing. Mobile-recoverable via Claude Cowork.
**Made by:** operator

---

### 2026-05-02 â€” VZT bus factor succession plan adopted (JJ tier 1, Vinnie tier 2)

**Decision:** Two-tier succession plan. JJ (16, AI-capable, building AI businesses) is Tier 1 secondary â€” with proper architecture docs, a legitimate emergency maintainer. Vinnie (capable beginner, AI-novice) is Tier 2 execution-only â€” pre-defined recovery procedures, no code modifications. Before first paying tenant, both doc flavors must exist: `docs/operator/` (architecture, decisions, code-level, audience JJ) and `docs/runbooks/` (step-by-step, screenshots, AI-idiot-proof, audience Vinnie).
**Reasoning:** Operator is currently the only person who can maintain VZT. Bus factor of 1 is unacceptable before paying tenants. JJ doubles as his training ground for holdco involvement.
**Made by:** operator

---

### 2026-05-02 â€” College Climb workflow locked at Light, validation-gated to ship

**Decision:** College Climb stays in Light workflow until validation completes. Phase 1: JJ smoke test with real data. Phase 2: 5â€“10 high schoolers + 2â€“3 parents beta cohort, 2-week time box. Phase 3: iteration on top issues. Phase 4: ship workflow activates (landing page, App Store assets, analytics, first 100 users plan). VZT keeps priority on operator attention; College Climb runs on JJ + beta tester bandwidth until Phase 3.
**Reasoning:** App is unvalidated â€” no real high schoolers, no real parents, no real end-to-end usage. Smoke tests only. Shipping before validation risks burning the opportunity.
**Made by:** operator

---

### 2026-05-02 â€” GitHub integration: read-only in v1, no webhooks until v2

**Decision:** v1 GitHub integration is read-only via Octokit + PAT. The OS reads `CLAUDE.md` and context files from project repos on demand. No webhooks, no bidirectional sync, no write operations until v2.
**Reasoning:** Webhooks add operational complexity (secret validation, retry logic, delivery guarantees). Read-on-demand is sufficient for v1. GITHUB_USERNAME is hardcoded as `davidbillera-lab`.
**Made by:** operator + agent

### 2026-05-02 â€” OS itself follows its own rules (kill-criteria.md, decisions.md, model cost logging)

**Decision:** The OS is not exempt from the rules it enforces on other projects. It has a `kill-criteria.md`. It logs decisions here. It logs its own model costs to `model_costs`.
**Reasoning:** Prevents the OS from becoming a sacred cow. If the OS stops delivering value, the kill criteria process should surface that â€” not operator sentiment.
**Made by:** operator

---

## Build-Time Decisions

### 2026-05-07 â€” Route group `(app)` pattern for auth-protected layout

**Decision:** Authenticated pages live under `app/(app)/` using Next.js route group convention. Root `app/layout.tsx` is the bare shell (fonts, globals, Toaster). `app/(app)/layout.tsx` runs the server-side auth check and renders Nav. `app/login/` lives outside the group, unprotected.
**Reasoning:** Avoids duplicating the auth check in every page. The route group gives a clean layout boundary without affecting URLs. Login page stays at `/login`, dashboard at `/`, inbox at `/inbox`, orchestrate at `/orchestrate` â€” no path nesting.
**Made by:** agent

---

### 2026-05-07 â€” `middleware.ts` â†’ `proxy.ts` (Next.js 16 breaking rename)

**Decision:** Auth session refresh uses `proxy.ts` with exported `proxy()` function, not the legacy `middleware.ts` / `middleware()` convention. The Supabase SSR cookie-refresh pattern is preserved exactly.
**Reasoning:** Next.js 16.2.6 deprecated the `middleware` file convention in favor of `proxy`. The rename is required to avoid the build warning. No behavior change â€” only the filename and export name changed.
**Made by:** agent

---

### 2026-05-07 â€” Single `authenticated_full_access` RLS policy per table (single-user v1)

**Decision:** Each table gets one RLS policy named `authenticated_full_access` granting full CRUD to all authenticated users. No per-row ownership checks.
**Reasoning:** v1 is single-operator. The only authenticated user is the operator. Adding owner-column checks now would be premature; they belong in v1.3 (Vinnie + JJ multi-user). Simple policy is reviewable in seconds; complex policies are auditable nightmares.
**Made by:** agent

---

### 2026-05-08 â€” Phase C: model router + brain dump classifier (Option B architecture)

**Decision:** AI layer wired via `lib/models/` (pricing, adapters, router) and `lib/classify.ts`. API routes at `/api/route-task` and `/api/classify` are thin POST wrappers. `quickDump` server action calls `classifyBrainDump()` directly â€” no HTTP self-call.
**Reasoning:** Option B keeps logic in lib/ so it's testable and reusable without HTTP overhead. Server actions are already in the server runtime, so calling classify() directly is correct and ~30ms faster than a loopback fetch.
**Made by:** operator + agent

---

### 2026-05-08 â€” GPT-4o-mini as accountability partner on low-confidence classifications

**Decision:** When Haiku classification confidence < 0.75, GPT-4o-mini runs the same classify prompt. If they disagree on type, the result is forced to `unclassified` and confidence is set to `Math.min(haiku_conf, gpt_conf)`. GPT call always logged to `model_costs` with `purpose: 'accountability_check'`.
**Reasoning:** Haiku is cheap and fast but can be uncertain on ambiguous brain dumps. GPT-4o-mini is a different model family â€” disagreement is a real signal, not noise. Forcing `unclassified` on disagreement is conservative but honest; the operator can review and reclassify. Cost: ~$0.0001 per accountability check â€” negligible.
**Made by:** operator + agent

---

### 2026-05-18 â€” Phase I: Credentials vault uses AES-256-GCM encryption at rest, never stored plain

**Decision:** All credential values in the `credentials` table are encrypted with AES-256-GCM before write and decrypted on reveal. Encryption key is `CREDENTIAL_ENCRYPTION_KEY` (64-char hex, 32 bytes) stored in env only â€” never in the database. List view shows masked values only (`â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢` + last 4 chars). Reveal is a separate server action that decrypts on demand and auto-clears after 30 seconds in the UI.
**Reasoning:** API keys in plaintext in Postgres are a critical exposure risk â€” Supabase dashboard, service role access, and any future RLS misconfiguration would expose them. AES-256-GCM provides authenticated encryption; the auth tag prevents tampering. Masking by default means no accidental screen-share leaks.
**Consequence:** `CREDENTIAL_ENCRYPTION_KEY` must exist in env before any credential write. Loss of the key means all stored credentials are permanently unreadable. Back it up to a secrets manager. Do not rotate without re-encrypting all rows.

---

### 2026-05-18 â€” Health monitoring uses cached results (5-min TTL) not live checks per page load

**Decision:** `getProjectHealth()` in `lib/health.ts` upserts results into `project_health` table and returns cached rows if age < 5 minutes. Live checks hit GitHub API and the project's Vercel URL; Supabase health is inferred from whether a `supabase_project_id` is recorded (no management API call).
**Reasoning:** Health checks on every page load would hammer the GitHub API rate limit (60 req/hr unauthenticated, 5000/hr with PAT). With ~10 projects each checked on dashboard load, we'd burn rate limits in minutes. Cache-then-refresh is the right pattern. Supabase management API requires an OAuth token we don't have; presence of a project ID is sufficient signal for v1.
**Consequence:** Health status can be up to 5 minutes stale. That's intentional. Do not remove the cache TTL to get "real-time" health â€” add a manual refresh button instead if needed.

---

### 2026-05-18 â€” Tier-3 (Opus) calls race GPT-4o in parallel

**Decision:** When `complexity_tier: 3` is routed, Opus and GPT-4o fire simultaneously via `Promise.allSettled`. Whichever resolves first is the winner. Both calls are logged to `model_costs`. GPT result logged with `purpose: 'accountability_partner'`.
**Reasoning:** Tier-3 tasks are the highest-stakes calls. Having a second model in flight costs ~2Ã— but adds meaningful error protection and a cross-check on correctness. Latency does not increase since both run in parallel. Operator explicitly requested this pattern.
**Made by:** operator + agent

---

### 2026-06-08 â€” MCP server at `/api/mcp` for agent tool access

**Decision:** Mission Control exposes a Model Context Protocol server at `/api/mcp` (deployed on Vercel). Agents authenticate via `Bearer MCP_API_KEY`. On Windows, the token must live in `.claude/settings.local.json` as an `env` entry â€” not as a Windows environment variable. OS env propagation on Windows is unreliable and silently fails.
**Reasoning:** Direct Supabase REST calls from agents required passing service role keys across sessions, which is a security exposure. The MCP server proxies all agent-to-MC communication behind a single bearer token and a controlled API surface. The token can be rotated without touching Supabase credentials.
**Consequence:** If `mc_*` tools fail to connect, check `settings.local.json` before anything else. Token is `mc-api-key-personal-os-2026`. Do not move it to Windows env vars.
**Made by:** operator + agent

---

### 2026-06-08 â€” Brain dump capture (InboxCapture) with voice input shipped

**Decision:** `InboxCapture` component (`components/InboxCapture.tsx`) is the primary capture surface. Submits via `submitDump` server action in `app/(app)/inbox/actions.ts`. Triggers synchronous Haiku classification (`classifyBrainDump`) before returning. Voice input uses the Web Speech API â€” appends to existing textarea content, does not replace. âŒ˜â†µ keyboard shortcut wired.
**Reasoning:** The brain dump inbox is the OS's highest-frequency user interaction. Classification must be synchronous so the operator sees a result immediately. Voice captures ideas without typing friction. Existing content is preserved on voice input so the operator can combine typed and spoken context.
**Consequence:** Classification happens on every submit â€” do not move it to async fire-and-forget without a deliberate decision. Voice only works in browsers supporting `SpeechRecognition`/`webkitSpeechRecognition`; no error is thrown if unsupported.
**Made by:** agent

---

### 2026-06-08 â€” Vault auto-capture integrated into spec generation

**Decision:** When a spec is generated from a brain dump (`generateSpecAction` in `inbox/actions.ts`), the spec text is automatically captured to `vault_items` via `captureToVault()` with type `build_spec`. This happens after the task row is updated, before `revalidatePath`.
**Reasoning:** Specs are the most valuable artifacts in the OS. Storing them in the vault makes them retrievable by future agents via semantic search (`mc_get_vault_context`) without the agent needing to know the task ID or query Supabase directly.
**Consequence:** Every generated spec appears in vault searches. If `captureToVault` fails, the spec is still saved to the `tasks` row â€” vault capture is additive, not load-bearing.
**Made by:** agent

---

### 2026-06-08 â€” Active Skills (Claude Code Superpowers) adopted across all sessions

**Decision:** Seven skills are active for all Claude Code sessions on this project: `davids-way` (build methodology), `vault-recall` (recall before code), `session-context` (session start protocol), `mission-control` (MC read/write bookends), `decisions-sync` (decisions.md + push at session end), `CodexQC` (GPT-5.x second-opinion review), `advisoryboard` (accountability panel for business decisions). All documented in the "Active Skills" section of `CLAUDE.md`.
**Reasoning:** Skills encode operator workflow discipline in a form any agent can read. Without them, each new session starts cold on methodology. With them, any agent picks up the build methodology automatically.
**Consequence:** Agents must invoke `davids-way` before any non-trivial build task. `session-context` or `vault-recall` before touching code. `decisions-sync` + `mc_update_project_status` at session end. Standing rule, not optional.
**Made by:** operator + agent

---

### 2026-06-08 â€” `createAdminSupabaseClient()` is the universal server-side pattern

**Decision:** All server actions, API routes, and server components in this repo use `createAdminSupabaseClient()` (service role key, bypasses RLS). `createServerSupabaseClient()` is not used on the server side.
**Reasoning:** The OS is a single-operator app. Server-side code runs as a service, not as an authenticated user â€” using the anon key causes silent failures when RLS blocks the query with no error. The admin client is explicit and correct for all server-side use.
**Consequence:** Do not introduce `createServerSupabaseClient()` in server actions or API routes. If a future multi-user feature requires per-user RLS enforcement, that requires a separate decision and explicit scope.
**Made by:** agent

---

### 2026-06-09 â€” Local stdio MCP server replaces Vercel HTTP transport

**Decision:** `mcp-server.mjs` (project root, Node.js ESM) is now the Claude Code MCP transport. `.mcp.json` switched from `type: "http"` to `type: "stdio"` with `command: "node", args: ["./mcp-server.mjs"]`. All 10 `mc_*` tools are implemented inline â€” no Next.js imports, no `@/` aliases. Vercel HTTP endpoint at `/api/mcp` stays unchanged as a fallback for non-Claude Code clients (e.g., web-based agents, Manus).
**Reasoning:** Vercel serverless functions sleep between invocations, causing 2â€“5s cold-start delays. Claude Code's MCP client times out during the `initialize` handshake, leaving all `mc_*` tools unavailable for the entire session. The local stdio server is launched directly by Claude Code as a child process â€” no network hop, no cold start, always available from first message.
**Consequence:** Claude Code must be restarted to pick up the new `.mcp.json` config. `mc_complete_task` skips auto-QC in the stdio server (requires Next.js server actions) â€” returns `qc: "not_available_in_local_server"` when a commit URL is provided. `CREDENTIAL_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` must be in `.env.local` at project root (already are); the server reads them at startup.
**Made by:** operator + agent

---

### 2026-06-09 â€” Portfolio agent roster: repo-authored, vault-distributed, globally installed

**Decision:** Ten reusable subagents live in `agents/*.md` (canonical Claude Code subagent format: YAML frontmatter + system prompt). `scripts/sync-agents.mjs` (`npm run sync:agents`) distributes them two ways: upserts into `vault_items` as `type: 'agent'` (tagged by crew â€” build / revenue / holdco â€” `is_mcp_accessible: true`, embedded for semantic search), and copies to `~/.claude/agents/` so every Claude Code session on any project can dispatch them. Two new MCP tools â€” `mc_list_agents` and `mc_get_agent` â€” expose the roster to any MCP client, implemented in both the stdio server (`mcp-server.mjs`) and the Vercel HTTP server (`lib/mcp-tools.ts`).
**Reasoning:** Delegation is the structural fix for compact thrashing and context rot â€” subagents burn their own context and return only conclusions, keeping the main session lean. Vault distribution keeps the roster tool-agnostic (Codex, Manus, web agents fetch definitions via MCP), honoring the standing rule that the repo is the source of truth and the OS reflects state. Crew assignment lives in the sync script's `CREWS` map, not in frontmatter, so agent files stay canonical Claude Code format.
**Consequence:** After editing or adding an agent, run `npm run sync:agents`. Claude Code discovers `~/.claude/agents/` at session start â€” newly installed agents need a restart before the Agent tool can dispatch them by name. Roster table lives in CLAUDE.md ("Agent Roster" section).
**Made by:** operator + agent

---

### 2026-06-11 â€” video-optimizer-app relocated out of personal-os (gitlink removed)

**Decision:** video-optimizer-app moved from `projects/video-optimizer-app` (nested git repo tracked as a bare gitlink in personal-os) to `C:\Users\david\video-optimizer-app`, a standalone sibling repo beside VZT and FlipRada…6391 tokens truncated…d/major change/spec gets its working **branch** pushed to GitHub by whoever holds the task (Claude Code, Hermes, an outside model like Kimi K3, or David) â€” never gated, so work is never stranded on a local disk. (b) **Merge to `main` + `decisions.md` + vault + `mc_update_project_status` stays the reviewed step** â€” happens only after cross-check + Codex QC, and does not bend for rate limits or a busy reviewer. (c) **Break-glass failover:** if the Claude subscription is maxed/down, persisting is mechanical â€” the *executor* swaps while the *authority* holds. Work is already safe on its branch; canonical persistence either waits for the window to reset, or **Codex (or David with the full-scope token) runs the *already-reviewed* result**. **Never skip review because the reviewer is rate-limited; never let an outside model push straight to `main` to dodge the wait.** When Claude is restored, the lane reverts to normal â€” Codex is failover, not a new default.

**Reasoning:** The prior rule ("Claude Code alone performs final persistence") created a single point of failure: an outside model could build end-to-end and then have nowhere to land the result if the Claude sub was capped at that moment. The fix separates the mechanical act (git push, MC write â€” needs the write token + a completed review, not a specific model) from the intelligence act (the review itself). This preserves the moat â€” one authority, reviewed before canonical, git+MC as sole source of truth â€” while removing the failure mode. It also operationalizes the tool-agnostic thesis: the write authority is welded to "a trusted persistence lane," not to Claude specifically, so a permanent Claude outage means re-homing the token, not rebuilding the moat. Motivated by the concrete case of routing full builds to a cheap capable open model (Kimi K3 / GLM 5.2) when economics favor it â€” especially once the local rig makes them free-at-margin.

**Consequence:** Folded into the canonical workflow spec (`specs/2026-07-18-ideation-execution-workflow.md` â†’ "Persistence resilience") and the `davids-rules` skill (re-synced to the vault). Two related tightenings â€” explicit build-size tiers (greenfield end-to-end vs existing-repo bounded vs protected-repo gated) and a metered-model cost gate â€” were deliberately **parked** until the local rig is live, to be revisited together with the hosting economics.
**Made by:** operator + agent

---

### 2026-07-28 â€” ChatGPT voice adopted as Chief-of-Staff relay; MC is the mailbox

**Decision:** ChatGPT voice becomes the mobile **front door / relay** for the portfolio â€” David's proxy when he's away from the keyboard. It reads MC for briefings, captures voice brain dumps and build intents into MC, and relays agent pushback/status back to David. It does **not** build, merge, or hold broad write authority â€” David explicitly withdrew the "access anything I can" ask in favor of the relay model. Roles stay separated: Hermes keeps spec drafting + the Telegram digest lane; Claude Code keeps build + persistence authority; Codex keeps QC. **All coordination flows through MC as the mailbox** â€” no direct ChatGPTâ†’Hermes or ChatGPTâ†’Claude channels. Access ladder: per-agent read token first (M1), then the narrow `capture` write scope (brain-dump + task-queue tools only) designed in the 2026-07-22 brain-dump decision â€” the full token never.

**Reasoning:** The goal is a bridge between the portfolio and David's geographical location, not a fourth builder. The relay model delivers the full Chief-of-Staff UX (talk â†’ capture â†’ spec â†’ build â†’ hear pushback â†’ approve) while every durable action still crosses the existing gates. MC-as-mailbox keeps one auditable channel, avoids exposing Hermes's local gateway to the internet, and reuses the live task queue instead of inventing agent-to-agent plumbing.

**Consequence:** Resolves amendments #1 and #4 of `specs/2026-07-28-mc-ai-orchestration-layer.md`. The deferred `mc_write_brain_dump` + `capture` token scope becomes the Phase 2 build, issued to ChatGPT (and later Hermes) on separate per-agent keys. The planned "inbound Telegramâ†’brain-dump capture" ambient sub-project is absorbed: ChatGPT voice is the capture path; Hermes's Telegram lane stays digest/alerts. Phase 0 (ChatGPT voice can invoke MCP connector tools + static Bearer auth compatibility) still gates all build work. Unattended headless builds (Phase 4) remain a separate future trust decision.
**Made by:** operator + agent

---

### 2026-07-30 â€” Phase 0 CLOSED (voice proven); ChatGPT connector needs OAuth, not a static key

**Decision:** Phase 0 is closed â€” **ChatGPT Work Voice provably invokes a custom MCP tool** on our server (throwaway `/api/mcp-probe`, No-Auth + Streamable HTTP; Vercel log confirms `mc_probe_echo` executed at `2026-07-30T21:26:37.357Z`, protocol `2025-11-25`). Two facts now govern the build: **(a) ChatGPT cannot present a static Bearer/API key** as a connector credential â€” the connector offers only OAuth / No-Auth / Mixed, so authenticated ChatGPT access **requires an OAuth 2.1 auth-code + PKCE facade**; a no-auth write endpoint is off the table. **(b)** the real `/api/mcp` must negotiate protocol version (echo the client's) â€” it hard-codes `2024-11-05` and would fail ChatGPT's handshake.

**Reasoning:** The premise the whole cockpit rests on (voice â†’ custom tool) was undocumented/rollout-dependent, so it was validated cheapest-first with a fake read-only probe before any OAuth investment â€” which the doc-check then proved would have been wasted if voice couldn't reach tools. The auth finding came from ChatGPT's own OpenAI-docs check (vault `d80be519`) + the live probe.

**Consequence:** Product baseline + confirmed connector requirements persisted to the vault (`59bbf2b2`, `d80be519`, `0b6bb199`). OAuth facade moves onto the Phase 1 critical path; the static `chatgpt-liaison` key is demoted to curl/internal use only. Probe stays live until Phase 1 passes, then removed.
**Made by:** operator + agent

---

### 2026-07-30 â€” Phase 1 ChatGPT-liaison relay: architecture + scope

**Decision:** Build the ChatGPT liaison as a controlled Mission Control relay in four pieces. **(1)** `mc_requests` queue (state machine `submittedâ†’queuedâ†’claimedâ†’in_progressâ†’{blocked,awaiting_approval,completed,failed,cancelled}`) + a narrow **`liaison` token scope** exposing exactly five tools â€” `mc_submit_request` (write) plus `mc_get_request_status` / `mc_list_recent_requests` / `mc_whats_stalled` / `mc_get_result` (read). No vault, no credentials, no worker mutations. **(2)** A **worker interface** (`mc_claim_request`, `mc_reassign_request`, `mc_post_progress`, `mc_mark_blocked`, `mc_request_approval`, `mc_complete_request`, `mc_mark_failed`), full-key-gated, state-machine-validated, never exposed to the liaison. **(3)** The OAuth 2.1 PKCE facade mapping a ChatGPT token â†’ the `chatgpt-liaison` identity + `liaison` scope. **(4)** Publish + acceptance tests. **Phase 1 = the plumbing, operated by real Claude/Codex sessions manually** â€” the autonomous auto-route/auto-claim engine is Phase 2. **Hermes stays read-only** (drafts specs in its own env; ChatGPT relays the MC hand-off; Claude executes; Codex QCs; Claude final-checks; push to GitHub/MC). An end-to-end Hermes build (specâ†’push when several projects run concurrently) is a **future call reserved to David**, not a default.

**Reasoning:** Cross-check against repo reality flagged three conflicts with the raw handoff: Hermes-write reverses a locked decision (guardrail #2); the handoff's Definition-of-Done implied an autonomous engine we deferred; and the rich request model doesn't fit `brain_dumps`/`tasks`. Splitting liaison (submit+read) from workers (mutations) with a dedicated scope keeps ChatGPT least-privileged and auditable while the trusted builders retain full access. Building the pipes before the automation lets Test 3 (relay) pass with manual worker steps, deferring the unattended runner's real trust cost.

**Consequence:** Pieces 1+2 shipped + curl-verified (`fd04608` and this commit): liaison sees only its 5 tools; full sees 28; end-to-end submitâ†’claimâ†’progressâ†’completeâ†’read-back works; blocked/approval surface via `mc_whats_stalled`/status; invalid transitions rejected; liaison walled from worker tools + vault + credentials (403). Every call stamped in `mcp_audit_log`. Worker tools are HTTP-only for now (stdio `mcp-server.mjs` parity deferred â€” not the active path); per-worker-key isolation (vs the current full-key + `worker` param) is a Phase 2 hardening. OAuth facade (piece 3) is next and gates any ChatGPT write exposure â€” if it can't be completed cleanly, stop before exposing write.
**Made by:** operator + agent

---

### 2026-07-31 â€” Piece 3 OAuth facade SHIPPED + live with ChatGPT; Hermes â†’ limited-write orchestrator; queue watcher

**Decision:** The OAuth 2.1 + PKCE liaison facade is built, deployed, and **proven end-to-end with the real ChatGPT connector** (authenticated `mc_list_recent_requests` + full write relay `mc_submit_request`â†’claimâ†’routeâ†’`mc_complete_request` MC-WRITE-OK, all audited). Migrations 018 (oauth_clients/auth_codes) + 019 (rate limits + revocation kill-switch) applied. Three rounds of dual review (code-reviewer + Codex QC) caught + closed a critical hole (unauthenticated consent â†’ operator `OAUTH_CONSENT_PASSCODE` gate, fail-closed). DCR locked to the exact ChatGPT callback; throwaway probe removed. **Separately, Hermes graduated from read-only to a tightly-scoped `orchestrator` role** â€” every read tool plus exactly `mc_claim_request` + `mc_reassign_request` (403 on complete/fail/submit/vault/credentials). All 5 Hermes profiles switched from the ungated local stdio `mcp-server.mjs` (service-role key, broad write) to the HTTPS endpoint + `MCP_ORCHESTRATOR_KEYS` scoped key. A serverless **queue watcher** (`/api/queue/dispatch`) auto-claims + routes queued requests to a worker and pings Telegram â€” **execution stays human-gated** (workers execute/complete; the watcher never does).

**Reasoning:** ChatGPT's connector offers no static-bearer mode, so OAuth was required; the passcode gate exists because the auth code is otherwise scrapeable off the redirect (both reviewers found this independently). Hermes-as-orchestrator with limited write (approved by operator + ChatGPT 2026-07-31) keeps the least-trusted always-on component from holding credential/vault-write power it never used (audit of its logs + `credential_access_log` showed zero MC writes ever). The watcher is serverless (matches the alerts-digest ambient model) so pickup works even when the rig is off.

**Consequence:** ChatGPT Voice/text is a live conversational layer over Mission Control, safely walled from code/deploy/credentials/spend. Commits `dbd050a`â†’`82ad888` on main. **Two open items:** (1) **Layer-2 rig exposure** â€” Hermes's local `terminal` + the repo `.env.local` on the same machine can read all secrets regardless of MCP scope; the MCP tightening is defense-in-depth, real fix is rig-architecture (see memory `hermes-rig-secret-exposure`). (2) **Watcher cadence** â€” Vercel Hobby caps crons at daily, so `/api/queue/dispatch` runs daily as a backstop; real-time pickup needs an external trigger (free, e.g. cron-job.org hitting the CRON_SECRET-gated endpoint) or a Vercel Pro upgrade. Refresh tokens (`offline_access`) for ChatGPT still deferred â€” 15-min access tokens mean periodic re-consent.
**Made by:** operator + agent

---

### 2026-07-31 â€” Minimal Voice Slice v0 built (autonomous execution engine, Claude-only) â€” code-complete, rig-DoD-pending

**Decision:** Built the smallest vertical slice that makes the voice loop real: **voice â†’ ChatGPT â†’ queued â†’ rig dispatcher builds in an isolated workspace â†’ CodexQC â†’ commit (no push) â†’ Telegram ping â†’ approve-by-voice â†’ SHA-bound gated push to a sandbox**. Scope held to Claude-as-the-only-worker; Hermes/multi-model builder, capability registry, and spend tracking stayed deferred (parent spec `2026-07-31-autonomous-execution-engine.md`). Four pieces, phased (phase-relay, one subagent per piece, dual review on each security boundary): **(1)** migration 020 (`phase, approved_by, approved_at, workspace_ref, attempt_id, reviewed_sha` on `mc_requests` + realtime enrollment; status enum unchanged); **(2)** `mc_respond_approval` â€” HTTP/liaison-only approval relay, actor-bound (`approved_by` from the resolved token, not the client), **atomic** attempt-binding + idempotency (never runs git); **(3)** `scripts/lib/telegram-notify.mjs` reusable `awaiting_approval` ping; **(4)** `scripts/dispatcher.mjs` + `claude-executor-adapter.mjs` â€” deterministic rig service: atomic claim (conditional UPDATE, race-safe), isolated push-denied workspace, SHA-bound gated push (verifies status/attempt, allowlist, no-newer-reject, `HEAD===reviewed_sha`), fault recovery. Sandbox = fixed `davidbillera-lab/mc-spike-test` + per-request branch `mc-build-<id>`, never a portfolio repo. **The `/api/queue/dispatch` daily cron was retired** â€” the rig dispatcher now owns queue pickup, and the non-atomic cron claiming the same pool was found to silently strand requests when the rig is offline (resolves open item #2 of the prior entry differently than planned).

**Reasoning:** Each boundary got `code-reviewer` + `/CodexQC`. The dual review earned its keep: it caught a production-path actor bug (`/api/mcp-liaison` recorded `approved_by='system'`), that `--dangerously-skip-permissions` **nullifies** the workspace deny-list (so the "executor structurally cannot push" guarantee was weaker than the comments claimed), a repo-allowlist that checked a constant against itself with a `SANDBOX_REMOTE` redirect bypass, a CodexQC step that reviewed an empty diff, and the cron-orphan silent-loss bug. All were remediated (commit `00a220a`): minimal executor env (secrets stripped), skip-permissions made opt-in (default OFF, trust-stamp enforces the deny-list), real allowlist + `SANDBOX_REMOTE` mock-only, dispatcher transitions now write `mcp_audit_log`, fail-closed adapter selection. Verified with a mock executor + local bare remote (10 checks incl. all three gate-blocks) â€” the real headless-Claude path can't run inside a classifier-gated session (Phase 0 finding), so it's deferred to the operator's rig.

**Consequence:** Six commits on branch **`voice-slice-v0`** (NOT merged to main â€” merge deploys the MCP tool + drops the cron, and the end-to-end DoD hasn't run). **Two rig-gated items before the first real autonomous push:** (1) verify headless `claude -p` runs trust-only (deny-list enforced without skip-permissions); if it hangs, `DISPATCHER_SKIP_PERMISSIONS=1` is the documented-risk fallback. (2) add `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` to the rig `.env.local` (only in Vercel today) or the ping no-ops. **Debt ledger (v0-acceptable for a single trusted-operator rig, disqualifying once `request_text` is untrusted):** OS/filesystem sandbox for the executor (it can still `Read` rig files / network via `node`) Â· immutable `approved_sha` capture Â· push/claim leases + heartbeat Â· async spawn Â· Windows process-tree kill Â· `stampTrust` unbounded `~/.claude.json` growth Â· dispatcher identity scope-split. DoD test = David speaks a build request to ChatGPT, approves by voice, confirms the sandbox push.
**Made by:** operator + agent

---

### 2026-08-01 â€” Voice slice v0 DEPLOYED + rig-proven end-to-end; OAuth refresh tokens now the #1 gap

**Decision/Result:** Merged `voice-slice-v0` â†’ `main` (`46647be`, Vercel prod deploy READY) and ran the real rig DoD. The full loop works: **ChatGPT `mc_submit_request` â†’ queued â†’ rig dispatcher atomic-claim â†’ real headless Claude build â†’ CodexQC SHIP â†’ commit (no executor push) â†’ awaiting_approval â†’ Telegram ping (received) â†’ approval â†’ SHA-bound gated push (all 4 gates) â†’ `mc-spike-test@mc-build-0cd0ad9d`, commit `273c7505` â†’ completed.**

**Rig findings (now settled):**
1. **Headless `claude -p` does NOT use tools with the trust-stamp alone** â€” it requires `--dangerously-skip-permissions` (`DISPATCHER_SKIP_PERMISSIONS=1`), which **nullifies the workspace deny-list**. The "executor structurally cannot push" guarantee held anyway in practice (fresh `git init` workspace has no remote + the prompt instruction held â€” verified GitHub stayed clean pre-approval), but restoring the *strong* guarantee needs headless allow-list enforcement (`--permission-mode`) â€” top code-hardening item.
2. **Windows:** `spawnSync('claude', â€¦)` can't launch the npm `.cmd` shim (instant null exit); fixed by resolving the real `claude.exe` binary (`46647be`).
3. **The auto-mode classifier correctly blocks the agent session from BOTH running the executor AND self-approving a push** â€” confirming the design premise: the executor + the approval must be a human / plain service, never a classifier-gated agent session.
4. **The one hop not done by pure ChatGPT-voice:** the final `mc_respond_approval` â€” ChatGPT's **15-min OAuth access token expired mid-approval** and the reconnect stalled. ChatGPT DID make real `mc_submit_request` + `mc_get_request_status` calls (integration proven); David approved via the `rig-test` helper (human authority â€” correct).

**Consequence:** v0 voice slice is LIVE and proven. **Top priority: OAuth refresh tokens (`offline_access`)** â€” the 15-min expiry is the primary UX blocker for hands-free voice (forces mid-flow re-consent). Other follow-ups: headless allow-list enforcement to drop skip-permissions and restore the deny-list; dispatcher as an always-on background service (currently foreground â€” dies on terminal close); `TELEGRAM_*` now on the rig `.env.local` + stored in the MC vault (encrypted). Tooling added: `scripts/rig-test.mjs` (seed/status/approve/reject/list/cleanup). Test artifacts live on the private `mc-spike-test` sandbox (throwaway `mc-build-*` branches).
**Made by:** operator + agent

---

### 2026-08-01 â€” OAuth refresh credentials use sliding renewal with an annual cap

**Decision:** ChatGPT's Mission Control liaison receives a stable, non-rotating refresh credential. Each successful refresh atomically renews a 90-day inactivity window, bounded by one year from issuance; access JWTs remain 15 minutes. The refresh row is hashed, client-bound, revocable through `revoked_at`, and wrong-client/revoked/expired attempts cannot renew it.

**Reasoning:** The operator needs the connector to stay signed in during normal use, but a literally permanent bearer credential would remain useful forever if stolen. A sliding inactivity window removes routine reconnects, while the annual ceiling and manual revocation retain a finite compromise boundary. The renewal is awaited and predicate-bound because detached serverless writes can be dropped and a read-then-unconditional-write could race a revocation.

**Consequence:** ChatGPT should refresh automatically without interrupting active voice workflows. The connector must be recreated once after this metadata change so ChatGPT fetches `offline_access` and refresh-token support; after that, only a year-old credential, 90 days of inactivity, or manual revocation requires reconnection. The pinned `personal-os-git-main-jsg1.vercel.app` alias must continue to be moved to each new production deployment.
**Made by:** Codex


