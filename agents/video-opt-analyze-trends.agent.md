---
name: video-opt-analyze-trends
description: Agent that ingests recent metrics and returns trend analysis and recommendations.
runbook:
  - step: Pull recent metrics from analytics source
  - step: Summarize top-performing themes and format recommendations
  - step: Return `trend_summary` and `recommendations`
---

Documentation-only agent file for MC.
