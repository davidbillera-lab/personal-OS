import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Every 'use server' export is a public POST endpoint and proxy.ts only checks sign-in,
// so each one must check the owner. Sign-in/out are the only exemptions.
const EXEMPT = new Set(['app/login/actions.ts'])
const OWNER_CHECK = /requireOwner\(\)|isOwner\(\)|runOwnerAction\(|ownerRunQc\(/

function serverActionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return serverActionFiles(p)
    if (!/\.tsx?$/.test(name)) return []
    return /^\W*['"]use server['"]/.test(readFileSync(p, 'utf8')) ? [p] : []
  })
}

describe('server actions', () => {
  it('every exported action checks the owner', () => {
    const root = process.cwd()
    const missing: string[] = []
    for (const file of serverActionFiles(join(root, 'app'))) {
      const rel = relative(root, file).replace(/\\/g, '/')
      if (EXEMPT.has(rel)) continue
      const chunks = readFileSync(file, 'utf8').split(/^export async function /m).slice(1)
      for (const chunk of chunks) {
        if (!OWNER_CHECK.test(chunk)) missing.push(`${rel}: ${chunk.match(/^\w+/)?.[0]}`)
      }
    }
    expect(missing).toEqual([])
  })
})
