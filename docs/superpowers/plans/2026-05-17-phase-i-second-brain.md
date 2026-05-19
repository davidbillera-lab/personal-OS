# Phase I — Second Brain Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Second Brain infrastructure for Mission Control — Command Center, Credentials Vault, Mission Brief redesign, Skills Registry, and Build Partner tool use.

**Architecture:** Eight sequential tasks tied to the Phase I spec; each builds on the prior. No real-time websockets; health dots are on-demand fetches cached in project_health. Credentials are AES-256-GCM encrypted in the application layer and never exposed in UI plain text.

**Tech Stack:** Next.js 16, Supabase (Postgres), TypeScript, Node.js crypto (AES-256-GCM), GitHub raw API (GITHUB_PAT), Anthropic SDK with tool use loop

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/007_phase_i_second_brain.sql` | Create |
| `lib/types.ts` | Modify — add Credential, ProjectHealth, CredentialAccessLog; extend Project |
| `lib/crypto.ts` | Create — AES-256-GCM encrypt/decrypt/mask |
| `lib/health.ts` | Create — getProjectHealth with 5-min cache |
| `app/(app)/vault/page.tsx` | Create — credential CRUD UI |
| `app/(app)/vault/actions.ts` | Create — server actions for vault |
| `lib/mcp-tools.ts` | Modify — add mc_get_credential tool |
| `app/(app)/page.tsx` | Modify — full rewrite as Command Center |
| `app/(app)/projects/[id]/page.tsx` | Modify — fetch kill-criteria.md, handoffs, health |
| `components/ProjectWorkspaceTabs.tsx` | Modify — rename overview→mission_brief, add handoff_log tab, health panel |
| `app/(app)/projects/[id]/actions.ts` | Modify — rewrite sendChatMessage with tool use loop |
| `components/ProjectChat.tsx` | Modify — handle toolCalls in response, ToolCallBadge |
| `app/(app)/skills/page.tsx` | Create — read-only skills registry |
| `components/Nav.tsx` | Modify — add Vault, Skills links; rename Dashboard → Command Center |

---

## Task 1: Migration 007 — Schema

**Files:**
- Create: `supabase/migrations/007_phase_i_second_brain.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/007_phase_i_second_brain.sql

-- New columns on projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS vercel_url TEXT,
  ADD COLUMN IF NOT EXISTS supabase_project_id TEXT,
  ADD COLUMN IF NOT EXISTS github_repo TEXT;

