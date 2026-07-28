> **Status: DRAFT — captured 2026-07-28, cross-checked by Claude Code against repo reality the same day.**
> Authored by ChatGPT (liaison candidate). Original: `~/Downloads/Mission_Control_AI_Orchestration_Architecture_v1.{md,pdf,docx}`.
>
> **Binding amendments from the cross-check (David to overrule explicitly if he disagrees):**
> 1. **No blanket access — RESOLVED 2026-07-28.** David withdrew the "access anything I can" ask in favor of a **Chief-of-Staff relay model**: ChatGPT reads MC, captures intents/brain dumps, and relays agent pushback — it never builds, merges, or holds broad write. Ladder: per-agent read token (M1) → narrow `capture` write scope (M2). See `decisions.md` 2026-07-28.
> 2. **Extend the existing `/api/mcp` server; do not greenfield `mc-orchestrator`.** Existing `mc_*` underscore naming is preserved (spec §10 permits this). Current surface: 16 `mc_*` tools, two flat scopes (full/read) — no audit events, approvals, risk tiers, agent dispatch, repo tools, or deploy tools yet.
> 3. **Phase 0 validation gate before any build:** confirm (a) ChatGPT voice mode can actually invoke custom-connector MCP tools, and (b) ChatGPT's connector auth can send our static Bearer token (or we need an OAuth shim). If (a) fails, the voice-cockpit premise reshapes and this spec gets re-scoped.
> 4. **Hermes role overlap — RESOLVED 2026-07-28.** ChatGPT voice is the mobile front door / capture path; Hermes keeps spec drafting + the Telegram digest lane; Claude Code keeps build + persistence; **MC is the mailbox between all agents** (no direct agent-to-agent channels). The planned Telegram→brain-dump capture sub-project is absorbed by ChatGPT capture. See `decisions.md` 2026-07-28.

# Mission Control AI Orchestration Layer

**Foundational Architecture and Implementation Specification — Version 1.0**

**Purpose:** Establish MC as the central, MCP-native orchestration and knowledge layer connecting ChatGPT, Hermes, Claude Code, Codex, VS Code, GitHub, Vercel, Supabase, local models, and future agents.

**Status:** Implementation blueprint
**Primary operating model:** User intent → ChatGPT liaison → MC policy/orchestration → specialist agents → independent QC → approved release

## 1. Executive Summary

This architecture turns the existing Mission Control environment into a controlled AI operating system. The user speaks to one primary interface—ChatGPT—while MC supplies structured tools, project context, memory, permissions, and execution routing. Hermes remains the planning and specification agent, Claude Code remains the principal implementation agent, and Codex remains the independent quality gate. ChatGPT is elevated from reviewer to liaison and authorized executor, but only through explicit MC tools and policy-scoped permissions.

MC is not an IDE and should not become a code repository. It is the durable second brain and control plane. GitHub remains the source of truth for code and release history. MC stores project relationships, goals, specifications, decisions, task state, agent runs, approvals, evidence, and indexed knowledge. Credentials remain behind a broker and are never copied into conversational context or model memory.

The first production goal is not unlimited autonomy. It is dependable remote operation: capture a brain dump, create or continue a project, dispatch the correct agent, observe work, resolve blockers, run independent QC, and request narrowly defined approvals for actions that create external or irreversible effects.

## 2. Goals and Non-Goals

### 2.1 Goals

- Provide one voice/chat cockpit for all project work.
- Allow ChatGPT to retrieve MC context and act as liaison between Hermes, Claude Code, Codex, and specialist agents.
- Create a stable MCP contract for projects, specs, tasks, agents, repositories, QC, approvals, deployments, notifications, and audit.
- Enable remote continuation of stalled work without requiring the user to manually shuttle text between Telegram, VS Code, and agent terminals.
- Preserve strict traceability from spoken intent through code, review, approval, and deployment.
- Keep credentials private, scoped, revocable, and inaccessible to model context unless a tool uses them internally.
- Support replaceable models and tools through a capability-based agent registry.

### 2.2 Non-Goals

- Replacing VS Code, GitHub, Claude Code, or existing development tools.
- Storing source code primarily inside MC.
- Granting any conversational model permanent unrestricted shell or production credentials.
- Allowing one agent to plan, implement, approve, and deploy a high-risk change without independent evidence.
- Using model memory as the system of record for project state or secrets.

