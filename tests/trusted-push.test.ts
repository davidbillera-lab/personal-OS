// Adversarial coverage for the credentialed push.
//
// These tests run REAL git against a REAL hostile workspace and REAL local remotes. Nothing
// here is stubbed, because the claim being tested is about what git itself honours — a mock
// would only prove that the mock agrees with me.
//
// The workspace is booby-trapped with every mechanism git offers for running a program or
// re-pointing a remote from inside a repository:
//   .git/hooks/pre-push, core.hooksPath, include.path, includeIf, url.*.insteadOf,
//   url.*.pushInsteadOf, remote.*.pushurl, credential.helper
// plus a hostile GIT_* environment. Each trap writes a witness file and/or aims the push at
// an "attacker" bare repo, so a breach is visible rather than inferred.
//
// A baseline test first pushes the OLD way (`git -C <workspace> push`) and asserts the traps
// DO fire — otherwise a green suite would only prove the traps were built wrong.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  trustedPush, sanitizeGitEnv, resolveWorkspaceHead, workspaceObjectStore, createTrustedPushRepo,
  prepareTrustedPush, pushTrustedRepo,
} from '../scripts/lib/trusted-push.mjs'

const REQ = '11111111-1111-1111-1111-111111111111'
const BRANCH = `mc-build-${REQ}`
const REF = `refs/heads/${BRANCH}`

let root: string
let workspace: string
let honest: string // the remote the push is SUPPOSED to reach
let attacker: string // the remote every trap tries to reach instead
let ghost: string // a target that does not exist — stands in for the real github URL, so the
//                   redirect traps have something to rewrite without any network being involved
let witness: string // traps that execute drop a file here
let sha: string

// EVERY push in this file stays on the local filesystem. An earlier draft aimed two tests at
// the real https://github.com/davidbillera-lab/mc-spike-test — the baseline through raw git,
// the redirect test through trustedPush — and created a live branch on it. Both git entry
// points now share this guard, so a network remote is a loud test failure rather than a
// silent live operation.
function assertLocalRemote(remote: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote) || remote.startsWith('git@')) {
    throw new Error(`REFUSED: this test tried to reach a network remote (${remote})`)
  }
}

/** Raw git, no sanitizing — used to build fixtures and to run the vulnerable baseline. */
function rawGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  if (args[0] === 'push') assertLocalRemote(args[1] ?? '')
  return spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
  })
}

/** trustedPush behind the same guard — every trustedPush in this file goes through here. */
function push(opts: { workspaceRef: string; sha: string; remote: string; ref: string }) {
  assertLocalRemote(opts.remote)
  return trustedPush(opts)
}

/** A shell script git will execute, portable enough for git-for-windows' bundled sh. */
function trap(path: string, marker: string) {
  writeFileSync(path, `#!/bin/sh\necho pwned > "${witness}/${marker}"\nexit 1\n`, { mode: 0o755 })
}

const breached = () => (existsSync(witness) ? readdirSync(witness).join(', ') : '')
/** Inspect a repo with the GIT_ namespace stripped, so a hostile parent env cannot skew a read. */
const refsOf = (repo: string) =>
  spawnSync('git', ['-C', repo, 'for-each-ref', '--format=%(objectname) %(refname)'], {
    encoding: 'utf8', env: sanitizeGitEnv(),
  }).stdout.trim()

