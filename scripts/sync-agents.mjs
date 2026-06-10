#!/usr/bin/env node
// Sync agent definitions: agents/*.md (source of truth) → vault_items (type 'agent') + ~/.claude/agents/ (Claude Code global install).
// Run after editing any agents/*.md: node scripts/sync-agents.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, mkdirSync, copyFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env.local into process.env (keys not already set only) — same pattern as mcp-server.mjs
try {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
} catch {
  // .env.local absent — rely on environment variables already set
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Crew assignment + knowledge graph tags — shared tags create edges in the vault graph UI.
// Tags overlap with skills/sessions intentionally: e.g. 'advisory' links agents to advisoryboard skill.
const CREWS = {
  'code-reviewer': 'build',
  'qa-verifier': 'build',
  'session-auditor': 'build',
  'spec-writer': 'build',
  'doc-writer': 'build',
  'researcher': 'revenue',
  'copywriter': 'revenue',
  'seo-geo-auditor': 'revenue',
  'kill-criteria-examiner': 'holdco',
  'exit-readiness-scorer': 'holdco',
}

const AGENT_TAGS = {
  'code-reviewer':          ['build', 'agent', 'code-review', 'workflow', 'quality'],
  'qa-verifier':            ['build', 'agent', 'testing', 'workflow', 'quality'],
  'session-auditor':        ['build', 'agent', 'workflow', 'session-end', 'mcp', 'token-usage'],
  'spec-writer':            ['build', 'agent', 'planning', 'spec', 'workflow'],
  'doc-writer':             ['build', 'agent', 'documentation', 'workflow'],
  'researcher':             ['revenue', 'agent', 'research', 'strategy', 'market'],
  'copywriter':             ['revenue', 'agent', 'copy', 'marketing', 'workflow'],
  'seo-geo-auditor':        ['revenue', 'agent', 'seo', 'marketing', 'audit'],
  'kill-criteria-examiner': ['holdco', 'agent', 'advisory', 'decision-support', 'kill-criteria'],
  'exit-readiness-scorer':  ['holdco', 'agent', 'advisory', 'decision-support', 'exit'],
}

// Minimal YAML frontmatter parse — flat string keys only, which is all agent files use.
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const fm = {}
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf(':')
    if (eq < 1) continue
    fm[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return fm
}

async function embed(text) {
  const input = String(text).slice(0, 8000)
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input }),
  })
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${res.statusText}`)
  return (await res.json()).data[0].embedding
}

async function syncAgent(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const fm = parseFrontmatter(content)
  const name = fm.name || basename(filePath, '.md')
  const crew = CREWS[name] ?? 'unassigned'
  const tags = AGENT_TAGS[name] ?? [crew, 'agent']
  const metadata = {
    description: fm.description ?? '',
    model: fm.model ?? '',
    tools: fm.tools ?? '',
    crew,
  }

  // Match-on-title to decide update vs insert
  const { data: existing, error: selErr } = await supabase
    .from('vault_items')
    .select('id')
    .eq('type', 'agent')
    .eq('title', name)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)

  let id
  if (existing) {
    const { error } = await supabase
      .from('vault_items')
      .update({ content, tags, metadata, is_mcp_accessible: true })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
    id = existing.id
  } else {
    const { data, error } = await supabase
      .from('vault_items')
      .insert({
        type: 'agent',
        title: name,
        content,
        encrypted: false,
        tags,
        metadata,
        is_mcp_accessible: true,
        capture_source: 'sync-agents-script',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'insert returned no data')
    id = data.id
  }

  // Two-step embed update — non-fatal on failure, same as captureToVault
  let embedded = true
  try {
    const embedding = await embed(`${name}\n${metadata.description}\n${content}`)
    const { error } = await supabase.from('vault_items').update({ embedding }).eq('id', id)
    if (error) throw new Error(error.message)
  } catch (err) {
    embedded = false
    console.error(`  ⚠ embed failed for ${name}: ${err.message}`)
  }

  return { name, action: existing ? 'updated' : 'inserted', embedded }
}

async function main() {
  const agentsDir = join(ROOT, 'agents')
  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'))
  if (files.length === 0) {
    console.error('No agent files found in agents/')
    process.exit(1)
  }

  const installDir = join(homedir(), '.claude', 'agents')
  mkdirSync(installDir, { recursive: true })

  let vaultOk = 0, vaultFail = 0, installed = 0
  for (const file of files) {
    const src = join(agentsDir, file)
    try {
      const r = await syncAgent(src)
      console.log(`✓ vault ${r.action}: ${r.name}${r.embedded ? '' : ' (no embedding)'}`)
      vaultOk++
    } catch (err) {
      console.error(`✗ vault sync failed: ${file} — ${err.message}`)
      vaultFail++
    }
    copyFileSync(src, join(installDir, file))
    installed++
  }

  console.log(`\n${vaultOk} synced to vault (${vaultFail} failed), ${installed} installed to ${installDir}`)
  if (vaultFail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