## 3. Governing Design Principles

| Principle | Requirement |
| --- | --- |
| Human intent is authoritative | The user defines goals, constraints, and approval policy. Agents may recommend, but never silently redefine intent. |
| MC is the operational brain | MC owns project state, memory, knowledge retrieval, agent routing, approvals, and audit history. |
| GitHub is the code authority | Repositories, branches, pull requests, tests, release tags, and deployment provenance remain anchored in GitHub. |
| Least privilege by default | Every agent receives only the tools and scope needed for the current task. Elevated permissions are time-bound and auditable. |
| Plan, implement, verify | Hermes plans, Claude Code implements, Codex independently verifies, and ChatGPT coordinates and resolves gaps. |
| No hidden side effects | Every write, commit, deployment, secret use, or destructive action produces a visible event and traceable actor record. |
| Replaceable agents | Routing is based on capability profiles rather than hard-coded model names, allowing Kimi, local models, or future agents to be substituted. |
| Voice is an interface, not authority | Speech commands are translated into structured intents, validated against policy, and confirmed when risk requires it. |

## 4. System Context and Boundaries

The system consists of a user-facing conversational layer, an MC orchestration gateway, internal vaults and state stores, execution agents, developer tooling, code hosting, and deployment services. All model-to-system interaction occurs through typed MCP tools exposed by MC or tightly controlled connector adapters.

![Architecture diagram](mc_architecture_diagram.png)

**Trust boundary rule:** ChatGPT, Hermes, Claude Code, Codex, and specialist models are treated as untrusted reasoning components. They may request tools, but MC validates identity, project scope, action risk, policy, approval state, and argument constraints before execution.

## 5. Source-of-Truth Model

| Domain | Authoritative system | MC responsibility |
| --- | --- | --- |
| Code and branches | GitHub | Index repository links, active branch/PR, release evidence, and summarized status. |
| Working copy | VS Code workspace / isolated worktree | Track workspace lease, owning agent, base commit, changes, and cleanup status. |
| Project state | MC | Own lifecycle state, task graph, blockers, agent runs, approvals, and decisions. |
| Specifications | MC, versioned and optionally mirrored to repository docs | Own immutable versions, approvals, and links to implementation commits. |
| Knowledge and memory | MC vaults | Own indexed notes, brainstorming, decisions, and retrieval permissions. |
| Secrets | Credential vault / secrets broker | Store references and issue short-lived scoped credentials; never expose raw values to agents. |
| Deployments | Provider plus GitHub release record | Store provider result, release URL/ID, environment, evidence, and rollback target. |

## 6. Logical Architecture

### 6.1 Conversational Liaison

ChatGPT receives voice or text, identifies the project and desired outcome, retrieves authorized context, creates a structured intent, selects or recommends an execution plan, invokes MC tools, and reports concise progress. It does not directly connect to the user’s computer outside the MCP tools made available by MC.

### 6.2 MC Orchestration Gateway

The gateway is the single policy enforcement point. It authenticates callers, validates schemas, resolves project scope, classifies risk, checks approvals, dispatches work, records evidence, and returns stable machine-readable responses.

### 6.3 Project and Knowledge Plane

MC stores projects, specs, task graphs, status, decision records, memory links, knowledge citations, run history, and audit events. Retrieval must enforce project/collection access controls and return citations or document identifiers.

### 6.4 Execution Plane

Claude Code, Codex, Hermes, local models, Kimi, and future agents run as registered workers or launch adapters. Each run receives a context package, tool allowance, workspace scope, time limit, budget, and expected output schema.

### 6.5 Repository and Workspace Plane

GitHub is accessed through an app or narrowly scoped token. Workspace changes occur in isolated worktrees or containers, never directly on a protected default branch. All changes are diffed, tested, attributed, and tied to an MC task.

### 6.6 Deployment Plane

Vercel, Supabase, and other providers are accessed only through deployment tools. MC creates a deployment plan, validates checks, obtains approvals, requests short-lived credentials, executes, records evidence, performs smoke tests, and exposes rollback.

### 6.7 Notification Plane

