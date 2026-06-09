/**
 * Backfills OpenAI embeddings for vault_items rows where embedding IS NULL.
 * Matches the logic in lib/vault.ts: embedVaultItem()
 *   - encrypted items: embed title only
 *   - plain items: embed "title content"
 *
 * Usage: node --env-file=.env.local scripts/backfill-vault-embeddings.mjs
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error(
    'Missing env vars. Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY\n' +
    'Run with: node --env-file=.env.local scripts/backfill-vault-embeddings.mjs'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

async function embed(title, content, encrypted) {
  const input = encrypted ? title : `${title} ${content}`
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input })
  return res.data[0].embedding
}

async function main() {
  const { data: items, error } = await supabase
    .from('vault_items')
    .select('id, title, content, encrypted')
    .is('embedding', null)

  if (error) {
    console.error('Fetch failed:', error.message)
    process.exit(1)
  }

  if (!items || items.length === 0) {
    console.log('All vault items already have embeddings.')
    return
  }

  console.log(`Found ${items.length} item(s) with no embedding. Backfilling...\n`)

  let ok = 0
  let fail = 0

  for (const item of items) {
    try {
      const embedding = await embed(item.title, item.content ?? '', item.encrypted ?? false)
      const { error: updateErr } = await supabase
        .from('vault_items')
        .update({ embedding })
        .eq('id', item.id)

      if (updateErr) throw new Error(updateErr.message)

      console.log(`  ✓ ${item.title}`)
      ok++
    } catch (err) {
      console.error(`  ✗ ${item.title} (${item.id}) — ${err.message}`)
      fail++
    }
  }

  console.log(`\nDone — ${ok} backfilled, ${fail} failed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
