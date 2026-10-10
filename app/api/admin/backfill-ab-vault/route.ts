import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { captureToVault } from '@/lib/vault'
import { requireBearer } from '@/lib/api-auth'
import { fetchAllRows } from '@/lib/paginate'

const MAX_ERRORS = 50

export async function POST(req: NextRequest) {
  const denied = await requireBearer(req)
  if (denied) return denied

  const supabase = createAdminSupabaseClient()

  type Chat = { id: string; brain_dump_id: string; content: string; run_number: number; created_at: string }
  let boardChats: Chat[]
  let existingSourceIds: Set<string>
  try {
    // All assistant board-run chat rows (id tiebreak keeps pages stable)
    boardChats = await fetchAllRows<Chat>('ab_chats', (from, to) =>
      supabase
        .from('ab_chats')
        .select('id, brain_dump_id, content, run_number, created_at')
        .eq('is_board_run', true)
        .eq('role', 'assistant')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    )

    // Vault items already captured from ab_chats to skip duplicates
    const existing = await fetchAllRows<{ id: string; source_id: string | null }>('vault_items', (from, to) =>
      supabase
        .from('vault_items')
        .select('id, source_id')
        .eq('source_table', 'ab_chats')
        .eq('type', 'ab_conversation')
        .order('id', { ascending: true })
        .range(from, to)
    )
    existingSourceIds = new Set(existing.map(r => r.source_id).filter((x): x is string => Boolean(x)))
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }

  let captured = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []
  const fail = (msg: string) => { failed++; if (errors.length < MAX_ERRORS) errors.push(msg) }

  for (const chat of boardChats) {
    if (existingSourceIds.has(chat.id)) {
      skipped++
      continue
    }

    const { data: dump, error: dumpErr } = await supabase
      .from('brain_dumps')
      .select('raw_text, ai_summary, classified_type, project_id')
      .eq('id', chat.brain_dump_id)
      .single()

    if (!dump) {
      fail(`brain_dump ${chat.brain_dump_id} not found for chat ${chat.id} (err: ${dumpErr?.code} ${dumpErr?.message})`)
      continue
    }

    // User follow-up for this run (if any)
    const { data: userMsg, error: userMsgErr } = await supabase
      .from('ab_chats')
      .select('content')
      .eq('brain_dump_id', chat.brain_dump_id)
      .eq('run_number', chat.run_number)
      .eq('role', 'user')
      .eq('is_board_run', false)
      .maybeSingle()

    if (userMsgErr) {
      fail(`follow-up read failed for chat ${chat.id}: ${userMsgErr.message}`)
      continue
    }

    const sessionParts = [
      `Brain Dump (${dump.classified_type ?? 'unclassified'}): ${dump.raw_text}`,
      dump.ai_summary ? `Summary: ${dump.ai_summary}` : '',
      userMsg?.content ? `\nOperator Follow-up: ${userMsg.content}` : '',
      `\n---\nBoard Response (Run ${chat.run_number}):\n${chat.content}`,
    ].filter(Boolean)

    // Parse verdict from board response content
    const verdictMatch = chat.content.match(/\*\*Agreed Recommendation:\*\*\s*(.+)/i)
    const verdict: 'keep' | 'kill' = verdictMatch?.[1]?.toLowerCase().includes('kill') ? 'kill' : 'keep'

    const ok = await captureToVault({
      type: 'ab_conversation',
      title: `Advisory Board: ${dump.raw_text.slice(0, 80)}`,
      content: sessionParts.join('\n'),
      project_id: dump.project_id ?? null,
      source_table: 'ab_chats',
      source_id: chat.id,
      capture_source: 'ab_conversation',
      tags: ['advisory-board', verdict],
      metadata: { verdict, run_number: chat.run_number, brain_dump_id: chat.brain_dump_id },
    })

    if (ok) captured++
    else fail(`vault insert failed for chat ${chat.id}`)
  }

  const body = { ok: failed === 0, processed: boardChats.length, captured, skipped, failed, errors }
  return NextResponse.json(body, { status: failed === 0 ? 200 : 207 })
}
