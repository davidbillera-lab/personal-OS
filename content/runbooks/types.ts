export type RunbookStep = {
  title: string
  detail: string
  tip?: string
  warning?: string
}

export type RunbookScenario = {
  if: string
  then: string
  who?: string
}

export type RunbookRole = {
  who: string
  does: string
  level: 'full' | 'limited' | 'view-only'
}

export type RunbookChapter =
  | { id: string; icon: string; title: string; type: 'text'; content: string }
  | { id: string; icon: string; title: string; type: 'steps'; intro?: string; steps: RunbookStep[] }
  | { id: string; icon: string; title: string; type: 'scenarios'; scenarios: RunbookScenario[] }
  | { id: string; icon: string; title: string; type: 'roles'; roles: RunbookRole[] }

export type TechnicalAppendix = {
  stack: string[]
  integrations: string[]
  how_it_works: string
  owner: string
  repo?: string
  notes?: string
}

export type Runbook = {
  slug: string
  name: string
  tagline: string
  description: string
  tier: 1 | 2 | 3
  stage: string
  emoji: string
  revenue_model: string
  chapters: RunbookChapter[]
  technical: TechnicalAppendix
}
