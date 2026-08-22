-- Migration 027: bind an operator approval to the exact commit that was reviewed.
--
-- Before this, an approval recorded WHO said yes (approved_by) and WHEN (approved_at) but
-- never WHAT. Consent was therefore a pointer into a mutable column: anything able to
-- rewrite mc_requests.reviewed_sha after the approval landed silently retargeted a live
-- approval at a different commit, and the dispatcher's gated push pushed that commit.
--
-- approved_sha freezes the reviewed commit at decision time. The push gate now requires
-- approved_sha = reviewed_sha = git HEAD, and pushes the literal approved SHA rather than
-- whatever HEAD happens to be by then.
ALTER TABLE mc_requests
  ADD COLUMN IF NOT EXISTS approved_sha TEXT; -- commit frozen at approval time

COMMENT ON COLUMN mc_requests.approved_sha IS
  'The exact commit the operator approved, frozen from reviewed_sha at decision time. NULL unless an approve decision is currently in force: cleared on reject, on resume, and on every new build attempt. The gated push requires approved_sha = reviewed_sha = workspace git HEAD.';
