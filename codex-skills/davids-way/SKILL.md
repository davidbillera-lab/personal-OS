---
name: davids-way
description: David Billera's Codex build methodology. Use when the user says /davids-way, asks to build/plan/fix a non-trivial feature, or when work touches 2+ files, creates a new feature, involves unknown bugs, architecture, protected projects, or multi-step implementation. Enforces tier audit, targeted reads, plan-first execution, verification, and small commits.
---

# David's Way For Codex

Follow this for non-trivial JSG portfolio work.

## Step 0: Model Tier Audit

Classify the task before work:

- Tier 1: classification, formatting, extraction, summaries, simple status checks.
- Tier 2: specs, code review, most build tasks, multi-step planning.
- Tier 3: architecture, complex multi-file debugging, novel system design.
- Tier 4: specialty work: code QC by an independent model, image/video, social trend signal, browser-heavy QA.

If the current model/tooling is clearly mismatched, tell David in one line and recommend the better route. If he says proceed, proceed.

## Step 0.5: Task Isolation

Do not mix unrelated old cleanup with a new build. If there is an in-flight checkpoint or unfinished task in scope, finish or explicitly park it before starting the new one.

## Step 1: Targeted Reads Only

Read the minimum file set. Use `rg` first when you do not know where a symbol, route, table, or component lives. Prefer 2-5 relevant files over broad directory sweeps.

Never read every agent, skill, migration, or component file just to feel oriented. Let `AGENTS.md`, `CLAUDE.md`, `decisions.md`, and MC/vault carry the broad context.

## Step 2: Plan First

Before implementation, state:

- What already exists.
- Exact files to create or modify.
- What changes go in each file.
- How each piece will be verified.
- Whether the work fits one window or needs `codex-relay`.

For low-risk tasks, this can be short. For protected projects or architecture changes, make it explicit.

## Step 3: Approval Gate

When the task is large, high-risk, destructive, or the user asked to plan first, wait for approval before editing. For ordinary requested implementation work, proceed after sharing the plan unless the user has asked to stop at planning.

## Step 4: Build In Order

Implement one logical piece at a time. Verify each piece before moving on. Use the existing codebase patterns. Avoid speculative abstractions.

If there are 3+ sequential heavy pieces or 5+ large files across steps, use `codex-relay` rather than carrying the whole build in one context.

## Step 5: Close The Loop

Run focused verification. Report failures honestly. If architecture changed, use `decisions-sync`. If the user asked for commits/pushes, commit small logical pieces and push the current branch without including unrelated work.

