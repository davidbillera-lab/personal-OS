---
name: video-opt-generate-thumbnail
description: Agent wrapper for the `generate-thumbnail` skill. Uses project API or a model to suggest thumbnail frames and metadata.
runbook:
  - step: Gather `video_metadata` (title, key_frames)
  - step: Call the project's thumbnail suggestion endpoint (`/api/thumbnail/suggest`) if available, otherwise call the LLM with the `video_metadata`.
  - step: Return JSON with `suggested_frame_timestamp`, `crop`, `overlay_text`, `notes`.
---

This file is an agent descriptor for Mission Control; implement the runtime worker separately if you want automation.
