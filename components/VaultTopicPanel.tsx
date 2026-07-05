'use client'

import type { VaultItemListItem } from '@/app/(app)/vault/actions'
import { TYPE_COLOR } from '@/components/VaultGraph'

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`
}

interface Props {
  /** Tag name without the `tag:` prefix; `__untagged` for the untagged hub. */
  topic: string
  items: VaultItemListItem[]
  onClose: () => void
  onOpenItem: (item: VaultItemListItem) => void
}

// Table of contents for one tag-hub "sun": every item orbiting the topic,
// newest activity first. Floating card — the galaxy stays live behind it.
export function VaultTopicPanel({ topic, items, onClose, onOpenItem }: Props) {
  const label = topic === '__untagged' ? 'untagged' : topic
  const sorted = [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))

  return (
    <div className="fixed right-4 top-16 bottom-4 z-50 flex items-start justify-end pointer-events-none">
      <div className="pointer-events-auto w-[360px] max-w-[90vw] max-h-full bg-gray-950/95 backdrop-blur border border-violet-500/30 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-violet-200 truncate">☀ #{label}</h2>
            <p className="text-[11px] text-gray-500">{sorted.length} item{sorted.length === 1 ? '' : 's'} orbiting this topic</p>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-gray-500 hover:text-white hover:bg-white/5 shrink-0">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto py-1">
          {sorted.map(item => (
            <button
              key={item.id}
              onClick={() => onOpenItem(item)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-white/5 transition-colors"
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: TYPE_COLOR[item.type] ?? '#94a3b8' }}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-gray-200 truncate">{item.title}</span>
                <span className="block text-[10px] text-gray-500">
                  {item.type.replace(/_/g, ' ')} · {timeAgo(item.updated_at)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