Telegram may remain a notification or emergency fallback channel, but not the primary control plane. Notifications carry summaries and approval links/IDs, not credentials or unrestricted command text.

## 7. Agent Roles and Separation of Duties

| Agent | Primary role | Permitted capabilities | Required constraints |
| --- | --- | --- | --- |
| ChatGPT Liaison | Primary conversational interface; turns voice/chat into structured intents; coordinates agents; reviews results; may execute approved tools. | Read all authorized project context; scoped writes; task orchestration; review; approvals request. | No unrestricted shell, secret export, or production deployment without policy approval. |
| Hermes | Brainstorming, discovery, requirements, specifications, and research synthesis. | Read MC knowledge, create/update draft specs, propose tasks. | Read-only to code and infrastructure by default; no deployments. |
| Claude Code | Primary coding and workspace execution agent. | Read/write repository workspace, run tests, create branches/commits/PRs under policy. | Cannot bypass protected branches, release gates, or secrets broker. |
| Codex | Independent quality-control and verification agent. | Read code/diffs/tests; run isolated checks; produce findings; optionally prepare fix suggestions. | Should not approve its own unreviewed code changes; no direct production deployment. |
| Specialist agents | Kimi, local models, design agents, data agents, or future tools selected by capability. | Exactly the tools declared by their capability profile. | No implicit inheritance of another agent’s permissions. |

## 8. Project Lifecycle and State Machine

| State | Meaning |
| --- | --- |
| CAPTURED | Brain dump or request received; not yet normalized. |
| DISCOVERY | Hermes/ChatGPT clarifies goals, constraints, and relevant context. |
| SPEC_DRAFT | A build specification exists but is not approved for implementation. |
| SPEC_APPROVED | Scope and acceptance criteria are authorized. |
| READY | Dependencies, repository, environment, and permissions are available. |
| IN_PROGRESS | An implementation agent has an active lease on one or more tasks. |
| BLOCKED | Progress requires input, access, dependency resolution, or a decision. |
| IMPLEMENTED | Implementation is complete and tests have been run by the builder. |
| QC_REVIEW | Codex or another independent reviewer is evaluating the change. |
| REWORK | Review findings require changes. |
| RELEASE_READY | Required checks and approvals have passed. |
| DEPLOYING | An approved deployment is running. |
| LIVE | Release succeeded and evidence was recorded. |
| ROLLED_BACK | Release was reverted to a known safe state. |
| ARCHIVED | Project is inactive and retained for knowledge/history. |

State transitions must be event-driven and validated. For example, `SPEC_DRAFT → SPEC_APPROVED` requires a recorded approval of a specific spec hash; `QC_REVIEW → RELEASE_READY` requires all blocking findings resolved or explicitly waived; `RELEASE_READY → DEPLOYING` requires a valid deployment approval and passing preflight checks.

## 9. Canonical Workflows

### 9.1 Brain Dump to Approved Specification

- ChatGPT calls `mc.intake.capture` with transcript, inferred project, source, and user identity.
- MC stores the raw intake and returns a reference.
- ChatGPT searches relevant knowledge and asks Hermes to create a structured spec draft.
- Hermes writes the draft through `mc.specs.create`; MC versions and hashes it.
- ChatGPT summarizes scope, risks, open questions, and acceptance criteria.
- The user approves the exact version through `mc.specs.approve`.
- MC generates tasks and transitions the project to `READY` when dependencies are satisfied.

### 9.2 Continue a Stalled Claude Code Build

- ChatGPT retrieves project state, latest run, active workspace, branch/PR, test status, and blocker.
- If the blocker is a safe interactive prompt, ChatGPT answers through an approved run-control tool; otherwise it requests the user decision.
- MC renews or creates a workspace lease and dispatches Claude Code with the approved task and current repository state.
- Claude posts progress and evidence; MC detects inactivity, timeout, or new blockers.
- ChatGPT provides a concise progress report and only interrupts the user when policy or missing intent requires it.

### 9.3 Implementation and Independent QC

