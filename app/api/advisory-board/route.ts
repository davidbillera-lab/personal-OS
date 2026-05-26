import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerSupabaseClient } from '@/lib/supabase'
import { calcCost } from '@/lib/models/pricing'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `You are the Advisory Board for a solo AI-native holdco operator. Four personas respond together to every message.

Personas:
- Partner — strategic co-investor. Capital allocation, ROI, portfolio risk. Direct, numbers-oriented.
- Advisor — experienced operator who has built and sold businesses. Pattern recognition. Blunt.
- Colleague — technical peer. Build complexity, time estimates, stack fit. No sugarcoating.
- Friend — honest voice who cares about the operator's wellbeing. Calls out avoidance, shiny objects, self-deception.

Rules:
- Verdicts first, reasoning after. Never bury the lead.
- Name behavioral patterns explicitly (avoidance, distraction, shiny object syndrome) when you see them.
- Turn questions back on the operator when they are fishing for validation.
- Do NOT help the operator make a bad idea work. Name what is actually happening.
- Apply four kill criteria: Functionality (solves a real problem?), Efficiency (right solution?), Scalability (grows without proportional work?), Time-to-revenue (realistic return timeline?).

CRITICAL FORMAT RULES — follow exactly, no deviation:
- Each persona MUST start on its own line with its name in double asterisks followed by a newline, like this:

**Partner**
[Partner's response here]

**Advisor**
[Advisor's response here]

**Colleague**
[Colleague's response here]

**Friend**
[Friend's response here]

**Agreed Recommendation:** [one sentence verdict — keep, kill, or conditional]

- Do NOT use ### headers. Do NOT use "Partner:" with a colon on the same line as text. ONLY use **Name** on its own line.
- Always include all four personas and the Agreed Recommendation in every response.`

export async function POST(req: NextRequest) {
  try {
    const { brain_dump_id, user_message } = await req.json() as {
      brain_dump_id: string
      user_message?: string
    }

    if (!brain_dump_id) {
      return NextResponse.json({ error: 'brain_dump_id required' }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()

    const { data: dump } = await supabase
      .from('brain_dumps')
      .select('raw_text, ai_summary, classified_type, project_id')
      .eq('id', brain_dump_id)
      .single()

    if (!dump) {
      return NextResponse.json({ error: 'Brain dump not found' }, { status: 404 })
    }

    const { data: history } = await supabase
      .from('ab_chats')
      .select('role, content, run_number, is_board_run')
      .eq('brain_dump_id', brain_dump_id)
      .order('created_at', { ascending: true })

    const existingChats = history ?? []
    const maxRun = existingChats.reduce((m, c) => Math.max(m, c.run_number), 0)
    const nextRun = maxRun + 1

    if (user_message) {
      await supabase.from('ab_chats').insert({
        brain_dump_id,
        role: 'user',
        content: user_message,
        is_board_run: false,
        run_number: nextRun,
      })
    }

    // Build messages: first user turn is the dump context, then alternating history
    const FORMAT_REMINDER = `IMPORTANT: Respond ONLY in this exact format — four labeled sections then Agreed Recommendation:

**Partner**
[response]

**Advisor**
[response]

**Colleague**
[response]

**Friend**
[response]

**Agreed Recommendation:** [one sentence]`

    const dumpContext = `${FORMAT_REMINDER}

Brain dump (type: ${dump.classified_type ?? 'unclassified'}):
"${dump.raw_text}"${dump.ai_summary ? `\n\nSummary: ${dump.ai_summary}` : ''}`

    type MessageParam = { role: 'user' | 'assistant'; content: string }
    const messages: MessageParam[] = []

    if (existingChats.length === 0 && !user_message) {
      // Initial call — dump is the first user turn
      messages.push({ role: 'user', content: dumpContext })
    } else {
      // Prepend dump as first turn, then replay history
      // Strip old history that used wrong JSON format to avoid poisoning new runs
      const cleanHistory = existingChats.filter(c =>
        !(c.role === 'assistant' && c.content.includes('"verdict"'))
      )
      messages.push({ role: 'user', content: dumpContext })
      for (const chat of cleanHistory) {
        messages.push({ role: chat.role as 'user' | 'assistant', content: chat.content })
      }
      if (user_message) {
        messages.push({ role: 'user', content: user_message })
      }
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    })

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    await supabase.from('ab_chats').insert({
      brain_dump_id,
      role: 'assistant',
      content,
      is_board_run: true,
      run_number: nextRun,
    })

    // Parse verdict from "Agreed Recommendation:" line
    const verdictMatch = content.match(/\*\*Agreed Recommendation:\*\*\s*(.+)/i)
    const rawVerdict = verdictMatch?.[1]?.toLowerCase() ?? ''
    const verdict: 'keep' | 'kill' = rawVerdict.includes('kill') ? 'kill' : 'keep'
    await supabase
      .from('brain_dumps')
      .update({ ab_verdict: verdict, ab_reasoning: verdictMatch?.[1] ?? content.slice(0, 500) })
      .eq('id', brain_dump_id)

    // Log cost
    const cost_usd = calcCost(MODEL, response.usage.input_tokens, response.usage.output_tokens)
    await supabase.from('model_costs').insert({
      model: MODEL,
      provider: 'anthropic',
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      cost_usd,
      purpose: 'advisory_board_chat',
      project_id: dump.project_id ?? null,
      brain_dump_id,
    })

    return NextResponse.json({ content, run_number: nextRun })
  } catch (err) {
    console.error('[advisory-board]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
