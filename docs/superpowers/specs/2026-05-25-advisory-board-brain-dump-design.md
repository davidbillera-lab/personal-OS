# Advisory Board — Brain Dump Page Design

**Date:** 2026-05-25
**Status:** Approved
**Feature:** `/inbox/[id]/advisory` — dedicated advisory board page per brain dump with persistent multi-turn chat

---

## What We're Building

A dedicated page at `/inbox/[id]/advisory` that runs the 4-persona accountability panel (Partner, Advisor, Colleague, Friend) against a brain dump, then lets the operator discuss, push back, and rerun the board as many times as they want. All conversation history persists in the DB.

Entry point: "Advisory Board" button added to each `InboxItem` card in the inbox.

---

## Data Model

### New table: `ab_chats`

```sql
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
```

Migration file: `supabase/migrations/011_ab_chats.sql`

**Field notes:**
- `is_board_run`: true for all assistant messages (full panel always responds); false for user messages
- `run_number`: starts at 1 for the initial board call, increments on each subsequent call (Rerun Board or reply). User messages carry the run_number of the call they preceded.

### Existing fields (no change)
`ab_verdict` and `ab_reasoning` on `brain_dumps` are updated after each board call to reflect the latest verdict — quick summary access without querying `ab_chats`.

### New type in `lib/types.ts`

```ts
export interface AbChat {
  id: string
  brain_dump_id: string
  role: 'user' | 'assistant'
  content: string
  is_board_run: boolean
  run_number: number
  created_at: string
}
```

Add `ab_chats` to the `Database` interface in `lib/types.ts`.

---

## API Route: `/api/advisory-board`

**Method:** POST

**Request body:**
```ts
{
  brain_dump_id: string
  user_message?: string   // omit on initial call and Rerun Board
}
```

**Logic:**
1. Load brain dump (`raw_text`, `ai_summary`, `classified_type`, `project_id`) from Supabase
2. Load all existing `ab_chats` for this dump ordered by `created_at asc`
3. Determine next `run_number`: max existing run_number + 1 (or 1 if none)
4. If `user_message` provided: save as `role: 'user', is_board_run: false, run_number: next_run_number` to `ab_chats`
5. Build system prompt from the advisory board skill definition (4 personas, non-negotiable rules, output structure)
6. Build conversation history for the model call: prefix with the dump text as context, then all prior `ab_chats` as alternating user/assistant turns
7. Call `routeTask` at **tier 2 (Sonnet 4.6)** with `brain_dump_id` for cost logging
8. Save model response as `role: 'assistant', is_board_run: true, run_number: next_run_number`
9. Parse the "Agreed Recommendation" from the response; update `ab_verdict` and `ab_reasoning` on the `brain_dumps` row
10. Return `{ content: string, run_number: number }`

**Error handling:** Return `{ error: string }` with appropriate status. Client surfaces the error inline.

---

## Page: `app/(app)/inbox/[id]/advisory/page.tsx`

Server component. On load:
- Fetch brain dump by ID (404 if not found)
- Fetch all `ab_chats` for this dump ordered by `created_at asc`
- Render `AdvisoryBoardChat` client component with `dump` and `chats` as props

---

## Client Component: `AdvisoryBoardChat`

File: `components/AdvisoryBoardChat.tsx`

**Props:**
```ts
interface Props {
  dump: BrainDump & { project_name?: string | null }
  chats: AbChat[]
}
```

**Layout (top to bottom):**
1. Back link → `/inbox`
2. Dump card — raw text (or ai_summary if present), classified type badge, project name
3. Scrollable chat thread
4. Sticky bottom bar — text input + Send button + Rerun Board button

**Chat thread rendering:**
- Assistant messages: full-width dark-bordered card, subtle "Run N" label in top-right corner, content rendered as pre-formatted text (preserves the persona formatting the model outputs)
- User messages: right-aligned, muted background bubble

**Behavior:**
- **On mount with empty chats:** immediately call `/api/advisory-board` with just `brain_dump_id` to get the initial verdict. Show "The board is deliberating…" spinner. Input disabled during this call.
- **Send:** save user message to local state optimistically, call API with `user_message`, append response. Input clears on send.
- **Rerun Board:** call API without `user_message`. Panel generates a fresh verdict incorporating full history. Run number increments. Button disabled during call.
- **Loading state:** "The board is deliberating…" text + spinner replaces the input bar during any API call.
- **Error state:** inline error message below thread if API call fails. Retry available.

---

## InboxItem Button

File: `components/InboxItem.tsx`

Add a Next.js `<Link>` styled as a button in the action row, positioned after "Promote to task" and before "Archive":

```tsx
<Link
  href={`/inbox/${dump.id}/advisory`}
  className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40"
>
  Advisory Board
</Link>
```

---

## Files Changed / Created

| File | Action |
|---|---|
| `supabase/migrations/011_ab_chats.sql` | Create |
| `lib/types.ts` | Add `AbChat` interface + Database entry |
| `app/api/advisory-board/route.ts` | Create |
| `app/(app)/inbox/[id]/advisory/page.tsx` | Create |
| `components/AdvisoryBoardChat.tsx` | Create |
| `components/InboxItem.tsx` | Add Advisory Board link button |

---

## Model Routing

- Tier 2 (Sonnet 4.6) — advisory panel needs personality and nuance; Haiku is too flat for 4-persona debate
- All calls log to `model_costs` with `brain_dump_id`
- Streaming deferred to v2; loading state provides adequate UX for now

---

## Out of Scope (v1)

- Streaming responses
- Individual persona addressing (Partner-only, Advisor-only, etc.) — full panel always responds
- Exporting/sharing the AB verdict
- AB verdicts feeding into kill criteria checks automatically
