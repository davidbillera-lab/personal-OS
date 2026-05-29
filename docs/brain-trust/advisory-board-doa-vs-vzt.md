---
title: "Advisory Board - DOA vs VZT: deprecate to cold standby (May 2026)"
type: knowledge
collection: brain-trust
tags: [brain-trust, advisory-board, decision, doa, vzt, deprecation]
mc_vault_id: bfcd3494-7731-4c0e-b5c6-35829ba3676d
mc_project: brain-trust
mc_source_brain_dump: ef5fa07f-9d31-4503-a404-e23ec05fa847
created: 2026-05-29
source: Mission Control vault_items
---

> Mirror of the Mission Control vault entry. MC is the source of truth; this markdown copy exists for human browsing in Obsidian. See [[README]] for the collection index. Related: [[tech-stack-assessment-and-tool-provenance]].

# Advisory Board - DOA vs VZT: deprecate the legacy tool (2026-05-26)

Advisory Board run on the brain dump "what do I do with the project - keep it, pivot it, or shelf it as a backup if VZT glitches out?" Resolved over two rounds once the board pushed back for specifics.

**Context that unlocked it:** The project is the **DOA Listing Agent**. **VZT (Vendor Zen Tool)** is the upgraded replacement built to supersede it. Both currently run; VZT has all the upgrades; DOA still works.

## Round 1 - board pushed back (brain dump too thin)
- **Partner:** No capital-allocation decision possible - "vague anxiety dressed up as a strategy question." Name what you built, the original revenue thesis, sunk cost, and what "VZT glitches out" means.
- **Advisor:** "Is there something we can do to make it viable?" is a classic sunk-cost question. The "bones" framing is a tell - you're seeking permission to pivot without admitting the original idea didn't work. Name what failed first.
- **Colleague:** Can't assess reuse/technical debt without the stack and what the "backup" means architecturally - redundancy play? cannibalizing feature? half-built prototype? Three different conversations.
- **Friend:** You asked three questions in one breath (keep / pivot / shelf) - you haven't decided what you *want*. Sounds like you've already written it off and want permission to let go.

## Round 2 - the actual verdict
- **Partner:** You have V1 (DOA) and a working V2 (VZT) with all features. Running two overlapping tools is a maintenance tax with zero revenue upside. ROI of active DOA investment ~ 0. Only legitimate use = cold standby.
- **Advisor:** You already did the pivot - the bones *became* VZT. You don't run V1 and V2 as equals in production; you deprecate V1 on a timeline. What you're really asking is permission to stop feeling guilty about DOA. You have it. Archive, document, cold-standby it.
- **Colleague:** Marginal cost of DOA in cold/warm standby? If serverless/containerized, near zero - fine to freeze. If it needs active patching or has rotting dependencies, kill or freeze it NOW before it's a liability. Do not run two active codebases doing the same job - that's a maintenance spiral.
- **Friend:** You already built the answer - it's called VZT. Still asking about DOA = you have a hard time closing things out. This is a completion problem, not a strategy problem.

## Agreed Recommendation
**Freeze DOA as cold standby only if infrastructure cost is negligible; fully commit to VZT as the active system; close the loop so it stops consuming mental overhead.**

> Source: Mission Control Advisory Board, brain_dump ef5fa07f-9d31-4503-a404-e23ec05fa847, runs 1-2.
