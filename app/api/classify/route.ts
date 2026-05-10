import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { classifyBrainDump } from '@/lib/classify'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, raw_text } = body as Record<string, unknown>

  if (!id || !raw_text) {
    return NextResponse.json({ error: 'id and raw_text are required' }, { status: 400 })
  }

  try {
    const supabase = await createServerSupabaseClient()
    await classifyBrainDump(id as string, raw_text as string, supabase)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[classify]', err)
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 })
  }
}
