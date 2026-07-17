# AGENTS.md - Codex Operating Guide for Personal OS

Generated from `CLAUDE.md` and the repo implementation so Codex can work in this project with the same context and discipline expected of Claude Code.

`CLAUDE.md` remains the canonical project narrative. This file adapts it into Codex-facing instructions. If this file and `CLAUDE.md` disagree, treat `CLAUDE.md`, `decisions.md`, and the newest user instruction as the source of truth.

## Identity And Mission

This repo is Personal OS, also called Mission Control: a portfolio operating system for David Billera's AI-native holding company.

Mission Control project id: `698d6376-5819-400b-babc-cd664ee36c04`.

JSG Estate Liquidators is the cash-flowing parent. The portfolio includes multiple SaaS and agency plays such as VZT, REELFLOW, Marblism agency work, FlipRadar, and College Climb.

This is not a personal productivity app. It is the connective tissue of a future holdco. Optimize work here for:

- Velocity of validated builds: ideas become specs, then working code, quickly.
- Ruthless killing of bad ideas: kill criteria must surface reality early.
- Exit-readiness: projects should be tracked against metrics that acquirers care about.

The operator has many projects in motion. Mission Control exists so each build does not need to re-explain itself every session.

## First Principles

- Repos are the source of truth. Mission Control reflects project state; it does not own it.
- Every serious project should have `CLAUDE.md`, `kill-criteria.md`, and `decisions.md`.
- The OS must follow its own rules: maintain decisions, respect kill criteria, log model costs, and keep project context durable.
- VZT and College Climb are protected priority projects. VZT gets special care because it is the production multiplier and expected revenue engine.
- Do not re-derive context that Mission Control's vault already stores. Recall first, then read targeted files.
- Treat mentions of Claude in project docs as behaviorally applying to Codex unless editing source text was explicitly requested.

## Codex Session Startup

At the start of meaningful work in this repo:

1. Read this file.
2. Read `CLAUDE.md` for canonical project context.
3. Skim `decisions.md` for recent architectural decisions that could affect the task.
4. Use Mission Control MCP tools if available:
   - `mc_get_project_context` for live project status.
   - `mc_get_vault_context` for semantic recall.
   - `mc_browse_vault` for recent/history browsing.
   - `mc_get_vault_item` only after search/browse returns a specific item id worth opening.
5. If MCP tools are unavailable, use local repo files as the fallback source of truth and say so if it matters.

Stay token-lean: search or browse first, fetch full vault items only when needed, and avoid broad rereads when a targeted file read will do.

## Core Surfaces

Mission Control v1 revolves around three surfaces:

- Project Status Dashboard: tiered project view with stage, blockers, last update, next action, kill criteria status, and priority badges.
- Brain Dump Inbox: single capture point for ideas, tasks, bugs, decisions, and kill candidates. Classification routes entries to the right project or flags new projects.
- Build Orchestration: turns validated ideas into context-loaded specs and recommends tool/model/runtime handoff.

## Tech Stack

- Frontend: Next.js App Router, currently Next 16, React 19, TypeScript.
- Styling: Tailwind CSS v4, shadcn-style components, `lucide-react`.
- Backend: Supabase Postgres/auth/storage; service-role server access through admin client.
- Deployment: Vercel.
- Models: Anthropic, OpenAI, and Gemini behind model routing.
- Embeddings: OpenAI `text-embedding-3-small`.
- MCP: local stdio server at `mcp-server.mjs`; HTTP fallback at `app/api/mcp/route.ts`.

