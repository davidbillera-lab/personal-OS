# Video Optimizer — Generate Thumbnail Skill

Purpose: Provide a small, reusable skill that generates a thumbnail spec and instructions for the Video Optimizer App. This is a documentation-only skill (no runtime code changes).

Inputs:
- `video_metadata` (object): title, duration, dominant_colors, key_frames (array of timestamps)

Outputs:
- JSON object with `suggested_frame_timestamp`, `crop`, `overlay_text`, `notes`.

When to use:
- Called by automation to suggest thumbnails for short-form videos prior to upload.

Implementation notes:
- This SKILL.md is a descriptive doc for Mission Control. To implement an automated worker, create an agent definition under `agents/` that calls the project's thumbnail generation endpoint or invokes an LLM to propose candidate frames.
