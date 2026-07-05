---
name: claude-qc
description: Independent Claude quality-control review for Codex-built work. Use when the user says /ClaudeQC, asks for Claude QC, requests independent review before merge/ship, or when Codex finishes protected, high-risk, architecture-heavy, auth/payment/data, tenant-isolation, or multi-file changes. Uses Claude as the reciprocal reviewer to CodexQC.
---

# Claude QC

When Codex builds, Claude should review. Independence is the value.

## Model Routing

- Claude Opus: protected projects, VZT, auth, payments, tenant isolation, architecture, complex multi-file diffs, work where being wrong costs days.
- Claude Sonnet: normal feature QC, focused multi-file review, routine pre-merge sanity.
- Claude Haiku: summaries and cheap mechanical triage only.
- Fable: orchestration or synthesis layer if David is using it, not the primary code-review brain unless it is backed by the right Claude model and code context.

If the current session cannot call Claude directly, generate a paste-ready Claude QC brief.

## Review Scope

Collect the smallest useful scope:

- `git diff --stat`
- `git diff` or diff against the merge base
- `git status --short`
- Relevant `CLAUDE.md`, `AGENTS.md`, `decisions.md`, and protected-project rules
- Test/build output

Never include secrets or raw env values.

## Claude QC Prompt

Ask Claude to review as an independent senior engineer. Require findings first, ordered by severity, with file/line references where possible. Rubric:

- Functionality: does it work and meet the request?
- Regression risk: what could break?
- Efficiency: is it wasteful, overbuilt, or too expensive?
- Scalability: will it survive production, tenants, and data growth?
- Sellability/maintainability: would this scare a buyer or future maintainer?
- Security/secrets: any leaks, unsafe auth, RLS mistakes, or credential handling issues?
- Tests: what verification is missing?
- Protected-project constraints: VZT and College Climb gates when relevant.

Claude should report only. Codex verifies and fixes.

## Codex Handling Of Findings

Treat Claude's output as a peer review, not gospel:

1. Verify every blocking or should-fix item against the actual code.
2. Fix real issues with `davids-way`.
3. Ignore or note false positives with evidence.
4. Re-run focused checks.
5. If a task was tracked in Mission Control, include QC outcome in the status/handoff.

## Paste-Ready Brief Template

```markdown
# Claude QC Request

Model: Claude [Opus/Sonnet]
Project:
Directory:
Branch:

## Context
[What Codex built and why.]

## Protected Rules
[Relevant CLAUDE.md / AGENTS.md / decisions constraints.]

## Diff / Files
[Paste diff or changed-file summary.]

## Verification Already Run
[Commands and results.]

## Review Rubric
Find bugs, regressions, security issues, missing tests, scalability problems, and sellability/maintainability risks. Lead with findings by severity. Report only; do not edit.
```