-- Credentials table (values encrypted at application layer with AES-256-GCM)
CREATE TABLE IF NOT EXISTS credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  key_name        TEXT NOT NULL UNIQUE,
  value           TEXT NOT NULL,
  tier            TEXT NOT NULL CHECK (tier IN ('global', 'project')),
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  is_mcp_accessible BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON credentials
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Credential access log
CREATE TABLE IF NOT EXISTS credential_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name    TEXT NOT NULL,
  accessed_by TEXT NOT NULL,
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE credential_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON credential_access_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Project health cache
CREATE TABLE IF NOT EXISTS project_health (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  github_status   TEXT CHECK (github_status IN ('ok', 'warn', 'error', 'unknown')),
  vercel_status   TEXT CHECK (vercel_status IN ('ok', 'warn', 'error', 'unknown')),
  supabase_status TEXT CHECK (supabase_status IN ('ok', 'warn', 'error', 'unknown')),
  checked_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON project_health
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Unique index so upsert works per project
CREATE UNIQUE INDEX IF NOT EXISTS project_health_project_id_idx ON project_health(project_id);
```

- [ ] **Step 2: Apply migration in Supabase**

Open Supabase dashboard → SQL Editor → paste and run the file contents.

Verify:
- `credentials` table appears in Table Editor
- `credential_access_log` table appears
- `project_health` table appears
- `projects` table has columns `vercel_url`, `supabase_project_id`, `github_repo`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_phase_i_second_brain.sql
git commit -m "feat: migration 007 — credentials, project_health, new project columns"
```

---

## Task 2: Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add new fields to Project interface and new interfaces**

Open `lib/types.ts`. The `Project` interface currently ends around line 30. Find the `Project` interface and add three fields after `github_repo_url` (or before the closing brace). Then add the new interfaces after the existing `AgentHandoff` interface.

In the `Project` interface, add:
```typescript
  vercel_url: string | null
  supabase_project_id: string | null
  github_repo: string | null
```

After the `AgentHandoff` interface, add:
```typescript
export type CredentialTier = 'global' | 'project'
export type HealthStatus = 'ok' | 'warn' | 'error' | 'unknown'

export interface Credential {
  id: string
  name: string
  key_name: string
  value: string
  tier: CredentialTier
  project_id: string | null
  is_mcp_accessible: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ProjectHealth {
  id: string
  project_id: string
  github_status: HealthStatus
  vercel_status: HealthStatus
  supabase_status: HealthStatus
  checked_at: string
}

export interface CredentialAccessLog {
  id: string
  key_name: string
  accessed_by: string
  accessed_at: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors (or only pre-existing errors unrelated to types.ts)

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add Credential, ProjectHealth types; extend Project with vercel_url, supabase_project_id, github_repo"
```

---

## Task 3: Crypto + Credentials Vault

**Files:**
- Create: `lib/crypto.ts`
- Create: `lib/health.ts`
- Create: `app/(app)/vault/page.tsx`
- Create: `app/(app)/vault/actions.ts`
- Modify: `lib/mcp-tools.ts`

### Step group A: lib/crypto.ts

- [ ] **Step 1: Create lib/crypto.ts**

```typescript
// lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_HEX = process.env.CREDENTIAL_ENCRYPTION_KEY ?? ''

function getKey(): Buffer {
  if (KEY_HEX.length !== 64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(KEY_HEX, 'hex')
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: iv(24 hex) + tag(32 hex) + encrypted(hex)
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex')
}

export function decrypt(ciphertext: string): string {
  const key = getKey()
  const iv = Buffer.from(ciphertext.slice(0, 24), 'hex')
  const tag = Buffer.from(ciphertext.slice(24, 56), 'hex')
  const encrypted = Buffer.from(ciphertext.slice(56), 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

export function maskValue(plaintext: string): string {
  if (plaintext.length <= 4) return '••••••••'
  return '••••••••' + plaintext.slice(-4)
}
```

- [ ] **Step 2: Add CREDENTIAL_ENCRYPTION_KEY to .env.local**

Generate a 64-char hex key (PowerShell):
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Add to `.env.local`:
```
CREDENTIAL_ENCRYPTION_KEY=<paste 64-char hex here>
```

### Step group B: lib/health.ts

- [ ] **Step 3: Create lib/health.ts**

```typescript
// lib/health.ts
import { createServerSupabaseClient } from '@/lib/supabase'
import type { ProjectHealth, HealthStatus } from '@/lib/types'

const CACHE_MINUTES = 5

export async function getProjectHealth(projectId: string): Promise<ProjectHealth | null> {
  const supabase = createServerSupabaseClient()

  // Check cache
  const { data: cached } = await supabase
    .from('project_health')
    .select('*')
    .eq('project_id', projectId)
    .single()

  if (cached) {
    const age = Date.now() - new Date(cached.checked_at).getTime()
    if (age < CACHE_MINUTES * 60 * 1000) return cached as ProjectHealth
  }

  // Fetch fresh health
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, vercel_url, supabase_project_id')
    .eq('id', projectId)
    .single()

  const github_status = await checkGitHub(project?.github_repo ?? null)
  const vercel_status = await checkVercel(project?.vercel_url ?? null)
  const supabase_status: HealthStatus = project?.supabase_project_id ? 'ok' : 'unknown'

  const health = {
    project_id: projectId,
    github_status,
    vercel_status,
    supabase_status,
    checked_at: new Date().toISOString(),
  }

  await supabase
    .from('project_health')
    .upsert(health, { onConflict: 'project_id' })

  const { data: result } = await supabase
    .from('project_health')
    .select('*')
    .eq('project_id', projectId)
    .single()

  return result as ProjectHealth | null
}

async function checkGitHub(repoUrl: string | null): Promise<HealthStatus> {
  if (!repoUrl) return 'unknown'
  try {
    const apiUrl = repoUrl.replace('https://github.com/', 'https://api.github.com/repos/')
    const res = await fetch(apiUrl, {
      headers: { Authorization: `token ${process.env.GITHUB_PAT ?? ''}` },
      next: { revalidate: 0 },
    })
    return res.ok ? 'ok' : 'warn'
  } catch {
    return 'error'
  }
}

async function checkVercel(vercelUrl: string | null): Promise<HealthStatus> {
  if (!vercelUrl) return 'unknown'
  try {
    const res = await fetch(vercelUrl, { method: 'HEAD', next: { revalidate: 0 } })
    if (res.ok) return 'ok'
    if (res.status >= 500) return 'error'
    return 'warn'
  } catch {
    return 'error'
  }
}
```

### Step group C: Vault server actions

- [ ] **Step 4: Create app/(app)/vault/actions.ts**

```typescript
// app/(app)/vault/actions.ts
'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'
import type { CredentialTier } from '@/lib/types'

export async function listCredentials() {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('credentials')
    .select('id, name, key_name, tier, project_id, is_mcp_accessible, notes, created_at, updated_at')
    .order('tier', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function addCredential(input: {
  name: string
  key_name: string
  value: string
  tier: CredentialTier
  project_id?: string
  is_mcp_accessible?: boolean
  notes?: string
}) {
  const supabase = createServerSupabaseClient()
  const encrypted = encrypt(input.value)
  const { error } = await supabase.from('credentials').insert({
    name: input.name,
    key_name: input.key_name,
    value: encrypted,
    tier: input.tier,
    project_id: input.project_id ?? null,
    is_mcp_accessible: input.is_mcp_accessible ?? true,
    notes: input.notes ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function updateCredential(id: string, input: {
  name?: string
  value?: string
  tier?: CredentialTier
  project_id?: string | null
  is_mcp_accessible?: boolean
  notes?: string | null
}) {
  const supabase = createServerSupabaseClient()
  const patch: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() }
  if (input.value) patch.value = encrypt(input.value)
  const { error } = await supabase.from('credentials').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteCredential(id: string) {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from('credentials').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function revealCredential(id: string): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('credentials')
    .select('value')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error('Credential not found')
  return decrypt(data.value)
}
```

### Step group D: Vault UI

- [ ] **Step 5: Create app/(app)/vault/page.tsx**

```typescript
// app/(app)/vault/page.tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  listCredentials,
  addCredential,
  updateCredential,
  deleteCredential,
  revealCredential,
} from './actions'
import type { CredentialTier } from '@/lib/types'

type CredRow = {
  id: string
  name: string
  key_name: string
  tier: CredentialTier
  project_id: string | null
  is_mcp_accessible: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export default function VaultPage() {
  const [creds, setCreds] = useState<CredRow[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<CredRow | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    listCredentials().then(setCreds)
  }, [])

  function reload() {
    listCredentials().then(setCreds)
  }

  function handleReveal(id: string) {
    startTransition(async () => {
      const plain = await revealCredential(id)
      setRevealed(prev => ({ ...prev, [id]: plain }))
      setTimeout(() => setRevealed(prev => { const next = { ...prev }; delete next[id]; return next }), 30000)
    })
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this credential? This cannot be undone.')) return
    startTransition(async () => {
      await deleteCredential(id)
      reload()
    })
  }

  const globals = creds.filter(c => c.tier === 'global')
  const projects = creds.filter(c => c.tier === 'project')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Credentials Vault</h1>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true) }}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
        >
          + Add Credential
        </button>
      </div>

      <Section title="Global Keys" creds={globals} revealed={revealed} onReveal={handleReveal} onEdit={c => { setEditTarget(c); setShowModal(true) }} onDelete={handleDelete} />
      <Section title="Project-Specific Keys" creds={projects} revealed={revealed} onReveal={handleReveal} onEdit={c => { setEditTarget(c); setShowModal(true) }} onDelete={handleDelete} />

      {showModal && (
        <CredentialModal
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSave={async (input) => {
            if (editTarget) {
              await updateCredential(editTarget.id, input)
            } else {
              await addCredential(input as Parameters<typeof addCredential>[0])
            }
            setShowModal(false)
            reload()
          }}
        />
      )}
    </div>
  )
}

function Section({ title, creds, revealed, onReveal, onEdit, onDelete }: {
  title: string
  creds: CredRow[]
  revealed: Record<string, string>
  onReveal: (id: string) => void
  onEdit: (c: CredRow) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      {creds.length === 0 && <p className="text-gray-500 text-sm">None yet.</p>}
      <div className="space-y-2">
        {creds.map(c => (
          <div key={c.id} className="flex items-center gap-4 p-3 bg-gray-800 rounded-lg">
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{c.name}</span>
              <span className="ml-2 text-xs text-gray-400 font-mono">{c.key_name}</span>
              {c.is_mcp_accessible && (
                <span className="ml-2 px-1.5 py-0.5 bg-blue-900 text-blue-300 rounded text-xs">MCP</span>
              )}
            </div>
            <div className="font-mono text-sm text-gray-300 min-w-[160px]">
              {revealed[c.id] ? (
                <span className="text-yellow-300">{revealed[c.id]}</span>
              ) : (
                <span>••••••••</span>
              )}
            </div>
            <button onClick={() => onReveal(c.id)} className="text-xs text-gray-400 hover:text-white px-2 py-1 border border-gray-600 rounded">
              Reveal
            </button>
            <button onClick={() => onEdit(c)} className="text-xs text-gray-400 hover:text-white px-2 py-1 border border-gray-600 rounded">
              Edit
            </button>
            <button onClick={() => onDelete(c.id)} className="text-xs text-red-400 hover:text-red-200 px-2 py-1 border border-red-800 rounded">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function CredentialModal({ initial, onClose, onSave }: {
  initial: CredRow | null
  onClose: () => void
  onSave: (input: { name: string; key_name: string; value?: string; tier: CredentialTier; project_id?: string | null; is_mcp_accessible?: boolean; notes?: string | null }) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [key_name, setKeyName] = useState(initial?.key_name ?? '')
  const [value, setValue] = useState('')
  const [tier, setTier] = useState<CredentialTier>(initial?.tier ?? 'global')
  const [project_id, setProjectId] = useState(initial?.project_id ?? '')
  const [is_mcp_accessible, setMcp] = useState(initial?.is_mcp_accessible ?? true)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave({
      name, key_name,
      ...(value ? { value } : {}),
      tier,
      project_id: project_id || null,
      is_mcp_accessible,
      notes: notes || null,
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-700">
        <h2 className="text-lg font-bold mb-4">{initial ? 'Edit Credential' : 'Add Credential'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Anthropic API Key)" className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
          <input required={!initial} value={key_name} onChange={e => setKeyName(e.target.value)} placeholder="Key name (e.g. ANTHROPIC_API_KEY)" disabled={!!initial} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm font-mono disabled:opacity-50" />
          <input type="password" value={value} onChange={e => setValue(e.target.value)} placeholder={initial ? 'New value (leave blank to keep current)' : 'Value'} required={!initial} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
          <select value={tier} onChange={e => setTier(e.target.value as CredentialTier)} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
            <option value="global">Global</option>
            <option value="project">Project-specific</option>
          </select>
          {tier === 'project' && (
            <input value={project_id} onChange={e => setProjectId(e.target.value)} placeholder="Project ID (UUID)" className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm font-mono" />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={is_mcp_accessible} onChange={e => setMcp(e.target.checked)} />
            MCP accessible
          </label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 bg-gray-700 rounded text-sm hover:bg-gray-600">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-purple-600 rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

### Step group E: MCP tool mc_get_credential

- [ ] **Step 6: Add mc_get_credential to lib/mcp-tools.ts**

Open `lib/mcp-tools.ts`. Add to the `MCP_TOOLS` array (before the closing `]`):

```typescript
  {
    name: 'mc_get_credential',
    description: 'Fetch a credential value by key_name. Logs access. Returns plain-text value to the calling agent.',
    inputSchema: {
      type: 'object',
      properties: {
        key_name: { type: 'string', description: 'The key_name of the credential to fetch' },
        agent_name: { type: 'string', description: 'Name of the agent requesting the credential (for access log)' },
      },
      required: ['key_name'],
    },
  },
