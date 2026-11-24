// Step 3 spike, piece 1: after the sandbox exits, <workspace>/.git is hostile input.
// No host git/node call may ever run with its cwd or --git-dir inside the workspace.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, symlinkSync, readdirSync, unlinkSync, lstatSync, chmodSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { readWorkspaceHead, openTrusted, qcRecordPath, OverBudgetError, BUDGET } from '../scripts/lib/trusted-git.mjs'
import { finishBuild, runHostQc, confirmContainerGone, claudeExecutorAdapter } from '../scripts/lib/claude-executor-adapter.mjs'

const g = (cwd: string, args: string[]) => {
  const r = spawnSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const fwd = (p: string) => p.replace(/\\/g, '/')

let root: string
let ws: string
let marker: string
let baseSha: string
let sha: string

// A finished "build": base commit + two build commits, with a .git/config that runs a
// marker-writing command on any fsmonitor or external-diff invocation.
function hostileWorkspace() {
  ws = join(root, 'ws')
  mkdirSync(ws)
  g(ws, ['init', '-q'])
  writeFileSync(join(ws, 'a.txt'), 'base\n')
  g(ws, ['add', '-A']); g(ws, ['commit', '-q', '-m', 'base'])
  baseSha = g(ws, ['rev-parse', 'HEAD'])
  writeFileSync(join(ws, 'a.txt'), 'one\n')
  g(ws, ['commit', '-q', '-am', 'build 1'])
  writeFileSync(join(ws, 'b.txt'), 'two\n')
  g(ws, ['add', '-A']); g(ws, ['commit', '-q', '-m', 'build 2'])
  sha = g(ws, ['rev-parse', 'HEAD'])

  marker = join(root, 'PWNED')
  const evil = join(root, 'evil.cjs')
  writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')\n`)
  g(ws, ['config', 'core.fsmonitor', `node "${fwd(evil)}"`])
  g(ws, ['config', 'diff.external', `node "${fwd(evil)}"`])
}

// QC stand-in: records its --base and cwd, runs git diff in its cwd (which would fire the
// hostile config if that cwd were the workspace), and writes a report the way CodexQC does.
function stubQcScript() {
  const p = join(root, 'stub-qc.mjs')
  writeFileSync(p, `
import { writeFileSync, mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
const base = process.argv[process.argv.indexOf('--base') + 1]
writeFileSync(${JSON.stringify(join(root, 'qc-args.json'))}, JSON.stringify({ base, cwd: process.cwd() }))
spawnSync('git', ['diff', base, 'HEAD'], { encoding: 'utf8' })
spawnSync('git', ['status'], { encoding: 'utf8' })
mkdirSync('.codex-qc', { recursive: true })
writeFileSync('.codex-qc/codex-qc-stub.md', '# report\\n**Verdict:** SHIP\\n')
console.log('**Verdict:** SHIP')
`)
  return p
}

const gone = () => ({ status: 1, stderr: 'Error: No such object: mc-executor-x', stdout: '' })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mc-trusted-test-'))
  hostileWorkspace()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('hostile workspace .git', () => {
  it('positive control: the planted config DOES fire under plain git (so the test is not vacuous)', () => {
    spawnSync('git', ['-C', ws, 'status'], { encoding: 'utf8' })
    expect(existsSync(marker)).toBe(true)
  })

  it('reading HEAD, opening the trusted repo, diffing and checking out never fire it', () => {
    expect(readWorkspaceHead(ws)).toBe(sha)
    const t = openTrusted(ws)
    try {
      expect(t.hasCommit(sha)).toBe(true)
      expect(t.isAncestor(baseSha, sha)).toBe(true)
      expect(t.diff(baseSha, sha).toString('utf8')).toContain('+two')
      expect(t.changes(baseSha, sha).map((c: any) => c.path).sort()).toEqual(['a.txt', 'b.txt'])
      expect(t.log(sha)).toHaveLength(3)
      t.checkout(sha)
      expect(readFileSync(join(t.dir, 'b.txt'), 'utf8').trim()).toBe('two')
    } finally { t.close() }
    expect(existsSync(marker), 'hostile .git/config ran a command on the host').toBe(false)
  }, 30_000)

  it('the real post-build flow (teardown check, harvest, QC with a stub script, commit list) never fires it', () => {
    const script = stubQcScript()
    const res = finishBuild({
      workspace: ws, requestId: 'req-1', baseSha,
      confirmWriterGone: () => confirmContainerGone('mc-executor-x', gone),
      runQc: (a: any) => runHostQc({ ...a, script }),
    })
    expect(res.reviewedSha).toBe(sha)
    expect(res.qcVerdict).toBe('SHIP')
    expect(res.commits).toHaveLength(3)
    expect(existsSync(marker), 'hostile .git/config ran a command on the host').toBe(false)

    // QC ran outside the workspace, over the whole build from the RECORDED base (not sha^).
    const args = JSON.parse(readFileSync(join(root, 'qc-args.json'), 'utf8'))
    expect(args.base).toBe(baseSha)
    expect(fwd(args.cwd).startsWith(fwd(ws))).toBe(false)

    // Durable record beside the workspace, report copied out before cleanup.
    const rec = JSON.parse(readFileSync(qcRecordPath(ws), 'utf8'))
    expect(rec).toMatchObject({ requestId: 'req-1', baseSha, sha, verdict: 'SHIP' })
    expect(readFileSync(rec.reportPath, 'utf8')).toContain('**Verdict:** SHIP')
    expect(existsSync(args.cwd), 'trusted temp checkout should be deleted').toBe(false)
  }, 30_000)

  it('a two-commit build is reviewed from the recorded base, not sha^', () => {
    const runQc = vi.fn(() => ({ verdict: 'SHIP' }))
    finishBuild({ workspace: ws, baseSha, confirmWriterGone: () => {}, runQc })
    expect(runQc).toHaveBeenCalledOnce()
    const call = (runQc.mock.calls[0] as any[])[0]
    expect(call.baseSha).toBe(baseSha)
    expect(call.baseSha).not.toBe(g(ws, ['rev-parse', `${sha}^`]))
  })
})

describe('trusted reader refusals', () => {
  it('refuses a symlink inside objects/', () => {
    const target = mkdtempSync(join(tmpdir(), 'mc-link-target-'))
    const link = join(ws, '.git', 'objects', 'zz')
    try { symlinkSync(target, link, 'junction') } catch { symlinkSync(target, link) }
    try {
      expect(() => openTrusted(ws)).toThrow(/refusing non-regular file/)
    } finally { unlinkSync(link); rmSync(target, { recursive: true, force: true }) }
  })

  it('refuses directories outside git\'s object layout (bounded walk)', () => {
    mkdirSync(join(ws, '.git', 'objects', 'junk'))
    expect(() => openTrusted(ws)).toThrow(/unexpected directory in workspace objects: junk/)
    rmSync(join(ws, '.git', 'objects', 'junk'), { recursive: true })
    const loose = readdirSync(join(ws, '.git', 'objects')).find((n) => /^[0-9a-f]{2}$/.test(n))!
    mkdirSync(join(ws, '.git', 'objects', loose, 'a', 'b'), { recursive: true })
    expect(() => openTrusted(ws)).toThrow(/unexpected directory in workspace objects/)
  })

  it('a committed .codex-qc symlink cannot redirect host QC outside the checkout', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const blob = spawnSync('git', ['-C', ws, 'hash-object', '-w', '--stdin'], { input: fwd(outside), encoding: 'utf8' }).stdout.trim()
    g(ws, ['update-index', '--add', '--cacheinfo', `120000,${blob},.codex-qc`])
    g(ws, ['commit', '-q', '-m', 'evil link'])
    const linkSha = g(ws, ['rev-parse', 'HEAD'])
    const t = openTrusted(ws)
    try {
      expect(t.git(['config', 'core.symlinks'])).toBe('false') // applied on every platform
      const res = runHostQc({ workspace: ws, sha: linkSha, baseSha, trusted: t, script: stubQcScript() })
      expect(lstatSync(join(t.dir, '.codex-qc')).isSymbolicLink()).toBe(false)
      expect(res.verdict).toBe('UNKNOWN') // QC could not make its report dir: fails closed
    } finally { t.close() }
    expect(readdirSync(outside)).toEqual([])
  }, 30_000)

  it('refuses a swapped object: the file stored under the base SHA holds another commit', () => {
    const objPath = (s: string) => join(ws, '.git', 'objects', s.slice(0, 2), s.slice(2))
    const build1 = g(ws, ['rev-parse', `${sha}^`])
    chmodSync(objPath(baseSha), 0o644)
    copyFileSync(objPath(build1), objPath(baseSha))
    // Positive control: ordinary git believes the swap (no re-hash on read).
    const fake = spawnSync('git', ['-C', ws, '-c', 'core.fsmonitor=', 'cat-file', '-p', baseSha], { encoding: 'utf8' }).stdout
    expect(fake).toMatch(/^parent /m)
    expect(() => openTrusted(ws)).toThrow(/object integrity check/)
  })

  it('fails "output over budget" when declared object sizes inflate past the budget', () => {
    expect(() => openTrusted(ws, { budget: { ...BUDGET, inflatedBytes: 10 } })).toThrow(/inflate past/)
  })

  it('fails the build with "output over budget" past the object budget', () => {
    expect(() => openTrusted(ws, { budget: { ...BUDGET, objectsFiles: 2 } })).toThrow(OverBudgetError)
    expect(() => openTrusted(ws, { budget: { ...BUDGET, objectsFiles: 2 } })).toThrow(/output over budget/)
  })

  it('leaves no trusted temp dir behind when opening fails', () => {
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('mc-trusted-') && !f.startsWith('mc-trusted-test-')).length
    expect(() => openTrusted(ws, { budget: { ...BUDGET, objectsFiles: 2 } })).toThrow()
    const after = readdirSync(tmpdir()).filter((f) => f.startsWith('mc-trusted-') && !f.startsWith('mc-trusted-test-')).length
    expect(after).toBe(before)
  })
})

