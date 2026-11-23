// Step 3 spike, piece 2: carry a reviewed sandbox build to the real repo as a patch.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import {
  validateArgs, globToRegExp, alwaysRefused, pathPolicy, checkQcRecord, exportBuild,
} from '../scripts/lib/build-patch.mjs'
import { provisionWorkspace, injectExecutorSettings } from '../scripts/lib/claude-executor-adapter.mjs'
import { readWorkspaceHead, qcRecordPath, provisionRecordPath, writeJson } from '../scripts/lib/trusted-git.mjs'

const REQ = '11111111-2222-4333-8444-555555555555'
const SHA = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const SLUG = 'test/fixture'

const g = (cwd: string, args: string[]) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

describe('validateArgs', () => {
  const ok = { workspace: '/w', sha: SHA, repo: SLUG, request: REQ, allow: ['src/**'] }
  it('accepts good input and returns the allowlist spelling of the repo', () => {
    expect(validateArgs({ ...ok, repo: 'TEST/Fixture' }, [SLUG]).slug).toBe(SLUG)
  })
  it.each([
    ['short sha', { sha: 'abc' }, /--sha/],
    ['uppercase sha', { sha: 'A'.repeat(40) }, /--sha/],
    ['non-uuid request', { request: 'nope' }, /--request/],
    ['repo off the allowlist', { repo: 'other/repo' }, /allowlist/],
    ['no allow globs', { allow: [] }, /--allow/],
    ['no workspace', { workspace: '' }, /--workspace/],
  ])('refuses %s', (_n, patch, re) => {
    expect(() => validateArgs({ ...ok, ...patch } as any, [SLUG])).toThrow(re)
  })
  it('refuses everything when the allowlist is empty', () => {
    expect(() => validateArgs(ok, [])).toThrow(/allowlist/)
  })
})

describe('path policy', () => {
  it('globs: * stays in a segment, ** crosses them', () => {
    expect(globToRegExp('tests/**').test('tests/a/b.test.ts')).toBe(true)
    expect(globToRegExp('src/*.js').test('src/a.js')).toBe(true)
    expect(globToRegExp('src/*.js').test('src/x/a.js')).toBe(false)
    expect(globToRegExp('scripts/lib/clone-target.mjs').test('scripts/lib/clone-target.mjs')).toBe(true)
    expect(globToRegExp('scripts/lib/clone-target.mjs').test('scripts/lib/clone-targetXmjs')).toBe(false)
  })

  it('always refuses protected paths, even with --allow "**"', () => {
    for (const p of [
      '.env.local', 'config/id_rsa', 'certs/a.pem',
      '.claude/settings.json', 'app/.claude/x', '.github/workflows/ci.yml',
      'vercel.json', '.gitleaks.toml', 'package.json', 'web/package.json',
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'CLAUDE.md', 'docs/AGENTS.md', 'claude.md',
    ]) {
      expect(alwaysRefused(p), p).not.toBeNull()
      expect(pathPolicy([{ path: p, newMode: '100644' }], ['**']), p).toHaveLength(1)
    }
  })

  it('refuses a path no --allow glob matches, and symlinks/submodules anywhere', () => {
    expect(pathPolicy([{ path: 'lib/x.ts', newMode: '100644' }], ['tests/**'])[0].reason).toMatch(/no --allow/)
    expect(pathPolicy([{ path: 'tests/l', newMode: '120000' }], ['tests/**'])[0].reason).toBe('symlink')
    expect(pathPolicy([{ path: 'tests/m', newMode: '160000' }], ['tests/**'])[0].reason).toBe('submodule')
    expect(pathPolicy([{ path: 'tests/ok.test.ts', newMode: '100644' }], ['tests/**'])).toEqual([])
    expect(pathPolicy([{ path: 'tests/gone.ts', newMode: '000000' }], ['tests/**'])).toEqual([]) // deletion
  })
})

describe('checkQcRecord (allowlisted verdicts, exact binding)', () => {
  const exp = { requestId: REQ, baseSha: BASE, sha: SHA }
  const good = { requestId: REQ, baseSha: BASE, sha: SHA, verdict: 'SHIP', reportPath: '/r.md' }
  it('accepts SHIP and FIX-FIRST', () => {
    expect(checkQcRecord(good, exp).verdict).toBe('SHIP')
    expect(checkQcRecord({ ...good, verdict: 'FIX-FIRST' }, exp).verdict).toBe('FIX-FIRST')
  })
  it.each([
    ['UNKNOWN verdict', { verdict: 'UNKNOWN' }],
    ['RECONSIDER verdict', { verdict: 'RECONSIDER' }],
    ['lowercase verdict', { verdict: 'ship' }],
    ['missing verdict', { verdict: undefined }],
    ['non-uuid requestId', { requestId: 'x' }],
    ['short sha', { sha: 'abc' }],
    ['null baseSha', { baseSha: null }],
    ['different request', { requestId: '99999999-2222-4333-8444-555555555555' }],
    ['different sha', { sha: 'c'.repeat(40) }],
    ['different base', { baseSha: 'd'.repeat(40) }],
  ])('refuses %s', (_n, patch) => {
    expect(() => checkQcRecord({ ...good, ...patch }, exp)).toThrow()
  })
  it('refuses a non-object', () => {
    for (const bad of [null, 'SHIP', 42, []]) expect(() => checkQcRecord(bad as any, exp)).toThrow()
  })
})

