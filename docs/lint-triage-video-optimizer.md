# Lint Triage — Video Optimizer Import

Date: 2026-06-11

Summary:
- `eslint --fix` was applied where safe and committed to `video-import-work`.
- Remaining lint issues were inspected and triaged into **Safe** and **Risky** categories.

Safe fixes (low-risk to apply automatically or in a small PR):
- Remove unused variables and imports (warnings in `app/(app)/inbox/page.tsx`, `app/(app)/orchestrate/page.tsx`, `components/ProjectCard.tsx`, `client` debug files).
- Escape unescaped JSX entities (react/no-unescaped-entities) in a few pages (`client/src/pages/*`), replacing `'` with `&apos;` in JSX text nodes.
- Fix trivial `no-this-alias` and unused `e` variables in debug scripts.
- Small TypeScript `any` annotations in UI helpers that can be tightened with local types (non-global changes).

Risky fixes (require review/test because they touch runtime behavior):
- `Calling setState synchronously within an effect` (many files) — these could change render timing and behavior; require careful refactor (move setState into callbacks or useReducer patterns).
- `Cannot access refs during render` — fix requires moving ref-dependent logic into effects or measuring container sizes with ResizeObserver; touching these may affect layout.
- `Unexpected any` in server SDK code — type-tightening could reveal API contract mismatches and needs integration tests.

Recommended next steps:
1. Create a small PR with the **Safe fixes** only (unused imports, JSX escapes, debug script cleanups). I can prepare and push this PR branch now.
2. For **Risky fixes**, open issues referencing the affected files and assign for dedicated follow-up. I can prepare a PR with one targeted risky fix at a time if you want.

Files with notable remaining errors (excerpt):
- `components/ProjectGraph.tsx` — refs-in-render
- `components/VaultGraph.tsx` — refs-in-render
- `components/VaultSidePanel.tsx` — setState-in-effect
- `projects/video-optimizer-app/client/src/components/*` — multiple setState-in-effect and typing issues

If you approve, I'll create and push the PR branch that implements the **Safe fixes** now.
