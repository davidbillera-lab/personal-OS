#!/usr/bin/env node
// Sync skill definitions: ~/.claude/skills/<name>/SKILL.md → vault_items (type 'skill').
// Run after adding or editing any skill: node scripts/sync-skills.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env.local into process.env (keys not already set only)
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

// Tags per skill — shared tags create edges in the vault graph UI.
const SKILL_TAGS = {
  'advisoryboard':        ['advisory', 'accountability', 'decision-support', 'personas', 'braindump'],
  'brainstorming':        ['workflow', 'design', 'planning', 'pre-implementation', 'spec'],
  'checkpoint':           ['workflow', 'session-start', 'context', 'resume', 'compaction'],
  'CodexQC':             ['quality', 'code-review', 'openai', 'second-opinion', 'build'],
  'davids-agents':        ['workflow', 'subagents', 'relay', 'compaction', 'token-efficiency', 'sequential'],
  'davids-way':           ['skill', 'methodology', 'build', 'davids-way', 'model-routing'],
  'decisions-sync':       ['workflow', 'decisions', 'session-end', 'github', 'mission-control'],
  'dynamic-workflow':     ['workflow', 'planning', 'plan-mode', 'build-loop', 'process', 'handoff'],
  'handoff':              ['workflow', 'session-start', 'context', 'resume', 'mission-control'],
  'mission-control':      ['workflow', 'session-start', 'session-end', 'mcp', 'supabase', 'mission-control'],
  'phase-relay':          ['workflow', 'subagents', 'relay', 'compaction', 'sequential', 'build'],
  'session-context':      ['workflow', 'session-start', 'context', 'vault', 'credentials'],
  'skill-invocation-scope': ['meta', 'routing', 'skills', 'workflow', 'complexity'],
  'vault-recall':         ['workflow', 'session-start', 'vault', 'memory', 'recall', 'mcp'],
}

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
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')
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

async function syncSkill(skillName, content) {
  const fm = parseFrontmatter(content)
  const name = fm.name || skillName
  const description = fm.description ?? ''
  const tags = SKILL_TAGS[skillName] ?? ['skill']

  const { data: existing, error: selErr } = await supabase
    .from('vault_items')
    .select('id')
    .eq('type', 'skill')
    .eq('title', name)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)

  let id
  if (existing) {
    const { error } = await supabase
      .from('vault_items')
      .update({ content, tags, metadata: { description }, is_mcp_accessible: true })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
    id = existing.id
  } else {
    const { data, error } = await supabase
      .from('vault_items')
      .insert({
        type: 'skill',
        title: name,
        content,
        encrypted: false,
        tags,
        metadata: { description },
        is_mcp_accessible: true,
        capture_source: 'sync-skills-script',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(error?.message ?? 'insert returned no data')
    id = data.id
  }

  let embedded = true
  try {
    const embedding = await embed(`${name}\n${description}\n${content}`)
    const { error } = await supabase.from('vault_items').update({ embedding }).eq('id', id)
    if (error) throw new Error(error.message)
  } catch (err) {
    embedded = false
    console.error(`  ⚠ embed failed for ${name}: ${err.message}`)
  }

  return { name, action: existing ? 'updated' : 'inserted', embedded }
}

async function main() {
  const skillsDir = join(homedir(), '.claude', 'skills')
  const entries = readdirSync(skillsDir).filter(e => {
    try { return statSync(join(skillsDir, e)).isDirectory() } catch { return false }
  })

  if (entries.length === 0) {
    console.error('No skill directories found in ~/.claude/skills/')
    process.exit(1)
  }

  let ok = 0, fail = 0, skipped = 0
  for (const skillName of entries) {
    const skillFile = join(skillsDir, skillName, 'SKILL.md')
    let content
    try {
      content = readFileSync(skillFile, 'utf8')
    } catch {
      console.warn(`  ⚠ skipping ${skillName} — no SKILL.md found`)
      skipped++
      continue
    }
    try {
      const r = await syncSkill(skillName, content)
      console.log(`✓ vault ${r.action}: ${r.name}${r.embedded ? '' : ' (no embedding)'}`)
      ok++
    } catch (err) {
      console.error(`✗ vault sync failed: ${skillName} — ${err.message}`)
      fail++
    }
  }

  console.log(`\n${ok} synced to vault (${fail} failed, ${skipped} skipped — no SKILL.md)`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
