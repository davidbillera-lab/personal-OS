---
name: codex-relay
description: Serial relay workflow for Codex on David's large sequential builds. Use when the user says /davids-agents, /phase-relay, asks for a handoff, or when a build has 3+ dependent pieces, 5+ large files across steps, prior compaction thrash, or needs one fresh context per piece. Adapts davids-agents, phase-relay, david-loop, step-by-step, and handoff-summary.
---

# Codex Relay

Keep the lead context thin. Each heavy piece gets a focused brief, verification, and a handoff.

## Decide Relay Or Single Window

Use relay when:

- The plan has 3+ dependent sequential pieces.
- Steps must happen in order and each depends on the previous being correct.
- The task would require reading 5+ large files across steps.
- A prior attempt hit compaction or context thrash.
- David explicitly invokes `/davids-agents` or `/phase-relay`.

Use a single window for 1-2 light steps.

## Relay Modes

- Tool mode: if Codex multi-agent tools are available, spawn one fresh subagent per piece.
- Manual mode: if subagents are unavailable, write a self-contained brief and complete one piece at a time in the current session, refreshing checkpoint/handoff state between pieces.

Never pretend subagents exist. If unavailable, use manual mode and say so briefly.

## Piece Plan

For each piece, define:

- Title and purpose.
- Files to read.
- Files to modify.
- Exact task.
- Verification command or observable result.
- Model tier if another agent/model will run it.

Only one piece can be in progress at a time.

## Subagent Or Manual Brief

Use this structure:

```markdown
# Relay Piece N of M

## Project
- Name:
- Directory:
- Branch:
- Stack:

## Starting State
[Prior handoff summary or "Piece 1 starts from current branch."]

## Your Job
[One focused task.]

## Files To Read
- path: why

## Files To Modify
- path: exact intended change

## Done When
[Concrete verification.]

## Do Not Touch
[Out-of-scope files/areas.]

## Required Final Handoff
Return what changed, verification run, commit if any, gotchas, and exact next step.
```

## Verify Between Pieces

After each piece:

1. Read the returned handoff.
2. Check changed files or run focused verification.
3. Update the todo/checkpoint state.
4. Do not launch the next piece on an unverified foundation.

## Handoff Summary Format

```markdown
## Handoff Summary - Piece N: [title]

**What was done:**
[2-4 sentences.]

**State of the build:**
- Done:
- Next:
- Gotchas:

**Files modified:**
- path: change

**Verification:**
- command/result

**Key context:**
[Non-obvious facts that save rereads.]
```

