# CLAUDE.md — Personal OS (Mission Control)

**Read first:** `~/.claude/CLAUDE.md` (operator profile) before this file.
mission_control_id: 698d6376-5819-400b-babc-cd664ee36c04

---

## What This Is

A portfolio operating system — "Mission Control" — for an AI-native holding company. JSG Estate Liquidators is the cash-flowing parent; underneath it, multiple potentially-millions-of-dollars SaaS plays are being incubated (VZT multi-tenant, REELFLOW multi-tenant, Marblism agency, FlipRadar, College Climb).

**This is not a personal productivity tool. It is the connective tissue of a future holdco.**

The OS optimizes for three things:

1. **Velocity of validated builds** — ideas → specs → working code, fast
2. **Ruthless killing of bad ideas** — kill criteria enforced at checkpoints
3. **Exit-readiness** — every project tracked against the metrics acquirers care about

---

## Why This Exists (The Pain Point)

Right now, ideas die in notebooks. Builds re-explain context every session. Tools clash (Lovable vs. Claude Code on GitHub). There's no single surface that tells the operator: *here's where every project stands, here's what's blocked, here's what to ship next, here's what to kill.* The OS solves that.

The operator has roughly 10 distinct projects in motion. Without a central command surface, scaling means hiring; with one, it means leverage.

---

## Tech Stack (v1)

- **Vault:** `vault_items` table — cross-session memory. Stores decisions, specs, agent sessions, brain dumps. OpenAI `text-embedding-3-small` for semantic search. Auto-captured via `captureToVault()` in `lib/vault.ts`. Queried via `mc_get_vault_context` (semantic, 200-char previews) or `mc_browse_vault` (browse by type/recency), with `mc_get_vault_item` for full single-item fetch.
- **MCP server:** `/api/mcp` endpoint deployed on Vercel. Agents connect via `Bearer MCP_API_KEY` (token in `.mcp.json` + `.claude/settings.local.json`). Exposes: project context, tasks, vault, credentials, skills. The server validates keys only against hashed rows in `mcp_api_keys` (no env-var fallback since M2, 2026-10-11). On Windows, always source MCP_API_KEY from `settings.local.json` — OS env propagation is unreliable.

**Supabase pattern:** All server-side calls use `createAdminSupabaseClient()` (service role key, bypasses RLS). Never use `createServerSupabaseClient()` in server actions or API routes — it silently fails behind RLS.

**Explicitly not used for the OS itself:** Lovable (clashes with multi-agent pushes), Make/Zapier/n8n (fragile).

---

## Active Skills (tool-agnostic superpowers)

Skills are installed in `~/.claude/skills/`. Any agent working on this project must invoke them. Invoked via the project’s `Skill` tool.

| Skill | Trigger | What it does |
|---|---|---|
| `davids-rules` | **Session start** (any agent), `/davids-rules` | Canonical operating rules: where to ideate vs execute, the mandatory cross-check loop, artifact + persistence contracts, research routing, 12 stop-and-flag guardrails. Bootstrap only — canonical doc is `specs/2026-07-18-ideation-execution-workflow.md` + vault `fb27cf0d`. Reachable by Hermes via `mc_get_skill`. |
| `davids-way` | Any task touching 2+ files or any new feature | Model tier audit, targeted reads only, plan-first approval gate, one-commit-per-piece discipline |
| `vault-recall` | Session start, cold pickup, "we did this before" | Pulls prior decisions/specs/knowledge from vault before touching code |
| `session-context` | Session start | 4-step protocol: vault search → recent decisions → credentials → project status |
| `mission-control` | Session start (read) and session end (write) | `mc_get_project_context` for briefing, `mc_update_project_status` + push to GitHub at close |
| `decisions-sync` | Session end, if any architectural decision was made | Appends to `decisions.md`, commits, pushes, updates MC |
| `checkpoint` | Start of any multi-step task; resume after compaction or `/clear`; `/checkpoint` | Maintains gitignored `.claude/checkpoint.md` (goal, state w/ NEXT marker, key files, decisions, gotchas, verbatim constraints). Post-compaction: read checkpoint first, vault second, never re-read source files until editing. SessionStart(compact) hook in `~/.claude/settings.json` reinforces it. |
| `CodexQC` | `/CodexQC` or before merging a branch | GPT-6.1 Sol independent second-opinion review (falls back to GPT-5.5). Output saved to `.codex-qc/`. Claude fixes; Codex reports only. |
| `advisoryboard` | `/advisoryboard`, "Team", business decision, pivot | Four-persona accountability panel: Partner, Advisor, Colleague, Friend. Verdict first, no rescuing bad ideas. Auto-saves every verdict to the vault (`ab_conversation`) at close — works from any project. |
| `handoff` | `/handoff <project>` or "give me a VZT handoff" | Pulls MC status + vault context + checkpoint into a single paste-ready brief. Drop it as the first message in a fresh project window to resume without losing a step. |
| `phase-relay` | `/phase-relay` or auto-triggered from davids-way Step 4 on 3+ sequential pieces | Serial multi-agent relay for phased builds. Each piece gets its own fresh context window connected by a handoff doc. Prevents context rot and compact thrashing on long sequential builds. |
| `davids-agents` | `/davids-agents` or any sequential multi-step task with 3+ heavy steps | Pre-task context evaluation gate → serial subagent relay if thrash risk detected. Each subagent handles one step in a fresh window; handoff summaries passed as cold-start context. Eliminates autocompact thrashing on long sequential builds. |
| `handoff-summary` | `/handoff-summary` or "give me a handoff summary" | Synthesizes the CURRENT SESSION state into a single paste-ready block — what was done, what's next, key files, constraints, and a suggested first message. Paste into a fresh window to resume exactly where you left off. Distinct from `/handoff` (which is project-named, pulls from MC/vault). |
| `lean-code` | `/lean-code`, "trim/slim this code", over-engineering review, or any environment not loading the global rules | On-demand Output Token Discipline (Ponytail adaptation): pre-write ladder + output-side rules, plus a review mode that flags over-engineering in a diff ranked by lines saved. Always-on version lives in `~/.claude/CLAUDE.md` → "Output Token Discipline". |

