# Vault Digest → NotebookLM Podcast — Build Spec (v0)

**Date:** 2026-08-25
**Status:** DRAFT — requires repo validation by Claude Code in a fresh project window
**Origin:** HQ session (personal-os), per standing rule — spec here, build in a fresh window

---

## 1. Problem (operator language)

David wants NotebookLM's Audio Overview (podcast-style narration) to teach him back what the MC vault already knows about his business — decisions, specs, knowledge — instead of generic AI output. NotebookLM has no API for the free consumer product (confirmed via search, 2026-08-25); the only programmatic path is Gemini Notebook Enterprise, a separate Google Cloud product still in Pre-GA preview. Not worth chasing.

What NotebookLM *does* support today, no API needed: ingesting a Google Doc as a source. So the build is an export job, not an integration.

## 2. Scope (v0)

One on-demand script/command, run in a fresh Claude Code window:

1. Take a topic filter (e.g. "VZT strategy," "College Climb," or "last 30 days") as input.
2. Query the MC vault (`mc_get_vault_context` for the topic, `mc_browse_vault` for recency, `mc_get_vault_item` to expand top matches past their 200-char previews).
3. Assemble a single readable Markdown/Doc digest — narrative enough to be good podcast source material, not a raw JSON dump. Include dates and decision reasoning (the "why," not just the "what").
4. Create the doc via the Google Drive MCP connector already authorized in this environment (`mcp__claude_ai_Google_Drive__create_file`), in a folder David designates.
5. Output the Drive doc link.

**Manual step (v0, stays manual):** David adds the Doc as a NotebookLM source and clicks Generate Audio Overview.

## 3. Explicitly out of scope (v0)

- Hermes involvement of any kind.
- Any recurring/cron/ambient trigger.
- Gemini Notebook Enterprise API or any new Google Cloud project.
- Reusing the vault's existing Gemini API keys (different product, won't work — confirmed).
- Auto-adding the source or auto-generating the Audio Overview inside NotebookLM (no API surface exists for this).

## 4. v1 (only if v0 proves valuable — do not build yet)

Hand the *ambient* half to Hermes, not the export code: Hermes already has read-only vault access and is the always-on layer. Its job would be to notice "N new decisions/specs since the last digest" and message David a nudge (same pattern as the existing alert-digest cron), not to build or own the Drive-write pipeline itself — Hermes stays read-only per the stop-and-flag guardrails. If a recurring auto-refresh is wanted, that's a Vercel cron hitting an API route, same shape as `/api/alerts/digest`.

## 5. Acceptance check

Run the script for one real topic, get a Drive doc back, manually add it to NotebookLM, generate one Audio Overview, confirm it's substantively different from a generic Gemini answer (i.e., it cites the actual decisions/reasoning in the vault).

---

## Fresh-window handoff (paste as first message in a new Claude Code window)

```
Build the v0 vault-digest export described in specs/2026-08-25-notebooklm-vault-digest.md
in personal-os. Scope: one on-demand command that takes a topic filter, pulls matching
content from the MC vault (mc_get_vault_context / mc_browse_vault / mc_get_vault_item),
formats it as a single readable Markdown digest, creates it as a Google Doc via the
Drive MCP connector, and returns the link. No cron, no Hermes, no new credentials.
Read the full spec first. Persist per standing rules: push branch, commit,
mc_write_vault if it's genuinely new architecture (this is a small utility — use judgment),
decisions.md only if it changes anything architectural.
```
