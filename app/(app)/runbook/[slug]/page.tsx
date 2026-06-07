import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRunbook } from '@/content/runbooks/data'
import type { RunbookChapter, RunbookStep, RunbookScenario, RunbookRole } from '@/content/runbooks/types'
import { RunbookTOC } from '@/components/RunbookTOC'
import { RunbookAppendix } from '@/components/RunbookAppendix'

const TIER_HERO: Record<number, string> = {
  1: 'from-violet-950/70 via-violet-950/20 to-transparent',
  2: 'from-blue-950/70 via-blue-950/20 to-transparent',
  3: 'from-emerald-950/70 via-emerald-950/20 to-transparent',
}

const TIER_BADGE: Record<number, string> = {
  1: 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30',
  2: 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30',
  3: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30',
}

const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 · Protect & Scale',
  2: 'Tier 2 · Active Build',
  3: 'Tier 3 · Personal',
}

const STAGE_BADGE: Record<string, string> = {
  active: 'bg-green-500/15 text-green-300',
  build: 'bg-indigo-500/15 text-indigo-300',
  spec: 'bg-yellow-500/15 text-yellow-300',
  ship: 'bg-violet-500/15 text-violet-300',
  scale: 'bg-cyan-500/15 text-cyan-300',
}

// ─── Chapter renderers ────────────────────────────────────────────────

function StepCard({ step, index }: { step: RunbookStep; index: number }) {
  return (
    <div className="flex gap-4 group">
      <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.08] text-xs font-bold text-gray-500 mt-0.5 group-hover:border-white/20 transition-colors">
        {index + 1}
      </div>
      <div className="flex-1 pb-5 border-b border-white/[0.04] last:border-0 last:pb-0">
        <h3 className="text-sm font-semibold text-white">{step.title}</h3>
        <p className="mt-1.5 text-sm text-gray-400 leading-relaxed">{step.detail}</p>
        {step.tip && (
          <div className="mt-3 flex gap-2.5 rounded-lg bg-emerald-500/[0.08] border border-emerald-500/20 px-3.5 py-2.5">
            <span className="text-sm shrink-0">💡</span>
            <p className="text-xs text-emerald-300/90 leading-relaxed">{step.tip}</p>
          </div>
        )}
        {step.warning && (
          <div className="mt-3 flex gap-2.5 rounded-lg bg-amber-500/[0.08] border border-amber-500/20 px-3.5 py-2.5">
            <span className="text-sm shrink-0">⚠️</span>
            <p className="text-xs text-amber-300/90 leading-relaxed">{step.warning}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ScenarioCard({ scenario }: { scenario: RunbookScenario }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="flex gap-4 px-4 py-3.5 border-b border-white/[0.06]">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-gray-600 w-8 pt-0.5">IF</span>
        <p className="text-sm text-gray-300 leading-relaxed">{scenario.if}</p>
      </div>
      <div className="flex gap-4 px-4 py-3.5">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-green-600 w-8 pt-0.5">THEN</span>
        <div>
          <p className="text-sm text-gray-400 leading-relaxed">{scenario.then}</p>
          {scenario.who && (
            <p className="mt-1.5 text-[11px] text-gray-600">{scenario.who}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function RoleCard({ role }: { role: RunbookRole }) {
  const levelLabel = role.level === 'full' ? 'Full access' : role.level === 'limited' ? 'Limited' : 'View only'
  const levelClass =
    role.level === 'full'
      ? 'bg-green-500/15 text-green-300'
      : role.level === 'limited'
        ? 'bg-yellow-500/15 text-yellow-300'
        : 'bg-gray-500/15 text-gray-400'

  return (
    <div className="flex items-start gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
      <div className="min-w-[110px]">
        <span className="text-sm font-semibold text-white">{role.who}</span>
      </div>
      <div className="flex-1">
        <p className="text-sm text-gray-400 leading-relaxed">{role.does}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${levelClass}`}>
        {levelLabel}
      </span>
    </div>
  )
}

function ChapterHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-2xl">{icon}</span>
      <h2 className="text-base font-semibold text-white">{title}</h2>
    </div>
  )
}

function ChapterSection({ chapter }: { chapter: RunbookChapter }) {
  return (
    <section id={chapter.id} className="scroll-mt-24 py-8 border-b border-white/[0.05] last:border-0">
      <ChapterHeader icon={chapter.icon} title={chapter.title} />

      {chapter.type === 'text' && (
        <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{chapter.content}</p>
      )}

      {chapter.type === 'steps' && (
        <div className="flex flex-col gap-0">
          {chapter.intro && (
            <p className="mb-5 text-sm text-gray-500 leading-relaxed">{chapter.intro}</p>
          )}
          {chapter.steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} />
          ))}
        </div>
      )}

      {chapter.type === 'scenarios' && (
        <div className="flex flex-col gap-3">
          {chapter.scenarios.map((s, i) => (
            <ScenarioCard key={i} scenario={s} />
          ))}
        </div>
      )}

      {chapter.type === 'roles' && (
        <div className="flex flex-col gap-2">
          {chapter.roles.map((r, i) => (
            <RoleCard key={i} role={r} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function RunbookPage({ params }: { params: { slug: string } }) {
  const runbook = getRunbook(params.slug)
  if (!runbook) notFound()

  const heroGradient = TIER_HERO[runbook.tier] ?? TIER_HERO[1]
  const tierBadge = TIER_BADGE[runbook.tier] ?? TIER_BADGE[1]
  const tierLabel = TIER_LABEL[runbook.tier] ?? ''
  const stageBadge = STAGE_BADGE[runbook.stage] ?? 'bg-white/10 text-gray-400'

  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <div className={`relative rounded-xl mb-6 overflow-hidden bg-gradient-to-br ${heroGradient} border border-white/[0.07] px-6 pt-8 pb-6`}>
        <div className="flex items-start gap-4">
          <span className="text-5xl leading-none">{runbook.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${tierBadge}`}>
                {tierLabel}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${stageBadge}`}>
                {runbook.stage}
              </span>
            </div>
            <h1 className="text-xl font-bold text-white">{runbook.name}</h1>
            <p className="mt-1.5 text-sm text-gray-400 leading-relaxed max-w-xl">{runbook.tagline}</p>
            {runbook.revenue_model && (
              <p className="mt-3 text-[11px] text-gray-600">
                <span className="text-gray-700">Revenue model: </span>
                {runbook.revenue_model}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <Link
            href="/runbook"
            className="text-[11px] text-gray-600 hover:text-gray-400 transition"
          >
            ← All Runbooks
          </Link>
        </div>
      </div>

      {/* ── Body: TOC + Content ── */}
      <div className="flex gap-6 lg:gap-8">
        {/* Sticky TOC sidebar */}
        <aside className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-6">
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-700">
              Contents
            </p>
            <RunbookTOC chapters={runbook.chapters} tier={runbook.tier} />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 flex flex-col">
          {runbook.chapters.map(ch => (
            <ChapterSection key={ch.id} chapter={ch} />
          ))}

          <div className="mt-4">
            <RunbookAppendix technical={runbook.technical} />
          </div>
        </main>
      </div>
    </div>
  )
}
