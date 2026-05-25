# Vault Second Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Vault from credential storage into a full second brain — a unified, searchable, graph-visualizable knowledge store with semantic retrieval for agents.

**Architecture:** Single `vault_items` table with pgvector embeddings for semantic search. Three React components (VaultList, VaultGraph, VaultSidePanel) compose into a rebuilt vault page. Agents retrieve context via a new `mc_get_vault_context` MCP tool that queries pgvector instead of reading files.

**Tech Stack:** Supabase (pgvector, ivfflat index, RPC functions), OpenAI text-embedding-3-small, react-force-graph-2d, Next.js server actions, existing encrypt/decrypt from lib/crypto.ts

---

## File Map

| File | Action |
|------|--------|
| `supabase/migrations/012_vault_items.sql` | Create — table, indexes, pgvector RPC functions |
| `lib/types.ts` | Modify — add `VaultItem` type and `VaultItemType` union |
| `lib/vault.ts` | Create — `embedVaultItem()`, `queryVaultContext()`, `seedCredentialsToVault()` |
| `app/(app)/vault/actions.ts` | Modify — add vault_items server actions (keep existing credential actions) |
| `components/VaultSidePanel.tsx` | Create — side panel for item detail, reveal, edit, related |
| `components/VaultList.tsx` | Create — search bar, filter chips, card list |
| `components/VaultGraph.tsx` | Create — react-force-graph-2d force-directed graph |
| `app/(app)/vault/page.tsx` | Replace — full vault page managing state, composing three components |
| `lib/mcp-tools.ts` | Modify — add `mc_get_vault_context` tool definition and handler |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/012_vault_items.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Enable pgvector extension
create extension if not exists vector;

