'use client'

import { useState, useTransition } from 'react'
import { updateShipChecklistItem, triggerGitHubWorkflow } from '@/app/(app)/ship/actions'
import type { Project } from '@/lib/types'

// ─── Checklist definition ─────────────────────────────────────────────────────

interface ChecklistItem {
  key: string
  label: string
  detail?: string
  /** If provided, derive checked state from project — overrides DB value */
  auto?: (p: Project) => boolean
  /** Auto items can't be manually toggled */
  readonly?: boolean
}

const ITEMS: ChecklistItem[] = [
  {
    key: 'landing_page',
    label: 'Landing page live',
    detail: 'Public URL users can visit',
    auto: (p) => !!p.vercel_url,
    readonly: true,
  },
  {
    key: 'analytics',
    label: 'Analytics connected',
    detail: 'Pageviews, signups, funnel tracking',
  },
  {
    key: 'first_100_plan',
    label: 'First 100 users plan',
    detail: 'Documented acquisition path for initial users',
  },
  {
    key: 'weekly_tracking',
    label: 'Weekly progress tracking',
    detail: 'Metrics reviewed on a cadence',
  },
  {
    key: 'exit_scorecard',
    label: 'Exit-readiness scorecard',
    detail: 'Revenue multiple, transferability, docs — Flippa/Empire Flippers ready',
  },
  {
    key: 'supabase_linked',
    label: 'Supabase project linked',
    detail: 'supabase_project_id recorded in OS',
    auto: (p) => !!p.supabase_project_id,
    readonly: true,
  },
  {
    key: 'runbook_exists',
    label: 'Runbook documented',
    detail: 'docs/runbooks/ in repo — Vinnie-safe execution procedures',
  },
]

// ─── GitHub Actions trigger ───────────────────────────────────────────────────

function WorkflowTrigger({ repoUrl }: { repoUrl: string }) {
  const [workflow, setWorkflow] = useState('deploy.yml')
  const [ref, setRef] = useState('main')
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleTrigger() {
    setState('loading')
    startTransition(async () => {
      const res = await triggerGitHubWorkflow(repoUrl, workflow.trim(), ref.trim())
      if (res.error) {
        setState('error')
        setErrorMsg(res.error)
      } else {
        setState('ok')
        setTimeout(() => setState('idle'), 3000)
      }
    })
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
        GitHub Actions
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={workflow}
          onChange={e => setWorkflow(e.target.value)}
          placeholder="deploy.yml"
          className="flex-1 min-w-[120px] rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
        />
        <input
          value={ref}
          onChange={e => setRef(e.target.value)}
          placeholder="main"
          className="w-20 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
        />
        <button
          onClick={handleTrigger}
          disabled={isPending || state === 'loading' || !workflow.trim()}
          className="rounded-md bg-violet-600/20 border border-violet-500/30 px-3 py-1 text-[11px] font-medium text-violet-300 hover:bg-violet-600/30 transition-colors disabled:opacity-40"
        >
          {state === 'loading' ? 'Triggering…' : state === 'ok' ? 'Triggered ✓' : 'Trigger ▶'}
        </button>
      </div>
      {state === 'error' && (
        <p className="text-[11px] text-red-400">{errorMsg}</p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ShipChecklist({ project }: { project: Project }) {
  const stored = project.ship_checklist ?? {}

  // Resolve checked state: auto-derived items override DB
  function isChecked(item: ChecklistItem): boolean {
    if (item.auto) return item.auto(project)
    return stored[item.key] ?? false
  }

  const checkedCount = ITEMS.filter(i => isChecked(i)).length
  const [pending, startTransition] = useTransition()
  const [localState, setLocalState] = useState<Record<string, boolean>>({})

  function getEffectiveChecked(item: ChecklistItem): boolean {
    if (item.auto) return item.auto(project)
    if (item.key in localState) return localState[item.key]
    return stored[item.key] ?? false
  }

  function handleToggle(item: ChecklistItem) {
    if (item.readonly) return
    const next = !getEffectiveChecked(item)
    setLocalState(s => ({ ...s, [item.key]: next }))
    startTransition(async () => {
      await updateShipChecklistItem(project.id, item.key, next)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-300"
            style={{ width: `${Math.round((checkedCount / ITEMS.length) * 100)}%` }}
          />
        </div>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {checkedCount}/{ITEMS.length}
        </span>
      </div>

      {/* Checklist items */}
      <div className="flex flex-col gap-0.5">
        {ITEMS.map(item => {
          const checked = getEffectiveChecked(item)
          const isAuto = !!item.auto
          return (
            <button
              key={item.key}
              onClick={() => handleToggle(item)}
              disabled={isAuto || pending}
              className={[
                'flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                isAuto ? 'cursor-default' : 'hover:bg-white/[0.04] cursor-pointer',
              ].join(' ')}
            >
              {/* Checkbox */}
              <div className={[
                'mt-0.5 shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center',
                checked
                  ? isAuto
                    ? 'bg-blue-500/20 border-blue-500/40'
                    : 'bg-green-500/20 border-green-500/40'
                  : 'border-white/20 bg-white/5',
              ].join(' ')}>
                {checked && (
                  <svg className={`h-2 w-2 ${isAuto ? 'text-blue-400' : 'text-green-400'}`} viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              {/* Label */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${checked ? 'text-gray-300 line-through decoration-white/30' : 'text-gray-200'}`}>
                  {item.label}
                  {isAuto && (
                    <span className="ml-1 text-[10px] text-gray-600 no-underline">(auto)</span>
                  )}
                </p>
                {item.detail && (
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-snug">{item.detail}</p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* GitHub Actions — only shown when repo is linked */}
      {project.repo_url && (
        <WorkflowTrigger repoUrl={project.repo_url} />
      )}
    </div>
  )
}
