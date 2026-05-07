# BUILD-SPEC.md — Mission Control v1

**Location:** `personal-os/BUILD-SPEC.md` (committed to repo root, alongside `CLAUDE.md`)
**Purpose:** Executable build specification for Claude Code (and any other agent assigned to this build). Defines what to build, in what order, with what architecture, and with what success criteria.
**Audience:** Primarily Claude Code. Operator reads this to know what to expect.
**Read first:** `~/.claude/CLAUDE.md` (operator profile) and `personal-os/CLAUDE.md` (project context) before starting any work in this spec.

---

## What You're Building

A portfolio operating system — "Mission Control" — for an AI-native holding company. The operator (David Billera) runs ~10 distinct projects across JSG Estate Liquidators and adjacent ventures. Mission Control gives him one surface to see all of them, capture ideas without losing them, and orchestrate builds across multiple AI tools.

**Three core surfaces in v1:**

1. **Project Status Dashboard** — tiered view of all portfolio projects
2. **Brain Dump Inbox** — single capture point with auto-classification
3. **Build Orchestration** — generates context-loaded specs and routes them to the right tool/model

Everything else is v2+. Resist scope creep. Ship v1 first.

---

## Architecture Decisions (Already Made — Don't Re-Litigate)

- **Frontend:** Next.js 14+ (App Router) deployed on Vercel
- **Backend:** Supabase (Postgres + auth + edge functions + storage)
- **Auth:** Supabase Auth, email/password to start, single operator user for v1
- **Model APIs:** Anthropic SDK + OpenAI SDK + Gemini SDK behind a unified `/api/route-task` endpoint
- **GitHub integration:** GitHub REST API via Octokit for reading repo content and CLAUDE.md files
- **Styling:** Tailwind CSS + shadcn/ui components (operator likes clean, doesn't want to babysit UI)
- **Hosting:** Vercel for the app; Supabase project for backend; GitHub for source of truth
- **TypeScript:** Yes, strict mode. Operator is not a developer; type safety prevents subtle bugs.

**Explicitly rejected for the OS itself:**
- Lovable (clashes with multi-agent GitHub pushes)
- Make/Zapier/n8n (fragile node-based workflows)
- Server-side rendering complexity beyond what Next.js gives by default

---

## Repo Structure (Create This)

```
personal-os/
├── README.md
├── CLAUDE.md                    # Already drafted by operator
├── BUILD-SPEC.md                # This file
├── decisions.md                 # Empty to start; log decisions as you make them
├── kill-criteria.md             # Empty to start; create from template
├── .env.example                 # Document required env vars
├── .gitignore
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── /app
│   ├── layout.tsx
│   ├── page.tsx                 # Dashboard (default landing)
│   ├── /inbox
│   │   └── page.tsx             # Brain Dump Inbox
│   ├── /projects
│   │   ├── page.tsx             # Project list
│   │   └── /[id]
│   │       └── page.tsx         # Single project detail
│   ├── /orchestrate
│   │   └── page.tsx             # Build Orchestration
│   └── /api
│       ├── /route-task
│       │   └── route.ts         # Model routing endpoint
│       ├── /classify
│       │   └── route.ts         # Brain dump classifier (Haiku)
│       ├── /github
│       │   └── route.ts         # GitHub repo + CLAUDE.md reader
│       └── /spec
│           └── route.ts         # Build spec generator
├── /components
│   ├── /ui                      # shadcn/ui components
│   ├── ProjectCard.tsx
│   ├── BrainDumpInput.tsx
│   ├── BrainDumpItem.tsx
│   ├── KillCriteriaBadge.tsx
│   └── ToolRecommendation.tsx
├── /lib
│   ├── supabase.ts              # Supabase client
│   ├── /models
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   └── router.ts            # Model selection logic
│   ├── github.ts
│   └── types.ts
└── /supabase
    ├── /migrations              # SQL migrations
    └── /functions               # Edge functions if needed
```

---

## Data Model — Build These Tables First

All tables include `created_at TIMESTAMPTZ DEFAULT NOW()` and `updated_at TIMESTAMPTZ DEFAULT NOW()` unless noted.

### `projects`

```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  protected BOOLEAN DEFAULT FALSE,
  stage TEXT NOT NULL CHECK (stage IN ('idea', 'spec', 'build', 'ship', 'scale', 'kill')),
  status TEXT,
  description TEXT,
  repo_url TEXT,
  claude_md_url TEXT,
  last_update TIMESTAMPTZ DEFAULT NOW(),
  next_action TEXT,
  blockers TEXT,
  kill_criteria_status TEXT CHECK (kill_criteria_status IN ('pass', 'warning', 'fail', 'exempt')),
  exit_thesis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `brain_dumps`

```sql
CREATE TABLE brain_dumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text TEXT NOT NULL,
  classified_type TEXT CHECK (classified_type IN ('idea', 'task', 'bug', 'decision', 'kill_candidate', 'unclassified')),
  classification_confidence FLOAT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'inbox' CHECK (status IN ('inbox', 'reviewed', 'actioned', 'archived', 'spec_generated')),
  ai_summary TEXT,
  source TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `decisions`

```sql
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  reasoning TEXT,
  decision_date DATE DEFAULT CURRENT_DATE,
  made_by TEXT DEFAULT 'operator',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `tasks`

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  brain_dump_id UUID REFERENCES brain_dumps(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  complexity_tier INTEGER CHECK (complexity_tier IN (1, 2, 3, 4)),
  recommended_tool TEXT,
  recommended_model TEXT,
  generated_spec TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'review', 'done', 'killed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `model_costs`

```sql
CREATE TABLE model_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  brain_dump_id UUID REFERENCES brain_dumps(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd DECIMAL(10, 6),
  purpose TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `kill_criteria_checks`

```sql
CREATE TABLE kill_criteria_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  check_date DATE DEFAULT CURRENT_DATE,
  functionality_score INTEGER CHECK (functionality_score BETWEEN 0 AND 5),
  efficiency_score INTEGER CHECK (efficiency_score BETWEEN 0 AND 5),
  scalability_score INTEGER CHECK (scalability_score BETWEEN 0 AND 5),
  time_to_revenue_score INTEGER CHECK (time_to_revenue_score BETWEEN 0 AND 5),
  verdict TEXT CHECK (verdict IN ('pass', 'warning', 'fail')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Seed Data — Insert These Projects on First Migration

```sql
-- Tier 1: Cash + Scale (protected)
INSERT INTO projects (name, slug, tier, protected, stage, repo_url, exit_thesis) VALUES
  ('Vendor Zen Tool', 'vzt', 1, TRUE, 'scale', 'https://github.com/davidbillera-lab/vendor-zen-tool', 'Multi-tenant SaaS productization — strategic acquirer'),
  ('REELFLOW', 'reelflow', 1, TRUE, 'build', NULL, 'Multi-tenant marketing automation SaaS'),
  ('JSG Operations', 'jsg-ops', 1, FALSE, 'scale', NULL, 'Cash-flowing parent business');

-- Tier 2: Active builds with exit potential
INSERT INTO projects (name, slug, tier, protected, stage) VALUES
  ('Deal Finder + Garage Sale Hunter', 'deal-finder', 2, FALSE, 'build'),
  ('Marblism Agency', 'marblism', 2, FALSE, 'build'),
  ('Auction House US Scale', 'auction-scale', 2, FALSE, 'idea');

-- Tier 3: Personal / family with upside
INSERT INTO projects (name, slug, tier, protected, stage, repo_url, exit_thesis) VALUES
  ('College Climb', 'college-climb', 3, FALSE, 'build', 'https://github.com/davidbillera-lab/college-compass-ui', '1M users — 5x baseline / 10x stretch exit'),
  ('KDP Publishing Pipeline', 'kdp', 3, FALSE, 'idea', NULL, 'Nicole-led; automation-friendly'),
  ('AI Receptionist Business', 'ai-receptionist', 3, FALSE, 'build', NULL, 'JJ-led; trade business B2B');
```

---

## The Three Core Surfaces — Build Order

Build in this order. Don't start surface 2 until surface 1 ships locally.

### Surface 1 — Project Status Dashboard (`/`)

The default landing page after login. The operator should see his entire portfolio in one glance.

**Layout:**
- Header: "Mission Control" + operator name + sign-out
- Three columns by tier (Tier 1 / Tier 2 / Tier 3)
- Each column shows project cards
- Tier 1 protected projects pinned at top of Tier 1 column with a shield badge
- Each card displays: project name, stage badge, last update, next action, kill criteria status (color-coded: green/yellow/red/gray-exempt), and a click-to-detail
- Top of page: "Brain Dump" quick-input (always available — operator should never need to navigate to capture an idea)

**Functionality:**
- Read all projects from `projects` table
- Click card → navigate to `/projects/[id]`
- Status badges color-coded
- Brain dump submit → POSTs to `/api/classify` → inserts to `brain_dumps` → toast confirmation

**Done criteria:**
- All seed projects render correctly
- Brain dump from dashboard creates a new entry and classifies it
- Tier 1 protected projects visually distinct
- Mobile-responsive (operator uses mobile via Cowork)

### Surface 2 — Brain Dump Inbox (`/inbox`)

Where ideas, tasks, bugs, and decisions go to be triaged.

**Layout:**
- List view of all brain dumps with status = 'inbox'
- Each item shows: raw text, AI-generated summary, classified type badge, suggested project (if matched), created timestamp
- Filters: by classification type, by project, by status
- Each item has actions: assign to project, change classification, generate spec, archive, dismiss

**Functionality:**
- New brain dumps default to `status = 'inbox'`
- Haiku classifies on insert (via `/api/classify`)
- Operator can override classification
- "Generate spec" action → calls `/api/spec` → creates a `tasks` row with generated spec
- "Archive" → status = 'archived', stays queryable for history

**Done criteria:**
- Inbox shows all unactioned brain dumps
- Classification works automatically
- Operator can route a brain dump to a project in one click
- Spec generation produces a usable handoff document

### Surface 3 — Build Orchestration (`/orchestrate`)

Where validated ideas become builds with the right tool + model assigned.

**Layout:**
- Top: list of tasks with status `pending` or `in_progress`
- Each task shows: title, project, complexity tier, recommended tool, recommended model, generated spec preview
- Click task → expanded view with full spec, "Copy spec to clipboard" button, "Mark in progress / done / killed" actions
- Side panel: model cost summary for the current month (per project breakdown)

**Functionality:**
- Tasks created from brain dump "Generate spec" action OR manually
- Recommended tool logic (see Tool Routing below) — runs at task creation, can be overridden
- Recommended model based on `complexity_tier`
- Generated spec includes: project context (loaded from `CLAUDE.md` via GitHub API), task description, success criteria, model + tool recommendation, cost estimate
- Copy-to-clipboard formats the spec ready to paste into Claude Code / Codex / Manus

**Done criteria:**
- Operator can take a brain dump → spec → ready-to-paste instructions in under 60 seconds
- Spec includes loaded CLAUDE.md context
- Cost dashboard accurately reflects API usage

---

## The Model Router — `/api/route-task`

This is the heart of the cost discipline. **Build it right; everything else depends on it.**

**Input:**

```json
{
  "prompt": "string",
  "complexity_tier": "1 | 2 | 3 | 4",
  "purpose": "string",
  "project_id": "string (optional)",
  "task_id": "string (optional)",
  "preferred_provider": "anthropic | openai | gemini (optional)",
  "needs_vision": "boolean (optional)",
  "needs_realtime": "boolean (optional)"
}
```

**Routing logic:**
- Tier 1 → `claude-haiku-4-5` (default) | `gemini-2.5-flash` if `needs_vision`
- Tier 2 → `claude-sonnet-4-6`
- Tier 3 → `claude-opus-4-7`
- Tier 4 → specialty:
  - `needs_vision` + image-heavy → Gemini multimodal
  - `needs_realtime` → Grok (placeholder for now; not connected v1)
  - Code review second-opinion → GPT-5 / Codex (placeholder; manual handoff v1)

**Behavior:**
- Returns the response + token counts + cost estimate
- Logs every call to `model_costs` with project/task attribution
- If the model fails, falls back ONE tier down (never up — never silently spend more than the operator sanctioned)
- Errors return clear messages, not silent failures

**Cost calculation:**
- Use current published per-million-token pricing for each model
- Hardcode a constants file `/lib/models/pricing.ts` — easy to update
- Calculate `cost_usd` on every call

**Don't:**
- Don't default to Opus for "safety." That's the exact behavior we're preventing.
- Don't auto-escalate without explicit operator config.
- Don't silently swap providers without logging the swap.

---

## The Brain Dump Classifier — `/api/classify`

Called automatically on every new brain dump.

**Model:** Haiku (Tier 1). Always. This is high-volume, low-stakes classification — it must stay cheap.

**Prompt template:**

```
You are classifying a brain dump from a business operator. Classify it as one of:
- idea (new project or feature concept)
- task (something to do on an existing project)
- bug (something broken on an existing project)
- decision (a choice that's been made and should be logged)
- kill_candidate (something the operator is considering killing)

Also: identify which project it likely belongs to from this list: {project_list}.

If unsure, return project_id = null and classified_type = 'unclassified'.

Return JSON only:
{
  "classified_type": "...",
  "project_slug": "..." | null,
  "ai_summary": "one-sentence summary",
  "confidence": 0.0-1.0
}

Brain dump:
"""
{raw_text}
"""
```

**Behavior:**
- Returns parsed classification
- Updates the `brain_dumps` row with classification, project_id (resolved from slug), summary, confidence
- Logs cost to `model_costs`
- Confidence < 0.6 → leaves classified_type = 'unclassified' for operator review

---

## Tool Routing Logic

For Build Orchestration. Recommends Claude Code / Codex / Manus / Lovable / Cursor based on task profile.

**Heuristics (simple rules, no AI call needed):**
- New build, multi-file, requires deep codebase context → **Claude Code**
- Code review / second opinion on Claude Code's work → **Codex**
- Web automation / multi-step browser task / data scraping → **Manus**
- Quick UI prototype, throwaway → **Lovable**
- Hands-on IDE work, pair programming → **Cursor / Antigravity**
- Browser automation against admin panels (DOA, marketplace logins) → **Claude in Chrome**

**Implementation:** Simple rule engine in `/lib/tool-router.ts`. No AI call. Operator can override.

---

## GitHub Integration — `/api/github`

Reads CLAUDE.md and other project context files from connected repos.

**v1 scope:**
- GET `/api/github?repo=<repo>&path=<path>` — returns file content
- Used by Build Orchestration to load project CLAUDE.md when generating specs
- Octokit + Personal Access Token (operator provides via env var)

**Don't build yet:**
- Webhook handlers
- Bidirectional sync (OS writing back to repos)
- Branch/PR automation

These are v2. v1 is read-only.

---

## Environment Variables (Document in `.env.example`)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI Providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=

# GitHub
GITHUB_PERSONAL_ACCESS_TOKEN=
GITHUB_USERNAME=davidbillera-lab

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Build Sequence — Do This In Order

### Phase A — Foundation (target: working skeleton)

1. Initialize Next.js 14 + TypeScript + Tailwind + shadcn/ui
2. Set up Supabase project, write migrations, run them
3. Configure auth (Supabase Auth, single user for v1)
4. Create `/lib/supabase.ts` client + types from schema
5. Build the layout shell with navigation (Dashboard / Inbox / Orchestrate)
6. **Checkpoint:** Operator can sign in and see empty dashboard.

### Phase B — Dashboard (Surface 1)

7. Build `ProjectCard` component
8. Build dashboard page with three-column tier layout
9. Insert seed projects via migration
10. Wire up project list query
11. Add inline brain dump input on dashboard
12. **Checkpoint:** Dashboard renders all projects, tiered, color-coded.

### Phase C — Model Router (the brain)

13. Build `/lib/models/pricing.ts` with current prices
14. Build `/lib/models/router.ts` with tier-based routing
15. Build provider adapters (`anthropic.ts`, `openai.ts`, `gemini.ts`)
16. Build `/api/route-task/route.ts` endpoint
17. Build `/api/classify/route.ts` using router
18. Test: send a brain dump, verify classification + cost logging
19. **Checkpoint:** Brain dumps from dashboard get classified and cost-logged automatically.

### Phase D — Brain Dump Inbox (Surface 2)

20. Build `/inbox` page with filtered list view
21. Build `BrainDumpItem` component with action buttons
22. Implement assign-to-project, override classification, archive
23. **Checkpoint:** Operator can triage inbox and route items to projects.

### Phase E — Build Orchestration (Surface 3)

24. Build `/api/github/route.ts` with Octokit
25. Build `/api/spec/route.ts` — loads CLAUDE.md + brain dump → generates spec via Sonnet (Tier 2)
26. Build `/orchestrate` page with task list
27. Build `ToolRecommendation` component
28. Wire up "Generate spec" action from Inbox → creates task → appears on Orchestrate page
29. Implement copy-to-clipboard for generated specs
30. Build cost dashboard side panel (monthly view, per-project)
31. **Checkpoint:** Brain dump → spec → ready-to-paste in Claude Code, in under 60 seconds.

### Phase F — Polish & Ship to Vercel

32. Loading states, error states, empty states
33. Mobile responsive review (operator uses mobile via Cowork)
34. Deploy to Vercel
35. Configure production environment variables
36. Smoke test in production
37. **Checkpoint:** Mission Control is live. Operator dogfoods for one week before adding features.

---

## What's Explicitly NOT in v1

Resist scope creep. These are v2 or later:

- Email integration (Marblism EVA covers gap)
- Calendar integration
- DOA / LiveAuctioneers / marketplace admin automation (browser agents — separate project)
- Multi-user / team features (Vinnie, JJ access — single user v1)
- Webhooks / bidirectional GitHub sync
- Voice input (text-only inbox v1)
- Mobile apps (web responsive only)
- Per-tenant features for VZT/REELFLOW (those projects' own work, not the OS)
- Kill criteria automation (manual entry v1; auto-checks in v2)
- Daily briefing / digest emails (v2)
- Multiple-acquirer-metric tracking dashboard (v2 — once a project ships)
- Real-time updates / websockets (polling fine for v1)

---

## Success Criteria for v1

Mission Control v1 is shipped when **all** of these are true:

1. Operator can see all 9 seed projects on the dashboard, correctly tiered, in under 2 seconds
2. Operator can capture a brain dump from any page in under 5 seconds
3. Brain dumps are auto-classified and cost-logged within 3 seconds of submission
4. Operator can take a brain dump → ready-to-paste spec for Claude Code in under 60 seconds
5. Cost dashboard correctly shows monthly spend per project per model
6. Mobile (Cowork-relevant) usage works for capture + dashboard view
7. Deployed to Vercel with custom domain (or Vercel default subdomain)
8. `decisions.md` has been updated with at least 3 build-time decisions made by Claude Code during the build

---

## Standing Rules for the Build

1. **Read the project `CLAUDE.md` and `~/.claude/CLAUDE.md` before writing code.** Always.
2. **Cost discipline applies to your own work.** Use Sonnet for most of this build. Use Opus only for architecture decisions or genuinely complex problems. Don't burn tokens on boilerplate.
3. **Log every architectural decision in `decisions.md`** with date and reasoning.
4. **If something is unclear, mark a TODO and proceed.** Don't stall the operator with questions that can be resolved during the build. Document the assumption in `decisions.md` so it's reviewable.
5. **Test the model router thoroughly.** This is the most cost-impactful piece in the OS. A bug here burns money on every call.
6. **Customer-facing copy gets a human voice pass.** The OS is operator-facing, but anything that goes to email/notifications (v2) follows global rules.
7. **Single-user simplification is fine for v1.** Don't pre-build multi-user complexity. Vinnie + JJ access is v2.
8. **No silent fallbacks.** If a model fails, log the failure clearly. Don't swap providers without operator visibility.

---

## Open Questions Acceptable to Resolve During Build

These can be decided by Claude Code at implementation time. Document the decision in `decisions.md`.

- Specific shadcn/ui component choices for cards and buttons
- Exact color palette (use Tailwind defaults to start; operator can theme later)
- Specific Tailwind class patterns for tier badges
- Exact JSON schema for the spec generator output (just make it useful)
- Whether to use Server Components or Client Components for each page (default: Server Components, escalate as needed)
- Specific error messages and toast wording
- Empty state copy

---

## Things That Need Operator Input Before Build Starts

Operator: confirm or provide these before handing the spec to Claude Code.

1. **GitHub Personal Access Token** with `repo` scope for `davidbillera-lab` org. Add to env.
2. **Anthropic API key** (separate from Claude.ai subscription). Add to env.
3. **OpenAI API key.** Add to env.
4. **Google AI API key** for Gemini. Add to env.
5. **New Supabase project** for the OS — separate from VZT's Supabase. Add URL + keys to env.
6. **Vercel account** linked to GitHub — confirm ready.
7. **Domain** — use Vercel default subdomain for v1, custom domain v1.5? Operator decides.
8. **Where the spec should be pasted** — Claude Code in VS Code on operator's local machine? Or a different agent?

---

## After v1 Ships — The Roadmap

Don't build any of this in v1. But here's what's next, so the architecture stays compatible:

- **v1.1:** Voice input on inbox; daily digest email
- **v1.2:** Email integration (Gmail MCP); kill criteria auto-checks
- **v1.3:** Multi-user (Vinnie execution-tier access; JJ operator-tier on protected projects)
- **v2.0:** Browser agent integration (DOA, marketplace admins via Claude in Chrome)
- **v2.1:** Per-tenant cost tracking for VZT/REELFLOW once multi-tenant ships
- **v2.2:** Acquirer-readiness scorecard (College Climb-led, then templated)
- **v3.0:** Bidirectional GitHub sync (OS writes back to CLAUDE.md / decisions.md)

---

## Last Updated

Initial draft: May 2026. Update as the build progresses and reality teaches us things the spec missed.