-- vault_items: unified second-brain store
create table vault_items (
  id                uuid        primary key default gen_random_uuid(),
  type              text        not null check (type in ('credential','skill','agent','personal','knowledge')),
  title             text        not null,
  content           text        not null,
  encrypted         boolean     not null default false,
  tags              text[]      not null default '{}',
  project_id        uuid        references projects(id) on delete set null,
  source_table      text,
  source_id         uuid,
  is_mcp_accessible boolean     not null default false,
  metadata          jsonb       not null default '{}',
  embedding         vector(1536),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index vault_items_embedding_idx on vault_items
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index vault_items_type_idx on vault_items (type);
create index vault_items_tags_idx on vault_items using gin (tags);

-- RPC: semantic search for MCP tool (requires is_mcp_accessible = true)
create or replace function match_vault_items(
  query_embedding vector(1536),
  match_count     int default 8
)
returns table (
  id                uuid,
  type              text,
  title             text,
  content           text,
  tags              text[],
  is_mcp_accessible boolean,
  metadata          jsonb
)
language sql stable
as $$
  select
    v.id, v.type, v.title, v.content, v.tags, v.is_mcp_accessible, v.metadata
  from vault_items v
  where v.encrypted = false
    and v.type != 'personal'
    and v.is_mcp_accessible = true
    and v.embedding is not null
  order by v.embedding <=> query_embedding
  limit match_count;
$$;

-- RPC: related items for UI side panel (no is_mcp_accessible requirement)
create or replace function match_vault_items_by_id(
  source_item_id uuid,
  match_count    int default 3
)
returns table (
  id           uuid,
  type         text,
  title        text,
  content      text,
  encrypted    boolean,
  tags         text[],
  project_id   uuid,
  source_table text,
  source_id    uuid,
  is_mcp_accessible boolean,
  metadata     jsonb,
  created_at   timestamptz,
  updated_at   timestamptz
)
language sql stable
as $$
  select
    v.id, v.type, v.title, v.content, v.encrypted, v.tags, v.project_id,
    v.source_table, v.source_id, v.is_mcp_accessible, v.metadata,
    v.created_at, v.updated_at
  from vault_items v
  where v.encrypted = false
    and v.type != 'personal'
    and v.id != source_item_id
    and v.embedding is not null
  order by v.embedding <=> (select embedding from vault_items where id = source_item_id)
  limit match_count;
$$;
```

- [ ] **Step 2: Apply the migration to Supabase**

Run in the Supabase SQL editor or via CLI:
```bash
# Via Supabase CLI (if configured)
supabase db push
# Or paste the SQL above into the Supabase dashboard SQL editor and run it
```

Expected: Table `vault_items` created, two RPC functions created, three indexes created. No errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/012_vault_items.sql
git commit -m "feat: add vault_items migration with pgvector semantic search"
```

---

## Task 2: Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add VaultItemType and VaultItem to lib/types.ts**

Add after the `CodexQcStatus` and `TaskTool` lines (around line 17), before the `Project` interface:

```typescript
export type VaultItemType = 'credential' | 'skill' | 'agent' | 'personal' | 'knowledge'

export interface VaultItem {
  id: string
  type: VaultItemType
  title: string
  content: string
  encrypted: boolean
  tags: string[]
  project_id: string | null
  source_table: string | null
  source_id: string | null
  is_mcp_accessible: boolean
  metadata: Record<string, unknown>
  embedding: number[] | null
  created_at: string
  updated_at: string
}
```

Also add `vault_items` to the `Database` interface's `Tables` section (after `project_health`):

```typescript
      vault_items: {
        Row: VaultItem
        Insert: Omit<VaultItem, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<VaultItem, 'id' | 'created_at'>>
        Relationships: []
      }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add VaultItem and VaultItemType to types"
```

---

## Task 3: Vault Library

**Files:**
- Create: `lib/vault.ts`

- [ ] **Step 1: Create lib/vault.ts**

```typescript
import OpenAI from 'openai'
import { createServerSupabaseClient } from '@/lib/supabase'
import { encrypt } from '@/lib/crypto'
import type { VaultItem } from '@/lib/types'

let _openai: OpenAI | null = null
function openaiClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

// For encrypted items, embed title only — content never sent to OpenAI
export async function embedVaultItem(title: string, content: string, isEncrypted: boolean): Promise<number[]> {
  const input = isEncrypted ? title : `${title} ${content}`
  const res = await openaiClient().embeddings.create({
    model: 'text-embedding-3-small',
    input,
  })
  return res.data[0].embedding
}

// MCP semantic search: returns only is_mcp_accessible items, excludes encrypted + personal
export async function queryVaultContext(query: string, limit = 8): Promise<Omit<VaultItem, 'embedding'>[]> {
  const supabase = await createServerSupabaseClient()
  const queryEmbedding = await embedVaultItem(query, '', false)

  const { data, error } = await supabase.rpc('match_vault_items', {
    query_embedding: queryEmbedding,
    match_count: limit,
  })

  if (error) throw new Error(error.message)
  return (data ?? []) as Omit<VaultItem, 'embedding'>[]
}

// One-time seed: copy existing credentials table rows into vault_items
export async function seedCredentialsToVault(): Promise<{ seeded: number; skipped: number }> {
  const supabase = await createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('vault_items')
    .select('source_id')
    .eq('source_table', 'credentials')
    .eq('type', 'credential')

  const existingSourceIds = new Set((existing ?? []).map(r => r.source_id))

  const { data: creds, error } = await supabase
    .from('credentials')
    .select('id, name, key_name, notes, tier, is_mcp_accessible')

  if (error) throw new Error(error.message)

  let seeded = 0
  let skipped = 0

  for (const cred of (creds ?? [])) {
    if (existingSourceIds.has(cred.id)) { skipped++; continue }

    const title = cred.name
    // Encrypt the content (key_name info) so it never leaves the vault unprotected
    const content = encrypt(`key_name: ${cred.key_name}`)
    const embedding = await embedVaultItem(title, '', true)

    await supabase.from('vault_items').insert({
      type: 'credential' as const,
      title,
      content,
      encrypted: true,
      is_mcp_accessible: false,
      source_table: 'credentials',
      source_id: cred.id,
      metadata: { key_name: cred.key_name, notes: cred.notes ?? null, tier: cred.tier },
      embedding,
    })
    seeded++
  }

  return { seeded, skipped }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/vault.ts
git commit -m "feat: add vault library with embedding, semantic search, and credential seed"
```

---

## Task 4: Server Actions for Vault Items

**Files:**
- Modify: `app/(app)/vault/actions.ts`

- [ ] **Step 1: Add vault_items server actions to the bottom of app/(app)/vault/actions.ts**

Keep all existing credential actions. Add the following below the existing `revealCredential` function:

```typescript
// ─── Vault Items ──────────────────────────────────────────────

import { embedVaultItem } from '@/lib/vault'
import type { VaultItem, VaultItemType } from '@/lib/types'

export type VaultItemListItem = Omit<VaultItem, 'embedding'>

export async function listVaultItems(params?: {
  type?: VaultItemType | 'all'
  search?: string
}): Promise<VaultItemListItem[]> {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from('vault_items')
    .select('id, type, title, content, encrypted, tags, project_id, source_table, source_id, is_mcp_accessible, metadata, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (params?.type && params.type !== 'all') {
    query = query.eq('type', params.type)
  }
  if (params?.search) {
    query = query.ilike('title', `%${params.search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as VaultItemListItem[]
}

export async function createVaultItem(params: {
  type: VaultItemType
  title: string
  content: string
  tags?: string[]
  project_id?: string | null
  is_mcp_accessible?: boolean
  metadata?: Record<string, unknown>
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()

  const isEncrypted = params.type === 'personal' || params.type === 'credential'
  const isMcpAccessible = isEncrypted ? false : (params.is_mcp_accessible ?? false)

  let storedContent = params.content
  if (isEncrypted) {
    const { encrypt: encryptFn } = await import('@/lib/crypto')
    storedContent = encryptFn(params.content)
  }

  let embedding: number[] | null = null
  try {
    embedding = await embedVaultItem(params.title, params.content, isEncrypted)
  } catch {
    // Non-fatal: item saves without embedding; search will skip it
  }

  const { data, error } = await supabase
    .from('vault_items')
    .insert({
      type: params.type,
      title: params.title,
      content: storedContent,
      encrypted: isEncrypted,
      tags: params.tags ?? [],
      project_id: params.project_id ?? null,
      is_mcp_accessible: isMcpAccessible,
      metadata: params.metadata ?? {},
      embedding,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/vault')
  return { id: data.id }
}

export async function updateVaultItem(
  id: string,
  params: {
    title?: string
    content?: string
    tags?: string[]
    project_id?: string | null
    is_mcp_accessible?: boolean
    metadata?: Record<string, unknown>
  }
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('vault_items')
    .select('type, encrypted, title, content')
    .eq('id', id)
    .single()

  if (!existing) return { error: 'Item not found' }

  const updates: Record<string, unknown> = { ...params, updated_at: new Date().toISOString() }

  if (params.content) {
    if (existing.encrypted) {
      const { encrypt: encryptFn } = await import('@/lib/crypto')
      updates.content = encryptFn(params.content)
    }
    // Re-embed with updated content
    try {
      const newTitle = params.title ?? existing.title
      updates.embedding = await embedVaultItem(newTitle, params.content, existing.encrypted)
    } catch {
      // Non-fatal
    }
  } else if (params.title) {
    // Title changed but content unchanged — re-embed with existing decrypted content not available,
    // so embed title only for encrypted items; skip re-embed for others unless content provided
    if (existing.encrypted) {
      try {
        updates.embedding = await embedVaultItem(params.title, '', true)
      } catch {
        // Non-fatal
      }
    }
  }

  // Encrypted and personal items can never be MCP accessible
  if (existing.encrypted) {
    updates.is_mcp_accessible = false
  }

  const { error } = await supabase.from('vault_items').update(updates).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function deleteVaultItem(id: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('vault_items').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function revealVaultItemContent(id: string): Promise<{ content?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('vault_items')
    .select('content, encrypted')
    .eq('id', id)
    .single()

  if (error || !data) return { error: error?.message ?? 'Not found' }
  if (!data.encrypted) return { content: data.content }

  try {
    const { decrypt } = await import('@/lib/crypto')
    return { content: decrypt(data.content) }
  } catch {
    return { error: 'Decryption failed' }
  }
}

export async function getRelatedVaultItems(id: string): Promise<VaultItemListItem[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('match_vault_items_by_id', {
    source_item_id: id,
    match_count: 3,
  })
  if (error) return []
  return (data ?? []) as VaultItemListItem[]
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/vault/actions.ts
git commit -m "feat: add vault_items server actions (create, update, delete, reveal, related)"
```

---

## Task 5: VaultSidePanel Component

**Files:**
- Create: `components/VaultSidePanel.tsx`

- [ ] **Step 1: Create components/VaultSidePanel.tsx**

```typescript
'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { updateVaultItem, deleteVaultItem, revealVaultItemContent, getRelatedVaultItems } from '@/app/(app)/vault/actions'
import type { VaultItem, VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

const TYPE_BADGE: Record<VaultItemType, string> = {
  credential: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  skill:      'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  agent:      'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  personal:   'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  knowledge:  'bg-green-500/15 text-green-300 ring-green-500/30',
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

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Close on click outside
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
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
                onClick={() => { setEditMode(false); setContent(''); setTitle(item.title); setTags(item.tags.join(', ')); }}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/VaultSidePanel.tsx
git commit -m "feat: add VaultSidePanel component with reveal, edit, related items"
```

---

## Task 6: VaultList Component

**Files:**
- Create: `components/VaultList.tsx`

- [ ] **Step 1: Create components/VaultList.tsx**

```typescript
'use client'

import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

const TYPE_BADGE: Record<VaultItemType, string> = {
  credential: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  skill:      'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  agent:      'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  personal:   'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  knowledge:  'bg-green-500/15 text-green-300 ring-green-500/30',
}

const FILTER_CHIPS: { value: VaultItemType | 'all'; label: string }[] = [
  { value: 'all',        label: 'All' },
  { value: 'credential', label: 'Credentials' },
  { value: 'skill',      label: 'Skills' },
  { value: 'agent',      label: 'Agents' },
  { value: 'personal',   label: 'Personal' },
  { value: 'knowledge',  label: 'Knowledge' },
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

      {/* Cards */}
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
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/VaultList.tsx
git commit -m "feat: add VaultList component with search, filter chips, card view"
```

---

## Task 7: VaultGraph Component

**Files:**
- Create: `components/VaultGraph.tsx`

- [ ] **Step 1: Install react-force-graph-2d**

```bash
npm install react-force-graph-2d
npm install --save-dev @types/react-force-graph
```

Expected: Package added to node_modules. If `@types/react-force-graph` fails (not published), skip it — react-force-graph-2d ships its own types.

- [ ] **Step 2: Create components/VaultGraph.tsx**

```typescript
'use client'

import dynamic from 'next/dynamic'
import { useMemo, useCallback, useRef } from 'react'
import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

// Dynamic import prevents SSR crash — react-force-graph-2d uses browser APIs
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

const TYPE_COLOR: Record<VaultItemType, string> = {
  credential: '#f59e0b',
  skill:      '#3b82f6',
  agent:      '#8b5cf6',
  personal:   '#f43f5e',
  knowledge:  '#22c55e',
}

interface GraphNode {
  id: string
  name: string
  type: VaultItemType
  val: number
  color: string
  item: VaultItemListItem
}

interface GraphLink {
  source: string
  target: string
}

interface Props {
  items: VaultItemListItem[]
  search: string
  selectedId: string | null
  onSelect: (item: VaultItemListItem) => void
}

export function VaultGraph({ items, search, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = items.map(item => ({
      id: item.id,
      name: item.title,
      type: item.type,
      val: Math.max(1, item.tags.length) + 1,
      color: TYPE_COLOR[item.type],
      item,
    }))

    const links: GraphLink[] = []
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const shared = items[i].tags.filter(t => items[j].tags.includes(t))
        if (shared.length > 0) {
          links.push({ source: items[i].id, target: items[j].id })
        }
      }
    }

    return { nodes, links }
  }, [items])

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = Math.sqrt(node.val) * 4
      const isSelected = node.id === selectedId
      const searchMatch = search && node.name.toLowerCase().includes(search.toLowerCase())
      const isSearching = !!search
      const opacity = isSearching ? (searchMatch ? 1 : 0.15) : 1

      ctx.globalAlpha = opacity

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.fill()

      // Selection ring
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, r + 3, 0, 2 * Math.PI)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Label (only when zoomed in enough)
      if (globalScale > 0.8) {
        const label = node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name
        const fontSize = Math.max(8, 12 / globalScale)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.textAlign = 'center'
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + fontSize + 2)
      }

      ctx.globalAlpha = 1
    },
    [selectedId, search]
  )

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onSelect(node.item)
    },
    [onSelect]
  )

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 rounded-xl border border-white/10 bg-white/3 text-sm text-gray-500">
        No vault items to display in graph.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="rounded-xl border border-white/10 bg-gray-950 overflow-hidden" style={{ height: 560 }}>
      <ForceGraph2D
        graphData={graphData as { nodes: GraphNode[]; links: GraphLink[] }}
        nodeId="id"
        nodeLabel="name"
        nodeCanvasObject={nodeCanvasObject as never}
        nodeCanvasObjectMode={() => 'replace'}
        onNodeClick={handleNodeClick as never}
        linkColor={() => 'rgba(255,255,255,0.1)'}
        linkWidth={1}
        backgroundColor="#030712"
        width={containerRef.current?.offsetWidth ?? 800}
        height={560}
        cooldownTicks={80}
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors. If `react-force-graph-2d` types cause issues, add `// @ts-ignore` above the ForceGraph2D usage and note it.

- [ ] **Step 4: Commit**

```bash
git add components/VaultGraph.tsx package.json package-lock.json
git commit -m "feat: add VaultGraph component with force-directed graph and search highlight"
```

---

## Task 8: Rebuild Vault Page

**Files:**
- Replace: `app/(app)/vault/page.tsx`

- [ ] **Step 1: Replace app/(app)/vault/page.tsx with the full vault page**

The new page is a client component that composes VaultList, VaultGraph, and VaultSidePanel. It preserves the existing credential UI under a tab, and adds the full vault_items UI as the main view.

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify the page renders in the browser**

Start dev server and navigate to `/vault`.

```bash
npm run dev
```

Navigate to `http://localhost:3000/vault`. Expected:
- Page loads with "Vault" heading
- "+ New Item" button present
- Search bar and filter chips visible
- List/Graph view toggle visible
- Empty state message if no items

Create a test item (e.g. type: Knowledge, title: "Test", content: "hello"). Expected:
- Item appears in the list
- Clicking the item opens the side panel
- Side panel shows title, type badge, content

- [ ] **Step 4: Commit**

```bash
git add app/(app)/vault/page.tsx
git commit -m "feat: rebuild vault page with full second brain UI"
```

---

## Task 9: MCP Tool — mc_get_vault_context

**Files:**
- Modify: `lib/mcp-tools.ts`

- [ ] **Step 1: Add the mc_get_vault_context tool definition to MCP_TOOLS array in lib/mcp-tools.ts**

Add after the last item in the `MCP_TOOLS` array (after `mc_update_project_status`), before the closing `]`:

```typescript
  {
    name: 'mc_get_vault_context',
    description: 'Semantic search over vault items. Pass the current task description to get relevant skills, agent roles, and knowledge items back. Never returns encrypted or personal items.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Task description or question to match against vault knowledge' },
        limit: { type: 'number', description: 'Max items to return (default 8, max 20)' },
      },
      required: ['query'],
    },
  },
```

- [ ] **Step 2: Add the mc_get_vault_context handler to the callTool function in lib/mcp-tools.ts**

Add before the final `throw new Error(\`Unknown tool: ${name}\`)` line:

```typescript
  if (name === 'mc_get_vault_context') {
    const { query, limit } = args
    if (!query) throw new Error('query is required')

    const { queryVaultContext } = await import('@/lib/vault')
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 20) : 8
    const results = await queryVaultContext(query, parsedLimit)

    return JSON.stringify(
      results.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content.slice(0, 500), // Truncate for token efficiency
        tags: r.tags,
      }))
    )
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp-tools.ts
git commit -m "feat: add mc_get_vault_context MCP tool for semantic vault retrieval"
```

---

## Task 10: End-to-End Smoke Test

- [ ] **Step 1: Add a vault item of each type via the UI**

Start the dev server (`npm run dev`) and navigate to `/vault`. Add one item of each type:
1. **skill** — title: "Write concise Next.js server actions", content: "Use 'use server', revalidatePath, return plain objects with optional error field. No throw from server actions — return { error } instead."
2. **knowledge** — title: "pgvector cosine search pattern", content: "Use <=> operator in SQL ORDER BY. Call via supabase.rpc with query_embedding as number array."
3. **personal** — title: "Test personal entry", content: "This should be encrypted"

Expected:
- All three items appear in the list
- personal item shows lock icon and `••••••••` content excerpt
- Clicking personal item shows "Reveal" button instead of content
- Clicking skill/knowledge items shows content in the side panel

- [ ] **Step 2: Test search and filter**

- Search "pgvector" — only the knowledge item should be visible
- Clear search, click "Skills" filter — only the skill item should be visible
- Click "All" to clear filter

- [ ] **Step 3: Test graph view**

Add a shared tag to two items (e.g. both skill and knowledge get tag "ai").
Toggle to Graph view. Expected:
- Nodes visible as colored circles
- Edge visible between the two items sharing the "ai" tag
- Clicking a node opens the side panel

- [ ] **Step 4: Test the seed function (optional manual)**

If there are existing credentials, call `seedCredentialsToVault()` from a temporary test route or the Supabase SQL editor to verify credentials mirror to vault_items with encrypted=true.

- [ ] **Step 5: Final commit and push**

```bash
git push origin main
```

---

## Notes for Implementers

**react-force-graph-2d types:** The library ships its own types but they can be loose. If TypeScript complains about node/link types, cast with `as never` on the graph data and callback props — the runtime behavior is correct.

**pgvector RPC:** Supabase converts JavaScript number arrays to `vector` type automatically when the SQL function signature declares `vector(1536)`. No manual serialization needed.

**Embedding failures are non-fatal:** If the OpenAI embeddings API call fails (rate limit, missing key), the item saves without an embedding and is excluded from semantic search. This is intentional — the vault should still function even if embeddings are unavailable.

**Encryption rule:** `personal` and `credential` type items are always `encrypted = true` regardless of what the caller passes. This is enforced in `createVaultItem`. Same items can never be `is_mcp_accessible = true`.

**Graph view layout:** In graph view, the filter chips and search bar still appear (rendered by VaultList in controls-only mode). The card list is hidden; only the graph renders below the controls.

Wait — the current page implementation renders VaultList in both list and graph modes (for controls). This means in graph view, VaultList renders the controls AND the card list. To fix this, VaultList should conditionally hide the card list when in graph mode. VaultList already receives the `view` prop — use it to conditionally render the card section.

**Fix for VaultList in graph mode:** At the end of VaultList, wrap the cards section:
```typescript
{view === 'list' && (
  <div className="flex flex-col gap-2">
    {/* ... cards ... */}
  </div>
)}
```
Apply this fix during Task 6 implementation.
