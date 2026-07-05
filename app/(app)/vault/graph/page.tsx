'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { listVaultItems, listProjectNames, type VaultItemListItem } from '../actions'
import { VaultGraph, type VaultGraphHandle } from '@/components/VaultGraph'
import { VaultSidePanel } from '@/components/VaultSidePanel'
import { VaultTopicPanel } from '@/components/VaultTopicPanel'
import { VaultGraphTour } from '@/components/VaultGraphTour'
import { STAR_TYPES } from '@/lib/vault-graph'
import type { VaultItemType } from '@/lib/types'

// Not exported — Next.js App Router rejects non-standard exports from page files
const TYPE_GROUPS: { key: string; label: string; types: VaultItemType[] | null }[] = [
  { key: 'all',       label: 'All',            types: null },
  { key: 'knowledge', label: 'Knowledge',      types: ['knowledge'] },
  { key: 'decisions', label: 'Specs & Decisions', types: ['build_spec', 'decision_log'] },
  { key: 'dumps',     label: 'Brain Dumps',    types: ['brain_dump_mirror', 'ab_conversation'] },
  { key: 'skills',    label: 'Skills & Agents', types: ['skill', 'agent'] },
  { key: 'history',   label: 'History',        types: STAR_TYPES },
]

export default function VaultGraphPage() {
  const [items, setItems] = useState<VaultItemListItem[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('all')
  const [projectFilter, setProjectFilter] = useState<'all' | string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [topicHubId, setTopicHubId] = useState<string | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  const [tourDim, setTourDim] = useState<Set<string> | null>(null)
  const graphHandle = useRef<VaultGraphHandle | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [data, projs] = await Promise.all([listVaultItems(), listProjectNames()])
      setItems(data)
      setProjects(projs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load vault')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const displayItems = useMemo(() => {
    const types = TYPE_GROUPS.find(g => g.key === group)?.types ?? null
    return items.filter(i =>
      (types === null || types.includes(i.type)) &&
      (projectFilter === 'all' || i.project_id === projectFilter)
    )
  }, [items, group, projectFilter])

  const selectedItem = items.find(i => i.id === selectedId) ?? null

  // Members of the open topic — respects the active filters, matching the graph
  const topicTag = topicHubId?.slice(4) ?? null   // strip the `tag:` prefix
  const topicItems = topicTag === null ? [] : displayItems.filter(i =>
    topicTag === '__untagged' ? i.tags.length === 0 : i.tags.includes(topicTag)
  )

  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs transition-colors border ${
      active ? 'bg-violet-600/30 border-violet-500/50 text-violet-200'
             : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/25'
    }`

  return (
    <div className="fixed inset-0 z-40" style={{ background: '#030712' }}>
      <VaultGraph
        items={displayItems}
        search={search}
        selectedId={selectedId ?? topicHubId}
        onSelect={item => { setSelectedId(item.id); setTopicHubId(null) }}
        onSelectHub={hubId => {
          setSelectedId(null)
          setTopicHubId(hubId)
          graphHandle.current?.centerOn(hubId, 1.7, 700)
        }}
        dimExcept={tourDim}
        paused={tourOpen}
        handleRef={graphHandle}
      />

      {/* Toolbar overlay */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center gap-3 flex-wrap pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <Link
            href="/vault"
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-400 hover:text-white"
          >
            ← Vault
          </Link>
          <input
            className="w-56 bg-black/50 backdrop-blur border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
            placeholder="Search the galaxy…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto">
          {TYPE_GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)} className={chipCls(group === g.key)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto pointer-events-auto">
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
              style={{ colorScheme: 'dark' }}
            >
              <option value="all" style={{ backgroundColor: '#111827' }}>All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id} style={{ backgroundColor: '#111827' }}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setTourOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500 text-white text-xs"
          >
            ✦ What is this?
          </button>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-gray-500 animate-pulse">Charting the galaxy…</p>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-x-0 top-20 flex justify-center">
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-400">Failed to load vault: {loadError}</p>
            <button onClick={load} className="mt-1 text-xs text-red-400 underline">Retry</button>
          </div>
        </div>
      )}

      {selectedItem ? (
        <VaultSidePanel
          floating
          item={selectedItem}
          onClose={() => setSelectedId(null)}
          onUpdated={load}
          onDeleted={() => { setSelectedId(null); load() }}
          onSelect={item => setSelectedId(item.id)}
        />
      ) : topicHubId && (
        <VaultTopicPanel
          topic={topicTag!}
          items={topicItems}
          onClose={() => setTopicHubId(null)}
          onOpenItem={item => setSelectedId(item.id)}
        />
      )}

      {tourOpen && (
        <VaultGraphTour
          handle={graphHandle}
          onDim={setTourDim}
          onClose={() => setTourOpen(false)}
        />
      )}
    </div>
  )
}
