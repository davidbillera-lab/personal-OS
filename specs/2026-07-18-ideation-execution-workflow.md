# Ideation → Execution Workflow (Hermes ↔ Claude Code)

**Date:** 2026-07-18
**Status:** Canonical operating workflow
**Applies to:** every JSG portfolio project

---

## The one-line version

**Ideate in Hermes. Execute in Claude Code. Each one attacks the other's work before it ships. Mission Control and the repos are the only source of truth.**

---

## Roles

| Actor | Job | Access | Cost |
|---|---|---|---|
| **Hermes** | Front door: brain-dump capture, concept development, market/model research, DRAFT specs + handoffs | **Read-only** MC (9 tools). Local machine. | Flat-rate (ChatGPT sub) — ideation here is effectively free |
| **Claude Code** | Repo-aware execution, spec validation, ALL persistence, MC writes | Full MC. Reads the actual codebase. | Opus/metered — reserve for work that needs the repo |
| **Codex** | Independent QC on protected or architecturally important work | Repo | Second opinion only |
| **MC + repos** | **Source of truth. Always.** | — | — |

Hermes is deliberately the swappable component. It holds no durable state, ever.

---

## The pipeline

```
Phase 0  CAPTURE          Hermes (Telegram or Desktop) — messy is fine
Phase 1  DEVELOP          Hermes — clarify, challenge, research, kill criteria
Phase 2  DRAFT SPEC       Hermes — emits Build Spec Draft + Handoff
Phase 2.5 AB GATE         Hermes-side — NEW VENTURES & PIVOTS ONLY. David engages
   │                      the four-persona panel on the finished handoff.
   │                      GO → proceed. KILL → stop; David carries the verdict to
   │                      a Claude session to log. MODIFY → back to Phase 1.
   ├─────► CROSS-CHECK A: Claude Code attacks the draft against repo reality
   │                      (existing-codebase work; N/A for greenfield)
Phase 3  FINALIZE+PERSIST Claude Code — specs/ + vault + decisions.md (+ AB verdict)
Phase 4  PLAN             Either — implementation plan
   ├─────► CROSS-CHECK B: the OTHER one attacks the plan
Phase 5  EXECUTE          Claude Code — fresh project window, davids-way
Phase 6  QC               Codex — protected / architecturally important only
Phase 7  CLOSE            Claude Code — push, mc_update_project_status, decisions.md
```

---

## The cross-check loop (non-negotiable)

**Whoever drafts it, the other one attacks it.** This is the highest-value part of this workflow and it is not optional ceremony — it is the mechanism that catches real defects.

Proven in practice (2026-07-16 Hermes ambient-layer build):
- Claude Code wrote the spec; **Hermes caught a fatal flaw** — the "repoint the token" step was meaningless because Hermes connected over stdio, which enforces no auth or scope at all.
- Hermes wrote the implementation plan; **Claude Code caught two defects** — a Telegram poller-collision landmine, and production work assigned to an unproven harness.

Neither agent would have produced that result alone. The reviewer's advantage is a *different vantage point*: Claude Code sees the repo, Hermes sees the live machine.

**Mandatory cross-check for:** new projects, architecture changes, anything touching a Tier 1 or protected project, anything that changes trust/credential boundaries, anything that touches production.

**Skip it for:** one-file fixes, renames, config tweaks, copy edits. Use judgment — the cost of a cross-check is minutes; the cost of a wrong build is days.

**How to run it:** paste the draft into the other agent with: *"Attack this. What's wrong, what's missing, what would break? Do not be agreeable."*

---

## Brain-dump capture (interim bridge — no Hermes write)

David brain-dumps into Hermes; those dumps are ephemeral (die on `/new`/compaction). Until Hermes earns a scoped write path, the bridge is:

1. **Hermes captures** each dump verbatim into a **local rolling buffer** (`AppData/Local/hermes/brain-dumps/buffer.md`) — a transient buffer, not durable state, so a dump survives compaction between capture and handoff. Hermes does not develop, classify, or route — capture only.
2. On request, Hermes emits a **BRAIN DUMP HANDOFF** — one paste-ready block, verbatim, indexed, with timestamps, source, and any explicit project hint David gave.
3. **David pastes it into Claude Code (personal-os).**
4. **Claude runs a Haiku classification pass** (Tier 1) → tags each dump (idea/task/bug/decision/kill-candidate/new-project) → routes to the right project using live project context → writes to the MC brain-dump inbox → reports what went where, surfacing decisions / kill-candidates / new-project candidates for David's eyes (never silent-filed).
5. On David's confirmation, Hermes archives + clears the buffer.

