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