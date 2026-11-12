-- Migration 032: a brain dump can apply to every project instead of one.
-- Global dumps keep project_id NULL; is_global tells them apart from dumps not yet routed.

ALTER TABLE brain_dumps
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT false;
