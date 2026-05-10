-- Mission Control — Initial Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- Order matters: referenced tables must exist before foreign keys.

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  protected BOOLEAN DEFAULT FALSE,
  stage TEXT NOT NULL CHECK (stage IN ('idea', 'spec', 'build', 'ship', 'scale', 'kill')),
  status TEXT,
  description TEXT,
  repo_url TEXT,
  claude_md_url TEXT,
  last_update TIMESTAMPTZ DEFAULT NOW(),
  next_action TEXT,
  blockers TEXT,
  kill_criteria_status TEXT CHECK (kill_criteria_status IN ('pass', 'warning', 'fail', 'exempt')),
  exit_thesis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BRAIN DUMPS
-- ============================================================
CREATE TABLE brain_dumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text TEXT NOT NULL,
  classified_type TEXT CHECK (classified_type IN ('idea', 'task', 'bug', 'decision', 'kill_candidate', 'unclassified')),
  classification_confidence FLOAT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'inbox' CHECK (status IN ('inbox', 'reviewed', 'actioned', 'archived', 'spec_generated')),
  ai_summary TEXT,
  source TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DECISIONS
-- ============================================================
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  reasoning TEXT,
  decision_date DATE DEFAULT CURRENT_DATE,
  made_by TEXT DEFAULT 'operator',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  brain_dump_id UUID REFERENCES brain_dumps(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  complexity_tier INTEGER CHECK (complexity_tier IN (1, 2, 3, 4)),
  recommended_tool TEXT,
  recommended_model TEXT,
  generated_spec TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'review', 'done', 'killed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MODEL COSTS
-- ============================================================
CREATE TABLE model_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  brain_dump_id UUID REFERENCES brain_dumps(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd DECIMAL(10, 6),
  purpose TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- KILL CRITERIA CHECKS
-- ============================================================
CREATE TABLE kill_criteria_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  check_date DATE DEFAULT CURRENT_DATE,
  functionality_score INTEGER CHECK (functionality_score BETWEEN 0 AND 5),
  efficiency_score INTEGER CHECK (efficiency_score BETWEEN 0 AND 5),
  scalability_score INTEGER CHECK (scalability_score BETWEEN 0 AND 5),
  time_to_revenue_score INTEGER CHECK (time_to_revenue_score BETWEEN 0 AND 5),
  verdict TEXT CHECK (verdict IN ('pass', 'warning', 'fail')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- updated_at TRIGGER (keep updated_at current automatically)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_brain_dumps_updated_at
  BEFORE UPDATE ON brain_dumps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- All tables locked down to authenticated users only.
-- Single-user v1: operator signs in → sees all rows.
-- ============================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_dumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kill_criteria_checks ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write all rows (single-user v1)
CREATE POLICY "authenticated_full_access" ON projects
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON brain_dumps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON decisions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON model_costs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_full_access" ON kill_criteria_checks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
