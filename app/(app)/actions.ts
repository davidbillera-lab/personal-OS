'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import { classifyBrainDump } from '@/lib/classify'

export async function quickDump(formData: FormData) {
  const text = (formData.get('text') as string | null)?.trim()
  if (!text) return

  const supabase = await createServerSupabaseClient()

  const { data } = await supabase
    .from('brain_dumps')
    .insert({
      raw_text: text,
      source: 'dashboard_quick_input',
      status: 'inbox',
      classified_type: null,
    })
    .select('id')
    .single()

  if (data?.id) {
    // Synchronous classification (~1-2s). Failure does not block the dump save.
    await classifyBrainDump(data.id, text, supabase).catch(console.error)
  }
}
