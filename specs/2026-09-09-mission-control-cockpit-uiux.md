# Spec: Mission Control — Operator Cockpit UI/UX Elevation

**Project:** Mission Control (Personal OS) — 698d6376-5819-400b-babc-cd664ee36c04
**Complexity tier:** 2 | **Recommended tool:** Claude Code (Sonnet 5 default)
**Authored by:** Hermes (Terra) | **Date:** 2026-09-09
**Status:** DRAFT — requires repo validation by Claude Code before build

## Goal (operator terms)
Turn Mission Control from a functional admin panel into the cockpit David opens
first. One screen shows the whole portfolio's operating picture and names the
next action, in under two minutes, instead of a flat menu of ten sections. This
is the front-door visual layer of the holdco's connective tissue; clearer
operating state raises velocity across every project and protects
exit-readiness visibility.

## What already exists — do NOT rebuild
- `app/layout.tsx`: root html, Geist + Geist_Mono font vars, `dark` class,
  `bg-background text-foreground`, global Toaster. Preserve the theme tokens.
- `(app)/layout.tsx`: `min-h-screen flex flex-col`, ambient violet/blue glow,
  renders `Nav` + `main container mx-auto max-w-7xl`. Preserve the glow.
- `components/Nav.tsx`: flat top bar, `navLinks[]` (Dashboard, Inbox, Queue,
  Ship, Vault, Guide, Runbook, Finance, Creative, CRM), active-route styling
  `bg-violet-500/15`, `logout` action. Reuse the `cn()` util + route styling.
- `components/ProjectCard.tsx`: already strong — stage chip, kill-status chip,
  blocked box, next-action box, `timeSince()`, Open workspace + VS Code links.
  Do NOT rewrite it; extend or wrap, never regress.
- `(app)/page.tsx`: dashboard already groups projects by ASSET_CLASS_SECTIONS
  (Ventures / Operating Tools / Personal / Web Properties / Client Services)
  with per-class accent + bar colors, `QuickDumpForm` at top.
- Supabase rule: read-only `createAdminSupabaseClient()` (service role) only.
  NO new tables, NO write path, NO auth changes, NO new dependencies.

## The work (Phase 1 — read-only, ships first)

1. **Nav → grouped app shell** — `components/Nav.tsx`
   Replace the flat list with grouped links using a small local config:
   groups = Ops (Dashboard, Inbox, Queue, Runbook), Build (Projects, Ship,
   Vault, Guide), Studio (Creative, CRM, Finance). Sticky, compact, dark;
   reuse existing active-route style. Verify: all 10 routes still reachable,
   active item highlights, Sign out still present, `npm run build` clean.
   No new libs; use `cn()`.

2. **Command palette** — new `components/CommandPalette.tsx`
   Props: `{ routes: {label, href}[], pinned: {name, href}[], onOpen? }`.
   Cmd/Ctrl+K toggles overlay; type-to-filter over routes + actions
   ("open VZT", "add brain dump" → /inbox, "new project" → /projects/new);
   Enter navigates, Esc closes. Keyboard-accessible (focus trap, aria).
   Mount once in `(app)/layout.tsx`, set trigger in `Nav`.
   Verify: Cmd+K opens/filters/navigates; Esc closes with focus restored;
   `npm run build` + browser keyboard pass.

3. **"Today / needs attention" strip** — `(app)/page.tsx`
   Add a top strip above asset sections listing: blocked projects
   (`blockers` set), protected projects (VZT, College Climb, REELFLOW,
   Mission Control), and highest-tier items, each a compact chip/link to its
   workspace, capped ~6 with "+N more". Draw ONLY from already-loaded
   `projects` payload; no new query, no queue coupling.
   Verify: strip renders, chips link to /projects/[id], no new server call.

4. **Pinned priorities + shell finish** — `(app)/layout.tsx`
   Optional `pinned` prop; render 2-4 priority shortcuts (VZT, College Climb)
   above the fold everywhere. Keep ambient glow. Tighten spacing/typography
   to existing tokens. Do NOT add a sidebar; preserve top-bar + single column.
   Verify: pins render on all routed pages, no mobile overflow, build ok.

## Out of scope (Phase 1)
- No backend/API/auth/multi-tenant/table changes; no writes to Git; no
  dispatch/build-from-UI; no new dependencies; no deploy or merge.
