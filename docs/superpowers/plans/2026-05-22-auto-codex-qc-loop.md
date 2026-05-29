# Auto Codex QC Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Codex calls `mc_complete_task` with a GitHub commit URL, Mission Control automatically fetches the diff and runs QC — looping until the build passes or loop detection fires, then handing off to Claude Code via the natural task queue.

**Architecture:** A new `lib/github.ts` module exposes `fetchGitHubDiff`. The `mc_complete_task` handler in `lib/mcp-tools.ts` calls it when a commit URL is present, selects `runCodexQC` or `rerunCodexQCOnSpec` based on current `codex_qc_status`, and returns the QC result inline. The UI in `ProjectWorkspaceTabs.tsx` demotes the manual `CodexQCForm` to a collapsed fallback when a codex task has already had auto-QC run.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (service role), GitHub REST API (`application/vnd.github.diff`), GPT-4o via `routeTask`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/github.ts` | Create | `fetchGitHubDiff(commitUrl)` — parse URL, call GitHub API, return raw diff string |
| `lib/mcp-tools.ts` | Modify | Extend `mc_complete_task` to fetch diff + run QC when commit URL present |
| `components/ProjectWorkspaceTabs.tsx` | Modify | Demote `CodexQCForm` to collapsed fallback when auto-QC has run on a codex task |

---

## Task 1: Create `lib/github.ts`

**Files:**
- Create: `lib/github.ts`

- [ ] **Step 1: Create the file**

```typescript
export async function fetchGitHubDiff(commitUrl: string): Promise<string> {
  const match = commitUrl.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]+)/i)
  if (!match) throw new Error(`Invalid GitHub commit URL: ${commitUrl}`)
  const [, owner, repo, sha] = match
  const pat = process.env.GITHUB_PAT
  if (!pat) throw new Error('GITHUB_PAT not configured')
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
    {
      headers: {
        Accept: 'application/vnd.github.diff',
        Authorization: `token ${pat}`,
      },
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API error ${res.status}: ${body}`)
  }
  return res.text()
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this file).

- [ ] **Step 3: Commit**

```bash
git add lib/github.ts
git commit -m "feat: add fetchGitHubDiff helper"
```

---

## Task 2: Enhance `mc_complete_task` in `lib/mcp-tools.ts`

**Files:**
- Modify: `lib/mcp-tools.ts`

Context: The `mc_complete_task` handler is at line 140. It currently selects `project_id` and `agent_assigned_to` from the task. We need to also select `codex_qc_status` to know which QC function to call on resubmit.

- [ ] **Step 1: Add imports at the top of `lib/mcp-tools.ts`**

After the existing imports, add:

```typescript
import { fetchGitHubDiff } from '@/lib/github'
import { runCodexQC, rerunCodexQCOnSpec } from '@/app/(app)/projects/[id]/actions'
```

- [ ] **Step 2: Extend the task select in `mc_complete_task` to include `codex_qc_status`**

Find this line (around line 144–146):

```typescript
    const { data: task } = await supabase
      .from('tasks')
      .select('project_id, agent_assigned_to')
      .eq('id', task_id)
      .single()
```

Replace with:

```typescript
    const { data: task } = await supabase
      .from('tasks')
      .select('project_id, agent_assigned_to, codex_qc_status')
      .eq('id', task_id)
      .single()
```

- [ ] **Step 3: Add auto-QC logic after the handoff update, before the return**

Find this line (around line 169):

```typescript
    return JSON.stringify({ ok: true, completed_at: now })
```

Replace with:

```typescript
    // Auto-QC: fetch diff and run QC when a commit URL is provided
    if (github_commit_url && task?.project_id) {
      const currentQcStatus = (task as { codex_qc_status?: string | null }).codex_qc_status

      // Skip if loop already detected — terminal state
      if (currentQcStatus !== 'loop_detected') {
        try {
          const diff = await fetchGitHubDiff(github_commit_url)

          const isRerun = currentQcStatus === 'issues_found'
          const qcResult = isRerun
            ? await rerunCodexQCOnSpec(task_id, task.project_id, diff, github_commit_url)
            : await runCodexQC(task_id, task.project_id, diff, github_commit_url)

          if ('error' in qcResult && qcResult.error) {
            return JSON.stringify({ ok: true, completed_at: now, qc_error: qcResult.error })
          }

          return JSON.stringify({ ok: true, completed_at: now, qc_status: qcResult.status })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return JSON.stringify({ ok: true, completed_at: now, qc_error: msg })
        }
      }
    }

    return JSON.stringify({ ok: true, completed_at: now })
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke test via the MCP endpoint**

Start the dev server (`npm run dev`) and use the MCP playground or a curl command to call `mc_complete_task` with a real task ID and a valid GitHub commit URL from any repo. Confirm the response includes `qc_status`.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp-tools.ts
git commit -m "feat: auto-trigger Codex QC in mc_complete_task when commit URL present"
```

---

## Task 3: Update UI in `components/ProjectWorkspaceTabs.tsx`

**Files:**
- Modify: `components/ProjectWorkspaceTabs.tsx`

Context: In the In Flight section (around line 1072), `CodexQCForm` is always rendered. For codex tasks where auto-QC has already run (status is `passed`, `issues_found`, or `loop_detected`), demote the form to a `<details>` collapsed fallback. For non-codex tasks or tasks with no QC status yet, keep the form as primary.

- [ ] **Step 1: Replace the `CodexQCForm` render at line 1072**

Find:

```tsx
                        <CodexQCForm taskId={task.id} projectId={project.id} currentQcStatus={task.codex_qc_status ?? undefined} />
```

Replace with:

```tsx
                        {task.tool === 'codex' && task.codex_qc_status && task.codex_qc_status !== 'pending' ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[10px] text-gray-600 hover:text-gray-400 select-none">
                              Run QC manually
                            </summary>
                            <div className="mt-2">
                              <CodexQCForm taskId={task.id} projectId={project.id} currentQcStatus={task.codex_qc_status} />
                            </div>
                          </details>
                        ) : (
                          <CodexQCForm taskId={task.id} projectId={project.id} currentQcStatus={task.codex_qc_status ?? undefined} />
                        )}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Visual verify in browser**

