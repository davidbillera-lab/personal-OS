---
title: Tech Stack Assessment + Tool Provenance (Opus 4.8, May 2026)
type: knowledge
collection: brain-trust
tags: [brain-trust, strategy, tooling, tech-stack, advice, claude-opus-4.8, provenance]
mc_vault_id: 29636d02-85f6-4fa2-9849-e5bc04b004dc
mc_project: brain-trust
created: 2026-05-29
source: Mission Control vault_items
---

> Mirror of the Mission Control vault entry. MC is the source of truth; this markdown copy exists for human browsing in Obsidian. See [[README]] for the collection index. Related: [[advisory-board-doa-vs-vzt]].

# Tech Stack Assessment + Tool Provenance (Claude Opus 4.8 - 2026-05-29)

Operator-framed honest assessment of David's AI tool "team" as of May 2026, plus a forensic breakdown of how much of each prior tool survives in the College Climb build. Saved at David's request - "way too valuable to not hold tight to."

---

## PART 1 - Provenance: how much of each tool is still in the build

Path: concept on ChatGPT -> build on Lovable -> moved to Manus -> ran out of credits -> Claude Code -> Codex -> back to Claude Code.

Evidence from git (all 29 commits authored as davidbillera-lab; tool attribution inferred from commit style, dates, tree contents):
- **ChatGPT ~0% of code.** Concept only (HTML mockups, planning doc). No surviving code.
- **Lovable + Manus = the Supabase backend survived, the frontend did NOT.** The 24 migrations (Lovable timestamp_UUID naming, College Compass schema/data - 3,733 colleges, 619 scholarships) are the inherited, still-live asset. The Vite/React frontend was 100% discarded ("migrated from Vite/React").
- **Claude Code ~90-95% of running code.** The entire Next.js app (commit 5c1f838: 85 files, 18,886 insertions) and everything since. 76 TS/TSX files today, zero Vite/Lovable frontend fingerprints remain.
- **Codex = small surgical footprint** (auth bypass, migration history sync, demo state - 3 commits on 2026-05-26).

**Where time was wasted:** two discarded frontend build cycles (Lovable, then Manus) + the re-context tax of five tool handoffs. The backend/data was the only thing worth carrying forward - and it was.

---

## PART 2 - Stack assessment as it sits

**Overall verdict:** The stack is genuinely well-shaped. Not a beginner tool-hoard anymore - it is a division of labor with one specialist per lane and minimal overlap. The biggest risk now is NOT a missing tool - it is sprawl and a weak memory/knowledge layer.

### Codex - change its JOB, not its seat
An auditor that silently rewrites code isn't auditing, it is churn. (You saw it: Codex changed things, Claude changed them back, net motion zero, paid tokens both ways.) Fix: stop letting Codex commit. Put it in review-only mode - output a written findings list, you/Claude decide what to act on. Scope it to paths where being wrong costs days (e.g. VZT). On routine work the audit overhead isn't worth it.

### Manus + Claude = "OpenClaw without the risk" - the actual design
OpenClaw/Hermes are risky because ONE autonomous agent holds broad credentials + a live browser + acts without a checkpoint. You don't beat that with a fancier framework - you beat it with a clean contract between two specialists:
- Manus = bounded, well-defined autonomous web/browser work (research, prototyping, admin panels with no API). Sandboxed.
- Claude = planning, code, anything touching production credentials or core repos.
- Handoff = a written spec / MC task, NOT shared live state.
The one hard rule that makes it safe: the autonomous browser agent never gets standing access to production credentials or push rights to core repos. That single boundary IS the whole difference. Don't over-build it into a framework - the MC task + spec is the system.

### Obsidian - the free win you're missing
Claude's agent memory is ALREADY in Obsidian format ([[wikilink]] + YAML frontmatter) at ...\.claude\...\memory\. Point Obsidian at that folder as a vault today -> graph UI, backlinks, the memory visualization you want, over the real memory Claude reads/writes each session. Zero build.
Deeper point: STOP trying to make Mission Control BE Obsidian - that is why MC's memory UI isn't landing. Different jobs:
- MC = operational state. Machine-readable, queryable, multi-agent. Should be a little ugly and very reliable.
- Obsidian = human thinking layer. Your knowledge graph.
Right architecture: one-way sync. Agents write MC -> a job exports MC data into markdown in an Obsidian vault for you to browse. Don't build a pretty graph UI inside MC - Obsidian already does it better for free.

### Where Claude agrees with you (no notes)
- **Antigravity - skip for now.** Google's IDE-agent play, behind. Claude Code + Codex own that lane. Revisit only if you go deep Gemini-native.
- **Gemini - correct to hold.** Cheap multimodal engine for the marketing push that is coming. Spin up when there is a job for it; don't "learn it" early.
- **Lovable - keep, scoped to the agency.** SEO/GEO pivot lines up with the Marblism client-website play. Keep it out of core long-lived builds (clashes with multi-agent GitHub pushes).

### What to actually LEARN - one thing, not a new tool
**MCP (Model Context Protocol) is your integration fabric.** It is how "all the tools work together" actually happens. Already in your world (MC runs an MCP server; Claude has Gmail/Calendar/Drive/Canva connectors now). Investing here means Google ecosystem + MC + Supabase stop being things you manually shuttle between and become tools Claude can act on directly in a session. Deepen Claude Code (skills, subagents, MCP) BEFORE adding anything.

### What to steer clear of
- **Don't add tools, period.** You're at the complexity ceiling for a two-person op. The next tool's cost is learning time competing with shipping. Apply kill-criteria to TOOLS.
- **Cursor** is now redundant with Claude Code for you. Drop unless you love the pairing UX. Two IDE-agents is one too many.
- **Any autonomous-agent framework** (AutoGPT/OpenClaw/Hermes-style). You already smelled the risk. The Manus+Claude contract is the better answer.

### The one honest counter to "sky is the limit"
Opus 4.8 + cheaper credits raised your BUILD ceiling, not your REVENUE ceiling. The constraint was never model capability - it is customers and distribution. The trap of cheaper credits: "build more" feels like progress when the actual bottleneck for College Climb is ship it and get the first paying users. Aim high - but the moon you're shooting for is paying users, not more features.