```

Then in the `callTool` function, add before the final `throw new Error(...)`:

```typescript
  if (name === 'mc_get_credential') {
    const key_name = args.key_name
    const agent_name = args.agent_name ?? 'unknown_agent'
    if (!key_name) throw new Error('key_name is required')

    const { data: cred, error } = await supabase
      .from('credentials')
      .select('value, is_mcp_accessible')
      .eq('key_name', key_name)
      .single()

    if (error || !cred) throw new Error(`Credential not found: ${key_name}`)
    if (!cred.is_mcp_accessible) throw new Error(`Credential ${key_name} is not MCP accessible`)

    // Log access
    await supabase.from('credential_access_log').insert({
      key_name,
      accessed_by: agent_name,
    })

    const { decrypt } = await import('@/lib/crypto')
    return decrypt(cred.value)
  }
```

Note: the `import` statement at the top of `lib/mcp-tools.ts` already imports `createServerSupabaseClient`. The `supabase` client is already initialized in the function. The `decrypt` import uses dynamic import to avoid circular dependency risk.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add lib/crypto.ts lib/health.ts app/(app)/vault/page.tsx app/(app)/vault/actions.ts lib/mcp-tools.ts
git commit -m "feat: credentials vault — AES-256-GCM crypto, vault UI, mc_get_credential MCP tool"
```

---

## Task 4: Command Center

**Files:**
- Modify: `app/(app)/page.tsx` (full rewrite)

- [ ] **Step 1: Rewrite app/(app)/page.tsx as Command Center**

