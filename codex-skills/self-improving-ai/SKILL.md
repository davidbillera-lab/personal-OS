---
name: self-improving-ai
description: Design or audit self-improving AI correction loops in David's products. Use when an AI feature identifies, classifies, extracts, drafts, or generates content that humans later correct, or when implementing Hermes-style capture, distill, and re-inject learning loops for VZT, Mission Control, College Climb, FlipRadar, REELFLOW, or other JSG builds.
---

# Self-Improving AI

Every human correction is high-signal product data. Capture it, distill it, and re-inject it so the system stops repeating mistakes.

## Use When

The feature has both:

- AI output: identification, classification, extraction, category, title, price, answer, caption, or draft.
- Human review: accept-with-edits, override, refine, re-tag, re-file, or correction.

If both are true, build the loop.

## Three-Stage Pattern

1. Capture: write before/after correction data in a non-blocking helper.
2. Distill: batch corrections into general lessons.
3. Re-inject: add relevant lessons/corrections to future evaluative AI calls.

All three stages matter. Capture without re-injection is a log, not a learning loop.

## Guardrails

- Never block the primary workflow. Capture and lesson reads are best-effort.
- Capture only real diffs. Do not store non-corrections.
- Preserve tenant/user isolation. RLS and request-authenticated reads matter.
- Inject nothing when no lessons exist.
- Keep hot-path model cost low: Tier 1 for category/embedding/retrieval, Tier 2 for batch distillation, avoid heavy models inline.
- Log AI costs where the project tracks `model_costs`.

## Implementation Checklist

- Corrections table with wrong value, corrected value, source, category/context, user or tenant id, timestamps.
- Fire-and-forget capture helper at each human correction site.
- Distillation job or function that creates general lessons after enough corrections.
- Lesson retrieval before evaluative/generative AI calls.
- Prompt section that clearly separates learned lessons from base instructions.
- Effectiveness tracking if the same field is corrected again after a lesson was injected.

## RLS Gotcha

For Supabase edge functions, validating a JWT with `getUser()` is not enough for RLS reads. Create the client used for user-scoped reads with the caller's `Authorization` header attached so `auth.uid()` policies see the user.

