'use client'

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { VaultGraphHandle } from '@/components/VaultGraph'
import type { GalaxyNode } from '@/lib/vault-graph'

interface TourStep {
  title: string
  body: string
  targetId: string | null   // null = zoom out to the whole galaxy
  zoom: number
}

// Pick live targets so the tour never goes stale. Any picker may return
// undefined (e.g. no stars exist) — those steps are skipped.
function buildSteps(nodes: GalaxyNode[]): TourStep[] {
  const planets = nodes.filter(n => n.cls === 'planet')
  const hubs = nodes.filter(n => n.cls === 'hub' && n.id !== 'tag:__untagged')
  const stars = nodes.filter(n => n.cls === 'star')

  const brightestPlanet = [...planets].sort((a, b) => b.brightness - a.brightness)[0]
  const biggestHub = [...hubs].sort((a, b) => b.degree - a.degree)[0]
  const dimmestPlanet = [...planets].sort((a, b) => a.brightness - b.brightness)[0]
  const anyStar = [...stars].sort((a, b) => b.brightness - a.brightness)[0]

  const steps: (TourStep | null)[] = [
    {
      title: "David's second brain",
      body: 'Every dot is one real thing — a lesson learned, a decision made, an idea captured, or a piece of work done. Together they form a map of everything the business knows.',
      targetId: null, zoom: 1,
    },
    brightestPlanet ? {
      title: 'The big colorful dots are knowledge',
      body: `Planets are the important stuff: things David learned, decisions, plans, and ideas. This one is "${brightestPlanet.label}". The color tells you what kind of thing it is.`,
      targetId: brightestPlanet.id, zoom: 3,
    } : null,
    biggestHub ? {
      title: 'Topics pull things together',
      body: `The small ringed dots are topics. Everything about "${biggestHub.label}" gathers around this one — that's why the map forms neighborhoods.`,
      targetId: biggestHub.id, zoom: 2.2,
    } : null,
    dimmestPlanet && dimmestPlanet.brightness < 0.8 ? {
      title: 'Bright means recent',
      body: 'Fresh information glows. Things nobody has touched in months fade — like this one — but they never disappear. Brightness shows where the action is right now.',
      targetId: dimmestPlanet.id, zoom: 3,
    } : null,
    anyStar ? {
      title: 'The tiny stars are work history',
      body: 'Every time code gets saved or an AI finishes a work session, a tiny star appears automatically. Nobody writes these down — the system remembers by itself.',
      targetId: anyStar.id, zoom: 3.5,
    } : null,
    {
      title: 'AI agents read this too',
      body: "When an AI works on any of David's projects, it looks things up here first — so nothing has to be re-explained. That's why it's called a second brain.",
      targetId: null, zoom: 1,
    },
    {
      title: 'Explore it yourself',
      body: "Point at any dot to see its name. Click it to read what is inside. That is all there is to it — have a look around.",
      targetId: null, zoom: 1,
    },
  ]
  return steps.filter((s): s is TourStep => s !== null)
}

interface TourProps {
  handle: MutableRefObject<VaultGraphHandle | null>
  onDim: (ids: Set<string> | null) => void
  onClose: () => void
}

export function VaultGraphTour({ handle, onDim, onClose }: TourProps) {
  const [idx, setIdx] = useState(0)
  // Build steps once on mount — handle.current is already populated by the time
  // the tour renders (VaultGraph mounts first and populates it via useEffect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const steps = useMemo(() => buildSteps(handle.current?.getGalaxy().nodes ?? []), [])

  useEffect(() => {
    const step = steps[idx]
    if (!step) return
    if (step.targetId) {
      handle.current?.centerOn(step.targetId, step.zoom, 900)
      const galaxy = handle.current?.getGalaxy()
      const spotlight = new Set([step.targetId])
      for (const n of galaxy?.neighbors.get(step.targetId) ?? []) spotlight.add(n)
      onDim(spotlight)
    } else {
      handle.current?.zoomToFit(900)
      onDim(null)
    }
  }, [idx, steps, handle, onDim])

  function close() {
    onDim(null)
    handle.current?.zoomToFit(600)
    onClose()
  }

  if (steps.length === 0) { close(); return null }
  const step = steps[idx]
  const last = idx === steps.length - 1

  return (
    <div className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md mx-4 rounded-2xl border border-violet-500/30 bg-gray-950/90 backdrop-blur p-5 shadow-2xl">
        <div className="flex items-center gap-1.5 mb-3">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-violet-400' : 'w-1.5 bg-white/20'}`} />
          ))}
          <button onClick={close} className="ml-auto text-xs text-gray-500 hover:text-white">Skip ✕</button>
        </div>
        <h3 className="text-sm font-semibold text-white">{step.title}</h3>
        <p className="mt-1.5 text-sm text-gray-400 leading-relaxed">{step.body}</p>
        <div className="flex justify-between mt-4">
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white disabled:opacity-30"
          >
            ← Back
          </button>
          <button
            onClick={() => (last ? close() : setIdx(i => i + 1))}
            className="px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg"
          >
            {last ? 'Done — explore' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
