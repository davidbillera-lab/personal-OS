# Venture Studio Framework — Design (v1, schema layer)

**Date:** 2026-07-12
**Status:** Approved direction; implementation in fresh window
**Context:** MC evolves from project dashboard into the operating framework of a venture studio (Martell-Ventures-style hierarchy). Core insight: the existing `tier` field (1/2/3) encodes *priority/protection*, not *asset class* — the two are tangled (launch-ready College Climb sits tier 3; live-billing Meridian tier 2). A studio needs them as two separate axes.

## Design

### 1. New axis: `projects.asset_class`

Add `asset_class text NOT NULL DEFAULT 'venture'` with check constraint:
`asset_class IN ('venture','operating_tool','personal','web_property','client_service')`

- `venture` — GTM multi-tenant assets built to scale/sell
- `operating_tool` — internal assets that run JSG/the studio
- `personal` — built for loved ones; catalogued as body-of-work, not marketed
- `web_property` — David-owned websites (Lovable builds)
- `client_service` — agency/client work

`tier` is unchanged and stays the priority/protection axis. Decisions made during design: personal stays ONE class (live-vs-archive is already captured by `stage`); websites get their own class rather than bundling with agency work (own assets ≠ client work).

### 2. Backfill map (existing 18 rows)

| asset_class | Projects |
|---|---|
| venture | College Climb, Meridian, Vendor Zen Tool, FlipRadar, REELFLOW, Auction House US Scale, AI Receptionist Business, Deal Finder (killed) |
| operating_tool | DOA Listing Agent, Video Optimizer App, Mission Control, JSG Operations (archived), Brain Trust |
| personal | Mom's Morning Light, Haunted Threads After Dark, KDP Publishing Pipeline, Liquidation Motivation Collab |
| client_service | Marblism Agency |

Operator may reclassify any row; the map above is the starting default.

### 3. New web_property rows

Websites are not in MC at all today. Insert as projects with `asset_class='web_property'`, tier 3, stage per reality:
- jsgliquidators.com
- skincarebynicole.com
- rodanheatingandair.com
- (enumerate remaining Lovable sites via Lovable MCP `list_projects` during implementation and add the live ones)

### 4. Dashboard: studio hierarchy view

Group project cards by `asset_class` sections (Ventures / Operating Tools / Personal / Web Properties / Client Services) instead of flat tier sort. Tier badge remains on cards. Pinned/protected behavior unchanged.

### 5. Explicitly deferred (v2+)

Financial roll-ups per asset class, entity/equity modeling, per-class exit-readiness scoring, studio P&L. Do not build tonight.

## Implementation shape (for the plan)

1. Migration on mission-control Supabase (`dmtctlpzlfpcogpjweuv`): add column + constraint, backfill UPDATEs, INSERT web_property rows. Use `apply_migration`.
2. Dashboard grouping change in personal-os Next.js app (find the projects list component; group by asset_class).
3. MCP surface: `mc_get_project_context` / project list tools should return `asset_class` (touch `lib/mcp-tools.ts` + `mcp-server.mjs` + `app/api/mcp/route.ts` together — all three, per standing convention).
4. Log decision in `decisions.md`; sync MC status at close.

Small, reversible, additive — no destructive changes to tier or existing data.
