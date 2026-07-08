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

## The Three Core Surfaces (v1)

### 1. Project Status Dashboard

Tiered view of all portfolio projects. Each project card shows:

- Stage (idea / spec / build / ship / scale / kill)
- Blockers
- Last update
- Next action
- Kill criteria status (pass / warning / fail)
- Tier badge (1 = protect/accelerate, 2 = active, 3 = personal)

VZT and College Climb are pinned as priority/protected.

### 2. Brain Dump Inbox

Single capture point. Text first; voice later. Every entry gets:

- **Auto-classified by Haiku** (idea, task, bug, decision, kill-candidate)
- Routed to the right project context (or flagged as new project)
- Surfaced in the dashboard until acted on

Nothing dies in a notebook. Nothing requires the operator to remember where it goes.

### 3. Build Orchestration

When an idea graduates from inbox to build:

- OS generates a context-loaded spec (project CLAUDE.md + decisions.md + idea + relevant code refs)
- OS recommends which runtime harness to hand it to based on job type
- OS recommends which model tier (1–4) for the work
- One-click handoff: spec ready, context bundled

---

## Tech Stack (v1)

- **Frontend:** Next.js → Vercel
- **Backend:** Supabase (Postgres, auth, edge functions for routing logic)
- **Model APIs:** Anthropic SDK + OpenAI SDK + Gemini SDK behind a single `/api/route-task` endpoint that picks the model by `complexity_tier`
- **GitHub API:** for repo context loading and project file sync
- **Auth:** Supabase auth (operator + Vinnie roles eventually)
- **Vault:** `vault_items` table — cross-session memory. Stores decisions, specs, agent sessions, brain dumps. OpenAI `text-embedding-3-small` for semantic search. Auto-captured via `captureToVault()` in `lib/vault.ts`. Queried via `mc_get_vault_context` (semantic, 200-char previews) or `mc_browse_vault` (browse by type/recency), with `mc_get_vault_item` for full single-item fetch.
- **MCP server:** `/api/mcp` endpoint deployed on Vercel. Agents connect via `Bearer MCP_API_KEY` (token in `.mcp.json` + `.claude/settings.local.json`). Exposes: project context, tasks, vault, credentials, skills. On Windows, always source MCP_API_KEY from `settings.local.json` — OS env propagation is unreliable.

**Supabase pattern:** All server-side calls use `createAdminSupabaseClient()` (service role key, bypasses RLS). Never use `createServerSupabaseClient()` in server actions or API routes — it silently fails behind RLS.

**Explicitly not used for the OS itself:** Lovable (clashes with multi-agent pushes), Make/Zapier/n8n (fragile).

---

## Active Skills (tool-agnostic superpowers)

Skills are installed in `~/.claude/skills/`. Any agent working on this project must invoke them. Invoked via the project’s `Skill` tool.

| Skill | Trigger | What it does |
|---|---|---|
| `davids-way` | Any task touching 2+ files or any new feature | Model tier audit, targeted reads only, plan-first approval gate, one-commit-per-piece discipline |
| `vault-recall` | Session start, cold pickup, "we did this before" | Pulls prior decisions/specs/knowledge from vault before touching code |
| `session-context` | Session start | 4-step protocol: vault search → recent decisions → credentials → project status |
| `mission-control` | Session start (read) and session end (write) | `mc_get_project_context` for briefing, `mc_update_project_status` + push to GitHub at close |
| `decisions-sync` | Session end, if any architectural decision was made | Appends to `decisions.md`, commits, pushes, updates MC |
| `checkpoint` | Start of any multi-step task; resume after compaction or `/clear`; `/checkpoint` | Maintains gitignored `.claude/checkpoint.md` (goal, state w/ NEXT marker, key files, decisions, gotchas, verbatim constraints). Post-compaction: read checkpoint first, vault second, never re-read source files until editing. SessionStart(compact) hook in `~/.claude/settings.json` reinforces it. |
| `CodexQC` | `/CodexQC` or before merging a branch | GPT-5.x independent second-opinion review. Output saved to `.codex-qc/`. Claude fixes; Codex reports only. |
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

