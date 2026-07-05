# Vault Graph v2 — Solar-System Starfield, Guided Tour, Token-Lean Agent Access

**Date:** 2026-07-04
**Status:** Approved by operator (brainstorming session with visual mockups)
**Scope:** Personal OS (Mission Control) — Vault surface + MCP tools

---

## Problem

The Vault graph has become an unreadable hairball as the vault grows:

1. **Quadratic edges.** Every pair of items sharing a tag gets its own edge — 20 items with one shared tag produce 190 crossing lines.
2. **Exhaust drowns knowledge.** Auto-captured records (`git_push`, `agent_session`, `file_snapshot`, `mcp_event`) outnumber real knowledge and render at the same size/prominence, forming giant same-color "grape" clusters with colliding labels.
3. **Cramped canvas.** The graph lives in a 560px box under the list view.
4. **No age signal.** A decision from January looks identical to one from yesterday.
5. **Non-operators can't read it.** Vinnie/JJ have no way to understand what they're looking at.
6. **Agents over-fetch.** `mc_get_vault_context` returns 8 × 500-char previews with no way to fetch one item's full content by id — agents burn tokens on previews and still can't get the full document they need.

## Approved Design

### 1. Full-screen graph page

- New route **`/vault/graph`** — full-viewport dark canvas.
- The Vault page (`/vault`) replaces its embedded graph with a **live preview card** that links to the full page. The list view remains the working surface; the graph page is the "map room."
- **Toolbar overlay** on the graph: search box, type-filter chips, project filter, and the "What is this?" tour button.
- **Side panel:** reuse existing `VaultSidePanel` unchanged — slides over the graph on node click.
- Rendering engine stays **`react-force-graph-2d`** (canvas). No new graph library. (WebGL rewrite evaluated and rejected — capacity we don't need at a few hundred items.)

### 2. Visual language — solar-system hierarchy

**Node classes:**

| Class | Types | Rendering |
|---|---|---|
| **Planet** | `knowledge`, `build_spec`, `decision_log`, `brain_dump_mirror`, `credential`, `skill`, `agent`, `personal`, `ab_conversation` | Sized ~3–17px by type significance (`TYPE_WEIGHT`) **plus content volume** (log of chars — a 40k-char spec is a gas giant, a one-liner a small rock) plus connectivity. Full type color, radial-gradient body with drifting sheen and day/night terminator. Deterministic surface variants per item: top-significance types get rings, others banded (Jupiter), storm-swirl, or smooth. Fresh planets get a pulsing glow halo. *(Revised 2026-07-05 from the original 5–9px flat band after operator smoke test.)* |
| **Star** | `git_push`, `agent_session`, `file_snapshot`, `mcp_event` | Tiny (1.5–2.5px) dim points, label-less at rest, positioned by physics on the cluster rim. Every record stays individually present — no collapsing, no aggregates. |
| **Tag hub** | synthetic node per tag | Small (~6px) dark disc with violet ring; tag name label visible at far zoom (these are the "territory" labels). |

**Edges — tag hub model:** items link to their tags' hub nodes; item↔item edges are removed. Edge count becomes linear in item count, and force physics forms visible cluster territories (the "starfield + clusters" Obsidian/Karpathy look). Edges render thin and faint (~8–12% opacity), brightening for the hovered/selected neighborhood.

**Age = brightness:** node opacity/luminance driven by `updated_at` (last activity — a revisited old item lights back up):

- ≤ ~3 days: full brightness
- smooth ease down to a **~35% floor at 90+ days** for planets (never invisible, always hoverable)
- stars use the same curve on a dimmer base (fresh star ≈ 75%, old star ≈ 20%)
- items updated within **~7 days** get a slow soft **pulse** (gentle radius/glow oscillation driven by `requestAnimationFrame` time inside the canvas draw — no physics re-layout, cheap)

**Hover emphasis (operator requirement):** hovered node **grows smoothly ~1.8×** with a brighter halo, easing in/out (animated scale, not a snap), and shows its title tooltip/label. Applies to planets, stars, and tag hubs alike. Click opens the side panel with full contents, same as today.

**Labels:** zoom-gated. Far zoom shows only tag-hub territory labels; item labels fade in past a zoom threshold or on hover/selection. This removes the label-collision mess entirely.

**Ambient motion — "living galaxy" (operator requirement):**

- **Shimmer:** stars twinkle — a slow per-node brightness oscillation with randomized phase offsets (seeded from node id) so the field flickers organically, never in unison. Planets get a subtle animated sheen drift on their gradient highlight. Both are time-based effects inside the canvas draw loop; no physics involvement.
- **Galaxy rotation:** the entire field drifts in a very slow rotation around the graph centroid (~minutes per revolution — barely perceptible while watching). Implemented as a camera/coordinate transform, not by moving node physics positions.
- **Interaction guard:** ambient rotation eases to a stop on any interaction (hover, drag, pan, zoom-in past the reading threshold, tour active) and eases back in after a few seconds idle. Hover targets never slide out from under the cursor. Shimmer stays on always — it doesn't affect hit targets.
- All ambient animation runs off a single `requestAnimationFrame` clock; effects must degrade gracefully (rotation and shimmer off) if the tab reports reduced-motion preference.

**Search/filter behavior:** unchanged in spirit — matches stay bright, non-matches dim to ~10%; hover/selection neighborhood highlighting preserved.

### 3. Guided tour — "What is this?"

Step-driven spotlight overlay **on the real graph**, written for a zero-context viewer (Vinnie-tier plain English). No separate explainer page to keep in sync.

- ~7 steps; each dims everything except a target, pans/zooms to it, and shows a narration card:
  1. "This is David's second brain — every decision, idea, and lesson lives here as a dot."
  2. A planet (knowledge node): "big colorful dots are things David learned or decided."
  3. A tag hub + its cluster: "topics pull related things together into neighborhoods."
  4. Bright vs. dim: "bright = touched recently, dim = sleeping."
  5. A star: "tiny dots are automatic work history — every code push and AI work session."
  6. "AI agents read this vault so David never has to re-explain context."
  7. "Click any dot to read what's inside. Explore."
- **Targets picked live from actual data** (brightest planet, largest tag hub, any star) so the tour never goes stale.
- Next / Back / Skip controls; restartable anytime from the toolbar button.

### 4. Token-lean agent access (MCP)

Per the MCP tool-placement rule, all three files change together: `lib/mcp-tools.ts`, `mcp-server.mjs`, `app/api/mcp/route.ts`.

1. **New tool `mc_get_vault_item`** — fetch one item's full content by `id`. Respects `is_mcp_accessible`; never returns encrypted or personal items. This is the missing "step 2."
2. **Slim `mc_get_vault_context`** — preview drops 500 → **200 chars** per hit; results keep `id`; tool description updated to teach the two-step pattern: *search cheap → `mc_get_vault_item` for the one you need in full.*

Net effect: typical context pull drops from ~4k chars of previews to ~1.6k, and agents fetch full documents only when they ask for exactly one.

### 5. Architecture & code layout

- **`lib/vault-graph.ts` (new, pure logic, no canvas/React):** tag-hub graph builder (nodes + links from `VaultItemListItem[]`), star/planet classification, age → brightness curve, node radius calculation. Unit-testable in isolation.
- **`components/VaultGraph.tsx`:** becomes the canvas renderer consuming `lib/vault-graph.ts` output — gradient planets, star points, pulse + hover-grow animation (time-based in `nodeCanvasObject`), zoom-gated labels.
- **`components/VaultGraphTour.tsx` (new):** tour overlay (spotlight, narration cards, step state, camera control via force-graph `centerAt`/`zoom`).
- **`app/(app)/vault/graph/page.tsx` (new):** full-screen page — data load, toolbar, filters, side panel, tour mount.
- **`app/(app)/vault/page.tsx`:** graph view replaced by preview card linking to `/vault/graph`.
- **No schema changes.** `created_at`/`updated_at` already load. Read-side only.

### 6. Error handling

- Empty vault / all filtered out → friendly empty state (exists today, keep).
- Items with no tags → link to a synthetic "untagged" hub so nothing floats detached.
- Tour targets missing (e.g. no stars exist) → step auto-skips.
- `mc_get_vault_item` with unknown/inaccessible id → clear error string, no leak of encrypted content.

### 7. Testing

- **Unit tests** on `lib/vault-graph.ts`: tag-hub link building (counts, untagged handling), star/planet classification, brightness curve boundaries (fresh / 90-day floor), radius bands.
- **MCP:** call `mc_get_vault_context` and `mc_get_vault_item` against the deployed endpoint; verify slim previews, full fetch, and encrypted-item refusal.
- **Visuals/tour:** verified by eye in the browser (animation is not meaningfully unit-testable).

## Explicitly Out of Scope

- WebGL/sigma.js rewrite (rejected — unneeded at current scale)
- Exhaust aggregation/collapsing (rejected in favor of star/planet hierarchy)
- Separate standalone explainer page (rejected in favor of on-graph tour)
- Any vault schema or capture-pipeline changes
- 3D graph

## Decision Trail (from brainstorming)

- Aesthetic north star: **starfield + visible clusters** (Obsidian/Karpathy)
- Edge model: **tag hub nodes** (kills quadratic edges, creates clusters for free)
- Age signal: **`updated_at`** (activity re-brightens; heat map of attention)
- Exhaust: operator chose **keep every record as individual tiny "distant star" nodes** after visual comparison of hide/aggregate/shrink options — with planet/star size classes carrying the hierarchy
- Explainer: **guided tour on live graph**, not a separate page
- Approach: **evolve existing engine + promote graph to full-screen route** (~2 sessions)
- Operator addition at approval: **hover-grow emphasis** on all nodes
- Operator addition post-approval: **living-galaxy ambient motion** — star twinkle, planet sheen, slow whole-field rotation that pauses during interaction
