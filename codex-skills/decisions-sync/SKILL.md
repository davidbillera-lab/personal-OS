---
name: decisions-sync
description: Capture architectural and product decisions after Codex work in David's portfolio. Use at session end when architecture, dependencies, auth, payments, data flow, AI model routing, protected-project constraints, or meaningful product direction changed. Updates decisions.md and, when available, Mission Control.
---

# Decisions Sync

Write down the why when future agents would be confused by code alone.

## Invoke When

Use this if the session included:

- Choosing between architectures.
- Adding, removing, or swapping a dependency.
- Changing auth, payments, data flow, AI calls, model routing, or tenant boundaries.
- Discovering a hidden constraint and working around it.
- Changing product, validation, kill criteria, or exit-readiness direction.

Skip it for routine implementation details, formatting, simple bug fixes, or status updates.

## Entry Format

Append to `decisions.md` using the project's existing style. If no style exists, use:

```markdown
### YYYY-MM-DD - Short title

**Decision:** What was decided.
**Reasoning:** The real constraint, tradeoff, or operator preference.
**Consequence:** What future agents must know to avoid reversing it.
**Made by:** Codex
```

One entry per decision. Do not bundle unrelated decisions.

## Mission Control

If MCP tools are available, also update MC with:

- Current status: one sentence.
- Next action: specific enough for a cold agent to start.

Do not store secrets in decisions or MC status fields.

## Commit Discipline

If the user asked to commit/push, include `decisions.md` in a small logical commit. Do not sweep unrelated files into the commit.