- Open a project workspace that has a task in `review` status with `tool = 'codex'` and a non-null `codex_qc_status`
- Confirm: QC badge + notes are visible; the form is collapsed under "Run QC manually"
- Open a project workspace with a task in `review` with no QC status yet (or `tool = 'claude_code'`)
- Confirm: full manual form still renders as primary

- [ ] **Step 4: Commit**

```bash
git add components/ProjectWorkspaceTabs.tsx
git commit -m "feat: demote manual CodexQCForm when auto-QC has already run"
```

---

## Self-Review

**Spec coverage:**
- ✅ `fetchGitHubDiff` — Task 1
- ✅ `mc_complete_task` auto-trigger — Task 2
- ✅ `codex_qc_status` routing (null/pending → `runCodexQC`, `issues_found` → `rerunCodexQCOnSpec`, `loop_detected` → skip) — Task 2, Step 3
- ✅ QC result returned inline in response JSON — Task 2, Step 3
- ✅ Task completion never blocked by QC failures (try/catch returns `qc_error`) — Task 2, Step 3
- ✅ Claude Code handoff — natural: when QC passes, task goes to `done`, next `mc_get_pending_tasks` poll returns next pending task. No code needed.
- ✅ UI demotes manual form when auto-QC ran — Task 3
- ✅ Non-codex tasks keep manual form as primary — Task 3, Step 1 (else branch)

**Placeholder scan:** None found.

**Type consistency:**
- `fetchGitHubDiff` returns `Promise<string>` — consumed directly in Task 2
- `runCodexQC` / `rerunCodexQCOnSpec` return `{ status, notes } | { error }` — both branches handled in Task 2, Step 3
- `codex_qc_status` typed as `string | null` from the extended select — cast handled inline
