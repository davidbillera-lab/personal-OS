import Link from 'next/link'
import { runbooks } from '@/content/runbooks/data'
import type { Runbook } from '@/content/runbooks/types'

const TIER_STYLES = {
  1: {
    border: 'border-t-violet-500',
    badge: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25',
    heading: 'text-violet-400',
    label: 'Tier 1 · Protect & Scale',
  },
  2: {
    border: 'border-t-blue-500',
    badge: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/25',
    heading: 'text-blue-400',
    label: 'Tier 2 · Active Builds',
  },
  3: {
    border: 'border-t-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25',
    heading: 'text-emerald-400',
    label: 'Tier 3 · Personal & Family',
  },
}

const STAGE_BADGE: Record<string, string> = {
  active: 'bg-green-500/15 text-green-300',
  build: 'bg-indigo-500/15 text-indigo-300',
  spec: 'bg-yellow-500/15 text-yellow-300',
  ship: 'bg-violet-500/15 text-violet-300',
  scale: 'bg-cyan-500/15 text-cyan-300',
  kill: 'bg-red-500/15 text-red-300',
}

function RunbookCard({ r }: { r: Runbook }) {
  const ts = TIER_STYLES[r.tier]
  const ss = STAGE_BADGE[r.stage] ?? 'bg-white/10 text-gray-400'
  return (
    <Link
      href={`/runbook/${r.slug}`}
      className={`group relative flex flex-col gap-3 rounded-xl border-t-2 border border-white/10 ${ts.border} bg-white/[0.03] p-5 transition-all hover:bg-white/[0.06] hover:border-white/20`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl leading-none">{r.emoji}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ss}`}>
          {r.stage}
        </span>
      </div>
      <div className="flex-1">
        <h2 className="font-semibold text-white group-hover:text-white/90 text-sm">{r.name}</h2>
        <p className="mt-1.5 text-xs text-gray-500 leading-relaxed line-clamp-2">{r.tagline}</p>
      </div>
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ts.badge}`}>
          {ts.label}
        </span>
        <span className="text-[11px] text-gray-600 group-hover:text-gray-400 transition">
          Open Runbook →
        </span>
      </div>
    </Link>
  )
}

function TierSection({ tier, label, items }: { tier: 1 | 2 | 3; label: string; items: Runbook[] }) {
  if (items.length === 0) return null
  const ts = TIER_STYLES[tier]
  return (
    <section className="flex flex-col gap-3">
      <h2 className={`text-[11px] font-semibold uppercase tracking-widest ${ts.heading}`}>
        {label}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(r => <RunbookCard key={r.slug} r={r} />)}
      </div>
    </section>
  )
}

export default function RunbookIndexPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Runbooks</h1>
        <p className="mt-1 text-sm text-gray-500">
          Plain-English guides to every project — what it does, who runs it, and how to operate it.
          For Vinnie, for buyers, for a cold start.
        </p>
      </div>

      <TierSection tier={1} label="Tier 1 — Protect & Scale" items={runbooks.filter(r => r.tier === 1)} />
      <TierSection tier={2} label="Tier 2 — Active Builds" items={runbooks.filter(r => r.tier === 2)} />
      <TierSection tier={3} label="Tier 3 — Personal & Family" items={runbooks.filter(r => r.tier === 3)} />
    </div>
  )
}
