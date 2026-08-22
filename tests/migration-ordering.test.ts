// Migrations are applied in filename order, so a duplicated or out-of-order number silently
// changes what runs when. 027 adds the approved_sha column the approval gate depends on: if
// it never lands, mc_respond_approval writes to a column that does not exist and every push
// fails closed on 'approved_sha missing'. Cheap to pin, expensive to discover in production.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const DIR = 'supabase/migrations'
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const NAME_RE = /^(\d{3})_[a-z0-9_]+\.sql$/

describe('migration ordering', () => {
  it('every migration is <nnn>_snake_case.sql', () => {
    for (const f of FILES) expect(f, f).toMatch(NAME_RE)
  })

  it('no number is used twice', () => {
    const numbers = FILES.map((f) => f.match(NAME_RE)![1])
    expect(new Set(numbers).size, `duplicate prefix in ${numbers.join(', ')}`).toBe(numbers.length)
  })

  it('lexical order is numeric order (what the migrator actually applies)', () => {
    const numbers = FILES.map((f) => Number(f.match(NAME_RE)![1]))
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
  })

  it('027 is the newest migration — this phase did not reuse or skip a slot', () => {
    const numbers = FILES.map((f) => Number(f.match(NAME_RE)![1]))
    expect(Math.max(...numbers)).toBe(27)
    expect(FILES.at(-1)).toBe('027_approval_sha_binding.sql')
  })
})

describe('027_approval_sha_binding', () => {
  const sql = readFileSync(join(DIR, '027_approval_sha_binding.sql'), 'utf8')

  it('adds approved_sha to mc_requests', () => {
    expect(sql).toMatch(/ALTER TABLE mc_requests/i)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS approved_sha/i)
  })

  it('is re-runnable, matching the convention every other migration follows', () => {
    expect(sql).toMatch(/IF NOT EXISTS/i)
  })

  it('is the only migration that defines approved_sha', () => {
    const definers = FILES.filter((f) => /ADD COLUMN IF NOT EXISTS approved_sha/i.test(readFileSync(join(DIR, f), 'utf8')))
    expect(definers).toEqual(['027_approval_sha_binding.sql'])
  })

  it('does not touch any table other than mc_requests', () => {
    const tables = [...sql.matchAll(/ALTER TABLE\s+(\w+)/gi)].map((m) => m[1])
    expect(new Set(tables)).toEqual(new Set(['mc_requests']))
  })
})
