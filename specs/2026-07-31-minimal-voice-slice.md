# Spec — Minimal Voice Slice (v0: Voice → built → QC'd → approve-by-voice → pushed)

**Status: build spec — execute in a FRESH window, phased (phase-relay). Do NOT build in the HQ window.**
**Parent:** `specs/2026-07-31-autonomous-execution-engine.md` · **Gated by:** `specs/2026-07-31-phase0-spike-report.md` (Phase 0 = QUALIFIED GO). `decisions.md` 2026-07-31.

## Why this exists
Phase 0 proved the executor link (headless Claude builds → `/CodexQC` → fix → **approval-gated push**, gate holds both ways). But the full voice loop can't run: three hops are unbuilt — the **approval relay** (ChatGPT can't return an "approve" to MC), the **Telegram approval ping**, and the **dispatcher** that launches a worker from a queued request. This spec builds the **smallest vertical slice** that makes the loop real, with **Claude as the only worker** — no Hermes, no multi-model builder, no capability registry. Those swap in later per the parent spec; they are NOT prerequisites for the first working voice demo.

## The v0 loop (what will actually work when this ships)
```
Voice → ChatGPT → mc_submit_request → queued          [EXISTS]
  → Dispatcher (rig, event-driven) claims → phase=building
      provisions isolated scratch workspace
      launches: claude -p "<build request_text> → run CodexQC → fix → test → commit (NO push)"
  → Dispatcher: mc_request_approval(kind=push) → awaiting_approval
      → Telegram ping "Request X wants to push: <title>. Approve via ChatGPT Voice."
  → You (voice): ChatGPT calls mc_respond_approval(approve|reject)   [NEW — Piece 2]
      approve → phase=pushing → Dispatcher runs the gated push → mc_complete_request
      reject  → blocked / cancelled (workspace held or torn down)
```
Everything the executor does happens in a scratch dir whose `.claude/settings.json` **denies `git push`+`gh`** — the worker structurally cannot push. Only the dispatcher, after `approval.granted`, performs the push. (Exactly the Phase-0 boundary.)

## Build order — 4 pieces, sequential (each: build → test → [deploy for MCP] → verify)

### Piece 1 — Migration 020 (minimal columns + realtime)
Add to `mc_requests` (nothing else from Phase-2 schema yet):
```sql
ALTER TABLE mc_requests
  ADD COLUMN IF NOT EXISTS phase         TEXT,         -- building|qc|fixing|review|pushing (observability)
  ADD COLUMN IF NOT EXISTS approved_by   TEXT,
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workspace_ref TEXT,         -- path/URL of the scratch workspace
  ADD COLUMN IF NOT EXISTS attempt_id    UUID,         -- current workflow attempt; approval binds to this
  ADD COLUMN IF NOT EXISTS reviewed_sha  TEXT;         -- the commit QC'd + shown for approval; the push must match it
-- Dispatcher event source (no cron): let it subscribe to row changes.
ALTER PUBLICATION supabase_realtime ADD TABLE mc_requests;
-- Note: attempt_id/reviewed_sha can instead live in a small mc_request_attempts
-- table if you prefer a history of attempts; v0 columns-on-request is fine.
```
**Deferred (fast-follow, NOT v0):** `plan jsonb`, `spend_usd`, `spend_cap_usd`, `model_requested`, `capability_registry` table, `mc_log_spend`. v0 substitutes a hard wall-clock/timeout backstop for the spend cap.

### Piece 2 — `mc_respond_approval` tool  (the approval relay)
Per **[[mcp-tool-placement]]** update **all three**: `lib/mcp-tools.ts`, `scripts/mcp-server.mjs` (stdio `tools[]`), and confirm `app/api/mcp/route.ts` `isToolAllowed` lets a liaison call it.
- **Args:** `request_id` (req), `decision` (req, `approve|reject`), `note` (opt), `attempt_id` (req — binds the approval to the exact reviewed attempt; see Piece 4). Actor/source comes from the resolved token (e.g. `chatgpt-liaison`) — do not trust a client-supplied actor.
- **Invariants it MUST enforce (reject the call otherwise):** request exists · status is exactly `awaiting_approval` · `attempt_id` matches the request's current attempt (a stale/superseded attempt is rejected) · not already resolved (idempotent — a repeat of the *same* decision returns the current state as a no-op success; a *conflicting* second decision is refused) · caller is authorized for this tool.
- **MC-only. This tool NEVER runs git or pushes.** It only records the decision + flips MC state. The push is the dispatcher's separate gated step (Piece 5-behavior in Piece 4).
- **In `lib/mcp-tools.ts`:** add to `MCP_TOOLS` (`scope:'write'`); add `'mc_respond_approval'` to **`LIAISON_TOOLS`** → ChatGPT sees it on next `tools/list` (no ChatGPT reconfig). Handler reuses `transitionRequest`:
  - `approve` → `transitionRequest(sb, id, ['awaiting_approval'], { status:'in_progress', phase:'pushing', approval_required:false, approved_by: actor, approved_at: now, blocker: null })` — only after the `attempt_id` + idempotency checks pass.
  - `reject` → `{ status:'blocked', approval_required:false, blocker: note ?? 'rejected by operator' }` (`cancelled` only if caller says kill).
  - Return `{ request_id, status, decision, attempt_id }`.