- Claude Code completes the task on an isolated branch, runs required tests, and submits a diff and implementation report.
- MC freezes the candidate commit for review and dispatches Codex with read-only access to the candidate and specification.
- Codex reports findings by severity with evidence and test reproduction steps.
- Blocking findings create rework tasks assigned to Claude Code; non-blocking items are tracked or waived with rationale.
- Claude fixes the issues and may review Codex’s findings, but cannot unilaterally dismiss blocking findings.
- Codex or another independent gate verifies the final candidate; MC marks it `RELEASE_READY`.

### 9.4 Approved Deployment

- MC creates a deployment plan including commit, environment, migration impact, checks, smoke tests, and rollback target.
- The policy engine determines required approvals from the risk tier.
- After approval, a short-lived provider credential is issued to the deployment adapter.
- The adapter deploys, runs smoke checks, records provider IDs and URLs, and revokes/lets the credential expire.
- On failure, MC automatically stops promotion and offers or executes the approved rollback policy.

## 10. MCP Tool Contract

Tool names below are normative for Version 1 unless an existing MC MCP naming convention must be preserved. Each tool must use JSON Schema, reject unknown fields where practical, return a correlation ID, and generate an audit event.

| Tool | Class | Purpose |
| --- | --- | --- |
| mc.system.health | read | Return gateway, queue, connector, and agent health. |
| mc.projects.list | read | List projects visible to the caller. |
| mc.projects.get | read | Return project summary, state, repositories, active tasks, and blockers. |
| mc.projects.create | write | Create an MC project from a structured intake. |
| mc.projects.update | write | Update project metadata or lifecycle state with optimistic concurrency. |
| mc.intake.capture | write | Store a raw voice/chat brain dump and return an intake ID. |
| mc.knowledge.search | read | Search approved knowledge and memory vault scopes with citations. |
| mc.specs.create | write | Create a versioned specification linked to an intake/project. |
| mc.specs.get | read | Retrieve a spec version and approval status. |
| mc.specs.approve | approval | Approve a specific immutable spec version. |
| mc.tasks.create | write | Create atomic tasks with acceptance criteria and dependencies. |
| mc.tasks.claim | write | Lease a task to an agent with TTL and scope. |
| mc.tasks.update | write | Post progress, evidence, blockers, or completion status. |
| mc.agents.list | read | List registered agent capability profiles and availability. |
| mc.agents.dispatch | execute | Create an agent run from a task, profile, context package, and permission envelope. |
| mc.runs.get | read | Return run status, logs, outputs, tool calls, and costs where available. |
| mc.runs.cancel | execute | Cancel a queued or active run. |
| mc.repo.inspect | read | Fetch repository metadata, branch state, PRs, checks, and relevant files. |
| mc.repo.workspace.open | execute | Create or attach to an isolated workspace/worktree. |
| mc.repo.diff | read | Return a normalized diff plus file and risk summary. |
| mc.repo.commit | execute | Create a signed/attributed commit under policy. |
| mc.repo.push | execute | Push an approved branch. |
| mc.repo.pr.create | execute | Open a pull request with evidence and linked tasks. |
| mc.qc.request | execute | Dispatch independent QC against a commit/PR/spec. |
| mc.qc.submit | write | Record findings, severity, evidence, and disposition. |
| mc.approvals.request | approval | Create a human approval request with exact action and expiry. |
| mc.approvals.resolve | approval | Approve or deny a pending request. |
| mc.deploy.plan | write | Generate deployment plan, impact, rollback, and required approvals. |
| mc.deploy.execute | execute | Execute an approved deployment using a short-lived token. |
| mc.deploy.rollback | execute | Rollback to a recorded safe release. |
| mc.audit.query | read | Query immutable action and decision history. |
| mc.notifications.send | execute | Send status/approval notifications through configured channels. |

### 10.1 Common Request Envelope

```json
{
  "request_id": "uuid",
  "actor": {"type": "user|agent|service", "id": "..."},
  "project_id": "mcproj_...",
  "intent_id": "intent_...",
  "expected_version": 17,
  "dry_run": false,
  "approval_token": null,
  "idempotency_key": "..."
}
```

### 10.2 Common Response Envelope

```json
{
  "ok": true,
  "request_id": "uuid",
  "correlation_id": "corr_...",
  "result": {},
  "warnings": [],
  "required_approval": null,
  "audit_event_id": "audit_..."
}
```

### 10.3 Tool Safety Requirements

