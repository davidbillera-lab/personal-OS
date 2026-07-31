# Spec — Autonomous Execution Engine (ChatGPT Voice → built → QC'd → pushed)

**Status: build spec — execute in phases, each in a fresh session.** Governing context: `decisions.md` (2026-07-30 + 2026-07-31 entries), `specs/2026-07-30-oauth-liaison-facade.md`, vault `d80be519`. This is **Phase 2** — the autonomous runner deferred by the 2026-07-30 decision, now authorized by the operator (2026-07-31).

## Objective (operator's words)
Tap ChatGPT Voice: *"I have an idea for an app / landing page — fire up Hermes, use whatever model is best (or the one I name), get it built, hand to Claude, Claude runs /CodexQC → fixes → review → push to GitHub + MC. Ping me only for approvals; I answer through ChatGPT Voice."* Any tool must be swappable (tool-agnostic).

## Operator decisions (locked 2026-07-31)
- **Dispatcher = a stateless, deterministic service — NOT an AI agent.** It replaces all cron polling with **event-driven routing**: it reacts to MC events (`request.created`, `worker.completed`, `approval.granted`), reads request metadata, determines the required capability, launches the matching registered worker, records the outcome, and advances state until complete. **No AI reasoning, no privileged writes.** All state lives in MC; on restart it reads incomplete workflows and resumes. Horizontally scalable by consequence. (Supersedes the earlier "Conductor = Hermes" framing — Hermes is now a *worker*, not the router.)
- **Workers are swappable via a capability registry**, not hard-coded. Each worker registers the capabilities it provides (`plan` / `build` / `review` / `push`) and how it is launched. The dispatcher matches required-capability → registered-worker. Swap any tool by editing the registry; the queue contract never changes.
- **Least privilege per worker.** Each worker acts under its own scoped identity (Hermes = `orchestrator`; Claude/executor = `full` for push; the dispatcher itself holds no write power beyond state transitions).
- **Gates = approve-before-push + per-request spend cap.** Plan → build → QC → fix → review run unattended. The workflow parks at `awaiting_approval` ONLY (a) before the GitHub push, and (b) if projected/actual spend exceeds `spend_cap_usd`. An approval is just a state the dispatcher resumes from.
- **Approval channel = ChatGPT Voice.** Telegram *notifies* "needs approval"; David *answers* via ChatGPT Voice; ChatGPT relays the decision into MC (`mc_respond_approval`), which emits `approval.granted` and the dispatcher continues.
- **Rig-dependency (v1):** execution is compute-bound, so the dispatcher + workers run on the rig. The *alerting* lane stays serverless; *building* needs the rig on. A cloud dispatcher/worker split is the future-proofing (the stateless design already allows it).

## Design goals (operator-stated)
Tool-agnostic · no cron (event-driven) · stateless dispatcher · least privilege per worker · full auditability · horizontally scalable. MC is the system of record; the dispatcher is pure orchestration — no AI reasoning, no privileged writes.

## Example flow (canonical)
User voice → **ChatGPT** (submit) → **Mission Control** (queue = system of record) → **Dispatcher** (event-driven) → **Hermes** `plan` → **Kimi K3** (or best/named) `build` → **Codex QC** `review` → **Claude Code** `fix` + approval-gated `push` (GitHub + artifacts) → **MC** → `completed`.

## Components (the queue contract is the only fixed interface)
| Component | Kind | Default tool | Capability / role |
|---|---|---|---|
| **Liaison** | worker | ChatGPT Voice/Text | capture requests + relay approvals (swap: any MCP-OAuth client) |
| **Dispatcher** | deterministic service | new (this build) | event-driven router; no AI, no privileged writes; stateless + resumable |
| **Planner** | worker | Hermes (rig) | `plan` — decompose the request into an ordered capability list, write it to MC |
| **Builder** | worker | Hermes + best/named model (Kimi K3, GLM 5.2, DeepSeek…) via Nous | `build` — write the app in an isolated workspace, log spend |
| **Reviewer** | worker | Codex via `/CodexQC` | `review` — second-opinion QC |
| **Executor** | worker | headless Claude Code (`claude -p` / Agent SDK) | `fix` + `push` — apply QC fixes, final review, approval-gated push to GitHub + MC |

