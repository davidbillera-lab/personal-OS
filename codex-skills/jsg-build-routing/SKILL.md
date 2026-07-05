---
name: jsg-build-routing
description: Route David Billera's Codex sessions to the right JSG workflow. Use at the start of portfolio work, when the user invokes /davids-way, /davids-agents, /checkpoint, /handoff, /ClaudeQC, /advisoryboard, or when deciding whether a task needs Mission Control recall, David's Way planning, serial relay, decisions sync, Claude QC, or a direct surgical edit.
---

# JSG Build Routing

Use this as the thin router for David's portfolio workflow. Do not load every workflow by default; pick the smallest useful process.

## Route The Task

- Trivial single-file fix, rename, config tweak, or lookup: act directly with Karpathy simplicity. No ceremony.
- Non-trivial build, new feature, unknown bug, or 2+ files: use `mission-control-context`, then `davids-way`.
- Three or more heavy sequential pieces, prior compaction thrash, or `/davids-agents`: use `codex-relay` after `davids-way` has produced a plan.
- Resume after compaction, `/clear`, or an in-flight multi-step task: use `checkpoint` first.
- Architecture, dependency, auth, payments, data-flow, or AI-call decision: end with `decisions-sync`.
- Business decision, pivot, shiny-object check, channel idea, or `/advisoryboard`: use `advisoryboard`.
- AI feature that humans correct over time: use `self-improving-ai`.
- Pre-merge, protected project, high-risk diff, or `/ClaudeQC`: use `claude-qc`.

## Slash Command Mapping

Treat these as trigger phrases:

- `/davids-way`: run Mission Control context, then David's Way.
- `/davids-agents`: evaluate and run Codex Relay.
- `/phase-relay`: run Codex Relay.
- `/checkpoint`: create or refresh the checkpoint.
- `/handoff` or `/handoff-summary`: use Codex Relay handoff format or checkpoint state.
- `/ClaudeQC`: run Claude QC.
- `/advisoryboard`: run the accountability panel.

## Default Build Stack

For most real builds:

1. Recall context with `mission-control-context`.
2. Plan and verify with `davids-way`.
3. Use `codex-relay` only if the plan is too large for one clean context.
4. Use `claude-qc` before merge or protected-project handoff.
5. Use `decisions-sync` only when a meaningful decision was made.