- Idempotency keys are mandatory for writes, commits, deployment actions, and notifications.
- Optimistic concurrency prevents one agent from overwriting newer project/spec/task state.
- Dry-run mode is supported for repository mutation, infrastructure changes, and deployment plans.
- Every execute-class tool declares risk tier, required scopes, timeout, side effects, and rollback capability.
- Arguments that contain paths, branch names, commands, URLs, or SQL are validated against allowlists and project scope.
- Long-running tools return a run ID and stream or poll structured status rather than holding an uncontrolled session.
- Outputs are size-limited; large logs and artifacts are stored separately and returned by reference.

## 11. Agent Registry and Routing

MC must route work by capability profile, not by brand name. A profile declares skills, quality level, cost/latency class, context limit, supported tools, trust level, data residency, and whether the agent may write or execute.

```json
{
  "agent_id": "claude-code-primary",
  "capabilities": ["typescript", "python", "repo_edit", "test_run"],
  "trust_level": "trusted_workspace_writer",
  "tool_scopes": ["repo:read", "workspace:write", "tests:execute"],
  "forbidden_scopes": ["prod:deploy", "secrets:export"],
  "max_run_minutes": 90,
  "requires_isolation": true
}
```

Routing considers task capability match, project preference, availability, cost, privacy, prior success, and required trust. The user may explicitly select a profile—such as Kimi for a website build—but the policy engine still applies the same scope and release controls.

## 12. Permission and Approval Model

| Risk tier | Examples | Default control |
| --- | --- | --- |
| R0 - Read | Search vaults, inspect repository, summarize status, read logs. | Automatic within granted project scope. |
| R1 - Draft | Create specs, plans, task lists, proposed patches, draft messages. | Automatic; no external side effect. |
| R2 - Workspace write | Edit files on a task branch, run local tools/tests, update MC project records. | Allowed for trusted agents within scoped workspace. |
| R3 - Repository mutation | Commit, push branch, open/update PR, modify issues. | Policy-based approval; may be automatic for trusted repos. |
| R4 - Infrastructure change | Database migration, environment variable update, Supabase/Vercel configuration. | Explicit approval and preflight evidence required. |
| R5 - Production/destructive | Production deploy, branch protection change, secret rotation, data deletion, force push. | Explicit just-in-time approval; two-person/dual-agent verification recommended. |

Permissions must be represented as a short-lived envelope bound to actor, project, repository/environment, allowed tools, path/branch constraints, expiry, and maximum number of uses. “Full permission” should therefore mean a broad but explicit policy profile, not a permanent unrestricted credential.

Recommended user profile: automatic R0-R2 actions; automatic R3 on designated personal repositories after tests; explicit approval for R4-R5. MC should allow repo-specific overrides and an emergency “read-only lock” that immediately disables all mutations.

## 13. Identity, Authentication, and Secrets

- Use per-agent identities; never share one generic token across ChatGPT, Hermes, Claude Code, and Codex.
- Prefer OAuth, GitHub Apps, workload identity, or short-lived tokens over personal access tokens.
- Keep raw secrets inside the MC credential vault or external secrets manager. Tools use a secret reference and receive the value only inside the connector process.
- Never place credentials in prompts, logs, specs, task descriptions, memory, Git commits, or chat responses.
- Redact likely secrets from tool outputs and block commits containing detected credentials.
- Require step-up authentication for production deployments, destructive data operations, secret rotation, and policy changes.
- Support immediate revocation by agent, project, provider, device, and user session.

## 14. Workspace and VS Code Integration

- Create one isolated Git worktree or container per active implementation run.
- Bind the workspace to a project, task, base commit, agent identity, and lease expiry.
- Expose approved workspace operations through MC tools; do not give ChatGPT arbitrary desktop control.
- Claude Code may operate interactively in its workspace through a managed adapter that can send input, capture output, detect prompts, and terminate safely.
- VS Code is a user-facing viewer/editor for the same workspace. Opening VS Code is optional to execution and should not be required for unattended runs.
- On completion, preserve diff, test evidence, logs, and commit; then clean or archive the workspace according to policy.

## 15. Quality Gates and Definition of Done

A task is not complete merely because an agent says it is complete. MC evaluates evidence against the task’s acceptance criteria and repository policy.