---

## Agent Roster (reusable subagents)

Portfolio-wide subagents, callable from any project — via the active agent environment's Agent tool or from any MCP client via `mc_list_agents` / `mc_get_agent`.

**Source of truth:** `agents/*.md` in this repo (canonical agent format: YAML frontmatter + system prompt). **Distribution:** `npm run sync:agents` upserts each into the vault (`vault_items` type `agent`, tagged by crew, embedded for semantic search) and installs to `~/.claude/agents/` (global — all projects). The active agent environment discovers installed agents at session start, so new agents need a restart before they're dispatchable by name.

Crew assignment lives in the `CREWS` map in `scripts/sync-agents.mjs`, not in frontmatter — agent files stay canonical Claude Code format.

---

## External Connections (v1 scope)

**In v1:**
- GitHub (read all repos for context — primary)
- Supabase (the OS's own backend)
- Claude Code, Codex, Manus (oversight via GitHub integration + webhooks; direct MCP where available)

**Deferred (v2+):**
- Gmail (Marblism EVA assistant covers this gap for now)
- Google Calendar (same — not enough volume yet to prioritize)
- DOA admin, LiveAuctioneers admin, eBay/Mercari/Poshmark/Etsy stores (Claude in Chrome browser automation when prioritized)

**Rationale for deferring email/calendar:** Operator confirmed not enough volume to stress about; existing assistant (Marblism EVA) can cover. Build OS muscle on project orchestration first; expand to inbox/calendar when the cost of managing those manually exceeds the cost of building the integration.

---

## Project Context File Convention

Every project repo gets:

- `CLAUDE.md` — purpose, stack, brand voice, status (this file is the template)
- `kill-criteria.md` — when do we kill this
- `decisions.md` — log of meaningful decisions and why
- `model-routing.md` — project-specific model/tool overrides (if any)

**Protected projects (Tier 1) additionally get:**

- `docs/operator/` — architecture, decisions, code-level documentation. Audience: operator + JJ-tier secondary maintainers. Voice: technical, explains the *why*.
- `docs/runbooks/` — step-by-step execution procedures. Audience: Vinnie-tier beginners. Voice: AI-idiot-proof, screenshots, decision trees, "if X happens, click Y, then call David."

The OS reads these files to power the dashboard and to bundle context for agent handoffs. **The repo is the source of truth, not the OS database.** The OS reflects state; it doesn't own it. This keeps the OS swappable — if a better tool comes along in 18 months, the context survives.

---

## Open Questions

None currently open. VZT protection (Medium now, Heavy before first paying tenant) and the College Climb Light ship workflow were LOCKED 2026-05-02. The canonical decision log is `decisions.md`.

---

## Standing Rules (project-specific — additive to global)

1. The OS is a **swappable command layer.** Never let it become the source of truth. The repos are.
2. Every new project added to the OS must have a `CLAUDE.md`, `kill-criteria.md`, and `decisions.md` from day one. No exceptions.
3. Every kill criteria check that comes back "fail" gets surfaced to the operator within 24 hours.
4. The OS itself follows its own rules. It has a `kill-criteria.md`. It logs decisions. It reports its own model costs.
5. **Invoke `davids-way` before any non-trivial build task.** Every session.
6. **Invoke `session-context` or `vault-recall` before reading code.** Don't re-derive what the vault already knows.
7. **Session end protocol:** push to GitHub → `mc_update_project_status` → run `decisions-sync` if architecture changed. **Write vault records last.** A `mc_write_vault` record created mid-session freezes a stale snapshot that later work invalidates; if you wrote one early, `mc_update_vault` it and read it back before closing.
8. **Never use `createServerSupabaseClient()` in server actions or API routes.** Always use `createAdminSupabaseClient()`.

---

## Hermes Ambient Layer

Hermes (multi-model agent, local desktop app) is the portfolio's **ambient layer** — the always-on role Claude Code and Codex can't fill (both are session-bound). Not a builder, not a portfolio asset (open-source infra).

- **Alert delivery is serverless.** Vercel cron → `/api/alerts/digest` → Telegram, once daily, only when a project is failing/blocked/stale >14d (silence = all-clear). Fires even when the local rig is off — this is what makes Standing Rule #3 enforceable. `CRON_SECRET`-gated.
- **Replies are Hermes's job.** Reply to an alert in Telegram and Hermes answers from the vault (best-effort — needs the rig up).
- **Hermes uses its own per-client MC key** (orchestrator scope) issued as a table row, not a shared token. Its `mission-control` server points at the HTTPS endpoint `personal-os-git-main-jsg1.vercel.app/api/mcp`. Its only writes are claim, reassign and submit-plan on requests; it cannot reach mc_get_credential, the vault, or execute/complete work (403). The key is injected into its profile config — Hermes can't self-serve it.
- Detail + trust ladder (inbound capture / autonomous cron are future, each needs more trust): `specs/2026-07-16-hermes-ambient-layer-design.md`, `decisions.md` 2026-07-16.

## Last Updated

Initial draft: May 2026. Skills + vault + MCP server documented: June 2026. Agent roster added: June 2026. Context trim + `lean-code` skill: July 2026. Hermes ambient layer + MC health digest: July 2026. CodexQC reviewer GPT-5.5 → GPT-6.1 Sol: October 2026. Update on every meaningful decision.
