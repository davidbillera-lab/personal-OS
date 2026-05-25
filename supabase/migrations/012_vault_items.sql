create extension if not exists vector;

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

create or replace function match_vault_items(
  query_embedding vector(1536),
  match_count     int default 8
)
returns table (
  id uuid, type text, title text, content text, tags text[], is_mcp_accessible boolean, metadata jsonb
)
language sql stable as $$
  select v.id, v.type, v.title, v.content, v.tags, v.is_mcp_accessible, v.metadata
  from vault_items v
  where v.encrypted = false
    and v.type != 'personal'
    and v.is_mcp_accessible = true
    and v.embedding is not null
  order by v.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_vault_items_by_id(
  source_item_id uuid,
  match_count    int default 3
)
returns table (
  id uuid, type text, title text, content text, encrypted boolean, tags text[],
  project_id uuid, source_table text, source_id uuid, is_mcp_accessible boolean,
  metadata jsonb, created_at timestamptz, updated_at timestamptz
)
language sql stable as $$
  select v.id, v.type, v.title, v.content, v.encrypted, v.tags, v.project_id,
    v.source_table, v.source_id, v.is_mcp_accessible, v.metadata, v.created_at, v.updated_at
  from vault_items v
  where v.encrypted = false
    and v.type != 'personal'
    and v.id != source_item_id
    and v.embedding is not null
  order by v.embedding <=> (select embedding from vault_items where id = source_item_id)
  limit match_count;
$$;
