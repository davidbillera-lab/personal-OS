-- Mission Control — Seed Data
-- Run AFTER 001_initial_schema.sql
-- Populates the 9 portfolio projects across all three tiers.

-- ============================================================
-- TIER 1 — Cash + Scale (protect and accelerate)
-- ============================================================
INSERT INTO projects (
  name, slug, tier, protected, stage, status, description,
  repo_url, kill_criteria_status, exit_thesis, next_action
) VALUES
(
  'Vendor Zen Tool',
  'vzt',
  1, TRUE, 'scale',
  'Multi-tenant transition in progress',
  'Internal production tool → multi-tenant SaaS. Powers JSG estate liquidation workflow. Operator is sole code committer. Revenue expected within months.',
  'https://github.com/davidbillera-lab/vendor-zen-tool',
  'exempt',
  'Multi-tenant SaaS productization — strategic acquirer in estate/auction vertical',
  'Complete multi-tenant migration; add staging Supabase environment'
),
(
  'REELFLOW',
  'reelflow',
  1, TRUE, 'build',
  'Multi-tenant transition in progress',
  'Marketing automation + video content SaaS. Multi-tenant productization underway.',
  NULL,
  'exempt',
  'Multi-tenant marketing automation SaaS — strategic or financial acquirer',
  'Define multi-tenant architecture; scope Phase 1 paying tenant'
),
(
  'JSG Operations',
  'jsg-ops',
  1, FALSE, 'scale',
  'Active / cash-flowing',
  'JSG Estate Liquidators LLC — Denver metro. Active liquidation, auction house, and e-commerce consignment. Cash-flowing parent business.',
  NULL,
  'pass',
  'Exit via acquisition or revenue multiple on Flippa/Empire Flippers when portfolio is ready',
  'Maintain current revenue; support VZT multi-tenant as operational multiplier'
);

-- ============================================================
-- TIER 2 — Active builds with exit potential
-- ============================================================
INSERT INTO projects (
  name, slug, tier, protected, stage, status, description,
  kill_criteria_status, next_action
) VALUES
(
  'Deal Finder + Garage Sale Hunter',
  'deal-finder',
  2, FALSE, 'build',
  'Active build',
  'Deal discovery tool for estate sale, garage sale, and resale arbitrage. Adjacent to JSG operations.',
  'pass',
  'Define v1 feature scope; begin build or spec out kill criteria'
),
(
  'Marblism Agency',
  'marblism',
  2, FALSE, 'build',
  'Active / paying clients',
  'Websites + SEO/GEO for paying clients. Marblism EVA assistant handles email/calendar for operator.',
  'pass',
  'Continue client delivery; scope productization path'
),
(
  'Auction House US Scale',
  'auction-scale',
  2, FALSE, 'idea',
  'Pre-spec',
  'Scale JSG auction house model to US markets beyond Denver metro.',
  'pass',
  'Define kill criteria and spec v1 before build begins'
);

-- ============================================================
-- TIER 3 — Personal / family with upside
-- ============================================================
INSERT INTO projects (
  name, slug, tier, protected, stage, status, description,
  repo_url, kill_criteria_status, exit_thesis, next_action
) VALUES
(
  'College Climb',
  'college-climb',
  3, FALSE, 'build',
  'Pre-validation — JJ smoke test pending',
  'College search + scholarship matching + essay help for high schoolers and parents. JJ (16, junior) is target user and Phase 1 tester.',
  'https://github.com/davidbillera-lab/college-compass-ui',
  'pass',
  '1M users — 5x baseline exit / 10x stretch via strategic acquirer in EdTech',
  'JJ smoke test with real data (Phase 1); recruit beta cohort (Phase 2)'
),
(
  'KDP Publishing Pipeline',
  'kdp',
  3, FALSE, 'idea',
  'Nicole-led; pre-spec',
  'Automated KDP publishing pipeline. Nicole leads. Automation-friendly revenue stream.',
  NULL,
  'pass',
  'Nicole-led; automation-friendly passive revenue',
  'Nicole to define v1 scope; operator reviews kill criteria'
),
(
  'AI Receptionist Business',
  'ai-receptionist',
  3, FALSE, 'build',
  'JJ-led; active build',
  'AI receptionist service for trade businesses (plumbers, HVAC, contractors). JJ leads. B2B revenue model.',
  NULL,
  'pass',
  'JJ-led B2B SaaS — trade business vertical; exit via strategic acquirer',
  'JJ to complete v1 build; operator reviews architecture before first paying client'
);
