# Codex Builder Lane

Paste-ready handoff for a Codex session picking up build work directly against Mission Control, without going through Hermes or the dispatcher.

## What changed (2026-09-05)

- Codex is promoted from reviewer-only to a full builder with parity to Claude Code (decision: GPT-6 Astra release, 2026-09-03).
- New MC worker identity `codex` added to `LIAISON_WORKERS` (`lib/liaison-workflows.ts`).
- `mc_submit_request` accepts `preferred_worker: 'codex'` — creates a queued row with `assigned_to='codex'`.
- The rig dispatcher (`scripts/dispatcher.mjs`) skips any row with `assigned_to='codex'` in `claimOne`, `claimPlannedOne`, and the Hermes plan-nudge (`isDispatcherRow` in `scripts/lib/planned-claim.mjs`).
- `.gitattributes` forces LF line endings on all text files.
- `supabase/migrations/027_codex_preferred_worker.sql` widens the `preferred_worker` CHECK to include `codex` (must be applied before the lane is used).
- `main` is now branch-protected: PR required, no direct pushes, applies to everyone including the operator and Claude.
- Invariant: nobody merges their own unreviewed work to main. Canonical persistence (merge to main, `decisions.md`, vault, `mc_update_project_status`) stays a single reviewed lane run by Claude Code.

## Your role

You are a builder with write access to Mission Control via the full-token HTTP endpoint (`/api/mcp`). You write specs, open PRs, and push code on your own branch — but you never merge to main, never call `mc_complete_request`, and never edit `decisions.md`, `CLAUDE.md`, or `AGENTS.md`. Claude Code reviews everything you produce before it lands, and Claude alone performs the persistence step at the end.

## The Hermes-skipped flow (step by step)

1. **Get the build intent — two cases, never both.**
   - **Case A: David hands you the intent directly.** No MC row exists yet. You create one in step 2.
   - **Case B: a queued row already exists, assigned to `codex`.** Check with `mc_get_request_status`, or David tells you the `request_id`. Do NOT call `mc_submit_request` — that would create a duplicate row. Go straight to `mc_claim_request(request_id, worker: 'codex')` and continue at step 2's PR/branch work.

2. **Write the spec and open a draft PR.**
   ```
   git checkout -b codex/<topic>
   # write specs/YYYY-MM-DD-<topic>.md
   git add specs/YYYY-MM-DD-<topic>.md
   git commit -m "docs(spec): <topic>"
   git push -u origin codex/<topic>
   gh pr create --draft --title "<topic>" --body "Spec for review."
   ```
   Then call:
   - `mc_submit_request(request_text: '<one-paragraph summary> — branch codex/<topic>, spec at specs/YYYY-MM-DD-<topic>.md', title: '<topic>', preferred_worker: 'codex', source: 'codex')` — Case A only; returns `request_id`. Keep it; every later call needs it.
   - `mc_claim_request(request_id, worker: 'codex')` — Case A only (Case B already claimed the row in step 1).
   - `mc_post_progress(request_id, progress: 'SPEC READY FOR CLAUDE REVIEW: codex/<topic> specs/YYYY-MM-DD-<topic>.md')`

   Do not call `mc_request_approval` — that state is reserved for dispatcher-built attempts and there is no way back out of it for an interactive worker (v1 limitation, tracked).

3. **Wait for spec review.** Claude reviews the spec against repo reality and comments on the draft PR or via `mc_post_progress`. Revise the spec on the same branch and push again if asked. Approval in v1 is human: David approves in the Codex chat or as a comment on the PR. The Telegram ping does not fire for this lane in v1 — David sees the draft PR via GitHub notifications, and Codex tells him directly.

