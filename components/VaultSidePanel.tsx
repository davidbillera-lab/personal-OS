'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { updateVaultItem, deleteVaultItem, revealVaultItemContent, getRelatedVaultItems } from '@/app/(app)/vault/actions'
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

interface Props {
  item: VaultItemListItem
  onClose: () => void
  onUpdated: () => void
  onDeleted: (id: string) => void
}

export function VaultSidePanel({ item, onClose, onUpdated, onDeleted }: Props) {
  const [editMode, setEditMode] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState('')
  const [tags, setTags] = useState(item.tags.join(', '))
  const [isMcp, setIsMcp] = useState(item.is_mcp_accessible)
  const [revealedContent, setRevealedContent] = useState<string | null>(null)
  const [related, setRelated] = useState<VaultItemListItem[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [revealing, startReveal] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTitle(item.title)
    setContent('')
    setTags(item.tags.join(', '))
    setIsMcp(item.is_mcp_accessible)
    setRevealedContent(null)
    setEditMode(false)
    setError(null)
    setRelated([])

    if (!item.encrypted && item.type !== 'personal') {
      setRelatedLoading(true)
      getRelatedVaultItems(item.id)
        .then(r => setRelated(r))
        .finally(() => setRelatedLoading(false))
    }
  }, [item.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  function handleReveal() {
    startReveal(async () => {
      const res = await revealVaultItemContent(item.id)
      if (res.content) {
        setRevealedContent(res.content)
        setTimeout(() => setRevealedContent(null), 30_000)
      }
      if (res.error) setError(res.error)
    })
  }

  function handleSave() {
    startSave(async () => {
      setError(null)
      const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean)
      const res = await updateVaultItem(item.id, {
        title: title !== item.title ? title : undefined,
        content: content || undefined,
        tags: parsedTags,
        is_mcp_accessible: isMcp,
      })
      if (res.error) { setError(res.error); return }
      setEditMode(false)
      setContent('')
      onUpdated()
    })
  }

  function handleDelete() {
    if (!confirm('Delete this vault item? This cannot be undone.')) return
    startSave(async () => {
      await deleteVaultItem(item.id)
      onDeleted(item.id)
    })
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
  }

  const displayContent = revealedContent ?? (item.encrypted ? null : item.content)

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500'

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={panelRef}
        className="relative z-50 w-[380px] h-full bg-gray-950 border-l border-white/10 flex flex-col overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 p-4 border-b border-white/10">
          <div className="flex-1 min-w-0">
            {editMode ? (
              <input
                className={inputCls}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Title"
              />
            ) : (
              <h2 className="text-base font-semibold text-white truncate">{item.title}</h2>
            )}
            <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${TYPE_BADGE[item.type]}`}>
              {item.type}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!editMode && (
              <button
                onClick={() => setEditMode(true)}
                className="rounded px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/5"
              >
                Edit
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={saving}
              className="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
            <button onClick={onClose} className="ml-1 rounded px-2 py-1 text-xs text-gray-500 hover:text-white hover:bg-white/5">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col gap-4 p-4">
          {/* Tags */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Tags</p>
            {editMode ? (
              <input
                className={inputCls}
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder="tag1, tag2, tag3"
              />
            ) : item.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {item.tags.map(tag => (
                  <span key={tag} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600">No tags</p>
            )}
          </div>

          {/* Content */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Content</p>
            {editMode ? (
              <textarea
                className={`${inputCls} min-h-[120px] resize-y`}
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={item.encrypted ? 'Enter new value (leave blank to keep current)' : 'Content'}
                rows={5}
              />
            ) : item.encrypted ? (
              <div className="flex items-center gap-2">
                {revealedContent ? (
                  <div className="flex-1">
                    <pre className="text-xs text-green-300 break-all whitespace-pre-wrap bg-green-500/5 rounded p-2 border border-green-500/20">
                      {revealedContent}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(revealedContent)}
                      className="mt-1 text-[11px] text-gray-400 hover:text-white"
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-gray-600 text-sm">••••••••••••</span>
                    <button
                      onClick={handleReveal}
                      disabled={revealing}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
                    >
                      {revealing ? 'Decrypting…' : 'Reveal'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative group">
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words bg-white/3 rounded p-3 border border-white/10 max-h-64 overflow-y-auto">
                  {displayContent}
                </pre>
                <button
                  onClick={() => copyToClipboard(item.content)}
                  className="absolute top-2 right-2 text-[10px] text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Copy
                </button>
              </div>
            )}
          </div>

          {/* MCP accessible toggle (edit mode, non-encrypted) */}
          {editMode && !item.encrypted && item.type !== 'personal' && (
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isMcp}
                onChange={e => setIsMcp(e.target.checked)}
                className="rounded"
              />
              Agent-accessible via MCP
            </label>
          )}

          {/* Save / Cancel (edit mode) */}
          {editMode && (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="flex-1 rounded bg-violet-600 hover:bg-violet-500 px-3 py-2 text-sm text-white font-medium disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditMode(false); setContent(''); setTitle(item.title); setTags(item.tags.join(', ')) }}
                className="rounded px-3 py-2 text-sm text-gray-400 hover:text-white bg-white/5"
              >
                Cancel
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</p>}

          {/* Project link */}
          {item.project_id && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Project</p>
              <p className="text-xs text-gray-400">{item.project_id}</p>
            </div>
          )}

          {/* Related items */}
          {!item.encrypted && item.type !== 'personal' && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Related</p>
              {relatedLoading ? (
                <p className="text-xs text-gray-600">Loading…</p>
              ) : related.length === 0 ? (
                <p className="text-xs text-gray-600">No related items found</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {related.map(r => (
                    <div key={r.id} className="rounded-lg border border-white/10 bg-white/3 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1 ${TYPE_BADGE[r.type]}`}>
                          {r.type}
                        </span>
                        <span className="text-xs text-gray-300 truncate">{r.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
