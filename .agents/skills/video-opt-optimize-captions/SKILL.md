# Video Optimizer — Optimize Captions Skill

Purpose: Describe a reusable skill to generate optimized captions and hashtags for short-form video platforms.

Inputs:
- `transcript` (string)
- `platform` (string) — e.g., 'tiktok'|'youtube'|'instagram'

Outputs:
- `caption` (string)
- `hashtags` (array)
- `short_description` (string)

Notes:
- This is documentation for Mission Control; an automated agent can call the project's captioning API or an LLM with the transcript to produce the outputs.
