# Auto Codex QC Loop — Design Spec

**Date:** 2026-05-22
**Status:** Approved
**Scope:** Mission Control — auto-trigger Codex QC when a task enters review via mc_complete_task

---

## Problem

Today's Codex QC requires the operator to manually paste a GitHub diff into the CodexQCForm and click Run. When Codex finishes a task and calls `mc_complete_task`, nothing happens automatically — the operator has to notice the review status, navigate to the project workspace, find the task, and run QC manually. This breaks the autonomous loop.

---

## Goal

When Codex calls `mc_complete_task` with a `github_commit_url`, Mission Control automatically fetches the diff from GitHub and runs QC server-side. Codex receives the QC result inline in the response. No operator action required in the happy path.

---

## Data Flow

```
Codex → mc_complete_task(taskId, outcome, githubCommitUrl)
  1. task.status = 'review'
  2. agent_handoffs row written (as today)
  3. if githubCommitUrl present:
       a. Parse owner/repo/sha from URL
       b. GET github.com/repos/{owner}/{repo}/commits/{sha}
          Accept: application/vnd.github.diff
          Authorization: token GITHUB_PAT
       c. Check current task.codex_qc_status:
            null | 'pending'   → runCodexQC(taskId, projectId, diff, commitUrl)
            'issues_found'     → rerunCodexQCOnSpec(taskId, projectId, diff, commitUrl)
            'loop_detected'    → skip (terminal — do not re-run)
       d. Return { ok: true, task_id, qc_status: 'passed' | 'issues_found' | 'loop_detected' }
  4. if no githubCommitUrl: return { ok: true, task_id } as today (no QC run)
```

Codex reads `qc_status` from the response to decide whether to iterate or stop.

---

## Loop Detection

`rerunCodexQCOnSpec` (already implemented) sets `loop_detected` when:
- Task was already `issues_found` AND
- Re-run also returns issues

Once `loop_detected`, `mc_complete_task` skips QC entirely on any further calls. The operator sees `loop_detected` in the UI and intervenes manually.

---

## Files Changed

### `lib/github.ts` (new)

Single exported function:

```typescript
export async function fetchGitHubDiff(commitUrl: string): Promise<string>
```

- Parses `https://github.com/{owner}/{repo}/commit/{sha}` — throws on invalid URL
- Calls `GET https://api.github.com/repos/{owner}/{repo}/commits/{sha}` with `Accept: application/vnd.github.diff`
- Uses `process.env.GITHUB_PAT`
- Throws descriptive error if PAT missing, URL invalid, or GitHub returns non-200

Rationale: the Ship page's `triggerGitHubWorkflow` already does inline URL parsing — this consolidates the pattern into one place.

### `lib/mcp-tools.ts`

Enhance `mc_complete_task`:
- After writing to `agent_handoffs`, check if `github_commit_url` is present
- Call `fetchGitHubDiff(github_commit_url)`
- Select QC function based on current `codex_qc_status`
- Await result, append `qc_status` to response JSON
- On diff-fetch failure: log the error, return `{ ok: true, task_id, qc_error: message }` — don't fail the task completion itself

### `components/ProjectWorkspaceTabs.tsx`

Light update to `review`-status task cards:

- **If `task.tool === 'codex'` and QC has run** (`codex_qc_status` is not null/pending):
  - Promote `QCStatusBadge` + show `codex_qc_notes` inline in the card
  - Demote `CodexQCForm` to a collapsed "Run manually" fallback (operator can still override)
- **Otherwise** (claude_code task, or no commit URL, or status is pending):
  - Keep existing manual `CodexQCForm` as primary — no change

---

## Error Handling

| Failure | Behavior |
|---|---|
| `GITHUB_PAT` not set | Return `{ ok: true, qc_error: 'GITHUB_PAT not configured' }` — task completes, QC skipped |
| Invalid commit URL | Return `{ ok: true, qc_error: 'Invalid GitHub commit URL' }` — task completes, QC skipped |
| GitHub API non-200 | Return `{ ok: true, qc_error: 'GitHub API error: {status}' }` — task completes, QC skipped |
| QC function throws | Catch, return `{ ok: true, qc_error: message }` — task completes, QC skipped |

Task completion is never blocked by QC failures — the agent's work is recorded regardless.

---

## Schema Changes

None. `codex_qc_status`, `codex_qc_notes`, and `github_commit_url` columns already exist.

---

## Out of Scope

- Auto-triggering QC for `claude_code` or `cursor` tasks (those go through the manual form)
- Hermes / OpenClaw connectors (deferred — agents not yet running)
- Surfacing QC results in the dashboard home view (future enhancement)