- The MC "Liaison workflow queue in UI" request (`02af8552`) is a separate
  card — do not fold it in; keep the strip decoupled from the queue.
- No rename/retheme; preserve the locked dark + violet identity.

## Kill check
- Functionality: surfaces already exist; this only sharpens them. PASS.
- Efficiency: read-only, no new infra, no deps. PASS.
- Scalability: component/group refactor scales with sections. PASS.
- Time-to-revenue: faster operating picture across every project. PASS.

## Model-tier note
Claude Code (Sonnet 5 default) executes; no Opus. Component + Tailwind work.
Keep `createAdminSupabaseClient()` read-only per locked decision.

## Card origin (for cross-reference)
This spec is attached to a Mission Control **own card** under the Mission
Control project (698d6376). Card created via Stage 1 voice/chat intake
(ChatGPT/Codex); Hermes (Terra) attaches this plan once the card exists, then
messages David on Telegram to wake the dispatcher on his go.
---

## Repo validation — 2026-10-10 (Claude Code)

Validated against `spec/mc-cockpit-uiux` merged with `origin/main` (b9dd2c2). Review only; no code changed.

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1 | `app/layout.tsx`: Geist + Geist_Mono vars, `dark` class, `bg-background text-foreground`, global Toaster | holds | app/layout.tsx:6-14, 27-30 |
| 2 | `(app)/layout.tsx`: `min-h-screen flex flex-col`, violet/blue ambient glow, `Nav` + `main container mx-auto max-w-7xl` | holds | app/(app)/layout.tsx:5-13 |
| 3 | `components/Nav.tsx` is a flat top bar with `navLinks[]` of the 10 entries | holds | components/Nav.tsx:8-19 |
| 4 | Active-route style `bg-violet-500/15` | holds | components/Nav.tsx:40 |
| 5 | `logout` action / Sign out present | holds | components/Nav.tsx:6, 48-55 |
| 6 | `cn()` util exists | holds | lib/utils.ts:4 (Nav imports it from `@/lib/utils`) |
| 7 | All 10 nav routes exist (`/`, inbox, queue, ship, vault, guide, runbook, finance, creative, crm) | holds | app/(app)/{page,inbox/page,queue/page,ship/page,vault/page,guide/page,runbook/page,finance/page,creative/page,crm/page}.tsx |
| 8 | `/inbox` exists (target of "add brain dump") | holds | app/(app)/inbox/page.tsx |
| 9 | `/projects/new` exists (target of "new project") | holds | app/(app)/projects/new/page.tsx |
| 10 | `/projects/[id]` workspace route exists (chip target) | holds | app/(app)/projects/[id]/page.tsx |
| 11 | Step 1 puts a "Projects" link in the Build group | **wrong** | No `app/(app)/projects/page.tsx`; only `[id]`, `[id]/edit`, `new`. A `/projects` link would 404. The project list is the dashboard (`/`). |
| 12 | Step 1 "all 10 routes still reachable" | holds, with caveat | Groups list 11 entries (10 existing plus the bogus Projects). Real but unlisted routes: `/orchestrate`, `/vault/graph`, `/inbox/[id]/advisory`, `/runbook/[slug]` |
| 13 | `ASSET_CLASS_SECTIONS` in `(app)/page.tsx`, 5 classes, per-class accent + bar | holds | app/(app)/page.tsx:19-60 (labels match) |
| 14 | `QuickDumpForm` at top of the dashboard | holds | app/(app)/page.tsx:246; components/QuickDumpForm.tsx:9 |
| 15 | Dashboard renders `ProjectCard` | **wrong** | `ProjectCard` is imported nowhere in the repo. The dashboard uses an inline `PipelineCard` (app/(app)/page.tsx:87-155) |
| 16 | `ProjectCard` features: stage chip, kill chip, blocked box, next-action box, `timeSince()`, Open workspace + VS Code links | code exists, but dead and wrong theme | components/ProjectCard.tsx:42, 47-51, 59-63, 65-69, 23, 76-89. Uses light-mode classes (`bg-red-50`, `bg-green-100`) and shadcn `Card`. The live `PipelineCard` has no next-action box, no VS Code link, no `timeSince` |
| 17 | "Extend or wrap ProjectCard, never regress" | **wrong** premise | Nothing renders it, so it cannot regress. The card to protect is `PipelineCard` (page.tsx:87) |
| 18 | `blockers` is in the already-loaded `projects` payload | holds | `select('*')` page.tsx:170; lib/types.ts:58 |
| 19 | `tier` in payload | holds | lib/types.ts:47; already `order('tier')` page.tsx:172 |
| 20 | `protected` flag in payload | holds | lib/types.ts:49; rendered page.tsx:100 |
| 21 | Strip needs no new query | holds | `all` (page.tsx:208) has blockers, tier, protected, kill_criteria_status, name, id; filter in page.tsx |
| 22 | Protected set is "VZT, College Climb, REELFLOW, Mission Control" | missing / unverified | Names are not in code. The DB `protected` boolean is the right source; whether all four have `protected=true` was not checked (no DB access) |
| 23 | Step 4: `(app)/layout.tsx` takes an optional `pinned` prop | **wrong** | Next.js layouts accept only `children` (app/(app)/layout.tsx:3), not custom props. Pins need a data source |
| 24 | Step 2: mount `CommandPalette` in layout, trigger in `Nav` | holds, with caveat | Layout is a server component and can render a client component; Nav is `'use client'` (Nav.tsx:1). Palette `pinned` data has the #23 problem |
| 25 | Palette "open VZT" action | missing | Needs project names/ids from somewhere; same data problem as #23 |
| 26 | "No new dependencies" is achievable for the palette | holds, more work | No dialog/`cmdk` primitive in components/ui (badge, button, card, input, select, separator, sonner, tabs, textarea). Focus trap and Esc/focus restore must be hand-written |
| 27 | Read-only `createAdminSupabaseClient()` rule | holds | lib/supabase.ts:16; planned work adds no writes (existing `quickDump` action already writes, untouched) |
| 28 | No auth changes needed | holds | Route gating lives in proxy.ts (no `middleware.ts`); new components do not touch it |
| 29 | `npm run build` as verify command | holds | package.json scripts.build (also `npm test` = vitest) |