| Gate | Minimum evidence |
| --- | --- |
| Specification | Approved immutable spec version and linked acceptance criteria. |
| Implementation | Candidate commit/diff, changed-file summary, and builder report. |
| Automated checks | Required lint, type, unit, integration, build, and security checks with timestamps. |
| Independent QC | Codex findings report; all blocking findings resolved or explicitly waived. |
| Security | Secret scan, dependency/vulnerability checks as required, and permission impact review. |
| Release | Approved deployment plan, environment, rollback target, and provider preflight. |
| Post-deploy | Smoke tests, health checks, release record, and rollback confirmation window. |

## 16. Audit, Observability, and Recovery

- Create an append-only audit event for every intent, tool request, policy decision, approval, agent dispatch, file mutation summary, commit, deployment, and rollback.
- Correlate all events from one user request with a single intent/correlation ID.
- Store structured logs separately from conversational summaries; provide links/references rather than flooding chat.
- Record actor, tool, arguments hash, project, resource, result, risk tier, policy version, approval, timestamps, and evidence references.
- Use heartbeats and leases to detect stalled agents. Expired leases must not retain write authority.
- Support cancellation, retry with idempotency, checkpoint/resume, and deterministic cleanup of orphaned workspaces.
- Back up MC project state, specs, decisions, and audit logs; test restore procedures.

## 17. Data Model

| Entity | Key fields |
| --- | --- |
| Project | id, name, objective, lifecycle_state, owner, repo_links, environment_links, policy_profile, created_at, updated_version |
| Intake | id, project_id, raw_text/audio_ref, normalized_intent, source, actor, timestamp |
| Specification | id, project_id, version, content_ref, hash, status, approvals, supersedes |
| Task | id, project_id, spec_id, title, description, acceptance_criteria, dependencies, state, risk, assignee, lease |
| AgentProfile | id, capabilities, trust, allowed_tools, constraints, runtime_adapter, health |
| AgentRun | id, task_id, profile_id, context_ref, permission_envelope, state, logs_ref, outputs_ref, cost, timestamps |
| Workspace | id, repo, worktree/container, branch, base_commit, task_id, owner_run, lease, cleanup_state |
| QCReport | id, candidate_commit, reviewer, findings, severity, evidence, disposition, verification_run |
| Approval | id, action_hash, risk, requested_by, approver, status, expires_at, resolved_at |
| Deployment | id, project, commit, environment, provider, plan_ref, approval_id, status, evidence, rollback_target |
| AuditEvent | id, correlation_id, actor, action, resource, policy_decision, result, timestamp, evidence_ref |

## 18. API and Schema Conventions

- Use stable opaque IDs with readable prefixes such as `mcproj_`, `task_`, `run_`, `approval_`, and `deploy_`.
- All timestamps use UTC ISO 8601; display may localize to America/Denver.
- All state-changing resources include integer versions for optimistic concurrency.
- All tool schemas are versioned; breaking changes require a new major namespace or explicit compatibility layer.
- Errors use stable codes: `UNAUTHORIZED`, `FORBIDDEN`, `APPROVAL_REQUIRED`, `CONFLICT`, `INVALID_SCOPE`, `DEPENDENCY_BLOCKED`, `TOOL_TIMEOUT`, `POLICY_DENIED`, and `PROVIDER_ERROR`.
- Tool responses never imply success before the underlying action is confirmed.

## 19. Voice and Mobile Interaction Design

Voice commands should produce short, confidence-building responses while MC performs structured work. The liaison confirms the interpreted project and action when ambiguity or risk is meaningful, but routine low-risk commands should not become a questionnaire.

| Spoken request | Expected behavior |
| --- | --- |
| “Capture this idea for the roofing estimator and have Hermes draft the build spec.” | Create intake, identify/create project, retrieve context, dispatch Hermes, then return spec status and any material open questions. |
| “What is holding up Project Atlas?” | Read project/task/run state and summarize the current blocker with evidence. |
| “Tell Claude to continue the checkout fix.” | Resolve the task, inspect workspace/run state, dispatch or resume Claude under the existing approved scope. |
| “Have Codex review what Claude just finished.” | Freeze candidate commit and create an independent QC run. |
| “Push it live.” | Resolve exact candidate/environment, show deployment summary, and request approval if required; never deploy an ambiguous target. |
| “Stop everything.” | Cancel active runs where safe and activate project or global read-only lock according to user scope. |