// ---- integration: the ordinary path, end to end, offline ----
describe('exportBuild dry run (file:// scratch repo)', () => {
  const saved: Record<string, string | undefined> = {}
  const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  beforeAll(() => { for (const [k, v] of Object.entries(ID)) { saved[k] = process.env[k]; process.env[k] = v } })
  afterAll(() => { for (const k of Object.keys(ID)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  let root: string, source: string, ws: string, sourceUrl: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mc-export-test-'))
    source = join(root, 'source')
    mkdirSync(join(source, 'src'), { recursive: true })
    g(source, ['init', '-q'])
    writeFileSync(join(source, 'src', 'lib.js'), 'export const x = 1\n')
    writeFileSync(join(source, 'README.md'), '# fixture\n')
    g(source, ['add', '-A']); g(source, ['commit', '-q', '-m', 'seed'])
    sourceUrl = pathToFileURL(source).href

    // 1. Provision a scratch clone and inject the executor settings the way the adapter does.
    ws = join(root, 'ws')
    provisionWorkspace(ws, { slug: SLUG, url: sourceUrl }, { requestId: REQ })
    injectExecutorSettings(ws)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // 2. The builder's instructed `git add -A` + commit. 3. The QC record.
  const build = (extra?: () => void) => {
    writeFileSync(join(ws, 'src', 'lib.js'), 'export const x = 2\n')
    extra?.()
    g(ws, ['add', '-A']); g(ws, ['commit', '-q', '-m', 'build'])
    const sha = readWorkspaceHead(ws)!
    const { baseSha } = JSON.parse(readFileSync(provisionRecordPath(ws), 'utf8'))
    writeJson(qcRecordPath(ws), { requestId: REQ, baseSha, sha, verdict: 'SHIP', reportPath: 'x' })
    return sha
  }
  const run = (sha: string, more: any = {}) => exportBuild({
    workspace: ws, sha, repo: SLUG, request: REQ, allow: ['src/**'],
    cloneUrlFor: () => sourceUrl, allowlist: [SLUG], ...more,
  })

  it('4. succeeds and carries ONLY the source change (not the injected .claude/settings.json)', () => {
    const sha = build()
    const res = run(sha)
    expect(res.branch).toBe(`mc-build-${REQ}`)
    expect(res.paths).toEqual(['src/lib.js'])
    expect(res.verdict).toBe('SHIP')
    expect(res.diff).toContain('+export const x = 2')
    expect(res.diff).not.toContain('.claude')
    expect(res.diff).toContain(sha) // commit message names the reviewed SHA
  }, 60_000)

  it('refuses a build that force-adds .claude/settings.json', () => {
    const sha = build(() => g(ws, ['add', '-f', '.claude/settings.json']))
    expect(() => run(sha, { allow: ['**'] })).toThrow(/\.claude\/settings\.json \(protected directory\)/)
  }, 60_000)

  it('refuses a change outside the --allow globs', () => {
    const sha = build(() => writeFileSync(join(ws, 'README.md'), '# changed\n'))
    expect(() => run(sha)).toThrow(/README\.md \(matches no --allow glob\)/)
  }, 60_000)

  it('refuses when HEAD is not the reviewed SHA', () => {
    build()
    expect(() => run('c'.repeat(40))).toThrow(/is not the reviewed SHA/)
  }, 60_000)

  it('refuses a missing, malformed or off-allowlist QC record', () => {
    const sha = build()
    writeFileSync(qcRecordPath(ws), '{not json')
    expect(() => run(sha)).toThrow(/not valid JSON/)
    rmSync(qcRecordPath(ws))
    expect(() => run(sha)).toThrow(/QC record missing/)
    const { baseSha } = JSON.parse(readFileSync(provisionRecordPath(ws), 'utf8'))
    writeJson(qcRecordPath(ws), { requestId: REQ, baseSha, sha, verdict: 'UNKNOWN' })
    expect(() => run(sha)).toThrow(/not SHIP or FIX-FIRST/)
  }, 60_000)

  it('refuses a provision record for another request or repo', () => {
    const sha = build()
    expect(() => run(sha, { request: '99999999-2222-4333-8444-555555555555' })).toThrow(/different request/)
    expect(() => run(sha, { repo: 'other/repo', allowlist: [SLUG, 'other/repo'] })).toThrow(/different repo/)
  }, 60_000)
})