describe('finishBuild fails closed', () => {
  it('cleanup refusal: if removal cannot be confirmed, neither harvest nor QC is called', () => {
    const readHead = vi.fn()
    const runQc = vi.fn()
    for (const fake of [
      () => ({ status: 0, stdout: '[{}]', stderr: '' }), // container still exists
      () => ({ error: { code: 'ETIMEDOUT' } }), // daemon timeout
      () => ({ status: 1, stderr: 'Cannot connect to the Docker daemon', stdout: '' }), // daemon down
    ]) {
      expect(() => finishBuild({
        workspace: ws, baseSha, readHead, runQc,
        confirmWriterGone: () => confirmContainerGone('mc-executor-x', fake as any),
      })).toThrow(/teardown unconfirmed/)
    }
    expect(readHead).not.toHaveBeenCalled()
    expect(runQc).not.toHaveBeenCalled()
  })

  it('no-op: HEAD equal to the recorded base is "no change produced", and QC is not called', () => {
    const runQc = vi.fn()
    expect(() => finishBuild({
      workspace: ws, baseSha: sha, confirmWriterGone: () => {}, runQc,
    })).toThrow('no change produced')
    expect(runQc).not.toHaveBeenCalled()
  })
})

describe('legacy host adapter', () => {
  it('refuses a clone target before provisioning anything', async () => {
    const target = join(root, 'never')
    await expect(claudeExecutorAdapter.launch({
      workspace: target, request: { id: 'r' }, env: {}, timeoutMs: 1000,
      cloneTarget: { slug: 'a/b', url: 'https://github.com/a/b.git' },
    } as any)).rejects.toThrow(/refuses clone targets/)
    expect(existsSync(target)).toBe(false)
  })
})
