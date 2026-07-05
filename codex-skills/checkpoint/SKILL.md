---
name: checkpoint
description: Maintain compact-resilient task state for Codex. Use when the user says /checkpoint, when starting or resuming a non-trivial multi-step task, after compaction or /clear, before risky operations, or when work touches 2+ files and may need a fresh session handoff.
---

# Checkpoint

Maintain a small local checkpoint so future sessions do not re-derive state.

## File

Use `<project-root>/.claude/checkpoint.md` for cross-agent compatibility with David's Claude workflow. If a project strongly prefers neutral naming, use `.agents/checkpoint.md`, but default to `.claude/checkpoint.md`.

Verify the checkpoint path is gitignored before writing. If it is not ignored, ask before adding it to `.gitignore`.

## Update Timing

Refresh the checkpoint:

- After each subtask.
- Before risky or long-running operations.
- After decisions or gotchas.
- Before ending a session with in-flight work.

Overwrite rather than append. Keep it under about 60 lines.

## Template

```markdown
# Checkpoint - <task title>
updated: <ISO timestamp>

## Goal
<one sentence>

## State
- [x] completed item
- [ ] next item <- NEXT

## Key files
- path:line - why it matters

## Decisions made this session
- decision - why

## Gotchas already hit
- problem - fix

## Verbatim constraints
- exact user/project rule
```

## Resume Protocol

After compaction or cold resume:

1. Read checkpoint first.
2. Resume from `<- NEXT`.
3. Query Mission Control vault only if needed.
4. Do not re-read key files until you are about to edit one.

Delete the checkpoint only when the task is fully complete and closed out.