- **Idempotency:** dedupe on `(request_id, attempt_id, decision)` so repeated voice submissions can't double-act. The `awaiting_approval`-only from-state already blocks a second *different* action; add the explicit no-op path for a duplicate *same* action so the caller gets success, not an error.
- **Verify** `isToolAllowed('mc_respond_approval','liaison')` returns true (liaison membership, not scope). Fix if the check keys off scope alone.
- **Deploy + verify** against the **bearer-test `/api/mcp`** deployment, NOT the pinned git-main alias — see **[[vercel-git-main-alias-pinned]]**.

### Piece 3 — Telegram approval ping (notification only — MC stays the source of truth)
When a request enters `awaiting_approval`, fire one Telegram message. **Simplest: the dispatcher sends it directly** when it makes that transition (it already watches `mc_requests`) — no new endpoint. Reuse the `/api/alerts/digest` send pattern + `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. The message carries the full decision context so you can judge from your phone:
- request **title** + **ID** + **attempt_id**
- one-line **summary of what was built**
- **QC result** (CodexQC verdict: SHIP / FIX-FIRST / etc.)
- target **repo + branch**
- **exact action awaiting approval** ("push commit `<sha>` to `<repo>@<branch>`")
- **cost/risk** if known (v0: run time; spend once Phase-2 tracking exists)
- instruction: **"Approve through ChatGPT Voice."**

Telegram is a *notice*, never the approval record — the approve/reject only counts when it lands in MC via `mc_respond_approval`.

### Piece 4 — The thin dispatcher (Claude-only, event-driven, rig)
A small always-on Node service (`scripts/dispatcher.mjs` or its own dir). **No AI reasoning — deterministic routing only.** Identity: an MC token scoped to post progress + request approval + complete (v0: `full`; harden/split later — note the debt).

**State model (keep the durable `status` enum; use `phase` for granularity).** The existing validated `status` enum (`queued|claimed|in_progress|blocked|awaiting_approval|completed|failed|cancelled`) does NOT change — do not add new status values (it would break the state-machine validator + need a bigger migration). ChatGPT's finer states map onto `phase` under `in_progress`: `executing → phase=building`, `qc_running → phase=qc`, `fixing → phase=fixing`, `approved/pushing → status=in_progress,phase=pushing`. `retryable` is not a v0 state — a hard error is `failed` with a `blocker`; real retry policy is deferred.

- **Event source:** Supabase Realtime `postgres_changes` on `mc_requests` (fallback: 5s poll loop if Realtime is flaky on the rig).
- **Atomic claim (required from day one).** On an *eligible* `queued` request: **atomically** claim it and open a **workflow attempt**, then invoke the adapter. ⚠️ The existing `transitionRequest()` is read-then-write (SELECT → check in JS → UPDATE) and is **NOT race-safe** — two dispatcher instances can double-claim. Use a conditional update: `UPDATE mc_requests SET status='claimed', assigned_to='claude', phase='building', attempt_id=<new> WHERE id=? AND status='queued' RETURNING *`; **0 rows = already claimed → back off.** (Add `attempt_id` + an `attempts` counter in migration 020, or a small `mc_request_attempts` row `{id, request_id, started_at, reviewed_sha}`.) The attempt is what approval binds to.
- **Launch through an adapter, not inline.** Even with one worker, the dispatcher calls a `claudeExecutorAdapter({ workspace, request, env, timeoutMs })` behind a stable interface (`launch() → {reviewedSha, qcVerdict, commits}`). Future `hermesAdapter` / `kimiAdapter` / `codexAdapter` / `ssh|dockerAdapter` slot in with zero dispatcher changes. This is the cheap seam that preserves the parent architecture.
- **Adapter steps (per attempt):**
  1. **Provision workspace** `builds/<request_id>/<attempt_id>/`: `git init`; write `.claude/settings.json` allow=[Read,Write,Edit,Bash(node/npm/git add/git commit/git diff/git log/ls/cat/mkdir/echo)] **deny=[git push, gh, curl, rm]**; **stamp trust** (`projects["<abs path>"].hasTrustDialogAccepted=true` in `~/.claude.json` — a plain service can, the Phase-0 blocker was only the HQ session's own classifier); child env with `OPENAI_API_KEY` injected, `CLAUDECODE` unset.
  2. **Launch executor:** `claude -p "<prompt>" --output-format text` (`--dangerously-skip-permissions` as belt-and-suspenders; deny-list still blocks push). Prompt = build `request_text` → `node ~/.claude/skills/CodexQC/codex-qc.mjs --full` → apply fixes → run tests → commit. **NO push.** Hard **timeout** (e.g. 10 min) → overrun ⇒ `mc_mark_failed`.
  3. On success the adapter returns the **reviewed commit SHA** (`git rev-parse HEAD`), the QC verdict, and the commit list. Dispatcher records `reviewed_sha` on the attempt + `workspace_ref` on the request.
- **Request approval:** `mc_request_approval(id, reason="built <title>; CodexQC <verdict>; commit <sha> ready to push")` → `awaiting_approval` → **Piece 3** Telegram ping (includes the SHA).
- **On `approval.granted`** (Realtime sees `status→in_progress, phase=pushing`, `approved_at` set, `attempt_id` matches) run the **SHA-bound gated push** — the gate is the *only* holder of GitHub write creds and verifies **all** before pushing:
  - request status is `approved`/pushing **for this same `attempt_id`** (approval matches the current attempt, not a superseded one);
  - QC passed;
  - target **repo + branch are on the allowlist** (v0: a private sandbox — `gh repo create mc-build-<id> --private`, or a fixed sandbox; **NEVER a real portfolio repo**);
  - **no newer rejection/cancellation** exists;
  - **`git rev-parse HEAD` == the approved `reviewed_sha`** — the commit being pushed IS the reviewed+approved commit. Any drift ⇒ abort, do not push, `mc_mark_failed`.
  Then `git push` → `mc_complete_request(result_summary, artifact_refs=[repo URL, commit SHA])`.
- **On reject:** leave `blocked` (hold workspace for edits) or tear down.
- **Fault recovery:** on start, query non-terminal requests and resume from `status`+`phase`+`attempt_id` (dispatcher holds no state). A crashed attempt mid-build is superseded by a fresh attempt (old `attempt_id` can no longer be approved).

## Trust & safety kept in v0 (non-negotiable)
- **Approval before every push** — dispatcher holds the gate; executor workspace denies push/gh.
- **Isolated per-request workspace** — never a live repo until the approved push, and even then only a sandbox repo in v0.
- **Kill switch** — reject/cancel halts a request; stopping the dispatcher halts all.
- **Timeout backstop** — stands in for the spend cap until Phase-2 spend tracking lands (flagged debt).
- **Full audit** — `mcp_audit_log` stamps every MC transition; dispatcher logs every launch + push.

## Explicitly deferred to the parent spec (do NOT build here)
Hermes/Kimi/multi-model builder · capability registry + tool-agnostic swap · planner decomposition · spend tracking + cap + `mc_log_spend` · least-privilege split of the dispatcher identity. v0 earns the demo; these are the hardening/scale rungs.

## Definition of done (the exact test — no manual desktop steps)
Complete only when this runs end-to-end without touching the desktop workflow by hand:
1. Speak a simple app request to ChatGPT → it calls `mc_submit_request` → `queued`.
2. Dispatcher **atomically claims** it (opens an attempt) → builds → CodexQC → fixes → commits (no push).
3. MC enters `awaiting_approval`; you get the **Telegram notification** (title, ID, summary, QC verdict, repo/branch, the exact commit SHA, approve-via-voice).
4. You tell ChatGPT by voice to approve → it calls `mc_respond_approval(approve, attempt_id)`.
5. The gate verifies status/attempt/QC/allowlist/no-newer-reject/**HEAD==reviewed_sha**, then pushes.
6. `mc_get_result` reports **repository URL, commit SHA, result summary, completed** status.
7. Reject path: say reject → nothing is pushed, request goes `blocked`.

## Verification per piece
1. Migration: columns present; `mc_requests` in `supabase_realtime` publication.
2. `mc_respond_approval`: liaison `tools/list` shows it; approve flips `awaiting_approval→in_progress/pushing`; reject → `blocked`; audit rows written.
3. Telegram: forcing a request to `awaiting_approval` fires exactly one ping.
4. Dispatcher: end-to-end on a throwaway request — build+QC+commit in scratch, ping, approve → push to sandbox repo, `completed`; reject → no push. Restart mid-flight resumes.
Each piece also gets a `code-reviewer` + `/CodexQC` pass on the credential/push/approval boundary before it's called done (parent spec's cross-check rule).