Every worker is registered in the **capability registry** with `{capabilities, launch_adapter, scope}`. The dispatcher never names a tool directly — it asks the registry "who provides `build`?" and launches that. Swapping Hermes→another builder, or Claude→Codex for push, is a registry edit.

Rationale for the build/push split: the paid-model builder is bounded by the Nous spend cap and works in an isolated workspace; the **trusted** executor (Claude Code, strong repo context, `full` scope) owns the approval-gated push. Untrusted build power and trusted push power stay separated, each under its own least-privilege identity.

## Lifecycle (extends the existing `mc_requests` state machine)
```
queued
  → claimed            (Conductor/Hermes claims; existing)
  → in_progress        phase='building'   (Hermes builds with chosen model, logs spend)
  → in_progress        phase='qc'         (headless Claude: tests + /CodexQC)
  → in_progress        phase='fixing'     (Claude applies fixes; loop qc↔fixing until clean or max rounds)
  → in_progress        phase='review'     (Claude final review)
  → awaiting_approval  approval_kind='push'   (Telegram ping → ChatGPT Voice → mc_respond_approval)
        ├─ approved → in_progress phase='pushing' → completed   (Claude pushes to GitHub + MC)
        └─ rejected → blocked (held for edits) or cancelled
  ↳ at ANY point, projected spend > spend_cap_usd
       → awaiting_approval approval_kind='spend' → (approved raises cap / rejected halts)
  → failed             (any hard error, with reason)
```
Reuses existing statuses; adds a `phase` sub-state for observability. No new terminal states.

## What already exists (REUSE — do not rebuild)
- `mc_requests` queue + validated state machine (migration 017); worker tools `mc_claim_request` / `mc_reassign_request` / `mc_post_progress` / `mc_mark_blocked` / `mc_request_approval` / `mc_complete_request` / `mc_mark_failed` (`lib/mcp-tools.ts`).
- Scopes: `liaison` (ChatGPT: submit + read), `orchestrator` (Hermes: reads + claim + reassign), `full` (workers). Timing-safe key maps in `app/api/mcp/route.ts`.
- `/api/queue/dispatch` (auto claim + route + Telegram) — **superseded** as the primary router by the event-driven dispatcher; kept as a cheap **safety-net heartbeat** (catches anything a missed event left stuck). Not the main path.
- Telegram lane (`/api/alerts/digest` pattern; `TELEGRAM_BOT_TOKEN`/`CHAT_ID`, `CRON_SECRET`).
- `mcp_audit_log`; `/CodexQC` skill; ChatGPT OAuth connector (live).

## New work (by phase — build order)

### Phase 0 — De-risk spike (cheapest-first, mirrors the Voice probe)
Prove the single riskiest link before building the engine: **Hermes can programmatically launch a headless Claude Code session that runs `/CodexQC` and pushes to a throwaway test repo, gated by an approval.** Deliverable: a Hermes script/skill that runs `claude -p "<task>"` (or Agent SDK) in a scratch dir, and a manual approval step before the push fires. GO/NO-GO on the whole architecture. If headless Claude can't drive `/CodexQC` + push reliably, stop and rethink the executor.

### Phase 1 — Approval relay (makes the human-in-loop real)
- New MC tool **`mc_respond_approval`** (scopes: `liaison` + `full`): args `request_id`, `decision` (approve|reject), optional `note`. On approve → clears `awaiting_approval` (records `approved_by`, `approved_at`), returns request to the phase it paused at. On reject → `blocked` (held) or `cancelled`. Add to `LIAISON_TOOLS` so ChatGPT sees it automatically (no ChatGPT-side reconfig — just a re-list).
- **Telegram approval notice:** when any request enters `awaiting_approval`, push a ping ("Request X needs approval to push: <summary>. Approve via ChatGPT Voice."). Extend `/api/queue/dispatch` or a small `/api/queue/notify`.
- Test: worker calls `mc_request_approval` → Telegram fires → `mc_respond_approval(approve)` via ChatGPT → request unblocks.

