'use client'

import { useEffect, useState, useTransition } from 'react'
import { listCredentials, addCredential, updateCredential, deleteCredential, revealCredential } from './actions'
import type { Credential, CredentialTier } from '@/lib/types'

type ListItem = Omit<Credential, 'value'> & { masked_value: string }

const TIERS: { value: CredentialTier; label: string }[] = [
  { value: 'global', label: 'Global (all projects)' },
  { value: 'project', label: 'Project-specific' },
]

const TIER_COLORS: Record<CredentialTier, string> = {
  global: 'bg-purple-900/40 text-purple-300 border-purple-700',
  project: 'bg-blue-900/40 text-blue-300 border-blue-700',
}

function CredentialRow({
  cred,
  onEdit,
  onDelete,
}: {
  cred: ListItem
  onEdit: (c: ListItem) => void
  onDelete: (id: string) => void
}) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [revealing, startReveal] = useTransition()

  function reveal() {
    startReveal(async () => {
      const res = await revealCredential(cred.id)
      if (res.value) {
        setRevealed(res.value)
        setTimeout(() => setRevealed(null), 30000)
      }
    })
  }

  return (
    <tr className="border-t border-white/10 text-sm">
      <td className="py-3 px-4 font-medium text-white">{cred.name}</td>
      <td className="py-3 px-4 font-mono text-gray-400">{cred.key_name}</td>
      <td className="py-3 px-4">
        <span
          className={`inline-block border rounded px-2 py-0.5 text-xs ${TIER_COLORS[cred.tier]}`}
        >
          {cred.tier}
        </span>
      </td>
      <td className="py-3 px-4 font-mono text-gray-400">
        {revealed ? (
          <span className="text-green-400 break-all">{revealed}</span>
        ) : (
          <span>{cred.masked_value}</span>
        )}
      </td>
      <td className="py-3 px-4">
        {cred.is_mcp_accessible && (
          <span className="inline-block bg-green-900/40 text-green-300 border border-green-700 rounded px-2 py-0.5 text-xs">
            MCP
          </span>
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-2">
          <button
            onClick={reveal}
            disabled={revealing || !!revealed}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
          >
            {revealing ? 'Loading…' : revealed ? 'Shown (30s)' : 'Reveal'}
          </button>
          <button
            onClick={() => onEdit(cred)}
            className="text-xs text-gray-400 hover:text-white"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(cred.id)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

interface ModalProps {
  initial?: ListItem | null
  onClose: () => void
  onSaved: () => void
}

function CredentialModal({ initial, onClose, onSaved }: ModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [keyName, setKeyName] = useState(initial?.key_name ?? '')
  const [value, setValue] = useState('')
  const [tier, setTier] = useState<CredentialTier>(initial?.tier ?? 'global')
  const [isMcp, setIsMcp] = useState(initial?.is_mcp_accessible ?? true)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState('')
  const [saving, startSave] = useTransition()

  function save() {
    startSave(async () => {
      setError('')
      let res: { error?: string }
      if (initial) {
        res = await updateCredential(initial.id, {
          name,
          key_name: keyName,
          ...(value ? { value } : {}),
          tier,
          is_mcp_accessible: isMcp,
          notes: notes || null,
        })
      } else {
        if (!value) { setError('Value is required for new credentials'); return }
        res = await addCredential({ name, key_name: keyName, value, tier, is_mcp_accessible: isMcp, notes: notes || null })
      }
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-4">
          {initial ? 'Edit Credential' : 'Add Credential'}
        </h2>
        <div className="flex flex-col gap-3">
          <input className={inputCls} placeholder="Display name (e.g. Anthropic API Key)" value={name} onChange={e => setName(e.target.value)} />
          <input className={inputCls} placeholder="Key name (e.g. ANTHROPIC_API_KEY)" value={keyName} onChange={e => setKeyName(e.target.value)} />
          <input
            className={inputCls}
            type="password"
            placeholder={initial ? 'New value (leave blank to keep current)' : 'Value'}
            value={value}
            onChange={e => setValue(e.target.value)}
            autoComplete="off"
          />
          <select
            className={inputCls}
            value={tier}
            onChange={e => setTier(e.target.value as CredentialTier)}
          >
            {TIERS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <textarea className={inputCls} placeholder="Notes (optional)" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={isMcp} onChange={e => setIsMcp(e.target.checked)} className="rounded" />
            Agent-accessible via MCP
          </label>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !name || !keyName}
            className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VaultPage() {
  const [credentials, setCredentials] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ListItem | null>(null)
  const [, startDelete] = useTransition()

  async function load() {
    setLoading(true)
    const data = await listCredentials()
    setCredentials(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() { setEditing(null); setModalOpen(true) }
  function openEdit(c: ListItem) { setEditing(c); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(null) }
  function onSaved() { closeModal(); load() }

  function handleDelete(id: string) {
    if (!confirm('Delete this credential? This cannot be undone.')) return
    startDelete(async () => {
      await deleteCredential(id)
      load()
    })
  }

  const global = credentials.filter(c => c.tier === 'global')
  const project = credentials.filter(c => c.tier === 'project')

  function Section({ title, items }: { title: string; items: ListItem[] }) {
    if (items.length === 0) return null
    return (
      <div className="mb-8">
        <h2 className="text-base font-semibold text-gray-300 mb-3">{title}</h2>
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left py-2 px-4">Name</th>
                <th className="text-left py-2 px-4">Key</th>
                <th className="text-left py-2 px-4">Tier</th>
                <th className="text-left py-2 px-4">Value</th>
                <th className="text-left py-2 px-4">Access</th>
                <th className="text-left py-2 px-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <CredentialRow key={c.id} cred={c} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Credentials Vault</h1>
          <p className="text-sm text-gray-400 mt-1">
            Keys are encrypted at rest. Values are never shown in plain text in the list.
            Agents access keys via the <code className="text-purple-400">mc_get_credential</code> MCP tool.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg"
        >
          + Add Key
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : credentials.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-gray-500 text-sm">
          No credentials yet. Add your first key to get started.
        </div>
      ) : (
        <>
          <Section title="Global Keys" items={global} />
          <Section title="Project-Specific Keys" items={project} />
        </>
      )}

      {modalOpen && (
        <CredentialModal initial={editing} onClose={closeModal} onSaved={onSaved} />
      )}
    </div>
  )
}
