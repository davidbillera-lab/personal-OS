-- Migration 025: mc_submit_plan planning-artifact intake (Hermes narrow write).
-- Bounded, additive columns on mc_requests so Hermes can deposit a planning
-- artifact on its own submitted request without touching status/assignment.
-- All nullable; length enforced app-side (32 KB cap in lib/mcp-tools.ts).
ALTER TABLE mc_requests
  ADD COLUMN IF NOT EXISTS plan               TEXT,
  ADD COLUMN IF NOT EXISTS plan_submitted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_by            TEXT;
