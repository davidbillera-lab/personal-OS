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
  ADD COLUMN IF NOT EXISTS phase        TEXT,          -- building|qc|fixing|review|pushing (observability)
  ADD COLUMN IF NOT EXISTS approved_by  TEXT,
  ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workspace_ref TEXT;         -- path/URL of the scratch workspace
-- Dispatcher event source (no cron): let it subscribe to row changes.
ALTER PUBLICATION supabase_realtime ADD TABLE mc_requests;
```
**Deferred (fast-follow, NOT v0):** `plan jsonb`, `spend_usd`, `spend_cap_usd`, `model_requested`, `capability_registry` table, `mc_log_spend`. v0 substitutes a hard wall-clock/timeout backstop for the spend cap.

### Piece 2 — `mc_respond_approval` tool  (the approval relay)
Per **[[mcp-tool-placement]]** update **all three**: `lib/mcp-tools.ts`, `scripts/mcp-server.mjs` (stdio `tools[]`), and confirm `app/api/mcp/route.ts` `isToolAllowed` lets a liaison call it.
- **In `lib/mcp-tools.ts`:**
  - Add to `MCP_TOOLS` with `scope: 'write'`, args: `request_id` (req), `decision` (req, `approve|reject`), `note` (opt).
  - Add `'mc_respond_approval'` to the **`LIAISON_TOOLS`** set → ChatGPT sees it automatically on next `tools/list` (no ChatGPT-side reconfig).
  - Handler (mirror `mc_request_approval`, reuse `transitionRequest`):
    - `approve` → `transitionRequest(sb, id, ['awaiting_approval'], { status:'in_progress', phase:'pushing', approval_required:false, approved_by: actor, approved_at: now, blocker: null })`
    - `reject` → `{ status:'blocked', approval_required:false, blocker: note ?? 'rejected by operator' }` (use `cancelled` only if caller says kill).
  - Return `{ request_id, status, decision }`.
- **Verify** `isToolAllowed('mc_respond_approval','liaison')` returns true (liaison membership, not scope). Fix if the check keys off scope alone.
- **Deploy + verify** against the **bearer-test `/api/mcp`** deployment, NOT the pinned git-main alias — see **[[vercel-git-main-alias-pinned]]**. Smoke: `tools/list` with the liaison key shows `mc_respond_approval`; a full-key call approve/reject flips status correctly.

### Piece 3 — Telegram approval ping
When a request enters `awaiting_approval`, fire one Telegram message. **Simplest: the dispatcher sends it directly** when it makes that transition (it already watches `mc_requests`) — no new endpoint. Reuse the `/api/alerts/digest` send pattern + `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. Body: `Request <id> wants to push: <title>. Approve via ChatGPT Voice.` (This is a *notice*; the approve/reject still comes back through `mc_respond_approval`.)

### Piece 4 — The thin dispatcher (Claude-only, event-driven, rig)
A small always-on Node service (`scripts/dispatcher.mjs` or its own dir). **No AI reasoning — deterministic routing only.** Identity: an MC token with enough scope to post progress + request approval + complete (v0: `full`; harden/split later — note the debt).
- **Event source:** Supabase Realtime `postgres_changes` on `mc_requests` (fallback: 5s poll loop if Realtime is flaky on the rig).
- **On a request becoming `queued`:**
  1. Claim → `assigned_to='claude'`, `status='in_progress'`, `phase='building'`.
  2. **Provision workspace** `builds/<request_id>/`: `git init`; write `.claude/settings.json` allow=[Read,Write,Edit,Bash(node/npm/git add/git commit/git diff/git log/ls/cat/mkdir/echo)] **deny=[git push, gh, curl, rm]**; **stamp trust** — set `projects["<abs path>"].hasTrustDialogAccepted=true` in `~/.claude.json` (a plain service can do this — the Phase-0 blocker was only the HQ session's own classifier); prepare child env with `OPENAI_API_KEY` injected and `CLAUDECODE` unset.
  3. **Launch executor:** `claude -p "<prompt>" --output-format text` (add `--dangerously-skip-permissions` as belt-and-suspenders; the deny-list still blocks push). Prompt = build `request_text` → run `node ~/.claude/skills/CodexQC/codex-qc.mjs --full` → apply fixes → run tests → commit. **NO push.** Wrap with a **hard timeout** (e.g. 10 min) → on overrun `mc_mark_failed`.
  4. Build/QC/commit done → `mc_request_approval(id, reason="built <title>; CodexQC <verdict>; N commits ready")` → `awaiting_approval` → **Piece 3** Telegram ping. Record `workspace_ref`.
  5. **On `approval.granted`** (Realtime sees `status→in_progress, phase=pushing`): run the **gated push** — target a **sandbox repo** (v0: `gh repo create mc-build-<id> --private`, or a fixed sandbox; NEVER a real portfolio repo) → `git push` → `mc_complete_request(result_summary, artifact_refs=[repo+commit URLs])`.
  6. **On reject:** leave `blocked` (hold workspace for edits) or tear down.
- **Fault recovery:** on start, query non-terminal requests and resume from `phase` (dispatcher holds no state).

## Trust & safety kept in v0 (non-negotiable)
- **Approval before every push** — dispatcher holds the gate; executor workspace denies push/gh.
- **Isolated per-request workspace** — never a live repo until the approved push, and even then only a sandbox repo in v0.
- **Kill switch** — reject/cancel halts a request; stopping the dispatcher halts all.
- **Timeout backstop** — stands in for the spend cap until Phase-2 spend tracking lands (flagged debt).
- **Full audit** — `mcp_audit_log` stamps every MC transition; dispatcher logs every launch + push.

## Explicitly deferred to the parent spec (do NOT build here)
Hermes/Kimi/multi-model builder · capability registry + tool-agnostic swap · planner decomposition · spend tracking + cap + `mc_log_spend` · least-privilege split of the dispatcher identity. v0 earns the demo; these are the hardening/scale rungs.

## Definition of done (the demo)
Speak an app idea into ChatGPT Voice → within minutes a Telegram ping says it's built + QC'd and wants to push → say "approve" to ChatGPT → the code lands in a private sandbox repo, and `mc_get_result` reads back what it built. Reject instead → nothing is pushed.

## Verification per piece
1. Migration: columns present; `mc_requests` in `supabase_realtime` publication.
2. `mc_respond_approval`: liaison `tools/list` shows it; approve flips `awaiting_approval→in_progress/pushing`; reject → `blocked`; audit rows written.
3. Telegram: forcing a request to `awaiting_approval` fires exactly one ping.
4. Dispatcher: end-to-end on a throwaway request — build+QC+commit in scratch, ping, approve → push to sandbox repo, `completed`; reject → no push. Restart mid-flight resumes.
Each piece also gets a `code-reviewer` + `/CodexQC` pass on the credential/push/approval boundary before it's called done (parent spec's cross-check rule).
