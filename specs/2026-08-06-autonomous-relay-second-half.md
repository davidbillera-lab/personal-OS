# Autonomous Relay — Second Half (dispatcher → builder → QC → push)

**Status:** Spec / build after C6 (safety keystone) lands
**Date:** 2026-08-06
**Parent:** C6 executor sandbox (`specs/2026-08-05-c6-executor-sandbox.md`), mc_submit_plan (shipped)

---

## The canonical workflow (operator's, verbatim intent)

1. Operator iterates to Codex/ChatGPT.
2. Message relayed into MC as a request.
3. Dispatcher triggered → assigns the path (operator's choice, generally Hermes).
4. Hermes builds the specs → deposits back into MC. **[DONE — `mc_submit_plan`, phase=planned]**
5. Dispatcher triggers the builder (Claude) to execute the build **from the deposited spec**.
6. Codex QC reviews the build.
7. Back to Claude for further review + fixes if needed.
8. Pushed to GitHub + MC.

The operator is NEVER the relay between agents. MC is the relay. This spec closes steps 5–8.

## What already exists (do not rebuild)

- Dispatcher claims `status='queued'`, builds via headless Claude in an isolated workspace, runs CodexQC (`codex-qc.mjs --staged`) **inside** the build, applies its Blocking/Should-fix items, commits, and returns a verdict. So **steps 6–7 already happen inside one executor run** (independent GPT review + Claude fix).
- Approval-before-push gate: SHA-bound, repo-allowlisted, branch-checked (step 8, gated).
- Classifier screens every claimed request before build.

## The gaps — the "second half"

### CORE (these two make the relay actually work)

**A. `planned → queued` trigger.** Nothing promotes a Hermes-deposited plan into the state the dispatcher claims. Options:
- **A1 (recommended, post-C6):** dispatcher also claims `phase='planned'` rows (treats a deposited plan as ready-to-build). Fully automatic — matches "dispatcher triggers the builder."
- **A2:** a gated `mc_promote_plan` (full-scope) for a human beat. Keep as the manual override; A1 is the default once C6 makes autonomous execution safe.

**B. Builder executes FROM the plan, not the original request.** Today the executor builds from `request.request_text` ([`claude-executor-adapter.mjs:130`]) and **ignores the `plan` column entirely**. Fix: when `request.plan` is present, the executor uses it as the build spec (Hermes's 30 KB plan), not the one-line voice ask. Without this, promotion produces garbage.

### POLISH (mostly present; formalize)

**C. Review loop.** Current in-build flow (Claude build → independent CodexQC → Claude fix → commit) already satisfies steps 6–7. Verify it's robust; optionally split into dispatcher-orchestrated stages later. No new build required unless we want QC as a separate re-dispatched worker.

**D. Push target.** Allowlist is currently `davidbillera-lab/mc-spike-test` only. The real workflow pushes to the target project's repo. Make the push target per-request/project-configurable, expand the allowlist deliberately, keep it **approval-gated**. (This is the highest-privilege step — treat with care; approval gate is mandatory.)

**E. Path routing (step 3).** Operator picks the path, generally Hermes. Partially present (ChatGPT assigns hermes via `mc_start_workflow`). Formalize path selection if we add non-Hermes planners.

## Sequencing

1. **C6 first** — sandbox the executor (kills the Rayetta class permanently). Everything below runs autonomously only because C6 makes it safe.
2. **B** — executor builds from `plan`.
3. **A1** — dispatcher claims `planned` → auto-triggers the build.
4. **D** — configurable, approval-gated push target.
5. **C / E** — formalize if needed.

After A1 + B: the operator drops an idea → it flows request → Hermes plan → dispatcher → Claude builds from the plan → CodexQC + fix → approval → push, with **no human relay** and C6 containing every build.

## Guardrails (why this is safe to run autonomously)

- **C6 sandbox** — a build cannot read secrets, reach infra, or exfiltrate (the permanent Rayetta fix).
- **Classifier** — screens every request pre-build (defense-in-depth once C6 lands).
- **Approval-before-push** — nothing reaches a real repo without operator approval (SHA-gated).
- **Kill-switch** — `.dispatcher-paused` halts everything within one tick.

## Definition of Done

Operator iterates to ChatGPT → the full chain completes to an approval-gated push with the operator only approving the push, never relaying between agents. C6 red-team green underneath it. `decisions.md` updated.
