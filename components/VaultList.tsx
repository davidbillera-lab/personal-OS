'use client'

import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

const TYPE_BADGE: Record<VaultItemType, string> = {
  credential:       'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  skill:            'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  agent:            'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  personal:         'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  knowledge:        'bg-green-500/15 text-green-300 ring-green-500/30',
  git_push:         'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  file_snapshot:    'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  brain_dump_mirror:'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30',
  ab_conversation:  'bg-purple-500/15 text-purple-300 ring-purple-500/30',
  build_spec:       'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  agent_session:    'bg-orange-500/15 text-orange-300 ring-orange-500/30',
  decision_log:     'bg-lime-500/15 text-lime-300 ring-lime-500/30',
  mcp_event:        'bg-slate-500/15 text-slate-300 ring-slate-500/30',
}

const FILTER_CHIPS: { value: VaultItemType | 'all'; label: string }[] = [
  { value: 'all',               label: 'All' },
  { value: 'credential',        label: 'Credentials' },
  { value: 'skill',             label: 'Skills' },
  { value: 'agent',             label: 'Agents' },
  { value: 'personal',          label: 'Personal' },
  { value: 'knowledge',         label: 'Knowledge' },
  { value: 'brain_dump_mirror', label: 'Brain Dumps' },
  { value: 'build_spec',        label: 'Specs' },
  { value: 'agent_session',     label: 'Agent Sessions' },
  { value: 'ab_conversation',   label: 'Advisory Board' },
]

interface Props {
  items: VaultItemListItem[]
  search: string
  typeFilter: VaultItemType | 'all'
  selectedId: string | null
  onSearch: (q: string) => void
  onTypeFilter: (t: VaultItemType | 'all') => void
  onSelect: (item: VaultItemListItem) => void
  onViewChange: (v: 'list' | 'graph') => void
  view: 'list' | 'graph'
}

export function VaultList({
  items, search, typeFilter, selectedId,
  onSearch, onTypeFilter, onSelect, onViewChange, view,
}: Props) {
  const filtered = items.filter(item => {
    const matchesType = typeFilter === 'all' || item.type === typeFilter
    const matchesSearch = !search || item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
    return matchesType && matchesSearch
  })

  return (
    <div className="flex flex-col gap-3">
      {/* Search + view toggle */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search vault…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
        />
        <div className="flex rounded-lg border border-white/10 overflow-hidden shrink-0">
          <button
            onClick={() => onViewChange('list')}
            className={`px-3 py-2 text-xs font-medium transition-colors ${view === 'list' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
          >
            ≡ List
          </button>
          <button
            onClick={() => onViewChange('graph')}
            className={`px-3 py-2 text-xs font-medium transition-colors ${view === 'graph' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
          >
            ◉ Graph
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_CHIPS.map(chip => (
          <button
            key={chip.value}
            onClick={() => onTypeFilter(chip.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              typeFilter === chip.value
                ? 'bg-white/15 text-white ring-1 ring-white/20'
                : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Cards — hidden in graph mode (controls above still render) */}
      {view === 'list' && (
        <div className="flex flex-col gap-2">
          {filtered.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/3 p-8 text-center text-sm text-gray-500">
              {items.length === 0 ? 'No vault items yet. Add your first item.' : 'No items match the current filter.'}
            </div>
          )}
          {filtered.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                selectedId === item.id
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-white/10 bg-white/3 hover:bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium text-white truncate">{item.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 shrink-0 ${TYPE_BADGE[item.type]}`}>
                      {item.type}
                    </span>
                    {item.encrypted && (
                      <span className="text-[10px] text-gray-500" title="Encrypted">🔒</span>
                    )}
                    {item.is_mcp_accessible && (
                      <span className="rounded-full bg-green-500/15 text-green-300 ring-1 ring-green-500/30 px-1.5 py-0.5 text-[9px] font-medium">
                        MCP
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {item.encrypted ? '••••••••••••' : item.content.slice(0, 100)}
                  </p>
                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.tags.slice(0, 4).map(tag => (
                        <span key={tag} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-500">
                          {tag}
                        </span>
                      ))}
                      {item.tags.length > 4 && (
                        <span className="text-[10px] text-gray-600">+{item.tags.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