Useful commands:

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm test`
- `npm run sync:agents`

## Supabase Rules

Use `createAdminSupabaseClient()` for server actions, API routes, and server components that need project data. Do not introduce `createServerSupabaseClient()` in server actions or API routes unless a new explicit architectural decision changes the RLS model.

Reason: `@supabase/ssr` can forward user cookies as authorization and silently apply RLS using the user role even when a service role key is passed. The plain admin client bypasses RLS correctly.

Current core tables include:

- `projects`
- `brain_dumps`
- `decisions`
- `tasks`
- `model_costs`
- `kill_criteria_checks`
- `credentials`
- `vault_items`

## Vault And Memory

The vault is the cross-session memory layer in `vault_items`. It stores durable context such as decisions, specs, agent sessions, brain dump mirrors, knowledge, skills, and agents.

Important behavior:

- `captureToVault()` writes a vault row, then tries to embed it. Embedding failure is non-fatal.
- New auto-captured vault rows are not MCP-accessible by default.
- MCP semantic search only returns non-encrypted, non-personal, MCP-accessible items.
- Encrypted items embed title only; encrypted content must never be sent to embedding APIs.
- Use the two-step MCP pattern: search/browse previews first, then fetch one full item by id.

Vault item types include:

- `credential`
- `skill`
- `agent`
- `personal`
- `knowledge`
- `git_push`
- `file_snapshot`
- `brain_dump_mirror`
- `ab_conversation`
- `build_spec`
- `mcp_event`
- `agent_session`
- `decision_log`

## Credentials And Secrets

Credentials live in the `credentials` table, encrypted with AES-256-GCM. The key is `CREDENTIAL_ENCRYPTION_KEY` in environment only. Losing that key makes stored credentials unreadable.

Rules:

- Never copy raw secrets into docs, commits, AGENTS.md, `decisions.md`, or vault content.
- Never store credential values in `vault_items`.
- Use `mc_get_credential` only when a credential is explicitly needed, MCP-accessible, and appropriate for the current task. It is a privileged/write-scoped tool because it returns secrets.
- Use `mc_capture_credential` for credential storage through MCP; it writes encrypted credential rows, not vault rows.
- `.env.local`, `.mcp.json`, and `.claude/settings.local.json` may contain sensitive operational configuration. Read only when needed; do not print values.
- On Windows, MCP token propagation through OS environment variables can be unreliable. Claude's setup stores MCP API key material in local settings. For Codex, respect whatever connector/tooling is available in the session.

## MCP Tools

Mission Control exposes these main MCP capabilities when configured:

- `mc_get_project_context`: live status, next action, blockers, lead model, current agent.
- `mc_update_project_status`: session-end status updates.
- `mc_get_pending_tasks`: generated specs waiting for work.
- `mc_claim_task`: claim a task and create handoff state.
- `mc_complete_task`: mark work complete and record outcome/commit URL.
- `mc_get_vault_context`: semantic vault search with short previews.
- `mc_browse_vault`: browse recent vault items, optionally by type.
- `mc_get_vault_item`: fetch one full non-encrypted vault item by id.
- `mc_list_skills` / `mc_get_skill`: discover and fetch operator workflow skills stored in vault.
- `mc_list_agents` / `mc_get_agent`: discover and fetch reusable subagent definitions.
- `mc_write_vault` / `mc_update_vault`: create or update vault memory.
- `mc_get_credential` / `mc_capture_credential`: privileged credential access and storage.

There are two MCP implementations:

- `mcp-server.mjs`: local stdio transport, used to avoid Vercel cold starts.
- `app/api/mcp/route.ts` plus `lib/mcp-tools.ts`: HTTP fallback for external clients.

When changing MCP tool contracts or behavior, keep both implementations in sync unless intentionally deprecating one.

## Active Skills From The Claude Environment

The Claude environment stores workflow skills in `~/.claude/skills/` and syncs them into the vault via `scripts/sync-skills.mjs`. Codex may not have these as native skills, but should honor their protocols when the task calls for them.

- `davids-way`: use before non-trivial build tasks. Model tier audit, targeted reads, plan-first approval gate in Claude, and one-commit-per-piece discipline.
- `vault-recall`: use at session start or cold pickup; pull prior decisions/specs/knowledge before touching code.
- `session-context`: session-start protocol: vault search, recent decisions, credentials, project status.
- `mission-control`: read MC context at start; update MC status at close.
- `decisions-sync`: if architecture changed, update `decisions.md`, commit/push as appropriate, and sync MC.
- `checkpoint`: maintain resumable state around multi-step work and compaction.
- `CodexQC`: independent GPT-5.x second-opinion review before merge or via `/CodexQC`; reports only.
- `advisoryboard`: accountability panel for pivots and business decisions; verdict first.
- `handoff`: produce project handoff briefs from MC/vault/checkpoint.
- `phase-relay`: serial multi-agent relay for long phased builds.
- `davids-agents`: context evaluation gate and subagent relay for heavy sequential work.
- `handoff-summary`: paste-ready summary of current session state.
- `lean-code`: on-demand Output Token Discipline — pre-write ladder plus a review mode that flags over-engineering in diffs, ranked by lines saved.

For Codex, map these to available Codex skills/tools and local judgment. If no equivalent tool exists, follow the behavior manually and be explicit about the fallback.

## Codex Skills

Codex-native workflow skills for David's portfolio live in this repo under `codex-skills/` and should be installed globally to `C:\Users\david\.codex\skills\` for runtime discovery.

The repo copy is the source of truth; the global copy is the active install.

Current Codex skills:

- `jsg-build-routing`: thin router for slash-style triggers and task complexity.
- `mission-control-context`: MC/vault/session startup context.
- `davids-way`: core build methodology for non-trivial work.
- `codex-relay`: serial relay and handoff workflow for large sequential builds.
- `checkpoint`: compact-resilient local task state.
- `decisions-sync`: durable decision logging.
- `advisoryboard`: accountability panel.
- `self-improving-ai`: correction capture, distill, and re-inject loops.
- `claude-qc`: independent Claude review for Codex-built work.

When David invokes Claude-style commands such as `/davids-way`, `/davids-agents`, `/phase-relay`, `/checkpoint`, `/handoff`, `/advisoryboard`, or `/ClaudeQC`, treat them as triggers for the matching Codex skill. If the skill is not installed in the current Codex runtime, read the matching file from `codex-skills/<name>/SKILL.md` and follow it manually.

## Agent Roster

Reusable subagents live in `agents/*.md`. That directory is the repo source of truth.

`npm run sync:agents` does two things:

- Upserts each agent into `vault_items` as type `agent`, tagged by crew and embedded for semantic search.
- Copies each agent into `~/.claude/agents/` for global Claude Code discovery.

Crew assignment lives in `scripts/sync-agents.mjs`, not in agent frontmatter.

Core agents:

- `code-reviewer`: second-opinion branch/diff review; reports, never fixes.
- `qa-verifier`: tests and smoke checks with evidence.
- `session-auditor`: transcript review for token waste, rereads, and compaction causes.
- `spec-writer`: brain dump or idea to agent-ready spec.
- `doc-writer`: operator docs and beginner runbooks.
- `researcher`: market signal, comps, competitor scans.
- `copywriter`: human-voice copy pass.
- `seo-geo-auditor`: SEO and AI-answer-engine readiness.
- `kill-criteria-examiner`: kill criteria verdicts; no rescuing bad ideas.
- `exit-readiness-scorer`: due-diligence style score out of 100.
- `codex-agent`: converts docs such as `CLAUDE.md` into reusable agent specs.

## Protected Project Rules

VZT:

- Tier 1, protected, pinned priority.
- Medium protection is active now: Codex second-opinion review before merge, staging Supabase first, critical-path automated tests, mandatory `decisions.md` for architecture changes.
- Heavy protection triggers before first paying tenant: feature flags, manual approval gates, daily health monitoring, tenant isolation testing, incident response playbook.
- Documentation must support JJ as emergency maintainer and Vinnie as execution-only recovery operator.

College Climb:

- Light workflow until validation completes.
- Phase 1: JJ real-data smoke test.
- Phase 2: 5-10 high schoolers plus 2-3 parents.
- Phase 3: iterate on top issues.
- Phase 4: ship workflow activates.
- Do not treat it as validated or shipping-ready before those gates.

## Output Token Discipline (all agents, all tools)

Output tokens cost ~5x input. Gate BEFORE generating — review-after-the-fact pays for the bloat twice. Full callable version: `lean-code` skill (`~/.claude/skills/lean-code/SKILL.md`, also in the vault as type `skill`).

Pre-write ladder — stop at the first rung that holds:

1. YAGNI — not asked for = not built.
2. Reuse — the codebase may already have it; grep before you generate.
3. Stdlib / platform — the language or platform may already provide it.
4. Installed deps — a package already in the project may solve it.
5. One line — can this be a one-liner?
6. Minimum — write the smallest working diff.

Output rules: edit, never rewrite full files; don't echo written code back into chat (reference file:line); one implementation, not a menu of options; no unrequested artifacts (READMEs, docstrings, example files); plans and summaries sized to the task; one runnable check for non-trivial logic; mark intentional shortcuts with a `minimal:` comment.

Never trim: problem comprehension, input validation at trust boundaries, error handling that prevents data loss, security, accessibility, explicitly requested features.

## Build And Product Discipline

- Keep edits surgical and tied to the user request.
- Prefer existing project patterns over new abstractions.
- Do not introduce Lovable, Make, Zapier, or n8n into the OS itself.
- For any meaningful architecture decision, update `decisions.md`.
- For kill criteria failures, surface the failure clearly and quickly.
- For generated specs and meaningful session outcomes, capture durable context to MC/vault when tools are available.
- If the task spans multiple sequential pieces, consider a handoff/relay approach instead of forcing everything through one overloaded context.

## UI And UX Direction

This is an operator command surface, not a marketing page.

- Prioritize dense, scannable, restrained interfaces.
- Make repeated workflows efficient.
- Keep dashboard/card data clear: stage, blockers, next action, last update, kill status, and tier matter.
- Use clean components and icons. Avoid decorative noise.
- Explain enough for a non-developer operator to act without babysitting the UI.

## Hermes Ambient Layer (read-only)

Hermes is Mission Control's ambient layer — always-on alert delivery + Telegram replies, not a peer builder. Operational boundary for Codex sessions:

- Hermes connects to MC over the **read-scope** token only (HTTPS `/api/mcp`, `MCP_READONLY_API_KEY`). It cannot call `mc_get_credential` or any write tool. Do not grant it the full token or broaden its access without an explicit operator decision (see `decisions.md` 2026-07-12 + 2026-07-16).
- Alert **delivery** is serverless (Vercel cron → `/api/alerts/digest` → Telegram) and has no Hermes dependency. Do not move delivery into Hermes.
- Detail: `specs/2026-07-16-hermes-ambient-layer-design.md`.

## Session End Protocol

For substantive work, close the loop:

1. Run focused checks (`npm test`, `npm run lint`, `npm run build`, or narrower commands as appropriate).
2. Summarize changed files and verification.
3. If architecture changed, update `decisions.md`.
4. If MCP is available, update project status with `mc_update_project_status`.
5. If committing/pushing is part of the user's workflow for the task, commit intentionally and push the current branch. Do not push unrelated changes.

Codex must still follow higher-priority system/developer/user instructions. If the user explicitly says not to touch files, do not mutate files except for the specific file they asked to create or edit.