| Agent | Crew | Job |
|---|---|---|
| `code-reviewer` | Build | Second-opinion diff/branch review before merge; reports, never fixes |
| `qa-verifier` | Build | Runs tests + smoke checks; pass/fail with evidence |
| `session-auditor` | Build | Reads session transcripts; reports token waste, re-reads, compaction causes |
| `spec-writer` | Build | Brain dump/idea → agent-ready build spec with context bundled |
| `doc-writer` | Build | Generates `docs/operator/` (JJ-tier) + `docs/runbooks/` (Vinnie-tier) |
| `researcher` | Revenue | Market signal, comps, competitor scans → findings brief |
| `copywriter` | Revenue | Human-voice pass on customer-facing copy; no AI-template feel |
| `seo-geo-auditor` | Revenue | SEO + AI-answer-engine readiness audits (Marblism clients) |
| `kill-criteria-examiner` | Holdco | Runs the 4 kill criteria; verdict first, no rescuing |
| `exit-readiness-scorer` | Holdco | Scores against acquirer due-diligence dimensions /100 |

Crew assignment lives in the `CREWS` map in `scripts/sync-agents.mjs`, not in frontmatter — agent files stay canonical Claude Code format.

---

## Core Data Model (initial sketch — refine in build)

- `projects` — id, name, tier, stage, status, kill_criteria_status, last_update, repo_url, claude_md_url
- `brain_dumps` — id, raw_text, classified_type, project_id (nullable), status, created_at
- `decisions` — id, project_id, decision, reasoning, date, made_by
- `tasks` — id, project_id, title, complexity_tier, recommended_tool, recommended_model, status
- `model_costs` — id, project_id, task_id, model, tokens_in, tokens_out, cost_usd, timestamp
- `kill_criteria_checks` — id, project_id, check_date, functionality, efficiency, scalability, time_to_revenue, verdict, notes

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

None currently open. Formerly-open items, both LOCKED 2026-05-02 — full detail in `decisions.md`:

- **A. VZT Protection Level** — Medium now (Codex review before merge, staging Supabase env, critical-path tests on listing + image pipelines, mandatory `decisions.md`); escalates to Heavy before first paying tenant (feature flags, deploy approval gate, daily health monitoring, tenant isolation testing, incident playbook). Succession: JJ = tier-1 emergency maintainer (`docs/operator/`), Vinnie = tier-2 execution-only recovery (`docs/runbooks/`); both doc tiers must exist before first paying tenant.
- **B. College Climb Ship Workflow** — Light workflow, validation-gated: Phase 1 JJ real-data smoke test (screen + voice recorded) → Phase 2 beta cohort (5–10 students + 2–3 parents, 2 weeks) → Phase 3 iteration → Phase 4 ship checklist activates. Runs on JJ/beta bandwidth, not operator bandwidth, until Phase 3. **Status: Phase 1 — pending JJ kickoff.**

---

## Decisions Log (so far)

See `decisions.md` for the canonical log. Summary of pre-build decisions:

- **2026-05-02** — OS built in Next.js + Supabase, deployed on Vercel. Lovable rejected for core OS.
- **2026-05-02** — Three core surfaces for v1. Email/calendar deferred to v2.
- **2026-05-02** — Model routing tiers (1–4) defined globally. OS implements via `/api/route-task`.
- **2026-05-02** — Project context lives in repos. OS database reflects state but does not own it.
- **2026-05-02** — VZT protection LOCKED at Medium now, Heavy before first paying tenant.
- **2026-05-02** — VZT bus factor succession plan adopted (JJ tier 1, Vinnie tier 2).
- **2026-05-02** — College Climb workflow LOCKED at Light, validation-gated.

---

## Standing Rules (project-specific — additive to global)

1. The OS is a **swappable command layer.** Never let it become the source of truth. The repos are.
2. Every new project added to the OS must have a `CLAUDE.md`, `kill-criteria.md`, and `decisions.md` from day one. No exceptions.
3. Every kill criteria check that comes back "fail" gets surfaced to the operator within 24 hours.
4. The OS itself follows its own rules. It has a `kill-criteria.md`. It logs decisions. It reports its own model costs.
5. **Invoke `davids-way` before any non-trivial build task.** Every session.
6. **Invoke `session-context` or `vault-recall` before reading code.** Don't re-derive what the vault already knows.
7. **Session end protocol:** push to GitHub → `mc_update_project_status` → run `decisions-sync` if architecture changed.
8. **Never use `createServerSupabaseClient()` in server actions or API routes.** Always use `createAdminSupabaseClient()`.

---

## Last Updated

Initial draft: May 2026. Skills + vault + MCP server documented: June 2026. Agent roster added: June 2026. Context trim + `lean-code` skill: July 2026. Update on every meaningful decision.
