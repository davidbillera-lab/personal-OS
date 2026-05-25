create table ab_chats (
  id uuid primary key default gen_random_uuid(),
  brain_dump_id uuid not null references brain_dumps(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  is_board_run boolean not null default true,
  run_number integer not null default 1,
  created_at timestamptz not null default now()
);

create index ab_chats_brain_dump_id_idx on ab_chats(brain_dump_id);
