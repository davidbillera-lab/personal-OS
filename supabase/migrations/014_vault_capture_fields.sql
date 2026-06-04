-- 014_vault_capture_fields.sql
-- Auto-capture outgrew migration 012; bring vault_items up to date.
-- Safe to re-run (uses drop-if-exists / add-if-not-exists).

-- 1. Widen the type whitelist to every VaultItemType in lib/types.ts (13 values).
--    The 012 constraint allowed only 5 types and silently rejected every
--    auto-capture (git_push, brain_dump_mirror, build_spec, ab_conversation, etc.).
alter table vault_items drop constraint if exists vault_items_type_check;
alter table vault_items add constraint vault_items_type_check
  check (type in (
    'credential','skill','agent','personal','knowledge',
    'git_push','file_snapshot','brain_dump_mirror','ab_conversation',
    'build_spec','mcp_event','agent_session','decision_log'
  ));

-- 2. Add the capture_source column every auto-capture writes.
--    Nullable: the credential seed path (seedCredentialsToVault) omits it
--    and must keep working.
alter table vault_items add column if not exists capture_source text;