const fwd = (p: string) => p.replace(/\\/g, '/')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mc-trusted-push-test-'))
  workspace = join(root, 'ws')
  honest = join(root, 'honest.git')
  attacker = join(root, 'attacker.git')
  // Deliberately never created. Forward-slashed at birth because git matches url.*.insteadOf
  // as a literal string: the config below and every push that targets it must spell it the
  // same way, or the redirect silently cannot fire and the tests below prove nothing.
  ghost = fwd(join(root, 'ghost.git'))
  witness = join(root, 'witness')
  mkdirSync(witness)

  rawGit(root, ['init', '--quiet', '--bare', honest])
  rawGit(root, ['init', '--quiet', '--bare', attacker])
  rawGit(root, ['init', '--quiet', workspace])
  writeFileSync(join(workspace, 'built.txt'), 'the approved build output\n')
  rawGit(workspace, ['add', 'built.txt'])
  rawGit(workspace, [
    '-c', 'user.email=build@sandbox', '-c', 'user.name=sandbox', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '-m', 'approved build',
  ])
  sha = rawGit(workspace, ['rev-parse', 'HEAD']).stdout.trim()
  expect(sha).toMatch(/^[0-9a-f]{40}$/)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Plant every trap the sandbox could plant in a workspace it owns. */
function boobyTrap() {
  const gitDir = join(workspace, '.git')

  // 1. the classic: a pre-push hook in the default location
  trap(join(gitDir, 'hooks', 'pre-push'), 'pre-push')

  // 2. core.hooksPath — hooks from a directory nothing is watching
  const elsewhere = join(workspace, '.sneaky-hooks')
  mkdirSync(elsewhere)
  trap(join(elsewhere, 'pre-push'), 'hookspath')

  // 3. an included config file, so the dangerous keys are not even in .git/config
  const included = join(gitDir, 'extra.config')
  writeFileSync(included, [
    '[core]',
    `\thooksPath = ${fwd(elsewhere)}`,
    `[url "${fwd(attacker)}"]`,
    // 4 + 5: redirect the credentialed push at the attacker's remote, both spellings.
    // `ghost` stands in for the production https://github.com/... target: it is a path that
    // does not exist, so an un-redirected push fails locally instead of reaching a real host.
    `\tinsteadOf = ${fwd(ghost)}`,
    `\tpushInsteadOf = ${fwd(ghost)}`,
    '[credential]',
    // 6: hand the push credential to an attacker-supplied program
    `\thelper = !${fwd(join(witness, 'cred.sh'))}`,
  ].join('\n') + '\n')
  trap(join(witness, 'cred.sh'), 'credential-helper')

  writeFileSync(join(gitDir, 'config'), readFileSync(join(gitDir, 'config'), 'utf8') + [
    '[include]',
    `\tpath = ${fwd(included)}`,
    '[includeIf "gitdir:**"]',
    `\tpath = ${fwd(included)}`,
    // 7: a named remote whose pushurl points at the attacker
    '[remote "origin"]',
    `\turl = ${fwd(honest)}`,
    `\tpushurl = ${fwd(attacker)}`,
  ].join('\n') + '\n')
}

