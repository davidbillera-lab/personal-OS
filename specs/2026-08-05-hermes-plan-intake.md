# mc_submit_plan — Hermes planning-artifact intake

**Status:** Spec / ready for build window (security-QC gated, like the liaison delta)
**Date:** 2026-08-05
**Owner:** fresh build window; this is HQ (spec only)
**Decision:** operator chose a **narrow planning-artifact intake**, not general Hermes write access. Artifact storage = **(A) a bounded `plan` column on `mc_requests`**.

---

## Why

Hermes plans a `submitted` Jarvis request but has no way to get the finished spec *into* MC — its `orchestrator` scope is read + `mc_claim_request` + `mc_reassign_request` only ([`mcp-tools.ts:31-34`]). That breaks the round-trip. This adds **one** narrow write so Hermes can deposit its plan — and nothing more. Promotion to execution stays a full-scope/human action; Hermes can never reach a `queued` (auto-executable) row.

## The one tool

`mc_submit_plan(request_id, plan)` — **scope: `write`**, added to `ORCHESTRATOR_EXTRA_TOOLS` (so Hermes + full can call it; no other scope).

Behavior:
- Validate `request_id` is a UUID and the request exists.
- **Precondition:** `status = 'submitted'` AND `assigned_to = 'hermes'`. Anything else → clean reject (can't plan a queued/blocked/completed/other-owner request).
- **Write-once:** if a `plan` is already present → reject (`plan already submitted`). Re-planning is a separate operator action, not a Hermes loop.
- Validate `plan`: non-empty string, **hard size cap** (e.g. 32 KB), sanitize secret-shaped strings on the way in (defense in depth).
- **The only fields it writes:** `plan = <artifact>`, `phase = 'planned'`, `plan_submitted_at = now`, `plan_by = actor`, `updated_at = now`. It **MUST NOT** write `status` (stays `submitted`), `assigned_to`, `approved_*`, `reviewed_sha`, `workspace_ref`, or any other field. **It must never be able to produce `status='queued'`.**
- Optimistic concurrency: guard the UPDATE on `.eq('status','submitted')`.
- Actor resolved server-side (`hermes`), never from args. Audited (`mcp_audit_log`, with `request_id`).
- Returns `{ request_id, phase, plan_submitted_at }`.

## The gate this preserves

```
Hermes:  claim → plan → mc_submit_plan   (deposits artifact, phase='planned', status stays 'submitted')   ← Hermes ceiling
   │
   ▼   full-scope actor (you or me) reviews the plan, promotes 'submitted/planned' → 'queued'
queued → dispatcher/Claude executes
```

Promotion (`planned → queued`) is deliberately NOT in this tool and NOT in Hermes's scope. For now it's a full-scope/manual action; a future gated `mc_promote_plan` can automate it after review, as its own build.

## Migration (bounded column, option A)

`ALTER TABLE mc_requests ADD COLUMN IF NOT EXISTS plan text;`
`ALTER TABLE mc_requests ADD COLUMN IF NOT EXISTS plan_submitted_at timestamptz;`
`ALTER TABLE mc_requests ADD COLUMN IF NOT EXISTS plan_by text;`
All nullable. Length enforced app-side (32 KB cap). Additive, zero-risk. Apply before deploying the tool.

## Wiring (per the tool-placement convention)

- `lib/mcp-tools.ts`: tool def in `MCP_TOOLS` (`scope: 'write'`), name added to `ORCHESTRATOR_EXTRA_TOOLS`, `callTool` handler.
- `app/api/mcp/route.ts`: no change needed — routes by `toolsForScope`/`isToolAllowed` already.
- `scripts/mcp-server.mjs`: add to the stdio `tools[]` for full-scope parity.
- **Do NOT** add to `LIAISON_TOOLS` (ChatGPT must never deposit plans).

## Security QC checklist (crown-jewel — same rigor as the liaison delta)

- ★ Cannot reach `queued`/executable state, ever — grep the handler for every `status:`/`phase:` it can set; prove none is `queued`.
- ★ Precondition enforced: only `submitted` + `assigned_to='hermes'`; foreign/terminal/queued rejected.
- ★ Actor server-side (`hermes`), never client args; no client-set `plan_by`/status.
- ★ Write-once respected; no overwrite churn.
- Only the five named fields written; no collateral field mutation; single request; parameterized; UUID validated.
- Size cap + sanitization enforced; oversized/secret-laden plan rejected or scrubbed.
- Audited (actor, tool, ok, request_id). Not in `LIAISON_TOOLS`; only orchestrator/full.

## Tests

- deposit on a `submitted`+hermes row → `phase='planned'`, `status` still `submitted`, plan stored.
- reject: status not `submitted`; assigned_to not `hermes`; plan already present; oversize plan; missing/invalid UUID; injection attempt.
- prove `status` never becomes `queued` on any path.
- audit row written.

## Definition of Done

Migration applied → tool deployed → independent security QC passes (no ★ failures) → Hermes can deposit a plan (phase `planned`) but cannot promote or execute → `decisions.md` + this spec updated. Round-trip's deposit step is closed; the execution gate stays with a full-scope actor.