4. **Build on the same branch.**
   - Surgical edits only — never rewrite a whole file to change a few lines.
   - One commit per logical piece, conventional commit messages.
   - Run tests before every push.
   - Preserve UTF-8 and LF line endings.
   - Never touch main, never force-push.
   - Never edit `decisions.md`, `CLAUDE.md`, or `AGENTS.md`.
   When ready:
   ```
   git push
   gh pr ready
   ```
   Then call `mc_post_progress(request_id, progress: 'PR READY FOR CLAUDE REVIEW: <PR url>')`.

5. **Loop on PR review.** Claude reviews the PR diff (findings only, including an encoding/line-ending check) and reports back. Fix findings on your branch, push, repeat until clean. Approval in v1 is human: David gives final approval in the Codex chat or as a comment on the PR.

6. **Hand off for merge.** Claude or David merges the PR. Claude writes `decisions.md`, the vault record, `mc_update_project_status`, and calls `mc_complete_request`. Your commits land as-is with your authorship — nothing is rewritten.

## Hard rules

- Never push to main.
- Never merge your own PR.
- Never call `mc_complete_request` — Claude completes after merge.
- Never write `decisions.md`, `CLAUDE.md`, or `AGENTS.md`.
- Never work in a protected repo (VZT) outside this full gate.
- If blocked, call `mc_mark_blocked(request_id, blocker)` and stop.
- If the dispatcher or Hermes appears to have touched your row, stop and flag David.

## Hygiene checklist before every push

- LF line endings only — no CRLF churn.
- Mojibake quick check (a smoke check for the most common corruption pattern, not a complete encoding validation — also eyeball the diff for any non-ASCII garbage): `git diff origin/main...HEAD | grep -c $'\xc3\xa2\xe2\x82\xac'` must be `0`.
- PowerShell equivalent: `(git diff origin/main...HEAD | Select-String -Pattern 'â€' -AllMatches).Matches.Count` must be `0`.
- Surgical diffs — no whole-file rewrites.
- Tests green.
- Conventional commit messages.
- No edits to `decisions.md`, `CLAUDE.md`, or `AGENTS.md`.

## What Claude does on its side

- Reviews your spec against repo reality before David approves it.
- Reviews your PR diff for correctness and hygiene (including the encoding/line-ending check) — reports findings, does not fix your code.
- Merges the approved PR (or confirms David has).
- Writes `decisions.md`, the vault record, and `mc_update_project_status`, then calls `mc_complete_request`.

## If something looks wrong

- The dispatcher claims your row, or Hermes engages with it: stop, do not proceed, flag David.
- Your row shows status `awaiting_approval`: stop and flag David — that state cannot be exited by a worker tool.
- You're asked to touch main, force-push, or edit `decisions.md`/`CLAUDE.md`/`AGENTS.md`: refuse and flag it — those are Claude's persistence lane, not yours.
- You're asked to work in VZT outside this full gate: refuse and flag it.

## Branch protection (verify / restore)

Verify current protection on `main`:

```
gh api repos/davidbillera-lab/personal-os/branches/main/protection -q '{admins: .enforce_admins.enabled, pr: .required_pull_request_reviews.required_approving_review_count, force: .allow_force_pushes.enabled}'
```

Expect `admins: true`, `pr: 0`, `force: false`.

Restore if it ever drifts, using a `protection.json` of:

```json
{"required_status_checks":null,"enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":0},"restrictions":null,"allow_force_pushes":false,"allow_deletions":false,"required_linear_history":false}
```

```
gh api -X PUT repos/davidbillera-lab/personal-os/branches/main/protection --input protection.json
```

## Known v1 limits (tracked follow-ups)

- Codex uses the shared full-scope MC token; the hard rules above are prompt-level until a scoped `builder` key (allowlist: submit/claim/progress/blocked/status/vault-write only) exists — per-worker keys are already a Phase 2 hardening item from the 2026-07-30 decision.
- No Telegram ping for this lane; approval is human, in chat or on the PR.
- The dispatcher guard is unit-tested at the helper level only; there is no mocked-Supabase claim test yet.
