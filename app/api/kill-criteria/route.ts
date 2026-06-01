import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import type { KillVerdict } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { project_id, functionality_score, efficiency_score, scalability_score, time_to_revenue_score, notes } = body

    if (!project_id) {
      return NextResponse.json({ error: 'project_id required' }, { status: 400 })
    }

    const scores = [functionality_score, efficiency_score, scalability_score, time_to_revenue_score]
    if (scores.some(s => !Number.isInteger(s) || s < 1 || s > 5)) {
      return NextResponse.json({ error: 'All scores must be integers 1–5' }, { status: 400 })
    }

    const min = Math.min(...scores)
    const verdict: KillVerdict = min <= 2 ? 'fail' : min <= 3 ? 'warning' : 'pass'

    const supabase = await createServerSupabaseClient()

    const { data: check, error: insertError } = await supabase
      .from('kill_criteria_checks')
      .insert({
        project_id,
        functionality_score,
        efficiency_score,
        scalability_score,
        time_to_revenue_score,
        verdict,
        notes: notes || null,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const { error: patchError } = await supabase
      .from('projects')
      .update({ kill_criteria_status: verdict, last_update: new Date().toISOString() })
      .eq('id', project_id)

    if (patchError) {
      return NextResponse.json({ error: patchError.message }, { status: 500 })
    }

    return NextResponse.json({ check, verdict }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