**Why the bridge before the write tool:** it does capture *and* triage in one pass (a raw auto-write wouldn't), it keeps Hermes read-only, and it teaches us the classification/routing rules to encode later. **Deferred step 2:** a scoped `capture` token + `mc_write_brain_dump` tool once the pattern is proven and Hermes has more track record (the trust ladder).

## The advisory-board gate (new ventures & pivots)

A **second, distinct gate** from the cross-check. They answer different questions:

- **Cross-check** = *will it work?* Technical, agent-vs-agent, adversarial.
- **AB gate** = *should we build it at all?* Strategic and behavioral, David-facing. Verdict first, names avoidance/shiny-object patterns, does not rescue bad ideas.

**When it fires:** new projects, new revenue lines, and significant pivots — mirroring the `advisoryboard` skill's own triggers. Features and fixes on already-validated projects skip it (they still get the cross-check and kill-criteria). Do not run it on routine work — a gate that fires on everything becomes a rubber stamp and gets skipped.

**Where it runs:** on the **Hermes side**, on the finished handoff, *before* anything crosses to a Claude Code build window. This is the last cheap moment before expensive execution — by now scope, time-to-revenue, and kill criteria are concrete, so the verdict is grounded in specifics, and Hermes ideation was flat-rate so nothing costly is yet spent. Hermes runs the panel by pulling the `advisoryboard` skill via `mc_get_skill`; David engages the four personas directly.

**Verdicts:**
- **GO** → the AB verdict travels inside the handoff; Claude Code persists it as an `ab_conversation` during Phase 3. No extra effort.
- **KILL** → stop. Because Hermes cannot write to the vault, the kill does not auto-persist — and a kill is the highest-value verdict to keep (so the same dead idea doesn't return in three months). David carries the verdict into a Claude/HQ session with "log this kill"; Claude writes it to `decisions.md` + vault. One deliberate step, on a rare event.
- **MODIFY** → back to Phase 1 with the panel's concerns.

**Why Hermes-side and not the build window:** the go/no-go belongs where David already is, before he commits to opening a build window at all. Auto-persistence (the one thing lost by not running it in Claude) is preserved for GO via the handoff, and handled manually for the rare KILL.

## Artifact contract — Hermes emits exactly two things

Hermes must **use the existing formats**, not invent parallel ones. It has MCP read access to `mc_get_skill` — pull the real skill and match its shape.

1. **Build Spec Draft** — follow the `spec-writer` agent's structure.
2. **Claude Code Handoff** — follow the `handoff` skill's format exactly.

Inventing new artifact shapes fragments the pipeline and gives every Claude Code session inconsistent input. If a format seems inadequate, say so and propose changing the skill — do not fork it silently.

---

## Persistence contract (the durability hole — read this twice)

**Hermes cannot write to Mission Control or the vault.** Anything it produces lives only in a Hermes session and dies on `/new`, compaction, or a crash. That is exactly the "ideas die in a notebook" failure Mission Control exists to prevent.

Therefore **every Hermes handoff MUST end with explicit persistence instructions** for Claude Code:

- [ ] Save the spec to `specs/YYYY-MM-DD-<topic>.md`, commit, push
- [ ] Capture to the vault (`mc_write_vault`) so it is semantically searchable
- [ ] Log any architectural decision to `decisions.md`
- [ ] `mc_update_project_status` at session close

A Hermes spec that is not persisted by Claude Code **does not exist**. Treat an unpersisted artifact as work not yet done.

---

## Where to ideate vs execute

| Situation | Lane | Why |
|---|---|---|
| Idea strikes away from desk | **Telegram → Hermes** | Capture beats perfect recall |
| Extended brainstorm, multi-round design, long docs, screenshots | **Hermes Desktop / dashboard** | Handles length + attachments; flat-rate |
| **Greenfield idea, no repo yet** | **Hermes — genuinely ideal** | Nothing to be unmoored from |
| **Spec for a change to an EXISTING codebase** | **Hermes drafts intent → Claude Code validates** | A spec written blind to the code will spec things that already exist or conflict |
| Implementation, refactor, debugging | **Claude Code, fresh project window** | Needs the repo |
| Anything touching VZT or a protected repo | **Claude Code + Codex QC** | Protection level is Medium; escalates before first paying tenant |

**The middle rows are the important ones.** A Hermes spec for existing code is a **draft of intent**, never a final spec, until Claude Code has read the actual files. Real example: the ambient-layer spec was only correct because Claude Code could read `lib/mcp-tools.ts` and discover a fully-built read-scope layer that was dormant. Specced blind, it would have proposed building something that already existed.

---

## Research routing

| Research type | Lane |
|---|---|
| Market size, competitors, pricing, user pain points | **Hermes** — cheap, has web tools, keeps research in the same reasoning thread |
| Model/provider evaluation, new releases, benchmarks | **Hermes** |
| Deep multi-source cited report | **`deep-research` skill or `researcher` agent — in-house FIRST** |
| Existing codebase investigation | **Claude Code only** |
| Independent technical sanity check | **Codex / CodexQC** |
| Bounded browser-heavy work the above can't do | Manus — **never a core dependency** (post-Meta acquisition uncertainty) |

Raw research from any external agent returns to Hermes for synthesis — it never goes straight into implementation unreviewed.

---

## Specialist model escalation & swappable execution

The execution model is chosen **per task, not permanently assigned by platform** — the operational expression of the tool-agnostic thesis. Match the model to the job; the context stays the moat.

**Default lanes (unchanged):**
- Hermes planning + synthesis → Codex OAuth (ChatGPT subscription)
- Claude Code → default implementation environment
- Codex → independent QC where required

**Specialist escalation:**
- Hermes may recommend a different model when current evidence shows a meaningful task-specific advantage — capability, cost, speed, privacy, context window, tool use, or local fit.
- **Metered API use requires an upfront route + cost assessment AND David's approval** before it runs (matches global model-routing cost discipline).
- **MoA (Mixture-of-Agents) planning** may consult specialist models as *advisors only* — the Hermes aggregator stays responsible for canonical compliance. Never use an unpinned/default metered MoA preset (silent-spend hazard, same class as the compression auto-route).

**Outside-model execution** (a non-default model implements):
- Runs a **bounded** task in an **isolated branch/worktree**.
- Gets **no MC write authority, no direct merge authority, no unnecessary production credentials** — and never touches a protected repo (VZT) outside the full protection gate (guardrail #7).
- **Claude Code reviews, tests, integrates, and takes ownership** of the result.
- **Codex independently reviews the actual diff + verification evidence.**
- Claude agrees, rebuts, or remediates each material Codex finding.
- **David makes the final approve / modify / reject call.**
- **Claude Code alone performs final GitHub + Mission Control persistence.**

**Ownership:** models perform work; they do not own project state. Git repos + Mission Control remain the only durable sources of truth.

## Guardrails — what must NOT be broken

These protect what the last several months of Mission Control work bought. Violating any of them is a stop-and-flag event, not a judgment call.

1. **MC + repos are the source of truth. Hermes stores nothing durable.** There is no "projects" section in Hermes and there should not be. Hermes's internal workspace concept is NOT an MC portfolio project — never conflate them.
2. **Hermes stays read-only.** It does not request, accumulate, or route around write access. Credential friction is working as designed (`decisions.md` 2026-07-12). Access is revisited on track record, by the operator, deliberately.
3. **Use the existing skills and formats.** `davids-way`, `handoff`, `spec-writer`, `dynamic-workflow`, `advisoryboard`, `kill-criteria-examiner`. Do not build parallel versions.
4. **Every new project gets `CLAUDE.md`, `kill-criteria.md`, and `decisions.md` from day one.** No exceptions.
5. **Kill criteria get evaluated before build starts** — functionality, efficiency, scalability, time-to-revenue. Ideas that fail get killed, not rescued. Say so plainly.
6. **Model tier discipline.** Match the tier; default cheap; escalate only when justified. Summarizer/auxiliary models must be pinned to Tier 1 — never left auto-selected.
7. **Protected projects (VZT):** Codex review before merge, never push directly to main, staging env, critical-path tests.
8. **Architecture changes always land in `decisions.md`** with date and reasoning.
9. **Customer-facing copy gets the `copywriter` human-voice pass.** No AI-template feel.
10. **Builds execute in a fresh Claude Code project window** (HQ-window rule) — not in the planning window.
11. **One interface at a time per agent turn.** Desktop, dashboard, and Telegram share session storage but not unsent composers; parallel instructions produce overlapping work.
12. **Specs for existing codebases are drafts until validated against the repo.**

---

## When to skip the ceremony

This workflow is for real builds. A one-line fix, a rename, a config tweak, or a question gets surgical judgment — read the file, make the change, move on. The cost of over-process on small work is real. Use the pipeline when the work is a feature, a new project, or anything touching production or a protected repo.
