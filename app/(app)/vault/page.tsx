'use client'

import { useEffect, useState, useTransition } from 'react'
import { listVaultItems, listCredentials, listProjectNames, createVaultItem, revealCredential, updateCredential, deleteCredential, type VaultItemListItem, type CredentialListItem } from './actions'
import { VaultList } from '@/components/VaultList'
import { VaultGraph } from '@/components/VaultGraph'
import { VaultSidePanel } from '@/components/VaultSidePanel'
import type { VaultItemType } from '@/lib/types'

const TYPE_OPTIONS: { value: VaultItemType; label: string }[] = [
  { value: 'skill',      label: 'Skill' },
  { value: 'agent',      label: 'Agent Role' },
  { value: 'knowledge',  label: 'Knowledge' },
  { value: 'personal',   label: 'Personal (encrypted)' },
  { value: 'credential', label: 'Credential (encrypted)' },
]

function AddItemModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<VaultItemType>('knowledge')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [isMcp, setIsMcp] = useState(false)
  const [error, setError] = useState('')
  const [saving, startSave] = useTransition()

  const isEncrypted = type === 'personal' || type === 'credential'

  function save() {
    startSave(async () => {
      setError('')
      if (!title.trim() || !content.trim()) { setError('Title and content are required'); return }
      const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean)
      const res = await createVaultItem({ type, title, content, tags: parsedTags, is_mcp_accessible: isEncrypted ? false : isMcp })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-4">New Vault Item</h2>
        <div className="flex flex-col gap-3">
          <select className={inputCls} style={{ colorScheme: 'dark' }} value={type} onChange={e => setType(e.target.value as VaultItemType)}>
            {TYPE_OPTIONS.map(t => (
              <option key={t.value} value={t.value} style={{ backgroundColor: '#111827', color: 'white' }}>{t.label}</option>
            ))}
          </select>
          <input className={inputCls} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea
            className={`${inputCls} resize-y`}
            placeholder={isEncrypted ? 'Value (will be encrypted at rest)' : 'Content'}
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={5}
          />
          <input className={inputCls} placeholder="Tags (comma-separated, optional)" value={tags} onChange={e => setTags(e.target.value)} />
          {!isEncrypted && (
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={isMcp} onChange={e => setIsMcp(e.target.checked)} />
              Agent-accessible via MCP
            </label>
          )}
          {isEncrypted && (
            <p className="text-xs text-amber-400/80">
              {type === 'personal' ? 'Personal items' : 'Credential items'} are always encrypted and never accessible to agents.
            </p>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !title.trim() || !content.trim()}
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

const TIER_BADGE: Record<string, string> = {
  system:   'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  project:  'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  personal: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
}

function CredentialsSection({ credentials, search, onReload }: { credentials: CredentialListItem[]; search: string; onReload: () => void }) {
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [revealing, setRevealing] = useState<Record<string, boolean>>({})
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})

  const filtered = credentials.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.key_name.toLowerCase().includes(search.toLowerCase())
  )

  async function handleReveal(id: string) {
    setRevealing(prev => ({ ...prev, [id]: true }))
    setRevealErrors(prev => ({ ...prev, [id]: '' }))
    try {
      const res = await revealCredential(id)
      if (res.value) setRevealed(prev => ({ ...prev, [id]: res.value! }))
      if (res.error) setRevealErrors(prev => ({ ...prev, [id]: res.error! }))
    } catch (err) {
      setRevealErrors(prev => ({ ...prev, [id]: err instanceof Error ? err.message : 'Reveal failed' }))
    } finally {
      setRevealing(prev => ({ ...prev, [id]: false }))
    }
  }

  function startEdit(cred: CredentialListItem) {
    setEditingId(cred.id)
    setEditValue('')
    setEditNotes(cred.notes ?? '')
    setSaveError('')
    setSaveSuccess(false)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
    setEditNotes('')
    setSaveError('')
  }

  async function handleSave(id: string) {
    setSaving(true)
    setSaveError('')
    const params: { value?: string; notes?: string } = {}
    if (editValue.trim()) params.value = editValue.trim()
    params.notes = editNotes.trim() || undefined
    const res = await updateCredential(id, params)
    setSaving(false)
    if (res.error) { setSaveError(res.error); return }
    setSaveSuccess(true)
    setTimeout(() => {
      setEditingId(null)
      setSaveSuccess(false)
      setRevealed(prev => { const n = { ...prev }; delete n[id]; return n })
      onReload()
    }, 800)
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    setDeleting(prev => ({ ...prev, [id]: true }))
    await deleteCredential(id)
    onReload()
  }

  if (filtered.length === 0) return null

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Credentials ({filtered.length})</span>
        <div className="flex-1 h-px bg-white/5" />
      </div>
      {filtered.map(cred => (
        <div key={cred.id} className="rounded-xl border border-white/10 bg-white/3 px-4 py-3">
          {editingId === cred.id ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-white">{cred.name}</span>
                <span className="text-xs text-gray-500 font-mono">{cred.key_name}</span>
              </div>
              <input
                className={inputCls}
                type="password"
                placeholder="New value (leave blank to keep existing)"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
              />
              <input
                className={inputCls}
                placeholder="Notes (optional)"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
              />
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={cancelEdit} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 border border-white/10 rounded">Cancel</button>
                <button
                  onClick={() => handleSave(cred.id)}
                  disabled={saving || saveSuccess}
                  className={`text-xs px-3 py-1.5 rounded disabled:opacity-40 text-white transition-colors ${saveSuccess ? 'bg-green-600' : 'bg-violet-600 hover:bg-violet-500'}`}
                >
                  {saveSuccess ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium text-white truncate">{cred.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 shrink-0 ${TIER_BADGE[cred.tier] ?? TIER_BADGE.personal}`}>
                    {cred.tier}
                  </span>
                  <span className="text-[10px] text-gray-500">🔒</span>
                  {cred.is_mcp_accessible && (
                    <span className="rounded-full bg-green-500/15 text-green-300 ring-1 ring-green-500/30 px-1.5 py-0.5 text-[9px] font-medium">MCP</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 font-mono truncate">{cred.key_name}</p>
                {revealed[cred.id] && (
                  <p className="text-xs text-amber-300 font-mono mt-1 break-all">{revealed[cred.id]}</p>
                )}
                {revealErrors[cred.id] && (
                  <p className="text-xs text-red-400 mt-1">{revealErrors[cred.id]}</p>
                )}
                {cred.notes && !revealed[cred.id] && (
                  <p className="text-xs text-gray-600 mt-1 truncate">{cred.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!revealed[cred.id] && (
                  <button
                    onClick={() => handleReveal(cred.id)}
                    disabled={revealing[cred.id]}
                    className="text-xs text-gray-500 hover:text-white border border-white/10 hover:border-white/30 rounded px-2 py-1 transition-colors disabled:opacity-40"
                  >
                    {revealing[cred.id] ? '…' : 'Reveal'}
                  </button>
                )}
                <button
                  onClick={() => startEdit(cred)}
                  className="text-xs text-gray-500 hover:text-white border border-white/10 hover:border-white/30 rounded px-2 py-1 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(cred.id, cred.name)}
                  disabled={deleting[cred.id]}
                  className="text-xs text-gray-500 hover:text-red-400 border border-white/10 hover:border-red-500/30 rounded px-2 py-1 transition-colors disabled:opacity-40"
                >
                  {deleting[cred.id] ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function VaultPage() {
  const [items, setItems] = useState<VaultItemListItem[]>([])
  const [credentials, setCredentials] = useState<CredentialListItem[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [projectFilter, setProjectFilter] = useState<'all' | 'none' | string>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<VaultItemType | 'all'>('all')
  const [view, setView] = useState<'list' | 'graph'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [, startLoad] = useTransition()

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [data, creds, projs] = await Promise.all([listVaultItems(), listCredentials(), listProjectNames()])
      setItems(data)
      setCredentials(creds)
      setProjects(projs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load vault')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleSelect(item: VaultItemListItem) {
    setSelectedId(item.id)
  }

  function handleClose() {
    setSelectedId(null)
  }

  function handleUpdated() {
    startLoad(async () => {
      const data = await listVaultItems()
      setItems(data)
    })
  }

  function handleDeleted(id: string) {
    setSelectedId(null)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const selectedItem = items.find(i => i.id === selectedId) ?? null

  const displayItems = projectFilter === 'all'
    ? items
    : projectFilter === 'none'
      ? items.filter(i => !i.project_id)
      : items.filter(i => i.project_id === projectFilter)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-white">Vault</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Second brain. Credentials, skills, agents, knowledge, personal info — all searchable and agent-retrievable.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg"
        >
          + New Item
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading vault…</p>
      ) : loadError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">Failed to load vault: {loadError}</p>
          <button onClick={load} className="mt-2 text-xs text-red-400 hover:text-red-300 underline">Retry</button>
        </div>
      ) : (
        <>
          {/* Project filter */}
          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">Project:</span>
              <select
                value={projectFilter}
                onChange={e => setProjectFilter(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-violet-500"
                style={{ colorScheme: 'dark' }}
              >
                <option value="all" style={{ backgroundColor: '#111827', color: 'white' }}>All</option>
                <option value="none" style={{ backgroundColor: '#111827', color: 'white' }}>No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id} style={{ backgroundColor: '#111827', color: 'white' }}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {view === 'list' ? (
            <VaultList
              items={displayItems}
              search={search}
              typeFilter={typeFilter}
              selectedId={selectedId}
              onSearch={setSearch}
              onTypeFilter={setTypeFilter}
              onSelect={handleSelect}
              onViewChange={setView}
              view={view}
            />
          ) : (
            <>
              <VaultList
                items={displayItems}
                search={search}
                typeFilter={typeFilter}
                selectedId={selectedId}
                onSearch={setSearch}
                onTypeFilter={setTypeFilter}
                onSelect={handleSelect}
                onViewChange={setView}
                view={view}
              />
              <VaultGraph
                items={displayItems}
                search={search}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </>
          )}
        </>
      )}

      {(typeFilter === 'all' || typeFilter === 'credential') && credentials.length > 0 && (
        <CredentialsSection
          credentials={credentials}
          search={search}
          onReload={load}
        />
      )}

      {selectedItem && (
        <VaultSidePanel
          item={selectedItem}
          onClose={handleClose}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onSelect={handleSelect}
        />
      )}

      {modalOpen && (
        <AddItemModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load() }}
        />
      )}
    </div>
  )
}