### Phase 2 — Schema + registry + spend tracking (migration 020)
- `mc_requests` adds: `phase` (text), `plan` (jsonb — the ordered capability list the planner writes), `model_requested` (text, null=auto), `spend_usd` (numeric default 0), `spend_cap_usd` (numeric, from request or a default), `workspace_ref` (text), `approval_kind` (text), `approved_by` / `approved_at`.
- **`capability_registry`** table: `{worker text, capabilities text[], launch_adapter text, scope text, enabled bool}` — the swap point that keeps the dispatcher tool-agnostic.
- New tool **`mc_log_spend`** (`full`): increments `spend_usd`; if `spend_usd > spend_cap_usd` → auto-transition to `awaiting_approval` (kind='spend'). Builder reports model cost per step (reuse the `model_costs` table pattern).
- ChatGPT's `mc_submit_request` gains optional `model` + `spend_cap_usd` passthrough so the voice command can name a model / budget.

### Phase 3 — The Dispatcher (stateless, event-driven, deterministic)
A small always-on service on the rig. **No AI, no privileged writes** — pure routing.
- **Event source:** subscribe to `mc_requests` changes via **Supabase Realtime `postgres_changes`** (fallback: Postgres `LISTEN/NOTIFY`). No cron, no polling. Events of interest: a request becomes `queued` (`request.created`), a worker finishes a phase (`worker.completed`), an approval lands (`approval.granted`).
- **Capability registry** (`capability_registry` table or config): rows of `{worker, capabilities[], launch_adapter, scope}`. The dispatcher resolves "next required capability" → a registered worker.
- **Routing loop (deterministic):** on each event → read the request's current `phase` + its plan → determine the next capability → launch that worker via its adapter (Hermes: message via MCP bridge / `delegate_task`; Claude: `claude -p`) → the worker does the phase and writes its result + next state back to MC → the next MC event fires → repeat until `completed`.
- **Launch adapters** (per worker, in the registry): how to invoke it (Hermes bridge call, `claude -p` in `workspace_ref`, etc.). Adding a tool = adding an adapter + a registry row.
- **Fault recovery:** the dispatcher holds NO state. On start/restart it queries MC for all non-terminal requests and re-drives them from their recorded `phase` — nothing is lost if it crashes. Multiple instances can run (claim is atomic in the state machine), giving horizontal scale.
- **Least privilege:** the dispatcher authenticates with a narrow identity that can only read requests + move state — it cannot build, push, spend, or read secrets. Workers act under their own scopes.
- Every transition + launch is stamped in `mcp_audit_log`; spend in `spend_usd` / `model_costs`.

The workers themselves do the work (planner decomposes; builder builds with `model_requested`/best-for-job + `mc_log_spend`; reviewer QCs; executor fixes + pushes after `approval.granted`). The dispatcher only decides *who's next* and launches them.

### Phase 4 — Tool-agnostic polish
- Config-driven builder model + executor (swap Hermes↔other, Claude↔Codex) without touching the queue contract.
- `mc_get_result` returns the full run trace (phases, spend, commits) so ChatGPT can read back "here's what it built + what it cost."

## Trust & safety (non-negotiable)
- **Approval before every push** (operator-locked). Push is Claude's (trusted) action, never Hermes's.
- **Per-request spend cap**; exceed → pause for approval. Hard ceiling even on approve (a second cap) to prevent runaway loops.
- **Isolated build workspace** — Hermes builds in scratch, never in a live protected repo, until the approved push.
- **Kill switch** — `mc_cancel` (or reject) halts any request; a global stop halts the Conductor.
- **Full audit** — every phase transition, spend, approval, and push logged + attributable.
- **No credential exposure** — Hermes stays on `orchestrator` scope (no `mc_get_credential`); the executor uses its own rig auth. (See open flag: `hermes-rig-secret-exposure` — the rig-level secret access is a separate hardening.)

## Open items / risks
- **Headless Claude reliability** (Phase 0 gates this) — can `claude -p` drive `/CodexQC` + commit + push unattended, with auth, on the rig? Prove first.
- **Conductor trigger mechanism** — exact Hermes automation (scheduled task vs persistent watch) is Hermes-implementation-specific; pin during Phase 3.
- **Rig-dependency** — no rig, no builds. Acceptable for v1; a cloud-VM Conductor is the future-proofing if uptime matters.
- **Spend attribution** — builder must report per-call cost accurately for the cap to bite.

## Report / cross-check
Phase 0 is the go/no-go. Each phase: build → local test → code-reviewer + Codex QC (credential/spend/push boundary) → deploy → report. Do NOT wire an un-gated push at any point. If the approval relay or spend cap can't be proven, STOP before enabling autonomous push.