Totals: 29 claims checked. Held 22 (3 with caveats), wrong 4 (#11, #15, #17, #23), missing or unverified 3 (#22, #25, and #16 as dead code counted as partial).

### Corrections to the spec's steps

1. **Step 1 nav:** drop `Projects` from Build, or first build a real `/projects` index (new scope). Recommended: drop it. Consider `startsWith` active matching, since `pathname === href` (Nav.tsx:39) leaves `/runbook/[slug]` and `/vault/graph` unhighlighted. Decide whether `/orchestrate` is surfaced.
2. **"What already exists" ProjectCard bullet:** replace with: the dashboard card is the inline `PipelineCard` (app/(app)/page.tsx:87); `components/ProjectCard.tsx` is unused and light-themed, so do not build on it.
3. **Step 3 strip:** select protected by `p.protected`, not hardcoded names; blocked = truthy `p.blockers`; "highest tier" = `tier === 1` (list is already sorted by tier). Define dedup (a blocked + protected project appears once). There is no `/projects` list, so "+N more" needs a target or should be plain text.
4. **Step 4 pins:** remove the "optional `pinned` prop". Either hardcode a constant `{label, href}` list (needs real project ids, fragile) or fetch protected projects in the layout (one extra read-only query per navigation, which the spec otherwise forbids). Needs David's call.
5. **Step 2 palette:** export one shared route/group config used by both Nav and the palette so they cannot drift.

### Risks and unknowns

- Pins vs "no new query" conflict (#23); decide before building.
- A palette without a dialog library means a hand-rolled focus trap and accessibility, which is most of Step 2's effort and risk.
- `app/(app)/page.tsx` starts with a UTF-8 BOM; use targeted edits, not whole-file rewrites.
- Nav is `sticky top-0 z-10` (Nav.tsx:25); a second sticky pins bar needs offset and z-index care.
- Mobile: Nav is a single non-wrapping row of 10 links; grouping will worsen overflow unless it scrolls or collapses.

### Verdict

**NEEDS REVISION** with 3 blockers:
1. Step 1 links to a non-existent `/projects` route (404).
2. The spec's premise that `ProjectCard` is the live dashboard card is false (unused, light-themed); the "extend or wrap" instruction targets the wrong component.
3. Step 4's "optional `pinned` prop" on a Next.js layout is not implementable; pins need a data-source decision that conflicts with the "no new query" constraint.

Step 3 (the strip) is validated as buildable from the existing payload with no new query. Status line left as DRAFT.
