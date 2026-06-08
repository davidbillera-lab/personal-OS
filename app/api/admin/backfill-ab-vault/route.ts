import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { captureToVault } from '@/lib/vault'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.MCP_API_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()

  // All assistant board-run chat rows
  const { data: boardChats, error: chatsErr } = await supabase
    .from('ab_chats')
    .select('id, brain_dump_id, content, run_number, created_at')
    .eq('is_board_run', true)
    .eq('role', 'assistant')
    .order('created_at', { ascending: true })

  if (chatsErr) {
    return NextResponse.json({ error: chatsErr.message }, { status: 500 })
  }

  // Vault items already captured from ab_chats to skip duplicates
  const { data: existing } = await supabase
    .from('vault_items')
    .select('source_id')
    .eq('source_table', 'ab_chats')
    .eq('type', 'ab_conversation')

  const existingSourceIds = new Set((existing ?? []).map(r => r.source_id).filter(Boolean))

  let captured = 0
  let skipped = 0
  const errors: string[] = []

  for (const chat of (boardChats ?? [])) {
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
      errors.push(`brain_dump ${chat.brain_dump_id} not found for chat ${chat.id} (err: ${dumpErr?.code} ${dumpErr?.message})`)
      skipped++
      continue
    }

    // User follow-up for this run (if any)
    const { data: userMsg } = await supabase
      .from('ab_chats')
      .select('content')
      .eq('brain_dump_id', chat.brain_dump_id)
      .eq('run_number', chat.run_number)
      .eq('role', 'user')
      .eq('is_board_run', false)
      .maybeSingle()

    const sessionParts = [
      `Brain Dump (${dump.classified_type ?? 'unclassified'}): ${dump.raw_text}`,
      dump.ai_summary ? `Summary: ${dump.ai_summary}` : '',
      userMsg?.content ? `\nOperator Follow-up: ${userMsg.content}` : '',
      `\n---\nBoard Response (Run ${chat.run_number}):\n${chat.content}`,
    ].filter(Boolean)

    // Parse verdict from board response content
    const verdictMatch = chat.content.match(/\*\*Agreed Recommendation:\*\*\s*(.+)/i)
    const verdict: 'keep' | 'kill' = verdictMatch?.[1]?.toLowerCase().includes('kill') ? 'kill' : 'keep'

    await captureToVault({
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

    captured++
  }

  return NextResponse.json({ captured, skipped, errors })
}
