# Phase I — Second Brain Infrastructure Design

**Date:** 2026-05-17
**Status:** Approved — ready for implementation planning
**Operator:** David Billera
**Project:** Mission Control (personal-os)

---

## Problem Statement

Mission Control after Phase H is a status board — it knows what projects exist and what agents have done. It does not function as a second brain. Specifically:

- No single view shows the health of all projects at once
- There is no way to access project context from a phone or different machine without opening multiple VS Code terminals
- API keys are scattered across per-project `.env.local` files — agents must ask for credentials or they are pasted in manually
- Skills live at `~/.claude/skills/` locally — no cloud-accessible registry
- The model/tool catalog is outdated relative to what's already documented in CLAUDE.md and decisions.md files
- The Build Partner chat is a basic LLM with no tools — it cannot read GitHub files, create tasks, or dispatch agents

The operator runs ~10 active projects simultaneously and describes the current experience as "bouncing between 8 VS Code terminals." The OS should be the single surface that removes that context-switching cost.

---

## What Gets Built in Phase I

### Surface 1 — Command Center (new top-level page, `/`)

The default landing page replaces the project grid dashboard. Everything visible at a glance without navigating.

**Health Summary Bar (top)**
- Total active projects
- Projects in Build / Ship stage
- Active agents (count of in-progress agent_handoffs)
- Awaiting operator action (tasks with status = spec_ready, no agent assigned)
- Blocked (projects with non-empty blockers field)
- Alert badges: blocked projects named explicitly; tasks ready to claim; healthy projects

**Project Grid**
- All projects, tiered (Tier 1 pinned top, purple stripe; Tier 2 blue; Tier 3 gray)
- Per card: project name, stage badge, tier badge, health badge, health dots (GitHub / Vercel / Supabase), one-line status, next_action block, last agent name, VS Code deep link, time since last update
- Click → navigates to Mission Brief (per-project workspace)
- Tier 1 projects always shown first; within tier, sorted by last_update desc

**Health Dots**
- Three dots per project: GitHub (last successful push), Vercel (latest deployment status), Supabase (connectivity check)
- Green / yellow / red based on status from periodic background check
- Implemented as on-demand fetch triggered on Command Center page load, cached for 5 minutes — not real-time websocket, not a background cron in Phase I

**Credentials Vault Quick-View Panel**
- Shows global keys (masked) with MCP badge indicating agent-accessible
- Shows project-specific keys (masked, labeled by project)
- Link to full `/vault` page
- No plain-text key display in UI ever

**Live Agent Activity Panel**
- Active and recent agent_handoffs rows
- Status: Active (animated), Review, Done
- Quick-dispatch control: pick project + agent → generates a Mission Brief link + marks task as claimed

**Navigation**
- New nav links: Command Center (home `/`), Inbox, Orchestrate, Vault, Skills
- The current "Projects" nav link is removed — Command Center IS the project list. Individual project pages remain at `/projects/[id]` (Mission Brief).
- Sidebar icons mirror nav for compact navigation

---

### Surface 2 — Mission Brief (enhanced per-project workspace)

The existing `/projects/[id]` workspace, redesigned for remote handoff. The goal: any agent starting cold can open this page and have everything it needs to begin work.

**Tab structure (replacing current 3-tab layout):**
1. **Mission Brief** — the handoff document
2. **Brain Dumps** — existing (unchanged)
3. **Tasks** — existing (unchanged)
4. **Handoff Log** — agent history for this project (from agent_handoffs table)

**Mission Brief tab content:**
- Health panel: GitHub/Vercel/Supabase status dots + last check time + direct links to each (Vercel dashboard URL, Supabase dashboard URL, GitHub repo URL stored per-project)
- Context Package: CLAUDE.md viewer (fetched from GitHub), decisions.md viewer, kill-criteria.md viewer — already partially implemented, extend to all three files
- Credentials pointer: lists which keys this project uses (names only, no values) with link to Vault page — agents use MCP to fetch actual values
- Active agent: current_agent field, claimed_at, link to the task being worked
- Next action: prominent display of next_action field
- Blockers: if non-empty, shown in red alert box
- Model routing: lead_model + complexity_tier from project record
- VS Code link: existing implementation kept
- Agent dispatch: same dispatch control as Command Center, scoped to this project

**What this enables remotely:**
- Phone or other machine: open MC → see project state → read CLAUDE.md → see next action → dispatch agent
- Agent starting cold: open Mission Brief URL → read CLAUDE.md → claim task → begin work

---

### Surface 3 — Credentials Vault (`/vault`)

Two-tier encrypted key store. Agents pull keys via MCP — they are never exposed in plain text in the UI.

