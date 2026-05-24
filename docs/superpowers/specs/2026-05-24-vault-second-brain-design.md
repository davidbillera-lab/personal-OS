# Vault Second Brain — Design Spec

**Date:** 2026-05-24
**Status:** Approved

---

## Problem

The Vault currently stores only API keys and secrets. Mission Control is meant to be a full extension of the operator — a second brain — but there's no place to store skills, agent roles, personal information, shelved build context, or general knowledge. Agents also have no way to pull relevant context without reading entire markdown files at session start.

---

## Goal

Expand the Vault into a unified second brain: a searchable, graph-visualizable knowledge store that covers credentials, skills, agent definitions, personal information, general knowledge, and shelved brain dump context. Agents retrieve relevant vault items via semantic search rather than full-file reads.

---

## Data Model

### New table: `vault_items`

```sql
create table vault_items (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('credential','skill','agent','personal','knowledge')),
  title        text not null,
  content      text not null,
  encrypted    boolean not null default false,
  tags         text[] not null default '{}',
  project_id   uuid references projects(id) on delete set null,
  source_table text,
  source_id    uuid,
  is_mcp_accessible boolean not null default false,
  metadata     jsonb not null default '{}',
  embedding    vector(1536),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index vault_items_embedding_idx on vault_items
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index vault_items_type_idx on vault_items (type);
create index vault_items_tags_idx on vault_items using gin (tags);
```

### Column notes

| Column | Purpose |
|--------|---------|
| `type` | Drives UI badge color, filter chips, and agent access rules |
| `content` | Plain text body. When `encrypted = true`, stored via `encrypt()` from `lib/crypto.ts`, decrypted on read |
| `encrypted` | True for credentials and personal items. Encrypted items are never included in agent retrieval |
| `tags` | User-defined. Drive graph edges — two items sharing a tag get an edge in the graph |
| `project_id` | Optional link to a project workspace |
| `source_table` / `source_id` | For brain dump references: `source_table = 'brain_dumps'`, `source_id = brain_dumps.id`. No data duplication |
| `is_mcp_accessible` | Opt-in per item. Default false. Personal and encrypted items cannot be set true (enforced in server action) |
| `metadata` | Flexible JSON — e.g. `{ url, username }` for credentials, `{ role, model_tier }` for agents |
| `embedding` | 1536-dim vector (text-embedding-3-small). Generated on save/update. Used for pgvector semantic search |

### Migration strategy

- New migration `012_vault_items.sql` creates the table and enables `vector` extension
- One-time seed: existing rows in `credentials` are copied to `vault_items` with `type = 'credential'`, `encrypted = true`
- The `credentials` table stays in place for backward compat (MCP tools continue to reference it)
- Going forward, new credentials write to both tables
- Brain dumps stay in `brain_dumps`. Shelved/notable dumps can be "saved to vault" by the operator — this creates a `vault_items` row with `type = 'knowledge'`, `source_table = 'brain_dumps'`, `source_id = dump.id`

---

## UI Layout

### Page: `/vault`

Three zones on a single page.

#### Top bar
- Page title "Vault"
- `+ New Item` button — opens side panel in create mode
- Search bar (full-width, real-time filter)
- Type filter chips: `All` `Credentials` `Skills` `Agents` `Personal` `Knowledge`
- View toggle (far right): `≡ List` / `◉ Graph`

#### List view (default)
- Scrollable column of cards
- Each card: title, type badge (color-coded by type), tags, one-line content excerpt
- Encrypted items: content shows as `••••••`, lock icon visible
- Clicking any card opens the side panel

#### Graph view (secondary, toggled)
- Force-directed graph via `react-force-graph-2d`
- Nodes colored by type (same palette as type badges)
- Node size scales with number of tag-based edges
- Edges between nodes that share one or more tags
- Isolated nodes (no shared tags) render as floating balls
- Search bar stays active — non-matching nodes fade to 20% opacity; matching nodes highlight
- Clicking a node opens the side panel

#### Side panel (~380px, slides in from right)
- Opens on card click (list) or node click (graph)
- Dismiss: click outside or press Escape
- Contents:
  - Title (editable inline)
  - Type badge + tags (editable)
  - Full content — encrypted items show `••••••` with a "Reveal" button; clicking decrypts in-place for the session
  - `Copy` button for credentials
  - Project link if `project_id` is set
  - `Related` section — 3 items from pgvector similarity search (personal/encrypted excluded)
  - Edit / Delete actions in top-right

### Type badge color palette

| Type | Color |
|------|-------|
| credential | amber |
| skill | blue |
| agent | violet |
| personal | rose |
| knowledge | green |

---

## Encryption

- Uses existing `encrypt()` / `decrypt()` from `lib/crypto.ts`
- `content` field is encrypted at write time when `encrypted = true`
- Decryption happens per-item on click ("Reveal") — no session-level master unlock
- `personal` type items are always `encrypted = true` (enforced in server action)
- Encrypted items are hardcoded out of pgvector search and MCP retrieval regardless of `is_mcp_accessible`

---

## Smart Context Retrieval

### Embedding pipeline
- On every `vault_items` insert or update: call `text-embedding-3-small` (OpenAI, Tier 1) with `title + " " + content`
- Store result in `embedding` column
- Encrypted items: embed the title only (content never sent to embedding API)

### Server action: `queryVaultContext(query: string, limit = 8)`
```typescript
// Returns top-N vault items by cosine similarity to query embedding
// Excludes: encrypted = true, is_mcp_accessible = false, type = 'personal'
```

### New MCP tool: `mc_get_vault_context`
```json
{
  "name": "mc_get_vault_context",
  "description": "Semantic search over vault items. Pass the current task description to get relevant skills, agent roles, and knowledge items back. Never returns encrypted or personal items.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Task description or question to match against" },
      "limit": { "type": "number", "description": "Max items to return (default 8)" }
    },
    "required": ["query"]
  }
}
```

Agents call this at session start with their task title + spec summary. They receive a JSON array of matching vault items (title, type, content excerpt, tags). No full vault dump, no manual file reads.

---

## File Map

| File | Action |
|------|--------|
| `supabase/migrations/012_vault_items.sql` | Create — table, indexes, pgvector extension |
| `lib/types.ts` | Add `VaultItem` type, `VaultItemType` union |
| `lib/vault.ts` | Create — `embedVaultItem()`, `queryVaultContext()`, `seedCredentialsToVault()` |
| `app/(app)/vault/actions.ts` | Create — `createVaultItem`, `updateVaultItem`, `deleteVaultItem`, `revealVaultItem` server actions |
| `app/(app)/vault/page.tsx` | Modify — replace credential-only view with full vault page |
| `components/VaultList.tsx` | Create — search bar, filter chips, view toggle, card list |
| `components/VaultGraph.tsx` | Create — react-force-graph-2d wrapper |
| `components/VaultSidePanel.tsx` | Create — item detail, inline edit, reveal, related items |
| `lib/mcp-tools.ts` | Add `mc_get_vault_context` tool definition and handler |
| `components/Nav.tsx` | No change needed — Vault link already present |

---

## Out of Scope (v1)

- Voice input to vault
- Attachment / file upload to vault items
- Sharing vault items across users
- Vault item version history
- Automatic brain dump → vault promotion (operator does this manually for now)
