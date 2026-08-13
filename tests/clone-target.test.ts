// Host-side clone targeting. The whole feature must fail CLOSED: with no allowlist, or any
// ambiguity about the target, the builder gets an empty repo exactly as it always has.
import { describe, it, expect } from 'vitest'
import { repoSlug, resolveCloneTarget, isCredentialPath, cloneAllowlist } from '../scripts/lib/clone-target.mjs'

const LIST = ['davidbillera-lab/vzt', 'davidbillera-lab/personal-OS']

describe('cloneAllowlist', () => {
  it('is EMPTY by default — the feature is off until an operator opts a repo in', () => {
    expect(cloneAllowlist({})).toEqual([])
    expect(cloneAllowlist({ DISPATCHER_CLONEABLE_REPOS: '' })).toEqual([])
  })

  it('parses a comma list and trims', () => {
    expect(cloneAllowlist({ DISPATCHER_CLONEABLE_REPOS: 'a/b , c/d' })).toEqual(['a/b', 'c/d'])
  })
})

describe('repoSlug', () => {
  it('normalises the url shapes a repo_url actually arrives in', () => {
    for (const input of [
      'https://github.com/davidbillera-lab/vzt',
      'https://github.com/davidbillera-lab/vzt.git',
      'https://github.com/davidbillera-lab/vzt/',
      'git@github.com:davidbillera-lab/vzt.git',
      'davidbillera-lab/vzt',
    ]) expect(repoSlug(input)).toBe('davidbillera-lab/vzt')
  })

  it('returns null for anything it cannot confidently parse', () => {
    for (const bad of ['', '   ', 'not a url', 'https://github.com/onlyowner', null, undefined, 42, {}]) {
      expect(repoSlug(bad as any)).toBeNull()
    }
  })
})

describe('resolveCloneTarget — fails closed', () => {
  it('returns null when the allowlist is empty, even for a valid repo', () => {
    expect(resolveCloneTarget('https://github.com/davidbillera-lab/vzt', [])).toBeNull()
    expect(resolveCloneTarget('https://github.com/davidbillera-lab/vzt', undefined as any)).toBeNull()
  })

  it('returns null for a repo that is not on the allowlist', () => {
    expect(resolveCloneTarget('https://github.com/someone/else', LIST)).toBeNull()
  })

  it('returns null for a missing or unparseable repo_url', () => {
    expect(resolveCloneTarget(null as any, LIST)).toBeNull()
    expect(resolveCloneTarget('garbage', LIST)).toBeNull()
  })

  it('resolves an allowlisted repo to an https clone url', () => {
    expect(resolveCloneTarget('git@github.com:davidbillera-lab/vzt.git', LIST))
      .toEqual({ slug: 'davidbillera-lab/vzt', url: 'https://github.com/davidbillera-lab/vzt.git' })
  })

  it('matches case-insensitively but clones the allowlist spelling', () => {
    const t = resolveCloneTarget('https://github.com/DavidBillera-Lab/Personal-OS', LIST)
    expect(t?.slug).toBe('davidbillera-lab/personal-OS')
  })
})

describe('isCredentialPath', () => {
  // Every one of these was named in the CodexQC finding on e0afb33a as a file the
  // rejected inspector would have opened while claiming it never reads credentials.
  it('catches the filenames that finding called out', () => {
    for (const p of [
      '.env', '.env.local', '.env.production', 'app/.env.local',
      '.npmrc', '.pypirc', '.netrc', '_netrc',
      'id_rsa', 'id_ed25519', '.ssh/id_ecdsa', 'deploy/id_rsa.pub',
      'secrets.yml', 'secrets.yaml', 'config/secrets.json',
      'client_secret_1234.json', 'firebase-adminsdk-abc.json',
      'gcp-service-account.json', 'serviceaccount.json',
      'kubeconfig', 'clusters/prod.kubeconfig',
      'certs/server.pem', 'apple/AuthKey.p8', 'a.p12', 'b.pfx', 'c.key', 'd.jks',
      '.aws/credentials', '.docker/config.json', 'credentials',
    ]) expect(isCredentialPath(p), p).toBe(true)
  })

  it('KEEPS committed env templates — Codex flagged treating them as secrets as a false positive', () => {
    for (const p of ['.env.example', '.env.sample', '.env.template', 'docs/.env.example']) {
      expect(isCredentialPath(p), p).toBe(false)
    }
  })

  it('leaves ordinary source alone', () => {
    for (const p of ['src/index.ts', 'README.md', 'package.json', 'lib/keyboard.ts', 'src/monkey.js']) {
      expect(isCredentialPath(p), p).toBe(false)
    }
  })

  it('normalises windows separators', () => {
    expect(isCredentialPath('app\\.env.local')).toBe(true)
  })

  it('handles junk input without throwing', () => {
    for (const p of ['', null, undefined, 7, {}]) expect(isCredentialPath(p as any)).toBe(false)
  })
})