```typescript
// app/(app)/page.tsx
import { createServerSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'
import type { Project, AgentHandoff } from '@/lib/types'

export const dynamic = 'force-dynamic'

function timeSince(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function stageBadge(stage: string) {
  const colors: Record<string, string> = {
    idea: 'bg-gray-700 text-gray-300',
    spec: 'bg-blue-900 text-blue-300',
    build: 'bg-yellow-900 text-yellow-300',
    ship: 'bg-green-900 text-green-300',
    scale: 'bg-purple-900 text-purple-300',
    kill: 'bg-red-900 text-red-400',
  }
  return colors[stage] ?? 'bg-gray-700 text-gray-300'
}

function healthDot(status: string | null) {
  if (status === 'ok') return <span className="inline-block w-2 h-2 rounded-full bg-green-400" title="ok" />
  if (status === 'warn') return <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" title="warn" />
  if (status === 'error') return <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="error" />
  return <span className="inline-block w-2 h-2 rounded-full bg-gray-600" title="unknown" />
}

export default async function CommandCenterPage() {
  const supabase = createServerSupabaseClient()

  const [{ data: projects }, { data: handoffs }, { data: tasks }, { data: creds }] = await Promise.all([
    supabase.from('projects').select('*').order('tier', { ascending: true }).order('last_update', { ascending: false }),
    supabase.from('agent_handoffs').select('*').order('created_at', { ascending: false }).limit(10),
    supabase.from('tasks').select('id, status, project_id').in('status', ['spec_ready', 'in_progress']),
    supabase.from('credentials').select('id, name, key_name, tier, is_mcp_accessible').order('tier'),
  ])

  const allProjects = (projects ?? []) as Project[]
  const allHandoffs = (handoffs ?? []) as AgentHandoff[]

  const activeAgents = allHandoffs.filter(h => h.status === 'in_progress').length
  const specReady = (tasks ?? []).filter(t => t.status === 'spec_ready').length
  const blocked = allProjects.filter(p => p.blockers && p.blockers.trim() !== '').length
  const inBuildShip = allProjects.filter(p => ['build', 'ship'].includes(p.stage ?? '')).length

  const tier1 = allProjects.filter(p => p.tier === 1)
  const tier2 = allProjects.filter(p => p.tier === 2)
  const tier3 = allProjects.filter(p => p.tier === 3)

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Health Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Projects', value: allProjects.length, color: 'text-white' },
          { label: 'Build / Ship', value: inBuildShip, color: 'text-yellow-300' },
          { label: 'Active Agents', value: activeAgents, color: 'text-blue-300' },
          { label: 'Awaiting Action', value: specReady, color: 'text-purple-300' },
          { label: 'Blocked', value: blocked, color: blocked > 0 ? 'text-red-400' : 'text-gray-400' },
        ].map(stat => (
          <div key={stat.label} className="bg-gray-800 rounded-lg p-4 text-center">
            <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-400 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Project Grid — 2/3 width */}
        <div className="xl:col-span-2 space-y-6">
          <ProjectTier label="Tier 1 — Protect & Accelerate" projects={tier1} color="border-purple-600" />
          <ProjectTier label="Tier 2 — Active Builds" projects={tier2} color="border-blue-600" />
          <ProjectTier label="Tier 3 — Personal / Family" projects={tier3} color="border-gray-600" />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Vault Quick-View */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Credentials Vault</h2>
              <Link href="/vault" className="text-xs text-purple-400 hover:text-purple-300">View all →</Link>
            </div>
            <div className="space-y-1">
              {(creds ?? []).slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center gap-2 text-xs py-1">
                  <span className="text-gray-300 font-mono flex-1 truncate">{c.key_name}</span>
                  {c.is_mcp_accessible && <span className="px-1 bg-blue-900 text-blue-300 rounded text-[10px]">MCP</span>}
                  <span className={`px-1 rounded text-[10px] ${c.tier === 'global' ? 'bg-purple-900 text-purple-300' : 'bg-gray-700 text-gray-400'}`}>{c.tier}</span>
                </div>
              ))}
              {(creds ?? []).length === 0 && <p className="text-gray-500 text-xs">No credentials yet. <Link href="/vault" className="text-purple-400">Add one →</Link></p>}
            </div>
          </div>

          {/* Agent Activity */}
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Agent Activity</h2>
              <Link href="/orchestrate" className="text-xs text-blue-400 hover:text-blue-300">Orchestrate →</Link>
            </div>
            <div className="space-y-2">
              {allHandoffs.slice(0, 6).map(h => (
                <div key={h.id} className="text-xs py-1.5 border-b border-gray-700 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${h.status === 'in_progress' ? 'bg-blue-900 text-blue-300 animate-pulse' : h.status === 'done' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-300'}`}>
                      {h.status}
                    </span>
                    <span className="font-medium text-gray-200">{h.agent_name}</span>
                  </div>
                  <p className="text-gray-400 mt-0.5 truncate">{h.task_description ?? '—'}</p>
                </div>
              ))}
              {allHandoffs.length === 0 && <p className="text-gray-500 text-xs">No agent sessions yet.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectTier({ label, projects, color }: { label: string; projects: Project[]; color: string }) {
  if (projects.length === 0) return null
  return (
    <div>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {projects.map(p => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  )
}

function ProjectCard({ project: p }: { project: Project }) {
  const vsCodePath = p.local_path
    ? `vscode://file/${p.local_path.replace(/\\/g, '/')}`
    : null

  const tierColors: Record<number, string> = {
    1: 'border-l-purple-500',
    2: 'border-l-blue-500',
    3: 'border-l-gray-500',
  }

  return (
    <Link href={`/projects/${p.id}`} className={`block bg-gray-800 rounded-xl p-4 border border-gray-700 border-l-4 ${tierColors[p.tier ?? 3] ?? 'border-l-gray-500'} hover:border-gray-500 transition-colors`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-sm leading-tight">{p.name}</span>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${stageBadge(p.stage ?? 'idea')}`}>{p.stage ?? 'idea'}</span>
      </div>

      {/* Health dots */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-gray-500">GH</span>
        {healthDot(null)}
        <span className="text-[10px] text-gray-500 ml-1">VCL</span>
        {healthDot(null)}
        <span className="text-[10px] text-gray-500 ml-1">SB</span>
        {healthDot(null)}
      </div>

      {p.status && <p className="text-xs text-gray-400 mb-2 line-clamp-2">{p.status}</p>}

      {p.next_action && (
        <div className="bg-gray-700/50 rounded p-2 mb-2">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Next</p>
          <p className="text-xs text-gray-200 line-clamp-2">{p.next_action}</p>
        </div>
      )}

      {p.blockers && p.blockers.trim() !== '' && (
        <div className="bg-red-900/30 border border-red-800 rounded p-2 mb-2">
          <p className="text-[10px] text-red-400 uppercase tracking-wide mb-0.5">Blocked</p>
          <p className="text-xs text-red-300 line-clamp-1">{p.blockers}</p>
        </div>
      )}

      <div className="flex items-center gap-3 mt-2">
        <span className="text-[10px] text-gray-500">{timeSince(p.last_update)}</span>
        {vsCodePath && (
          <a href={vsCodePath} onClick={e => e.stopPropagation()} className="text-[10px] text-blue-400 hover:text-blue-300">
            Open VS Code
          </a>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Start dev server and check Command Center**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
- Health summary bar shows 5 stat cards
- Projects appear in 3 tier groups
- Right column shows Vault quick-view and Agent Activity panel
- Each project card links to `/projects/[id]`

- [ ] **Step 4: Commit**

```bash
git add app/(app)/page.tsx
git commit -m "feat: Command Center — replaces dashboard with health bar, tiered project grid, vault panel, agent activity"
```

---

## Task 5: Mission Brief Redesign

**Files:**
- Modify: `app/(app)/projects/[id]/page.tsx`
- Modify: `components/ProjectWorkspaceTabs.tsx`

### Step group A: Project page — add kill-criteria.md, handoffs, health

- [ ] **Step 1: Update app/(app)/projects/[id]/page.tsx**

Read the current file first (51 lines). Replace the full file:

```typescript
// app/(app)/projects/[id]/page.tsx
import { createServerSupabaseClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import ProjectWorkspaceTabs from '@/components/ProjectWorkspaceTabs'
import { getProjectHealth } from '@/lib/health'
import type { AgentHandoff, ProjectHealth } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function fetchGitHubFile(repoUrl: string, path: string): Promise<string> {
  const raw = repoUrl.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/main/' + path
  const res = await fetch(raw, {
    headers: { Authorization: `token ${process.env.GITHUB_PAT ?? ''}` },
    next: { revalidate: 0 },
  })
  if (!res.ok) return ''
  return res.text()
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!project) notFound()

  const [
    { data: brainDumps },
    { data: tasks },
    { data: chats },
    { data: handoffs },
  ] = await Promise.all([
    supabase.from('brain_dumps').select('*').eq('project_id', params.id).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('project_id', params.id).order('created_at', { ascending: false }),
    supabase.from('project_chats').select('*').eq('project_id', params.id).order('created_at', { ascending: true }),
    supabase.from('agent_handoffs').select('*').eq('project_id', params.id).order('created_at', { ascending: false }).limit(20),
  ])

  const repoUrl = project.github_repo ?? project.repo_url ?? ''

  const [claudeMdResult, decisionsMdResult, killCriteriaMdResult] = await Promise.allSettled([
    repoUrl ? fetchGitHubFile(repoUrl, 'CLAUDE.md') : Promise.resolve(''),
    repoUrl ? fetchGitHubFile(repoUrl, 'decisions.md') : Promise.resolve(''),
    repoUrl ? fetchGitHubFile(repoUrl, 'kill-criteria.md') : Promise.resolve(''),
  ])

  const claudeMd = claudeMdResult.status === 'fulfilled' ? claudeMdResult.value : ''
  const decisionsMd = decisionsMdResult.status === 'fulfilled' ? decisionsMdResult.value : ''
  const killCriteriaMd = killCriteriaMdResult.status === 'fulfilled' ? killCriteriaMdResult.value : ''

  const health = await getProjectHealth(params.id)

  return (
    <ProjectWorkspaceTabs
      project={project}
      brainDumps={brainDumps ?? []}
      tasks={tasks ?? []}
      initialChats={chats ?? []}
      claudeMd={claudeMd}
      decisionsMd={decisionsMd}
      killCriteriaMd={killCriteriaMd}
      handoffs={(handoffs ?? []) as AgentHandoff[]}
      health={health}
    />
  )
}
```

### Step group B: ProjectWorkspaceTabs — redesign

- [ ] **Step 2: Update components/ProjectWorkspaceTabs.tsx**

Full rewrite (the file is 279 lines; replace entirely):

```typescript
// components/ProjectWorkspaceTabs.tsx
'use client'

import { useState } from 'react'
import type { Project, BrainDump, Task, ProjectChat, AgentHandoff, ProjectHealth } from '@/lib/types'
import ProjectChat from '@/components/ProjectChat'
import BrainDumpList from '@/components/BrainDumpList'
import TaskList from '@/components/TaskList'

const TABS = ['mission_brief', 'brain_dumps', 'tasks', 'handoff_log'] as const
type Tab = typeof TABS[number]

const TAB_LABELS: Record<Tab, string> = {
  mission_brief: 'Mission Brief',
  brain_dumps: 'Brain Dumps',
  tasks: 'Tasks',
  handoff_log: 'Handoff Log',
}

function timeSince(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function HealthDot({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    ok: 'bg-green-400',
    warn: 'bg-yellow-400',
    error: 'bg-red-500',
    unknown: 'bg-gray-600',
  }
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status ?? 'unknown'] ?? 'bg-gray-600'}`} title={status ?? 'unknown'} />
}

function MdViewer({ title, content, defaultOpen = false }: { title: string; content: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!content) return (
    <div className="border border-gray-700 rounded-lg p-3">
      <span className="text-sm text-gray-500">{title} — not found in repo</span>
    </div>
  )
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-3 bg-gray-800 hover:bg-gray-750 text-sm font-medium">
        <span>{title}</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <pre className="p-4 text-xs text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap bg-gray-900">{content}</pre>
      )}
    </div>
  )
}

export default function ProjectWorkspaceTabs({
  project,
  brainDumps,
  tasks,
  initialChats,
  claudeMd,
  decisionsMd,
  killCriteriaMd,
  handoffs,
  health,
}: {
  project: Project
  brainDumps: BrainDump[]
  tasks: Task[]
  initialChats: ProjectChat[]
  claudeMd: string
  decisionsMd: string
  killCriteriaMd: string
  handoffs: AgentHandoff[]
  health: ProjectHealth | null
}) {
  const [activeTab, setActiveTab] = useState<Tab>('mission_brief')

  const vsCodePath = project.local_path
    ? `vscode://file/${project.local_path.replace(/\\/g, '/')}`
    : null

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left — tabs */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-0 border-b border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-xl font-bold">{project.name}</h1>
            <span className="px-2 py-0.5 bg-gray-700 rounded-full text-xs">{project.stage ?? 'idea'}</span>
            <span className="px-2 py-0.5 bg-gray-700 rounded-full text-xs">Tier {project.tier}</span>
            {vsCodePath && (
              <a href={vsCodePath} className="text-xs text-blue-400 hover:text-blue-300 ml-auto">Open VS Code</a>
            )}
          </div>
          <div className="flex gap-1">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${activeTab === t ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'mission_brief' && (
            <MissionBriefTab project={project} claudeMd={claudeMd} decisionsMd={decisionsMd} killCriteriaMd={killCriteriaMd} health={health} />
          )}
          {activeTab === 'brain_dumps' && <BrainDumpList brainDumps={brainDumps} projectId={project.id} />}
          {activeTab === 'tasks' && <TaskList tasks={tasks} projectId={project.id} />}
          {activeTab === 'handoff_log' && <HandoffLogTab handoffs={handoffs} />}
        </div>
      </div>

      {/* Right — sticky chat */}
      <div className="w-[360px] shrink-0 border-l border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold">Build Partner</h2>
        </div>
        <div className="flex-1 overflow-hidden">
          <ProjectChat projectId={project.id} initialChats={initialChats} />
        </div>
      </div>
    </div>
  )
}

function MissionBriefTab({ project, claudeMd, decisionsMd, killCriteriaMd, health }: {
  project: Project
  claudeMd: string
  decisionsMd: string
  killCriteriaMd: string
  health: ProjectHealth | null
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      {/* Health panel */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <h2 className="text-sm font-semibold mb-3">Service Health</h2>
        <div className="flex gap-6">
          {[
            { label: 'GitHub', status: health?.github_status ?? null, href: project.github_repo ?? project.repo_url ?? null },
            { label: 'Vercel', status: health?.vercel_status ?? null, href: project.vercel_url ?? null },
            { label: 'Supabase', status: health?.supabase_status ?? null, href: project.supabase_project_id ? `https://supabase.com/dashboard/project/${project.supabase_project_id}` : null },
          ].map(({ label, status, href }) => (
            <div key={label} className="flex items-center gap-2">
              <HealthDot status={status} />
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-300 hover:text-white">{label}</a>
              ) : (
                <span className="text-sm text-gray-500">{label}</span>
              )}
            </div>
          ))}
        </div>
        {health && <p className="text-xs text-gray-500 mt-2">Checked {timeSince(health.checked_at)}</p>}
      </div>

      {/* Blockers */}
      {project.blockers && project.blockers.trim() !== '' && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-red-400 mb-1">Blocked</h2>
          <p className="text-sm text-red-300">{project.blockers}</p>
        </div>
      )}

      {/* Next action */}
      {project.next_action && (
        <div className="bg-purple-900/20 border border-purple-800 rounded-xl p-4">
          <h2 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-1">Next Action</h2>
          <p className="text-sm text-purple-200">{project.next_action}</p>
        </div>
      )}

      {/* Status */}
      {project.status && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Status</h2>
          <p className="text-sm text-gray-200">{project.status}</p>
          <p className="text-xs text-gray-500 mt-1">Updated {timeSince(project.last_update)}</p>
        </div>
      )}

      {/* Context Package */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-300">Context Package</h2>
        <MdViewer title="CLAUDE.md" content={claudeMd} defaultOpen={true} />
        <MdViewer title="decisions.md" content={decisionsMd} />
        <MdViewer title="kill-criteria.md" content={killCriteriaMd} />
      </div>

      {/* Credentials pointer */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold">Credentials</h2>
          <a href="/vault" className="text-xs text-purple-400 hover:text-purple-300">View Vault →</a>
        </div>
        <p className="text-xs text-gray-400">Keys are accessible to agents via MCP (<code className="text-purple-300">mc_get_credential</code>). Values are never shown here.</p>
      </div>

      {/* Model routing */}
      {(project.lead_model || project.complexity_tier) && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h2 className="text-sm font-semibold mb-2">Model Routing</h2>
          <div className="flex gap-4 text-sm">
            {project.lead_model && <div><span className="text-gray-400">Lead model:</span> <span className="font-mono text-blue-300">{project.lead_model}</span></div>}
            {project.complexity_tier && <div><span className="text-gray-400">Tier:</span> <span className="font-mono text-blue-300">{project.complexity_tier}</span></div>}
          </div>
        </div>
      )}
    </div>
  )
}

function HandoffLogTab({ handoffs }: { handoffs: AgentHandoff[] }) {
  if (handoffs.length === 0) {
    return <p className="text-gray-500 text-sm">No agent sessions recorded yet.</p>
  }
  return (
    <div className="space-y-3 max-w-3xl">
      {handoffs.map(h => (
        <div key={h.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${h.status === 'in_progress' ? 'bg-blue-900 text-blue-300' : h.status === 'done' ? 'bg-green-900 text-green-300' : h.status === 'failed' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'}`}>{h.status}</span>
            <span className="font-medium text-sm">{h.agent_name}</span>
            <span className="text-xs text-gray-500 ml-auto">{timeSince(h.created_at)}</span>
          </div>
          {h.task_description && <p className="text-xs text-gray-400 mb-1"><span className="text-gray-500">Task:</span> {h.task_description}</p>}
          {h.outcome && <p className="text-xs text-gray-300"><span className="text-gray-500">Outcome:</span> {h.outcome}</p>}
          {h.github_commit_url && (
            <a href={h.github_commit_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block">
              View commit →
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If `BrainDumpList` or `TaskList` import errors appear because those components don't accept the props shown, adjust to match existing component signatures.

- [ ] **Step 4: Test Mission Brief tab in browser**

Open a project page. Verify:
- Mission Brief tab loads with health panel, blockers (if any), next action, context package (CLAUDE.md expandable), credentials pointer
- Handoff Log tab shows agent sessions or empty state
- Brain Dumps and Tasks tabs still work

- [ ] **Step 5: Commit**

```bash
git add app/(app)/projects/[id]/page.tsx components/ProjectWorkspaceTabs.tsx
git commit -m "feat: Mission Brief tab — health panel, context package, handoff log"
```

---

## Task 6: Build Partner Tool Use

**Files:**
- Modify: `app/(app)/projects/[id]/actions.ts`
- Modify: `components/ProjectChat.tsx`

### Step group A: sendChatMessage rewrite

- [ ] **Step 1: Rewrite sendChatMessage in app/(app)/projects/[id]/actions.ts**

Open the file. Find `sendChatMessage` (currently a simple routeTask wrapper, around line 100+). Replace it entirely:

```typescript
export async function sendChatMessage(
  projectId: string,
  userMessage: string
): Promise<{ reply?: string; toolCalls?: Array<{ name: string; input: unknown }>; error?: string }> {
  'use server'

  const supabase = createServerSupabaseClient()

  // Fetch project for context
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }

  // Save user message
  await supabase.from('project_chats').insert({
    project_id: projectId,
    role: 'user',
    content: userMessage,
  })

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const tools: Anthropic.Tool[] = [
    {
      name: 'read_github_file',
      description: 'Fetch the content of a file from the project\'s GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'File path relative to repo root (e.g. CLAUDE.md, src/index.ts)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_github_files',
      description: 'List files in a directory of the project\'s GitHub repository.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'Directory path relative to repo root (e.g. src/components)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create_task',
      description: 'Create a new task for this project in Mission Control.',
      input_schema: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          complexity_tier: { type: 'number', description: '1-4' },
        },
        required: ['title', 'description'],
      },
    },
    {
      name: 'get_project_context',
      description: 'Return full project state: status, next_action, blockers, stage, tier.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_credential',
      description: 'Fetch a credential value by key_name for use in this session. The value is injected into the tool result and NEVER returned as a chat message.',
      input_schema: {
        type: 'object' as const,
        properties: {
          key_name: { type: 'string' },
        },
        required: ['key_name'],
      },
    },
    {
      name: 'list_agent_handoffs',
      description: 'Return recent agent sessions for this project.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ]

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ]

  const repoUrl = project.github_repo ?? project.repo_url ?? ''
  const toolCallsForDisplay: Array<{ name: string; input: unknown }> = []

  let response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `You are the Build Partner for project "${project.name}". You have tools to read GitHub files, create tasks, and fetch project context. Be concise and actionable. Never output raw credential values in your response text.`,
    tools,
    messages,
  })

  // Tool use loop
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]

    messages.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of toolUseBlocks) {
      toolCallsForDisplay.push({ name: block.name, input: block.input })
      const input = block.input as Record<string, unknown>
      let result = ''

      try {
        if (block.name === 'get_project_context') {
          result = JSON.stringify({
            name: project.name,
            stage: project.stage,
            tier: project.tier,
            status: project.status,
            next_action: project.next_action,
            blockers: project.blockers,
            lead_model: project.lead_model,
          })
        } else if (block.name === 'read_github_file') {
          const path = input.path as string
          if (!repoUrl) { result = 'No GitHub repo configured for this project.'; break }
          const raw = repoUrl.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/main/' + path
          const res = await fetch(raw, { headers: { Authorization: `token ${process.env.GITHUB_PAT ?? ''}` } })
          result = res.ok ? await res.text() : `File not found: ${path}`
        } else if (block.name === 'list_github_files') {
          const path = (input.path as string) || ''
          if (!repoUrl) { result = 'No GitHub repo configured.'; break }
          const apiUrl = repoUrl.replace('https://github.com/', 'https://api.github.com/repos/') + '/contents/' + path
          const res = await fetch(apiUrl, { headers: { Authorization: `token ${process.env.GITHUB_PAT ?? ''}` } })
          if (!res.ok) { result = 'Could not list files'; break }
          const files = await res.json()
          result = (files as Array<{ name: string; type: string }>).map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`).join('\n')
        } else if (block.name === 'create_task') {
          const { data, error } = await supabase.from('tasks').insert({
            project_id: projectId,
            title: input.title as string,
            description: input.description as string,
            complexity_tier: input.complexity_tier ?? 2,
            status: 'pending',
          }).select('id').single()
          result = error ? `Error: ${error.message}` : `Task created with id: ${data?.id}`
        } else if (block.name === 'get_credential') {
          const key_name = input.key_name as string
          const { data: cred } = await supabase.from('credentials').select('value').eq('key_name', key_name).single()
          if (!cred) { result = `Credential not found: ${key_name}`; break }
          const { decrypt } = await import('@/lib/crypto')
          result = decrypt(cred.value)
          // Log access
          await supabase.from('credential_access_log').insert({ key_name, accessed_by: 'build_partner' })
        } else if (block.name === 'list_agent_handoffs') {
          const { data: h } = await supabase.from('agent_handoffs').select('agent_name, status, task_description, outcome, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(5)
          result = JSON.stringify(h ?? [])
        }
      } catch (e) {
        result = `Tool error: ${e instanceof Error ? e.message : String(e)}`
      }

      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
    }

    messages.push({ role: 'user', content: toolResults })

    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are the Build Partner for project "${project.name}". Be concise and actionable. Never output raw credential values in your response text.`,
      tools,
      messages,
    })
  }

  // Extract final text reply
  const replyText = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('\n')

  // Save only the final assistant reply (no tool messages)
  if (replyText) {
    await supabase.from('project_chats').insert({
      project_id: projectId,
      role: 'assistant',
      content: replyText,
    })
  }

  return {
    reply: replyText,
    toolCalls: toolCallsForDisplay.length > 0 ? toolCallsForDisplay : undefined,
  }
}
```

### Step group B: ProjectChat — handle toolCalls

- [ ] **Step 2: Update components/ProjectChat.tsx**

Open the file (128 lines). Find the section that handles the `sendChatMessage` result and renders messages. Update to handle `{ reply, toolCalls, error }` return type:

At the top of the component, add a `ToolCallBadge` sub-component:

```typescript
function ToolCallBadge({ calls }: { calls: Array<{ name: string; input: unknown }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[10px] px-2 py-0.5 bg-gray-700 text-gray-400 rounded hover:bg-gray-600"
      >
        {calls.length} tool call{calls.length !== 1 ? 's' : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {calls.map((c, i) => (
            <div key={i} className="text-[10px] bg-gray-800 rounded p-2">
              <span className="font-mono text-blue-300">{c.name}</span>
              <pre className="text-gray-400 mt-0.5 overflow-auto">{JSON.stringify(c.input, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

In the message send handler, update to handle the new return type. Find where `sendChatMessage` is called and update:

```typescript
// Before (old pattern):
const result = await sendChatMessage(projectId, userMessage)
// After handling reply string directly

// New pattern:
const result = await sendChatMessage(projectId, userMessage)
if (result.error) {
  // show error
} else {
  // result.reply = final text
  // result.toolCalls = tool calls for display badge (optional)
}
```

In the message rendering, if a message has `toolCalls`, render `<ToolCallBadge calls={toolCalls} />` above the message text.

The exact diff depends on ProjectChat.tsx's current structure (128 lines). The key changes:
1. Import `useState` if not already imported (for ToolCallBadge)
2. Add ToolCallBadge component
3. Update the optimistic message state to include optional `toolCalls` field
4. Render ToolCallBadge when toolCalls is present

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Test Build Partner in browser**

Open a project page. In the Build Partner chat, type:
- "What's the next thing to build on this project?"

Verify:
- Response appears within a few seconds
- If GitHub repo is configured, the model reads CLAUDE.md via tool call
- Tool calls badge appears collapsed above the reply (if tools were used)

- [ ] **Step 5: Commit**

```bash
git add app/(app)/projects/[id]/actions.ts components/ProjectChat.tsx
git commit -m "feat: Build Partner tool use — read_github_file, create_task, get_credential, list_agent_handoffs"
```

---

## Task 7: Skills Registry

**Files:**
- Create: `app/(app)/skills/page.tsx`

- [ ] **Step 1: Create app/(app)/skills/page.tsx**

```typescript
// app/(app)/skills/page.tsx
export const dynamic = 'force-dynamic'

const SKILLS_REPO = process.env.CLAUDE_SKILLS_REPO ?? ''
const GITHUB_PAT = process.env.GITHUB_PAT ?? ''

type GitHubFile = {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url: string | null
  html_url: string
  sha: string
}

async function listSkillFiles(): Promise<GitHubFile[]> {
  if (!SKILLS_REPO) return []
  const [owner, ...repoParts] = SKILLS_REPO.replace('https://github.com/', '').split('/')
  const repo = repoParts.join('/')
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`
  const res = await fetch(apiUrl, {
    headers: { Authorization: `token ${GITHUB_PAT}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) return []
  return res.json()
}

async function fetchFileContent(downloadUrl: string): Promise<string> {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `token ${GITHUB_PAT}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) return ''
  return res.text()
}

function parseFrontmatter(content: string): { name?: string; description?: string; type?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':')
    if (key && rest.length) fm[key.trim()] = rest.join(':').trim()
  }
  return fm
}

export default async function SkillsPage() {
  if (!SKILLS_REPO) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Skills Registry</h1>
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-6">
          <h2 className="font-semibold text-yellow-300 mb-2">Setup Required</h2>
          <p className="text-sm text-yellow-200 mb-3">
            Put your <code className="bg-black/30 px-1 rounded">~/.claude/skills/</code> directory in a GitHub repo and add the repo URL to your environment.
          </p>
          <pre className="bg-black/30 rounded p-3 text-xs text-gray-300">
            {`# In .env.local:\nCLAUDE_SKILLS_REPO=https://github.com/your-username/your-skills-repo`}
          </pre>
        </div>
      </div>
    )
  }

  const files = await listSkillFiles()
  const mdFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.md') && f.download_url)

  const skills = await Promise.all(
    mdFiles.map(async f => {
      const content = f.download_url ? await fetchFileContent(f.download_url) : ''
      const fm = parseFrontmatter(content)
      return {
        name: fm.name ?? f.name.replace('.md', ''),
        description: fm.description ?? '',
        type: fm.type ?? '',
        path: f.path,
        content,
        html_url: f.html_url,
      }
    })
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Skills Registry</h1>
      <p className="text-sm text-gray-400 mb-6">
        Read-only view from <a href={SKILLS_REPO} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{SKILLS_REPO}</a>. Skills are authored locally.
      </p>

      {skills.length === 0 && <p className="text-gray-500">No .md files found in the repo root.</p>}

      <div className="space-y-4">
        {skills.map(s => (
          <SkillCard key={s.path} skill={s} />
        ))}
      </div>
    </div>
  )
}

function SkillCard({ skill }: { skill: { name: string; description: string; type: string; path: string; content: string; html_url: string } }) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm">{skill.name}</span>
            {skill.type && (
              <span className="px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded text-xs">{skill.type}</span>
            )}
          </div>
          {skill.description && <p className="text-xs text-gray-400">{skill.description}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <code className="text-xs bg-gray-900 text-purple-300 px-2 py-1 rounded">
            {`Skill({ skill: "${skill.name}" })`}
          </code>
          <a href={skill.html_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
            GitHub →
          </a>
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

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add app/(app)/skills/page.tsx
git commit -m "feat: Skills Registry — read-only GitHub API view of claude skills"
```

---

## Task 8: Nav Update + Final Wiring

**Files:**
- Modify: `components/Nav.tsx`

- [ ] **Step 1: Update Nav.tsx**

Open the file. Find the nav links array/list. The current links are Dashboard (`/`), Inbox, Orchestrate.

Replace / update to:

```typescript
const NAV_LINKS = [
  { label: 'Command Center', href: '/' },
  { label: 'Inbox', href: '/inbox' },
  { label: 'Orchestrate', href: '/orchestrate' },
  { label: 'Vault', href: '/vault' },
  { label: 'Skills', href: '/skills' },
]
```

Remove any "Projects" or "Dashboard" link — Command Center at `/` IS the project list.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Full smoke test in browser**

```bash
npm run dev
```

Verify the complete happy path:
1. `/` — Command Center loads, shows stat cards, tiered project grid, vault quick-view, agent activity
2. `/vault` — Vault page loads, "Add Credential" opens modal, can add a global key (e.g. `TEST_KEY`)
3. Add a project-specific credential, verify both appear in list with `••••••••` masking
4. Reveal button shows value for 30 seconds then clears
5. `/projects/[id]` — Mission Brief tab loads with health panel, context package, blockers
6. Handoff Log tab shows agent sessions (or empty state)
7. Build Partner chat — send a message, verify response arrives (tool calls badge if tools invoked)
8. `/skills` — if `CLAUDE_SKILLS_REPO` not set, shows setup instructions; if set, shows skills list
9. Nav links all resolve correctly

- [ ] **Step 4: Final TypeScript check + push**

```bash
npx tsc --noEmit
git add components/Nav.tsx
git commit -m "feat: nav update — Command Center, Vault, Skills links"
git push origin main
```

- [ ] **Step 5: Update Mission Control**

```powershell
# Load env vars
$content = Get-Content ".env.local"
foreach ($line in $content) {
  if ($line -match '^([^#][^=]+)=(.+)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}

# Update project status
$headers = @{
  "apikey" = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
  "Authorization" = "Bearer $env:NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "Content-Type" = "application/json"
  "Prefer" = "return=minimal"
}
$body = @{
  status = "Phase I complete. Command Center, Credentials Vault, Mission Brief redesign, Build Partner tool use, Skills Registry all shipped."
  next_action = "Test all surfaces end-to-end. Add real credentials to Vault. Set CLAUDE_SKILLS_REPO if skills registry is needed. Phase II planning."
  last_update = (Get-Date -Format "o")
} | ConvertTo-Json
Invoke-RestMethod -Method PATCH -Uri "$env:NEXT_PUBLIC_SUPABASE_URL/rest/v1/projects?id=eq.698d6376-5819-400b-babc-cd664ee36c04" -Headers $headers -Body $body
```

---

## Verification Checklist

- [ ] `credentials` table exists in Supabase with RLS enabled
- [ ] `credential_access_log` table exists
- [ ] `project_health` table exists with unique index on `project_id`
- [ ] `projects` table has `vercel_url`, `supabase_project_id`, `github_repo` columns
- [ ] `lib/crypto.ts` encrypt/decrypt round-trip works (verify by adding a credential and revealing it)
- [ ] Vault UI: add, mask, reveal, edit, delete all work
- [ ] Vault UI: revealed value auto-clears after 30 seconds
- [ ] MCP `mc_get_credential` tool returns decrypted value and logs to `credential_access_log`
- [ ] Command Center shows tiered project grid with health dots
- [ ] Mission Brief tab: health panel, CLAUDE.md viewer, decisions.md viewer, kill-criteria.md viewer
- [ ] Handoff Log tab shows agent sessions
- [ ] Build Partner sends message → tool use loop executes → reply appears
- [ ] `get_credential` tool result NEVER appears as a chat message in `project_chats`
- [ ] Skills page shows setup instructions when `CLAUDE_SKILLS_REPO` is not set
- [ ] Nav has Command Center, Inbox, Orchestrate, Vault, Skills
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `git push origin main` succeeds