## 20. Security Threat Model — Required Controls

| Threat | Primary controls |
| --- | --- |
| Prompt injection in repositories or vault content | Treat retrieved content as data; tool policy remains external; label untrusted instructions; restrict tool scopes. |
| Agent exceeds requested scope | Permission envelopes, path/branch allowlists, command restrictions, leases, audit, and runtime isolation. |
| Secret leakage | Secrets broker, redaction, commit scanning, no secret values in prompts/logs, short-lived credentials. |
| Malicious or accidental production change | Risk classification, explicit approval, protected environments, deployment plan, smoke tests, rollback. |
| Conflicting agents overwrite work | Task ownership leases, isolated worktrees, optimistic concurrency, PR-based integration. |
| Compromised agent/model | Per-agent identity, minimal scope, revocation, anomaly detection, no inherited permissions. |
| Voice misrecognition or unauthorized speaker | Device/session authentication, confirmation for high-risk actions, optional speaker/device trust, exact action summary. |
| Audit tampering | Append-only log, remote/immutable storage, hashes/signatures, limited administrator access. |

## 21. Deployment Topology

- Run the MC orchestration gateway as a Windows service, WSL2 service, or containerized service with automatic restart and health checks.
- Keep agent adapters near the tools they control: Claude Code/VS Code adapter on the workstation; GitHub/Vercel/Supabase connectors in a protected service context.
- Expose remote access only through authenticated encrypted transport such as a private mesh/VPN or hardened HTTPS endpoint; do not expose raw local MCP ports directly to the public internet.
- Use separate development and production MC environments or at minimum separate credentials, databases, and policy profiles.
- Place the audit store and project database on durable backed-up storage. Keep ephemeral workspaces separate.

## 22. Implementation Roadmap

| Milestone | Scope | Exit criteria |
| --- | --- | --- |
| M0 - Inventory and threat model | Document current MC MCP, vaults, repos, Claude/Codex/Hermes launch methods, credentials flow, and trust boundaries. | Architecture inventory; data classification; threat model; connector map. |
| M1 - Read-only liaison | Connect ChatGPT to MC for health, project listing, status, knowledge search, spec retrieval, and audit query. | Voice query can safely answer “what is stalled?” with grounded project evidence. |
| M2 - Structured intake and specs | Add brain-dump capture, project creation, spec versioning, and approval. | Voice request creates an MC project and Hermes draft spec without touching code. |
| M3 - Task orchestration | Add task graph, agent registry, run dispatch, leases, logs, and cancellation. | ChatGPT can assign an approved task to Claude Code and report status. |
| M4 - Safe workspace execution | Add isolated worktrees, scoped filesystem writes, test execution, diffs, and branch pushes. | Claude can implement on a branch with full traceability and no production access. |
| M5 - Independent QC loop | Add Codex review, severity policy, rework loop, and release-ready gate. | A build cannot advance until required findings are resolved or explicitly waived. |
| M6 - Deployment controls | Integrate GitHub checks, Vercel, Supabase migrations, secrets broker, approvals, and rollback. | Approved release can deploy with evidence and immediate rollback path. |
| M7 - Mobile/voice operations | Add concise voice confirmations, notification routing, interruption recovery, and remote approval UX. | User can safely direct and approve work from the road. |
| M8 - Autonomy tuning | Introduce trust scores, repo-specific policies, recurring maintenance, and measured automatic approvals. | Routine low-risk work proceeds automatically while high-risk actions remain gated. |

## 23. Initial Repository Structure

```text
mc-orchestrator/
  README.md
  docs/
    architecture.md
    threat-model.md
    tool-contracts.md
    adr/
  apps/
    gateway/
    approval-ui/
  packages/
    schemas/
    policy-engine/
    audit/
    agent-registry/
    task-engine/
  adapters/
    hermes/
    claude-code/
    codex/
    github/
    vscode-workspace/
    vercel/
    supabase/
    notifications/
  tests/
    contract/
    policy/
    integration/
    security/
  infra/
  .github/workflows/
```