// ---- integration: the scrub must actually remove files from a real clone ----
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { provisionWorkspace } from '../scripts/lib/claude-executor-adapter.mjs'

const g = (cwd: string, args: string[]) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

describe('provisionWorkspace (integration)', () => {
  it('clones shallow, strips credential files, and keeps source + env templates', () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-clone-'))
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    g(source, ['init'])
    g(source, ['config', 'user.email', 't@t'])
    g(source, ['config', 'user.name', 't'])
    writeFileSync(join(source, 'index.js'), 'export const x = 1\n')
    writeFileSync(join(source, '.env.example'), 'API_KEY=replace-me\n')
    writeFileSync(join(source, '.env.local'), 'REAL_SECRET=hunter2\n')
    writeFileSync(join(source, 'secrets.yml'), 'token: abc\n')
    writeFileSync(join(source, 'id_rsa'), 'PRIVATE KEY\n')
    g(source, ['add', '-A'])
    g(source, ['commit', '-m', 'seed'])

    const ws = join(root, 'ws')
    // file:// on purpose: git silently ignores --depth for local-PATH clones (it hardlinks
    // the object store instead), so a path fixture would not exercise the shallow guarantee.
    const res = provisionWorkspace(ws, { slug: 'test/fixture', url: pathToFileURL(source).href })

    expect(res.cloned).toBe(true)
    expect(res.baseSha).toMatch(/^[0-9a-f]{40}$/)
    // secrets gone from the working tree the container will mount
    for (const f of ['.env.local', 'secrets.yml', 'id_rsa']) {
      expect(existsSync(join(ws, f)), `${f} should be scrubbed`).toBe(false)
    }
    // source and the intentionally-committed template survive
    expect(existsSync(join(ws, 'index.js'))).toBe(true)
    expect(existsSync(join(ws, '.env.example'))).toBe(true)
    expect(res.removed.sort()).toEqual(['.env.local', 'id_rsa', 'secrets.yml'])

    // THE ONE THAT MATTERS: a scrubbed secret must not be recoverable from git history.
    // Deleting the file and committing the deletion leaves the blob in .git/objects, and
    // `git show <base>:.env.local` returned the plaintext until the repo was re-initialised.
    const base = g(ws, ['rev-list', '--max-parents=0', 'HEAD']).stdout.trim().split('\n')[0]
    const leak = g(ws, ['show', `${base}:.env.local`])
    expect(leak.status, 'scrubbed secret is still readable from git history').not.toBe(0)
    expect(`${leak.stdout}${leak.stderr}`).not.toContain('hunter2')
    // and no dangling objects carry it either
    expect(g(ws, ['log', '--all', '--oneline']).stdout.trim().split('\n')).toHaveLength(1)

    rmSync(root, { recursive: true, force: true })
  })

  it('with no clone target it git-inits an empty repo, exactly as before', () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-init-'))
    const ws = join(root, 'ws')
    const res = provisionWorkspace(ws, null)
    expect(res).toEqual({ cloned: false, baseSha: null, removed: [] })
    expect(existsSync(join(ws, '.git'))).toBe(true)
    expect(g(ws, ['log', '--oneline']).status).not.toBe(0) // no commits
    rmSync(root, { recursive: true, force: true })
  })
})

describe('repoSlug — host must be GitHub when one is present', () => {
  it('rejects a non-GitHub host rather than silently cloning a same-named GitHub repo', () => {
    // resolveCloneTarget always clones from github.com. Accepting a gitlab/bitbucket
    // repo_url would resolve to an owner/repo that merely SHARES a name with the intended
    // project — a different repo entirely, and one anyone could register.
    expect(repoSlug('https://gitlab.com/davidbillera-lab/vzt')).toBeNull()
    expect(repoSlug('https://bitbucket.org/davidbillera-lab/vzt')).toBeNull()
    expect(repoSlug('git@gitlab.com:davidbillera-lab/vzt.git')).toBeNull()
    expect(resolveCloneTarget('https://gitlab.com/davidbillera-lab/vzt', LIST)).toBeNull()
  })

  it('still accepts github.com and a bare slug', () => {
    expect(repoSlug('https://github.com/davidbillera-lab/vzt')).toBe('davidbillera-lab/vzt')
    expect(repoSlug('https://www.github.com/davidbillera-lab/vzt')).toBe('davidbillera-lab/vzt')
    expect(repoSlug('git@github.com:davidbillera-lab/vzt.git')).toBe('davidbillera-lab/vzt')
    expect(repoSlug('davidbillera-lab/vzt')).toBe('davidbillera-lab/vzt')
  })
})
