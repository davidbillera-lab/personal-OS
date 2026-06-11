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
{
  name: 'OpenAI API Key',
    key_name: 'OPENAI_API_KEY',
      value: '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',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Primary OpenAI API key — used by all projects',
  },
{
  name: 'Google AI API Key',
    key_name: 'GOOGLE_AI_API_KEY',
      value: 'AIzaSyBH5Q2Tn6Es0wPLlfTUT3euqVJu4K68pNo',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Google AI / Gemini API key',
  },
{
  name: 'GitHub Personal Access Token',
    key_name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
      value: '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',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'GitHub PAT — repo read/write access for all portfolio repos',
  },
{
  name: 'GitHub Username',
    key_name: 'GITHUB_USERNAME',
      value: 'davidbillera-lab',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'GitHub account username',
  },
{
  name: 'Mission Control MCP API Key',
    key_name: 'MCP_API_KEY',
      value: 'mc-api-key-personal-os-2026',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Bearer token for the /api/mcp endpoint on Mission Control',
  },
{
  name: 'Firecrawl API Key',
    key_name: 'FIRECRAWL_API_KEY',
      value: 'fc-302cd462b7c548f79420579277d9591b',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Firecrawl web scraping API key',
  },
{
  name: 'Supabase Access Token (CLI/API)',
    key_name: 'SUPABASE_ACCESS_TOKEN',
      value: 'sbp_9faf3eabe43bd7c89f6af26b115076836c9f4e40',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Supabase personal access token — CLI / Management API',
  },

// ── Mission Control Supabase (global) ─────────────────────────────────────
{
  name: 'Mission Control — Supabase URL',
    key_name: 'MC_SUPABASE_URL',
      value: 'https://dmtctlpzlfpcogpjweuv.supabase.co',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Mission Control Supabase project URL',
  },
{
  name: 'Mission Control — Supabase Anon Key',
    key_name: 'MC_SUPABASE_ANON_KEY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtdGN0bHB6bGZwY29ncGp3ZXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjYxNjcsImV4cCI6MjA5MzcwMjE2N30.M84k8Mx2iANWZyQF7Zk1AHqYU8yQBh0MZny9MuxGOvc',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Mission Control Supabase anon/public key',
  },
{
  name: 'Mission Control — Supabase Service Role Key',
    key_name: 'MC_SUPABASE_SERVICE_KEY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtdGN0bHB6bGZwY29ncGp3ZXV2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODEyNjE2NywiZXhwIjoyMDkzNzAyMTY3fQ.WsnfS6CmBmo_ad71fM3djHNyzKdJKEV6WSy2S-5_FcY',
        tier: 'global',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Mission Control Supabase service role key — bypasses RLS',
  },

// ── JSG / DOA Supabase (project) ──────────────────────────────────────────
{
  name: 'JSG/DOA — Supabase URL',
    key_name: 'DOA_SUPABASE_URL',
      value: 'https://atgrxqfxysvppqoyvjdd.supabase.co',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'JSG / DOA listing agent Supabase project URL',
  },
{
  name: 'JSG/DOA — Supabase Anon Key',
    key_name: 'DOA_SUPABASE_ANON_KEY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Z3J4cWZ4eXN2cHBxb3l2amRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDQ4NDEsImV4cCI6MjA4ODM4MDg0MX0.ZeddfaNJD5GJJ85B_HW6x8_i1W4sx-bOzK2_HdQiWN4',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'JSG / DOA listing agent Supabase anon key',
  },
{
  name: 'JSG/DOA — Supabase Service Role Key',
    key_name: 'DOA_SUPABASE_SERVICE_ROLE_KEY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Z3J4cWZ4eXN2cHBxb3l2amRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjgwNDg0MSwiZXhwIjoyMDg4MzgwODQxfQ.2eJvgaYOaTbgz8B4-PqW25MT6grTckUmuhqt348DLdw',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'JSG / DOA listing agent Supabase service role key',
  },

