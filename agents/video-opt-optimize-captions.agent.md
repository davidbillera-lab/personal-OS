---
name: video-opt-optimize-captions
description: Agent that produces platform-optimized captions and hashtag lists from a transcript.
runbook:
  - step: Retrieve transcript for the video
  - step: Call captioning service or LLM with platform constraints
  - step: Return `caption`, `hashtags`, and `short_description`.
---

Documentation-only agent definition for Mission Control.