## 24. Claude Code Build Instructions

- Treat this document as the governing architecture. Do not silently weaken security or approval requirements to simplify implementation.
- Begin with an inventory of the existing MC MCP server and reuse compatible conventions rather than replacing working components.
- Implement Milestones M0 and M1 first. Produce an interface inventory and a read-only vertical slice before any write or execution tool.
- Use schema-first development. Generate shared request/response types and contract tests for every MCP tool.
- Implement the policy engine as a distinct module called by every tool; do not scatter permission checks through adapters.
- Use mock adapters for Hermes, Claude Code, Codex, GitHub, Vercel, and Supabase until contracts and audit behavior are tested.
- Every pull request must include tests, migration notes, security impact, rollback notes, and updates to this architecture when behavior changes.
- Do not import existing credentials into source or configuration examples. Use placeholders and secret references only.

## 25. Acceptance Criteria for Version 1

- From ChatGPT, the user can list projects, retrieve project status, search authorized MC knowledge, and read a versioned specification.
- A spoken brain dump can create an intake, project, and Hermes specification draft with complete audit linkage.
- An approved task can be dispatched to Claude Code in an isolated workspace with scoped write permissions.
- ChatGPT can observe progress, answer safe prompts, cancel a run, and report blockers without exposing secrets.
- A completed candidate can be independently reviewed by Codex; blocking findings prevent release readiness.
- Commits, pushes, pull requests, infrastructure changes, and deployments follow the configured risk/approval policy.
- All actions are attributable and queryable through the audit log.
- Production deployment uses short-lived credentials, records evidence, runs smoke checks, and supports rollback.
- A global or project read-only lock can immediately stop new mutation actions.

## 26. Architecture Decision Records to Create

- ADR-001: MC as control plane; GitHub as code source of truth.
- ADR-002: Capability-based agent registry instead of hard-coded model routing.
- ADR-003: Isolated worktrees/containers for agent workspace execution.
- ADR-004: Central policy engine with risk-tier approvals.
- ADR-005: Secrets broker and short-lived credential model.
- ADR-006: Append-only correlated audit event model.
- ADR-007: Independent QC gate before release readiness.
- ADR-008: Remote access topology and network boundary.
- ADR-009: Voice confirmation rules for high-risk actions.
- ADR-010: Spec versioning, hashing, and approval semantics.

## 27. Immediate Next Actions

- Create a GitHub repository named `mc-orchestrator` (or map this spec into the existing MC repository if the MCP already lives there).
- Place this document at `docs/architecture.md` and mirror it into the MC knowledge vault under the umbrella project “AI Operating System.”
- Ask Claude Code to inventory the current MC MCP server and produce a gap analysis against Sections 10, 12, 13, and 22—without making production changes.
- Implement the read-only vertical slice: `health`, `projects.list`, `projects.get`, `knowledge.search`, `specs.get`, and `audit.query`.
- Connect ChatGPT only after those tools pass contract, authorization, and audit tests.
- Expand to intake/spec creation, then task dispatch, then code writes, then QC, and only then deployment.

## Appendix A — Example End-to-End Intent

```json
{
  "intent": "continue_project",
  "project_ref": "Atlas",
  "requested_outcome": "finish checkout fix and prepare for QC",
  "constraints": ["do not deploy", "use existing branch if clean"],
  "preferred_agent_profile": "claude-code-primary",
  "source": "chatgpt_voice",
  "user_confirmation_required_above_risk": "R3"
}
```

## Appendix B — Example Approval Request

```json
{
  "approval_id": "approval_123",
  "action": "deploy",
  "project": "Atlas",
  "environment": "production",
  "commit": "abc1234",
  "risk": "R5",
  "checks": {"required": 12, "passed": 12},
  "qc": {"blocking_open": 0, "report_id": "qc_456"},
  "rollback_target": "release_789",
  "expires_at": "2026-07-28T04:15:00Z"
}
```

## Appendix C — Governing Rule

Any material change to agent authority, tool behavior, source-of-truth ownership, approval policy, credential handling, deployment flow, or audit semantics must update this architecture and create or amend an Architecture Decision Record. Implementation that conflicts with the approved architecture is considered a defect until explicitly accepted through the decision process.