**Tier 1 — Global (reusable across all projects)**
- Anthropic API Key
- OpenAI API Key
- Google Gemini API Key
- GitHub Personal Access Token
- MCP_API_KEY (Mission Control's own MCP auth token)
- Any other keys used by 2+ projects

**Tier 2 — Project-specific**
- Keyed by project_id
- Any key specific to one project: Stripe secret, project Supabase service key, Vercel API token, etc.

**Schema** (new `credentials` table):
```sql
CREATE TABLE credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  key_name    TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,  -- encrypted at rest via Supabase Vault or pgcrypto
  tier        TEXT NOT NULL CHECK (tier IN ('global', 'project')),
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  is_mcp_accessible BOOLEAN DEFAULT true,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**UI:**
- List view: name, key_name, masked value (last 4 chars), tier, project tag, MCP badge
- Add/edit via modal (value only visible on explicit reveal, never in list)
- Delete with confirmation

**MCP tool** (new): `mc_get_credential({ key_name: string })` — returns plain-text value to the calling agent. Requires valid Bearer token. Logs access to a `credential_access_log` table (who, when, which key).

**Security posture:**
- Values encrypted in Supabase (pgcrypto or Vault)
- Never logged to console or model_costs table
- MCP access logged with agent name + timestamp
- No plain-text exposure in UI list view

---

### Surface 4 — Skills Registry (`/skills`)

Read-only view of skills available to agents. Requires `~/.claude/skills/` to be in a GitHub repo first — that is a prerequisite step before this surface has live data.

**What it shows:**
- List of all skills (from GitHub repo, fetched via GitHub API)
- Per skill: name, description (from frontmatter), file path, last commit date
- Markdown preview of the full skill content
- Filter by type (user, feedback, project, reference) if skills follow the memory file convention
- Copy skill invocation command: `Skill({ skill: "skill-name" })`

**Implementation:**
- GitHub API call to list `~/.claude/skills/` (or equivalent repo path)
- Same pattern as existing CLAUDE.md fetching — read file content from GitHub API
- No write capability in Phase I — registry is read-only; skills are still authored locally

**Prerequisite (operator action required before this surface works):**
Put `~/.claude/` or `~/.claude/skills/` into a GitHub repo and store the repo URL in a new `settings` table or `.env.local` var (`CLAUDE_SKILLS_REPO`). This is a one-time setup step.

---

### Surface 5 — Build Partner Chat Upgrade

The existing per-project chat panel gets tool use. Planning and orchestration can happen in MC without opening a terminal.

**New tools available to Build Partner:**
- `read_github_file(path)` — fetch any file from the project's GitHub repo (CLAUDE.md, decisions.md, any source file)
- `list_github_files(path)` — list files in a directory of the project repo
- `create_task(title, description, complexity_tier)` — create a task record in Supabase
- `generate_spec(task_id)` — trigger spec generation for a task
- `get_project_context()` — return full project state (same as mc_get_project_context MCP tool)
- `get_credential(key_name)` — fetches credential server-side and injects it into the agent's next tool call context; the raw value is never returned as a chat message and is not stored in the conversation history or model_costs log
- `list_agent_handoffs()` — show recent agent sessions for context

**Model routing for chat:**
- Default: Sonnet 4.6 (Tier 2) — reasoning and planning tasks
- Operator can escalate to Opus 4.7 via toggle for architecture decisions
- Haiku 4.5 for simple lookups (context fetch, status checks)

**What this enables:**
- "What's the next thing to build on College Climb?" → Build Partner reads CLAUDE.md, decisions.md, tasks table → answers with context
- "Create a task to wire Stripe webhooks" → creates task, generates spec, marks as spec_ready
- "What keys does this project need?" → fetches from Vault (not exposed in chat history)
- Cannot write files — execution still requires local Claude Code or Codex

**What it does NOT replace:**
- File writing / code editing → local Claude Code
- Multi-file refactors → local Claude Code
- Running tests → local Claude Code

The split is: **MC = ideate / plan / spec / dispatch / track. Local = execute.**

---

## Data Model Changes

**New table: `credentials`** — see schema above

**New table: `credential_access_log`**
```sql
CREATE TABLE credential_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name    TEXT NOT NULL,
  accessed_by TEXT NOT NULL,  -- agent name or 'ui'
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New table: `project_health`**
```sql
CREATE TABLE project_health (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  github_status TEXT CHECK (github_status IN ('ok', 'warn', 'error', 'unknown')),
  vercel_status TEXT CHECK (vercel_status IN ('ok', 'warn', 'error', 'unknown')),
  supabase_status TEXT CHECK (supabase_status IN ('ok', 'warn', 'error', 'unknown')),
  checked_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**New columns on `projects`:**
- `vercel_url TEXT` — deployed app URL (for health check + links)
- `supabase_project_id TEXT` — for Supabase dashboard deep links
- `github_repo TEXT` — already potentially exists; confirm and add if missing

**New MCP tool: `mc_get_credential`** — added to existing `/api/mcp/route.ts`

---

## What This Does NOT Include (Phase II+)

- `/advisoryboard` skill hardwired into brain dump flow — skill must be built first
- Real-time websocket health monitoring — Phase I uses on-demand checks
- Write capability in Skills Registry — read-only in Phase I
- Google Calendar / Gmail integration — deferred per prior decision
- Multi-user / team access — single-operator for now
- Mobile-native app — responsive web covers the phone use case

---

## Build Order

1. **Migration 007** — credentials table, credential_access_log, project_health, new project columns
2. **lib/types.ts** — add Credential, ProjectHealth interfaces; add vercel_url, supabase_project_id to Project
3. **Credentials Vault page** — `/vault` page + CRUD UI + new MCP tool `mc_get_credential`
4. **Command Center page** — new `/` route with health bar, project grid, vault panel, agent activity panel
5. **Mission Brief tab** — redesign Overview tab in ProjectWorkspaceTabs: health panel, context package, credentials pointer, blockers alert
6. **Build Partner tools** — wire tool use into ProjectChat component
7. **Skills Registry page** — `/skills` read-only view (requires operator to set up GitHub repo first)
8. **Health check cron** — lightweight background check that writes to project_health table

---

## Success Criteria

- Open MC from phone browser → see all project statuses, next actions, blockers in under 3 seconds
- Agent starts cold → opens Mission Brief → reads CLAUDE.md + decisions.md in-page → sees next action → can claim a task → all without opening a terminal
- Global API key changed → updated in Vault once → all projects use new key via MCP (no `.env.local` hunting)
- Build Partner answers "what should I build next on VZT?" using live GitHub data, not stale training