describe('BASELINE — the traps are real (this is what the old push path did)', () => {
  it('pushing from the builder workspace executes its hooks and honours its config', () => {
    boobyTrap()
    // `ghost` stands in for the production github URL: same role in the fixture (it is what
    // the planted url.*.insteadOf rewrites), but it is a local path that was never created,
    // so nothing here can leave this machine.
    const r = rawGit(workspace, ['push', ghost, `${sha}:${REF}`], { GIT_TERMINAL_PROMPT: '0' })

    // A hook fired (exit 1 from the trap) and/or the URL was rewritten to the attacker.
    const output = `${r.stdout}${r.stderr}`
    const hookRan = existsSync(join(witness, 'pre-push')) || existsSync(join(witness, 'hookspath'))
    const redirected = output.includes('attacker.git')
    expect(hookRan || redirected, `neither trap fired — fixture is wrong:\n${output}`).toBe(true)
  })

  // Positive control for the redirect trap specifically. Without this, the trustedPush
  // redirect test below could pass vacuously: a push to `ghost` fails whether or not the
  // rewrite config was ever loaded. Here — no hooks to abort first — the rewrite must fire
  // and the commit must actually land in the attacker's repo.
  it('url.*.pushInsteadOf alone silently redirects the push to the attacker', () => {
    const gitDir = join(workspace, '.git')
    writeFileSync(join(gitDir, 'config'), readFileSync(join(gitDir, 'config'), 'utf8') + [
      `[url "${fwd(attacker)}"]`,
      `\tpushInsteadOf = ${fwd(ghost)}`,
    ].join('\n') + '\n')

    rawGit(workspace, ['push', ghost, `${sha}:${REF}`])
    expect(refsOf(attacker), 'the rewrite did not fire — fixture is wrong').toBe(`${sha} ${REF}`)
  })

  it('a pre-push hook alone can block or subvert the push', () => {
    trap(join(workspace, '.git', 'hooks', 'pre-push'), 'pre-push')
    rawGit(workspace, ['push', honest, `${sha}:${REF}`])
    expect(existsSync(join(witness, 'pre-push')), 'hook did not run').toBe(true)
    expect(refsOf(honest), 'hook blocked the push, as designed for this fixture').toBe('')
  })

  // Positive control for the credential trap specifically. The combined boobyTrap() test only
  // asserts the trap did NOT fire under trustedPush; without this, that assertion could be
  // vacuously true because credential.helper never fires for a local push at all. `git
  // credential fill` invokes the helper chain directly — no network, no push — proving the
  // planted helper really does hand over whatever git asks it for.
  it('credential.helper alone hands the push credential to an attacker-supplied program', () => {
    const marker = join(witness, 'credential-helper')
    const helper = join(witness, 'credential-helper.cjs')
    writeFileSync(helper, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')\n`)
    rawGit(workspace, [
      'config', '--add', 'credential.helper',
      `!'${fwd(process.execPath)}' '${fwd(helper)}'`,
    ])

    spawnSync('git', ['-C', workspace, 'credential', 'fill'], {
      encoding: 'utf8',
      input: 'protocol=https\nhost=example.invalid\n\n',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    expect(existsSync(marker), 'credential helper did not run').toBe(true)
  })

  // Positive control for the remote-helper class of executable remote: `ext::` runs its
  // argument directly (no shell, no network), which is why trustedPush refuses any remote
  // containing "::" before git ever sees it (see the "not negotiable" suite below).
  const gitExecPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim()
  const hasRemoteExt = ['git-remote-ext', 'git-remote-ext.exe']
    .some((name) => existsSync(join(gitExecPath, name)))
  const remoteExtTest = hasRemoteExt ? it : it.skip
  remoteExtTest('an ext:: remote runs an arbitrary program instead of talking to a remote', () => {
    const marker = join(witness, 'ext-helper')
    const helper = join(witness, 'ext-helper.cjs')
    writeFileSync(helper, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.exit(1)\n`)
    rawGit(workspace, ['push', `ext::node ${fwd(helper)}`, `${sha}:${REF}`])
    expect(existsSync(join(witness, 'ext-helper')), 'ext:: helper did not run — fixture is wrong').toBe(true)
  })
})

describe('trustedPush — the builder workspace is off the git path entirely', () => {
  it('THE FIX: pushes the approved sha to the intended remote with every trap armed', () => {
    boobyTrap()
    push({ workspaceRef: workspace, sha, remote: honest, ref: REF })

    expect(refsOf(honest)).toBe(`${sha} ${REF}`)
    expect(refsOf(attacker), 'nothing may reach the attacker remote').toBe('')
  })

  it('no planted hook executes — pre-push, core.hooksPath, or included config', () => {
    boobyTrap()
    push({ workspaceRef: workspace, sha, remote: honest, ref: REF })

    for (const marker of ['pre-push', 'hookspath', 'credential-helper']) {
      expect(existsSync(join(witness, marker)), `${marker} trap executed: ${breached()}`).toBe(false)
    }
  })

  it('url.*.insteadOf / pushInsteadOf cannot redirect the target', () => {
    boobyTrap()
    // Push at `ghost` — the exact path the builder's config rewrites to the attacker, proven
    // one describe up to land there when git honours that config. The trusted repo never
    // reads it, so the rewrite cannot happen and the push must instead fail to resolve a
    // path that does not exist. The assertion that matters is WHERE it did not go.
    expect(() => push({ workspaceRef: workspace, sha, ref: REF, remote: ghost })).toThrow()
    expect(refsOf(attacker), 'redirect landed on the attacker remote').toBe('')
  })

  it('remote.origin.pushurl cannot redirect the target', () => {
    boobyTrap()
    push({ workspaceRef: workspace, sha, remote: honest, ref: REF })
    expect(refsOf(attacker)).toBe('')
    expect(refsOf(honest)).toBe(`${sha} ${REF}`)
  })

  it('the trusted repo has no hooks directory, no builder config, and no alternates', () => {
    boobyTrap()
    const trusted = createTrustedPushRepo(workspace)
    try {
      expect(existsSync(join(trusted.repo, '.git', 'hooks'))).toBe(false)
      const config = readFileSync(join(trusted.repo, '.git', 'config'), 'utf8')
      expect(config).not.toContain('hooksPath')
      expect(config).not.toContain('insteadOf')
      expect(config).not.toContain('pushurl')
      expect(config).not.toContain('helper')
      // objects are copied in, never chained through alternates — see the module header.
      expect(existsSync(join(trusted.repo, '.git', 'objects', 'info', 'alternates'))).toBe(false)
      const check = spawnSync('git', ['-C', trusted.repo, 'cat-file', '-e', `${sha}^{commit}`], {
        encoding: 'utf8', env: sanitizeGitEnv(),
      })
      expect(check.status, `approved commit missing from the copied object store: ${check.stderr}`).toBe(0)
    } finally { trusted.cleanup() }
  })

  // importTrustedObjects() copies objects/pack by filename, not by re-deriving them, so a
  // build the sandbox packed (or the operator ran `git gc` on) has to copy just as cleanly as
  // one that never left loose objects.
  it('pushes successfully when the objects live only in a pack (post gc/repack)', () => {
    rawGit(workspace, ['-c', 'pack.writeReverseIndex=true', 'repack', '-a', '-d', '--quiet'])
    const packDir = join(workspace, '.git', 'objects', 'pack')
    const packFiles = existsSync(packDir) ? readdirSync(packDir) : []
    expect(
      packFiles.some((f) => f.endsWith('.pack')),
      'fixture did not actually produce a pack — repack failed silently',
    ).toBe(true)
    const reverseIndex = packFiles.find((f) => f.endsWith('.rev'))
    expect(reverseIndex, 'fixture did not produce the .rev sidecar this test promises to cover').toBeTruthy()

    const trusted = createTrustedPushRepo(workspace)
    try {
      expect(existsSync(join(trusted.repo, '.git', 'objects', 'pack', reverseIndex!))).toBe(true)
    } finally { trusted.cleanup() }

    push({ workspaceRef: workspace, sha, remote: honest, ref: REF })
    expect(refsOf(honest)).toBe(`${sha} ${REF}`)
    expect(refsOf(attacker)).toBe('')
  })

  it('leaves no trusted repo behind, on success or on failure', () => {
    // Exclude this suite's own fixture roots (`mc-trusted-push-test-*`); only the
    // implementation-created `mc-trusted-push-<random>` directories are relevant.
    const leftovers = () => readdirSync(tmpdir())
      .filter((d) => d.startsWith('mc-trusted-push-') && !d.startsWith('mc-trusted-push-test-'))
    const before = new Set(leftovers())
    push({ workspaceRef: workspace, sha, remote: honest, ref: REF })
    expect(() => push({ workspaceRef: workspace, sha, remote: join(root, 'nope.git'), ref: REF })).toThrow()
    expect(leftovers().filter((d) => !before.has(d))).toEqual([])
  })
})

describe('importTrustedObjects — the builder cannot smuggle objects in via nested alternates', () => {
  it('a commit reachable only through a builder-planted objects/info/alternates never reaches the trusted repo, and the push fails closed', () => {
    // A second repository the sandbox never built and workspaceObjectStore() never bound —
    // stands in for whatever an attacker-controlled alternates target would be.
    const external = join(root, 'external')
    rawGit(root, ['init', '--quiet', external])
    writeFileSync(join(external, 'nested.txt'), 'reachable only via a nested alternates chain\n')
    rawGit(external, ['add', 'nested.txt'])
    rawGit(external, [
      '-c', 'user.email=build@sandbox', '-c', 'user.name=sandbox', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'planted via nested alternates',
    ])
    const nestedSha = rawGit(external, ['rev-parse', 'HEAD']).stdout.trim()
    expect(nestedSha).toMatch(/^[0-9a-f]{40}$/)

    // Planted exactly where a legitimate alternates chain would live — inside the BUILDER'S
    // OWN object store's objects/info — pointing at `external`. importTrustedObjects() never
    // opens objects/info (see the module header), so this must not make nestedSha reachable
    // from the trusted repo.
    const alternatesDir = join(workspace, '.git', 'objects', 'info')
    mkdirSync(alternatesDir, { recursive: true })
    writeFileSync(join(alternatesDir, 'alternates'), `${fwd(join(external, '.git', 'objects'))}\n`)

    // Fixture sanity check: raw git in the workspace DOES resolve nestedSha through the
    // alternates file, so the assertion below is about the copy path refusing it, not about
    // the fixture failing to wire the trap up.
    const sanity = spawnSync('git', ['-C', workspace, 'cat-file', '-e', `${nestedSha}^{commit}`], {
      encoding: 'utf8', env: sanitizeGitEnv(),
    })
    expect(sanity.status, `fixture is wrong — nestedSha is not reachable via alternates: ${sanity.stderr}`).toBe(0)

    expect(() => push({ workspaceRef: workspace, sha: nestedSha, remote: honest, ref: REF })).toThrow()
    expect(refsOf(honest), 'nested-alternates commit must not land on the intended remote').toBe('')
    expect(refsOf(attacker)).toBe('')
  })
})

describe('importTrustedObjects — a symlinked/junctioned shard or pack directory does not pass as real', () => {
  it('refuses a loose-object shard directory that is a symlink/junction', () => {
    const decoy = join(root, 'decoy-shard')
    mkdirSync(decoy, { recursive: true })
    const objectsDir = join(workspace, '.git', 'objects')
    const shard = ['ff', 'ee', 'dd', 'cc'].find((h) => !existsSync(join(objectsDir, h)))
    try {
      symlinkSync(decoy, join(objectsDir, shard!), 'junction')
    } catch {
      return // symlink/junction creation not permitted in this environment — skip
    }
    expect(() => push({ workspaceRef: workspace, sha, remote: honest, ref: REF })).toThrow(/not a directory/)
    expect(refsOf(honest)).toBe('')
    expect(refsOf(attacker)).toBe('')
  })

  it('refuses an objects/pack directory that is a symlink/junction', () => {
    const decoy = join(root, 'decoy-pack')
    mkdirSync(decoy, { recursive: true })
    const packPath = join(workspace, '.git', 'objects', 'pack')
    try {
      symlinkSync(decoy, packPath, 'junction')
    } catch {
      return // symlink/junction creation not permitted in this environment — skip
    }
    expect(() => push({ workspaceRef: workspace, sha, remote: honest, ref: REF })).toThrow(/not a directory/)
    expect(refsOf(honest)).toBe('')
    expect(refsOf(attacker)).toBe('')
  })
})

describe('trustedPush — a hostile GIT_* environment cannot reach git', () => {
  const hostile = {
    GIT_DIR: 'C:/nope/.git',
    GIT_WORK_TREE: 'C:/nope',
    GIT_OBJECT_DIRECTORY: 'C:/nope/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: 'C:/nope/objects',
    GIT_INDEX_FILE: 'C:/nope/index',
    GIT_SSH_COMMAND: 'pwn',
    GIT_PROXY_COMMAND: 'pwn',
    GIT_ASKPASS: 'pwn',
    GIT_EXTERNAL_DIFF: 'pwn',
    GIT_CONFIG_GLOBAL: 'C:/nope/gitconfig',
    GIT_CONFIG_SYSTEM: 'C:/nope/gitconfig',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: 'C:/nope/hooks',
    SSH_ASKPASS: 'pwn',
  }

  it('sanitizeGitEnv drops the whole GIT_ namespace and the askpass hooks', () => {
    const cleaned = sanitizeGitEnv({ ...process.env, ...hostile })
    for (const key of Object.keys(hostile)) {
      expect(cleaned[key], `${key} survived sanitizing`).toBeUndefined()
    }
    expect(cleaned.GIT_TERMINAL_PROMPT, 'a push must fail rather than hang on a prompt').toBe('0')
    expect(cleaned.PATH ?? cleaned.Path, 'PATH must survive or git cannot be found').toBeTruthy()
  })

  it('is case-insensitive — Git_Dir is as dangerous as GIT_DIR', () => {
    const cleaned = sanitizeGitEnv({ Git_Dir: 'C:/nope', git_config_count: '1' })
    expect(cleaned.Git_Dir).toBeUndefined()
    expect(cleaned.git_config_count).toBeUndefined()
  })

  it('the push still succeeds with that environment set on the parent process', () => {
    boobyTrap()
    const saved: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(hostile)) { saved[k] = process.env[k]; process.env[k] = v }
    try {
      push({ workspaceRef: workspace, sha, remote: honest, ref: REF })
      expect(refsOf(honest)).toBe(`${sha} ${REF}`)
      expect(refsOf(attacker)).toBe('')
      expect(existsSync(join(witness, 'hookspath')), 'GIT_CONFIG_KEY_0 hooksPath fired').toBe(false)
    } finally {
      for (const k of Object.keys(hostile)) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
      }
    }
  })
})

describe('trustedPush — the destination is not negotiable', () => {
  it('rejects executable or unknown remote-helper transports before Git starts', () => {
    for (const bad of [
      'ext::node attacker.cjs',
      'helper::payload',
      'evil+exec://attacker.invalid/repo',
      '--upload-pack=attacker',
    ]) {
      expect(() => trustedPush({ workspaceRef: workspace, sha, remote: bad, ref: REF }))
        .toThrow(/remote-helper|unrecognised remote scheme|looks like an option/)
    }
    expect(refsOf(honest)).toBe('')
    expect(refsOf(attacker)).toBe('')
  })

  it('refuses a source that is not a literal 40-hex sha', () => {
    for (const bad of ['HEAD', 'refs/heads/main', `${sha}^`, 'HEAD~1', '', null, `${sha}\n${sha}`]) {
      expect(() => push({ workspaceRef: workspace, sha: bad as string, remote: honest, ref: REF }))
        .toThrow(/literal sha/)
    }
    expect(refsOf(honest)).toBe('')
  })

  it('refuses a destination ref outside refs/heads/', () => {
    for (const bad of ['refs/tags/v1', 'HEAD', 'refs/heads/../../evil', `refs/heads/${BRANCH}:refs/heads/other`, '']) {
      expect(() => push({ workspaceRef: workspace, sha, remote: honest, ref: bad }))
        .toThrow(/unexpected destination ref/)
    }
    expect(refsOf(honest)).toBe('')
  })

  it('refuses an empty remote rather than falling back to a configured one', () => {
    expect(() => push({ workspaceRef: workspace, sha, remote: '', ref: REF })).toThrow(/no push remote/)
  })

  it('refuses a sha the builder never produced', () => {
    const absentSha = 'c'.repeat(40)
    expect(() => push({ workspaceRef: workspace, sha: absentSha, remote: honest, ref: REF })).toThrow()
    expect(refsOf(honest)).toBe('')
  })

  it('refuses a sha that exists but is not a commit', () => {
    const blob = rawGit(workspace, ['rev-parse', 'HEAD:built.txt']).stdout.trim()
    expect(() => push({ workspaceRef: workspace, sha: blob, remote: honest, ref: REF })).toThrow()
    expect(refsOf(honest)).toBe('')
  })
})

describe('prepared trusted-push handle — identity, binding, and single use', () => {
  it('is frozen and binds the remote before the consent re-read', () => {
    const prepared = prepareTrustedPush({ workspaceRef: workspace, sha, ref: REF, remote: honest })
    try {
      expect(Object.isFrozen(prepared)).toBe(true)
      expect(Reflect.set(prepared, 'remote', attacker)).toBe(false)
      pushTrustedRepo(prepared)
      expect(refsOf(honest)).toBe(`${sha} ${REF}`)
      expect(refsOf(attacker)).toBe('')
    } finally { prepared.cleanup() }
  })

  it('rejects a forged look-alike before Git runs', () => {
    const forged = Object.freeze({
      repo: workspace, hooks: join(workspace, '.git', 'hooks'),
      sha, ref: REF, remote: attacker, cleanup: () => {},
    })
    expect(() => pushTrustedRepo(forged)).toThrow(/unrecognised trusted-push handle/)
    expect(refsOf(honest)).toBe('')
    expect(refsOf(attacker)).toBe('')
  })

  it('rejects reuse even after the first push succeeds', () => {
    const prepared = prepareTrustedPush({ workspaceRef: workspace, sha, ref: REF, remote: honest })
    try {
      pushTrustedRepo(prepared)
      expect(() => pushTrustedRepo(prepared)).toThrow(/reuse a trusted-push handle/)
      expect(refsOf(honest)).toBe(`${sha} ${REF}`)
    } finally { prepared.cleanup() }
  })
})

describe('workspaceObjectStore — the object store must be inside the bound workspace', () => {
  it('accepts the ordinary case', () => {
    expect(workspaceObjectStore(workspace)).toBe(join(workspace, '.git', 'objects'))
  })

  it('refuses a workspace with no object store at all', () => {
    const bare = join(root, 'not-a-repo')
    mkdirSync(bare)
    expect(() => workspaceObjectStore(bare)).toThrow(/no git object store/)
  })

  it('refuses an object store symlinked out of the workspace', () => {
    const other = join(root, 'other-repo')
    rawGit(root, ['init', '--quiet', other])
    const victim = join(root, 'victim')
    mkdirSync(join(victim, '.git'), { recursive: true })
    try {
      symlinkSync(join(other, '.git', 'objects'), join(victim, '.git', 'objects'), 'junction')
    } catch {
      return // symlink/junction creation not permitted in this environment — skip
    }
    expect(() => workspaceObjectStore(victim)).toThrow(/escapes the workspace/)
  })
})

describe('resolveWorkspaceHead — HEAD without starting git in the builder repo', () => {
  it('agrees with git rev-parse on a normal branch checkout', () => {
    expect(resolveWorkspaceHead(workspace)).toBe(sha)
  })

  it('resolves a detached HEAD', () => {
    writeFileSync(join(workspace, '.git', 'HEAD'), `${sha}\n`)
    expect(resolveWorkspaceHead(workspace)).toBe(sha)
  })

  it('resolves through packed-refs when the loose ref is gone', () => {
    const before = resolveWorkspaceHead(workspace)
    rawGit(workspace, ['pack-refs', '--all'])
    expect(resolveWorkspaceHead(workspace)).toBe(before)
  })

  it('refuses a symref that would climb out of the git dir', () => {
    for (const evil of ['ref: refs/../../../../etc/passwd', 'ref: ../../secret', 'ref: refs/heads/../../evil']) {
      writeFileSync(join(workspace, '.git', 'HEAD'), `${evil}\n`)
      expect(() => resolveWorkspaceHead(workspace)).toThrow(/unsafe ref name/)
    }
  })

  it('refuses garbage rather than returning something pushable', () => {
    for (const junk of ['', 'not a sha', 'ref:', `ref: refs/heads/gone`]) {
      writeFileSync(join(workspace, '.git', 'HEAD'), `${junk}\n`)
      expect(() => resolveWorkspaceHead(workspace)).toThrow()
    }
  })

  it('refuses a ref file that does not hold a sha', () => {
    writeFileSync(join(workspace, '.git', 'HEAD'), 'ref: refs/heads/master\n')
    mkdirSync(join(workspace, '.git', 'refs', 'heads'), { recursive: true })
    writeFileSync(join(workspace, '.git', 'refs', 'heads', 'master'), 'ref: refs/heads/loop\n')
    expect(() => resolveWorkspaceHead(workspace)).toThrow(/does not hold a sha/)
  })
})

// ---------------------------------------------------------------------------------------
// Host-level config. Every trap above lives INSIDE the workspace; these live on the MACHINE —
// $HOME/.gitconfig — which the builder never touches but which git reads on every invocation
// anyway. Stripping GIT_* does nothing about that, so the push path now pins HOME /
// USERPROFILE / XDG_CONFIG_HOME at an empty directory and sets GIT_CONFIG_NOSYSTEM. Codex
// flagged the gap; these two tests are the regression proof.
// ---------------------------------------------------------------------------------------
describe('host global git config', () => {
  let fakeHome = ''
  let savedHome: Record<string, string | undefined> = {}

  // redirectOnly: a pre-push hook that exits 1 aborts the push BEFORE a url rewrite can
  // deliver, so the baseline — which has to observe the rewrite landing — gets the url rules
  // on their own. The trustedPush test takes the full set, since it asserts none of them fire.
  function poisonGlobalConfig({ redirectOnly = false }: { redirectOnly?: boolean } = {}) {
    fakeHome = mkdtempSync(join(tmpdir(), 'mc-hostile-home-'))
    const hooks = join(fakeHome, 'hooks')
    mkdirSync(hooks)
    trap(join(hooks, 'pre-push'), 'global-prepush')
    trap(join(fakeHome, 'cred.sh'), 'global-credential')
    const redirectRules = [
      `[url "${fwd(attacker)}"]`,
      `\tinsteadOf = ${fwd(ghost)}`,
      `\tpushInsteadOf = ${fwd(ghost)}`,
    ]
    const executeRules = [
      '[core]',
      `\thooksPath = ${fwd(hooks)}`,
      '[credential]',
      `\thelper = !${fwd(join(fakeHome, 'cred.sh'))}`,
    ]
    const rules = redirectOnly ? redirectRules : [...executeRules, ...redirectRules]
    writeFileSync(join(fakeHome, '.gitconfig'), rules.join('\n') + '\n')
    savedHome = {}
    for (const k of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME']) {
      savedHome[k] = process.env[k]
      process.env[k] = fakeHome
    }
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedHome)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    savedHome = {}
    if (fakeHome) rmSync(fakeHome, { recursive: true, force: true })
    fakeHome = ''
  })

  // Without this the test below would prove nothing — it has to be shown that the machine-level
  // trap really does fire when git is left to read it.
  it('baseline: a raw push DOES honour host global config', () => {
    poisonGlobalConfig({ redirectOnly: true })
    rawGit(workspace, ['push', ghost, `${sha}:${REF}`])
    expect(refsOf(attacker), 'global pushInsteadOf did not redirect — the trap is built wrong').toBe(`${sha} ${REF}`)
  })

  it('trustedPush ignores host global config entirely', () => {
    poisonGlobalConfig()
    push({ workspaceRef: workspace, sha, remote: honest, ref: REF })
    expect(refsOf(honest)).toBe(`${sha} ${REF}`)
    expect(refsOf(attacker), 'the push was redirected by host global config').toBe('')
    expect(breached(), 'a host-level trap executed').toBe('')
  })
})
