# Mission Control — Pipeline Redesign Design Spec
**Date:** 2026-05-20
**Status:** Approved for implementation

---

## Problem

The current Mission Control UI is a read-only display board. It shows project state but provides no way to act on it. The operator cannot run a project from beginning to ship without leaving MC and manually re-explaining context to agents every session.

---

## Goal

MC becomes the planning surface for all projects. VS Code + Claude Code is the execution surface. The handoff between them is seamless — one button, zero re-explanation.

**The mental model:**
- MC = plan mode (everything before writing code)
- VS Code / Claude Code = build mode (everything after the plan is approved)

---

## The Full Pipeline

```
Brain Dump submitted
    ↓
Advisory Board session (inline — honest kill/keep verdict with reasoning)
    ↓ [survives]
MC generates spec (context-loaded: CLAUDE.md + decisions.md + relevant file refs + task)
    ↓
Operator reviews + approves spec
    ↓
MC recommends tool + model tier (operator can override)
    ↓
Operator approves → "Open in VS Code" button
    ↓
VS Code opens at project root, Claude Code chat pre-loaded with spec as first message
    ↓
Claude Code executes
    ↓
Codex (GPT-5.5) QCs output + debugs loops
    ↓
Completion logged to Handoff Log in MC
```

---

## Where the Pipeline Lives

**Option C: Dashboard routes, Project executes.**

- **Dashboard:** One pipeline status card per project. Shows current stage, pending dumps, what's in flight. "Run Pipeline" button drops into the project workspace at the correct stage.
- **Project workspace:** The actual work surface. Stage-based sidebar navigation + main panel for the active stage.
- **Orchestrate:** Retired as a separate surface. Its function is absorbed into the Dashboard pipeline cards.

---

## Key Surfaces

### 1. Dashboard

Each project card shows:
- Project name, tier badge, stage badge
- Pipeline summary: `X dumps · Y spec ready · Z in flight`
- Blocker or status note (e.g., "Codex QC pending", "Advisory board verdict pending")
- **"Run Pipeline →"** button — opens project workspace at the active stage

Global quick capture at the bottom of the dashboard:
- Single text input: "What's on your mind?"
- Submitting creates a brain dump and triggers advisory board evaluation
- Project assignment happens via Haiku classification (operator can override)

### 2. Project Workspace

Three-column layout:

**Left sidebar — Pipeline stages:**
- Dumps (badge: count of unreviewed)
- Spec Review (badge: count awaiting approval)
- In Flight (badge: count of active executions)
- Done
- Divider → Context section: Mission Brief, Handoff Log, Health

**Main panel — Active stage content:**

*Dumps stage:*
- Each dump card shows: raw text, Haiku-assigned type tag (bug / idea / task / decision), project assignment
- Advisory Board verdict rendered inline under each dump: verdict (Keep / Kill) + reasoning
- If Kill: full argument explaining why the idea doesn't work — no sugarcoating
- If Keep: "Approve → Generate Spec" button

*Spec Review stage:*
- Generated spec rendered in full: context bundle (CLAUDE.md excerpt, decisions.md excerpt, relevant file paths, task description)
- Edit inline or approve as-is
- Tool recommendation (Claude Code / Codex / Cursor) with reasoning
- Model tier recommendation (1–4) with reasoning — operator can override either
- **"Open in VS Code →"** button — triggers handoff

*In Flight stage:*
- Task title, dispatched timestamp, model/tool used
- Codex QC status: pending / passed / issues found
- If issues: Codex feedback rendered inline
- Link to GitHub commit when complete

*Done stage:*
- Historical log of completed tasks with outcomes

**Right sidebar — Build Partner:**
- Persistent Claude chat scoped to the current project
- Aware of pipeline stage, current dump/task in focus
- Can pull relevant files, suggest clarifications, answer questions about the codebase

---

## Advisory Board Integration

- Triggered automatically on every brain dump submission
- Runs as an inline session within the dump card (not a separate page)
- Uses the `/advisoryboard` skill
- Outputs a structured verdict:
  - **Keep** + reasoning (why it's worth building, what to watch for)
  - **Kill** + argument (why it won't work, what specific problem it has)
- Operator can override either verdict — but the argument is always shown
- Kill verdicts are stored and visible in the dump history for reference

---

## Spec Generation

When operator approves a dump from the advisory board:

1. MC bundles context automatically:
   - Project `CLAUDE.md` (full)
   - Project `decisions.md` (full)
   - Haiku-identified relevant file paths based on task description
   - Task description (raw dump + any AB refinements)
   - Recommended model tier + reasoning

2. Spec is written to `docs/superpowers/plans/<task-slug>.md` in the project repo

3. Operator reviews in the Spec Review stage — can edit inline or approve as-is

---

## VS Code Handoff

When operator hits "Open in VS Code →":

1. MC writes the finalized spec to `docs/superpowers/plans/<task-slug>.md`
2. Opens VS Code at the project root: `code <absolute-project-path>`
3. Pre-loads Claude Code chat with the spec as the opening message — Claude Code starts with full context, no re-explanation required

The operator never hunts for the project folder. The operator never re-explains context. Claude Code opens already knowing what it's building and why.

---

## Codex QC

After Claude Code commits:

1. MC calls Codex (GPT-5.5) with: the diff, the original task spec, and the project's CLAUDE.md
2. Codex reviews for: correctness, regressions, scope adherence, code quality
3. Result surfaces in the In Flight card:
   - **Passed** — task moves to Done automatically
   - **Issues found** — issues listed inline, operator decides whether to re-run or override
4. If issues cause a loop (Claude Code → Codex → Claude Code repeatedly), MC surfaces the loop alert and pauses for operator input

---

## Navigation Changes

- Remove `Orchestrate` from the nav — its cross-project queue function is replaced by Dashboard pipeline cards
- Nav becomes: **Dashboard · Inbox · Vault**
- `Inbox` remains as a raw capture surface (bulk entry, no project context required yet)

---

## Data Model Additions

New fields / tables needed:

- `brain_dumps.ab_verdict` — `keep | kill | pending`
- `brain_dumps.ab_reasoning` — text of the advisory board argument
- `tasks.spec_path` — path to the generated spec file in the repo
- `tasks.tool` — recommended/selected tool (`claude_code | codex | cursor`)
- `tasks.model_tier` — 1–4
- `tasks.codex_qc_status` — `pending | passed | issues_found | loop_detected`
- `tasks.codex_qc_notes` — Codex review output
- `agent_handoffs.spec_path` — links handoff record to the spec that drove it

---

## Out of Scope (this phase)

- Email / calendar integration (deferred per original OS design)
- Voice brain dump capture
- Multi-user roles (Vinnie access)
- Mobile-native view (responsive web is sufficient for now)
- Automated GitHub webhook triggers (Codex QC is manually triggered post-commit in v1)
