/**
 * Bulk-import credentials into the Mission Control vault.
 * Run once: node scripts/seed-vault.mjs
 *
 * Uses AES-256-GCM (same algorithm as lib/crypto.ts) so values are readable
 * by the app's revealCredential() server action.
 */

import { createCipheriv, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load secrets from an external file (scripts/seed-vault.secrets.json)
// This file MUST be gitignored. If it's not present, the script will abort.
const secretsPath = process.env.SEED_VAULT_SECRETS_FILE || join(process.cwd(), 'scripts', 'seed-vault.secrets.json')
let secrets
try {
  secrets = JSON.parse(readFileSync(secretsPath, 'utf8'))
} catch (err) {
  console.error('[seed-vault] Missing secrets file:', secretsPath)
  console.error('Create the file and include ENCRYPTION_KEY, SUPABASE_URL, SERVICE_ROLE_KEY, and credentials array. THIS FILE MUST NOT BE COMMITTED.')
  process.exit(1)
}

const ENCRYPTION_KEY = secrets.ENCRYPTION_KEY
const SUPABASE_URL = secrets.SUPABASE_URL
const SERVICE_ROLE_KEY = secrets.SERVICE_ROLE_KEY

function encrypt(plaintext) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex')
}

// project_id values — null = global
const PROJECT_IDS = {
  // These will be inserted as project-scoped once we have the UUIDs.
  // For now, all project-scoped ones use null and can be re-associated later.
}

const credentials = secrets.credentials || []

async function upsertCredential(cred) {
  const encrypted = encrypt(cred.value)
  const body = {
    name: cred.name,
    key_name: cred.key_name,
    value: encrypted,
    tier: cred.tier,
    project_id: cred.project_id,
    is_mcp_accessible: cred.is_mcp_accessible,
    notes: cred.notes ?? null,
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/credentials?on_conflict=key_name`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    console.error(`  ✗ ${cred.key_name} — HTTP ${res.status}: ${text}`)
    return false
  }
  return true
}

async function main() {
  console.log(`Seeding ${credentials.length} credentials into Mission Control vault…\n`)
  let ok = 0
  let fail = 0
  for (const cred of credentials) {
    const success = await upsertCredential(cred)
    if (success) {
      console.log(`  ✓ ${cred.key_name}`)
      ok++
    } else {
      fail++
    }
  }
  console.log(`\nDone — ${ok} inserted/updated, ${fail} failed.`)
}

main().catch(err => { console.error(err); process.exit(1) })
