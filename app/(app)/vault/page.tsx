'use client'

import { useEffect, useState, useTransition } from 'react'
import { listVaultItems, createVaultItem, type VaultItemListItem } from './actions'
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
          <select className={inputCls} value={type} onChange={e => setType(e.target.value as VaultItemType)}>
            {TYPE_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
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

export default function VaultPage() {
  const [items, setItems] = useState<VaultItemListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<VaultItemType | 'all'>('all')
  const [view, setView] = useState<'list' | 'graph'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [, startLoad] = useTransition()

  async function load() {
    setLoading(true)
    const data = await listVaultItems()
    setItems(data)
    setLoading(false)
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
      ) : (
        <>
          {view === 'list' ? (
            <VaultList
              items={items}
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
                items={items}
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
                items={items}
                search={search}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </>
          )}
        </>
      )}

      {selectedItem && (
        <VaultSidePanel
          item={selectedItem}
          onClose={handleClose}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
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
