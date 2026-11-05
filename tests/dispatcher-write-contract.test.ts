// Tripwire for the mc_requests write contract (migration 029): every UPDATE the dispatcher
// issues must CAS on updated_at. Reads the source as text; a new unguarded write fails here.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const src = readFileSync(resolve(__dirname, '../scripts/dispatcher.mjs'), 'utf8')

describe('dispatcher mc_requests writes carry the updated_at guard', () => {
  // A chain runs from `.from('mc_requests')` to the next `await`/blank line/function end.
  const chains = src.split(".from('mc_requests')").slice(1)
    .map((rest) => rest.split(/\n\s*\n|\nasync function |\nfunction /)[0])
    .filter((c) => c.includes('.update('))

  it('finds the update chains (guards against the test silently matching nothing)', () => {
    expect(chains.length).toBeGreaterThanOrEqual(9)
  })

  it.each(chains.map((c, i) => [i, c.trim().split('\n')[0].slice(0, 60), c]))('chain %i (%s) has .eq(\'updated_at\', ...)', (_i, _label, chain) => {
    expect(chain).toMatch(/\.eq\(\s*'updated_at'\s*,/)
  })
})