// ── College Climb Supabase (project) ──────────────────────────────────────
{
  name: 'College Climb — Supabase URL',
    key_name: 'COLLEGE_CLIMB_SUPABASE_URL',
      value: 'https://qdapwypyfcfvwwqguqja.supabase.co',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'College Climb Supabase project URL',
  },
{
  name: 'College Climb — Supabase Anon Key',
    key_name: 'COLLEGE_CLIMB_SUPABASE_ANON_KEY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkYXB3eXB5ZmNmdnd3cWd1cWphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMTMzMTMsImV4cCI6MjA4OTc4OTMxM30.11w1AtE8E0WMIyEC-OWPD5SoigochsLAeoLfm0HPsEU',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'College Climb Supabase anon key',
  },
{
  name: 'College Climb — Supabase Service Role Key',
    key_name: 'COLLEGE_CLIMB_SUPABASE_SERVICE_ROLE_KEY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkYXB3eXB5ZmNmdnd3cWd1cWphIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDIxMzMxMywiZXhwIjoyMDg5Nzg5MzEzfQ.fLCULixdKv0DfXZ1_B4vWSt42M5LqYy41TmzGHbq9jA',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'College Climb Supabase service role key',
  },
{
  name: 'College Climb — Upstash Redis URL',
    key_name: 'UPSTASH_REDIS_REST_URL',
      value: 'https://liked-shrew-131017.upstash.io',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'College Climb Upstash Redis REST URL',
  },
{
  name: 'College Climb — Upstash Redis Token',
    key_name: 'UPSTASH_REDIS_REST_TOKEN',
      value: 'gQAAAAAAAf_JAAIgcDI1NGZjYmRiODJmZmE0MzdmYTQwM2Y2Y2NmM2JiMDhiYg',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'College Climb Upstash Redis REST token',
  },

// ── DOA / JSG Login & Email ───────────────────────────────────────────────
{
  name: 'DOA Email',
    key_name: 'DOA_EMAIL',
      value: 'davidbillera@gmail.com',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Login email for denveronlineauctions.com admin',
  },
{
  name: 'DOA Password',
    key_name: 'DOA_PASSWORD',
      value: 'Nicdavoz1@',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Login password for denveronlineauctions.com admin panel',
  },
{
  name: 'DOA Base URL',
    key_name: 'DOA_BASE_URL',
      value: 'https://denveronlineauctions.com',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'Base URL for Denver Online Auctions site',
  },
{
  name: 'Supabase CLI Email (DOA project)',
    key_name: 'SUPABASE_EMAIL',
      value: 'davidbillera@gmail.com',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Login email for Supabase CLI auth (DOA project)',
  },
{
  name: 'Supabase CLI Password (DOA project)',
    key_name: 'SUPABASE_PASSWORD',
      value: 'Nicdavozjj12@',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Login password for Supabase CLI auth (DOA project)',
  },
{
  name: 'Notify Gmail App Password',
    key_name: 'NOTIFY_GMAIL_APP_PASSWORD',
      value: 'wzbz htji zksi mcjr',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'Gmail app password for sending notifications from listing agent',
  },

// ── eBay API (JSG eBay) ───────────────────────────────────────────────────
{
  name: 'eBay App ID / Client ID',
    key_name: 'EBAY_APP_ID',
      value: 'DavidBil-zapier-PRD-1b452d056-30b471f5',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: true,
              notes: 'eBay Developer App ID (same as EBAY_CLIENT_ID)',
  },
{
  name: 'eBay Cert ID / Client Secret',
    key_name: 'EBAY_CERT_ID',
      value: 'PRD-b452d0569ca9-2e1c-4627-95df-1b70',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'eBay Developer Cert ID (same as EBAY_CLIENT_SECRET)',
  },
{
  name: 'eBay RuName',
    key_name: 'EBAY_RUNAME',
      value: 'David_Billera-DavidBil-zapier-ewozzry',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'eBay OAuth redirect URI name',
  },
{
  name: 'eBay Refresh Token',
    key_name: 'EBAY_REFRESH_TOKEN',
      value: 'v^1.1#i^1#r^1#p^3#f^0#I^3#t^Ul4xMF8yOkVBQkI1MjNCMzc3NTM0RDRGOTlCQzU5MjlCQUI2NTc5XzJfMSNFXjI2MA==',
        tier: 'project',
          project_id: null,
            is_mcp_accessible: false,
              notes: 'eBay OAuth refresh token for JSG eBay store',
  },
]

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
