# Runbook — Secure Hermes Bot Mode rollout

This rollout is **migration-first and approval-gated**. The branch may be reviewed and pushed, but it must not be deployed or applied to live Hermes profiles as one undifferentiated action.

## Locked outcomes

- `gpt` remains GPT-5.6 Sol through `openai-codex` OAuth by default.
- Terra and Luna are optional aliases through the same subscription route, added only during the later local-profile migration gate.
- Only `gpt` may receive the scoped Mission Control Chief credential.
- Specialist profiles receive no Mission Control credential.
- OpenRouter Opus is retired only after the existing backup and restore drill are reverified.
- The dispatcher remains sandbox-only: clone allowlist off by default and push fixed to `mc-spike-test`. Real-repository Gap D is not closed here.

## Gate 0 — backups and branch evidence

Before any migration or deployment:

1. Verify `C:/Users/david/hermes-backups/bot-team-20260820/hermes-full-pre-team.zip` with SHA-256 `39a89bfc91bc5facece0ff307a70676952315e097af540698f989494bd837552`.
2. Verify the credential-free profile exports and internal snapshot `20260821-052510-pre-bot-team`.
3. Keep the sensitive ZIP outside Git and model context with restrictive local ACLs.
4. Record the exact reviewed branch SHA and Codex verdict.

## Gate 1 — apply migration 027 before application code

Migration `supabase/migrations/027_approval_sha_binding.sql` adds `mc_requests.approved_sha`.

This is an expand migration: old production code ignores the new nullable column, while new branch code immediately selects and writes it. Therefore the safe order is:

1. Obtain explicit database-migration approval.
2. Apply migration 027 while old application code remains live.
3. Verify the `approved_sha` column exists using an authorized, sanitized schema query. Report only presence/type/nullability—never connection strings or keys.
4. If the migration or verification fails, **stop**. Do not deploy application code.
5. Record the migration evidence and exact time.

Code-first deployment is prohibited: approval, resume, status, and dispatcher write-back paths depend on the column.

## Gate 2 — deploy the exact reviewed application SHA

1. Obtain separate deployment approval for the exact reviewed SHA.
2. Deploy that SHA only after Gate 1 passes.
3. Verify the Chief scope is deny-by-default and newly registered tools remain denied.
4. Provision a dedicated Chief credential. Do not reuse a full/orchestrator key.
5. Prove the Chief credential is rejected by the full endpoint and accepted only on the intended scoped route.
6. Verify `mc_submit_plan` remains submitted/Hermes-assigned/write-once and has no dispatch, approval, push, or deployment side effect.
7. Verify approval is bound to `attempt_id` and `approved_sha`, SHA changes invalidate consent, workspace is attempt-bound, and the dispatcher pushes the literal approved SHA.

If any bypass or drift check fails, disable the scoped route and stop. Do not restore broad Hermes access except as a separately approved, monitored, time-bounded break-glass action.

## Gate 3 — migrate local Hermes profiles separately

Only after deployed Gate 2 verification:

1. Obtain local-profile migration approval.
2. Keep `gpt` default as `gpt-5.6-sol` / `openai-codex`.
3. Add aliases to `gpt` only:
   - `terra: openai-codex/gpt-5.6-terra`
   - `luna: openai-codex/gpt-5.6-luna`
4. Preserve Luna compression through Codex OAuth.
5. Remove inactive K3 aliases until Nous authentication/privacy/cost are separately approved.
6. Remove Mission Control from specialist profiles; install only the dedicated Chief credential on `gpt`.
7. Reverify Opus dependencies, then retire the OpenRouter Opus profile using the supported backup/restore path.
8. Keep fallback chains empty.
9. Validate provider/model resolution offline. A live inference sentinel requires separate approval.

Safe rollback disables Mission Control on `gpt` and restores non-MC configuration. It does not reconnect the broad endpoint automatically.

## Cost and privacy boundary

No real per-request spend ledger is implemented in this branch. `DISPATCHER_TIMEOUT_MS` is a wall-clock kill limit, **not a monetary cost cap**. The mounted Claude OAuth credential can still consume subscription inference while a sandboxed build runs.

Until a separately specified spend ledger exists:

- no automatic external model escalation;
- no standing premium Bot groups;
- OpenRouter/Nous calls require per-task provider, data-class, token/output, and dollar approval;
- provider failures fail closed because fallback chains remain empty;
- proposed external-model trial ceiling remains $5/month, but it is an operator policy—not an enforced ledger.

The existing dispatcher output sanitizer remains the outbound redaction boundary. Private Mission Control data, customer/student PII, protected-source material, and unrelated credentials must not be sent to external specialist models.

## Evidence required before completion

- Migration 027 applied and column presence verified.
- Exact deployment SHA and independent Codex verdict.
- Chief credential full-endpoint rejection test.
- Exact tool list for Chief and no MC tools on specialists.
- Sol remains default; Terra/Luna resolve via `openai-codex` only.
- No active Anthropic API/OpenRouter Opus route.
- Approval/attempt/SHA/workspace/push boundary tests pass.
- Focused security suites pass; production build passes with non-secret synthetic build-time variables.
- Any unrelated Windows clone-fixture failure remains explicitly separated from this security change.
