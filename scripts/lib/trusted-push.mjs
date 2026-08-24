// The credentialed push must not run inside the repository the sandbox just wrote.
//
// WHY THIS EXISTS: gatedPush() proved WHAT to push (the literal approved sha) but still ran
// `git -C <builder workspace> push <github url>` — inside a working tree whose entire .git
// directory the untrusted build controls. Everything git consults on a push comes from there:
//
//   .git/hooks/pre-push          → arbitrary code, running as the dispatcher, with the push
//                                  credential live in the ambient environment
//   core.hooksPath               → the same, from a directory the deny-list never watched
//   include.path / includeIf     → pulls all of the above in from a file that is not .git/config
//   url.<evil>.insteadOf         → silently rewrites the github.com target to the attacker's
//   url.<evil>.pushInsteadOf       host, so the credential is presented TO the attacker
//   remote.<name>.pushurl        → same redirect by another name
//   credential.helper            → hands the token to an attacker-supplied program
//
// Both were confirmed to fire against the pre-fix code path. Neutralising them key-by-key
// means enumerating every config knob git will ever honour and re-auditing on every git
// release. So don't neutralise — don't read it at all.
//
// THE DESIGN: build a throwaway repository under the host's temp dir, owned entirely by this
// process, containing exactly one thing the builder contributed — the object store, reachable
// read-only through objects/info/alternates. Objects are content-addressed, so the approved
// sha names exactly the commit the operator reviewed and nothing else can be substituted for
// it. No builder config is on the lookup path, no builder hooks directory exists, and the
// push runs from a repo whose only refs are the ones we just wrote.
//
// The workspace's own HEAD still has to be checked for drift, and that check must not become
// the hole the push no longer is: resolveWorkspaceHead() reads HEAD, the loose ref and
// packed-refs as plain files. No git process is ever started inside the builder workspace.

import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'

const SHA_RE = /^[0-9a-f]{40}$/

// Environment variables are the second way to reach git's configuration without touching a
// config file: GIT_CONFIG_COUNT/KEY/VALUE inject arbitrary settings, GIT_DIR and
// GIT_OBJECT_DIRECTORY relocate the repository out from under us, GIT_SSH_COMMAND and
// GIT_PROXY_COMMAND and GIT_ASKPASS all name programs git will execute. Rather than list the
// dangerous ones, drop the whole GIT_ namespace and put back only what this process chose.
export function sanitizeGitEnv(env = process.env) {
  const out = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (/^GIT_/i.test(key)) continue
    // Not GIT_-prefixed, but git and ssh both honour them to run a program for credentials.
    if (/^SSH_ASKPASS(_REQUIRE)?$/i.test(key)) continue
    out[key] = value
  }
  // A push that cannot authenticate must fail, not sit forever on a prompt no one will answer.
  out.GIT_TERMINAL_PROMPT = '0'
  return out
}

// Every git invocation on the push path goes through here: sanitized environment, no shell,
// throws on a nonzero exit. `cwd` is always a directory THIS module created.
export function runGit(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: sanitizeGitEnv() })
  if (r.error) throw new Error(`git ${args[0]} could not start: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${r.status}): ${(r.stderr || r.stdout || '').trim()}`)
  return (r.stdout || '').trim()
}

// The builder's object store, resolved through symlinks and required to still be inside the
// bound workspace. A `.git` (or `.git/objects`) symlinked at some other repository on the rig
// would otherwise let a row rewrite feed the push objects it never built.
export function workspaceObjectStore(workspaceRef) {
  let workspace
  try { workspace = realpathSync(resolve(workspaceRef)) }
  catch (e) { throw new Error(`workspace is not readable: ${e.message}`) }
  const nominal = join(workspace, '.git', 'objects')
  if (!existsSync(nominal)) throw new Error(`no git object store at ${nominal}`)
  const objects = realpathSync(nominal)
  if (objects !== nominal && !objects.startsWith(workspace + sep)) {
    throw new Error(`object store escapes the workspace (${nominal} → ${objects})`)
  }
  return objects
}

// HEAD, resolved by reading files. Deliberately NOT `git rev-parse`: that would start a git
// process inside the untrusted repository, which is the thing this module exists to avoid.
// Throws rather than guessing — an unresolvable HEAD is a gate failure, never a pass.
export function resolveWorkspaceHead(workspaceRef) {
  const gitDir = join(resolve(workspaceRef), '.git')
  const headFile = join(gitDir, 'HEAD')
  if (!existsSync(headFile)) throw new Error(`no HEAD in ${gitDir}`)
  const head = readFileSync(headFile, 'utf8').trim()
  if (SHA_RE.test(head)) return head // detached HEAD

  const m = /^ref:\s*(\S+)$/.exec(head)
  if (!m) throw new Error(`HEAD is neither a sha nor a symref`)
  const ref = m[1]
  // The ref name becomes path segments, so it is validated before any path is built from it.
  const segments = ref.split('/')
  if (segments[0] !== 'refs' || segments.length < 2 ||
      segments.some((s) => s === '' || s === '.' || s === '..' || !/^[A-Za-z0-9._-]+$/.test(s))) {
    throw new Error(`refusing to resolve an unsafe ref name: ${ref}`)
  }

  const loose = join(gitDir, ...segments)
  if (existsSync(loose)) {
    const value = readFileSync(loose, 'utf8').trim()
    if (!SHA_RE.test(value)) throw new Error(`ref ${ref} does not hold a sha`)
    return value
  }

  const packed = join(gitDir, 'packed-refs')
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      if (!line || line.startsWith('#') || line.startsWith('^')) continue
      const [sha, name] = line.trim().split(/\s+/)
      if (name === ref && SHA_RE.test(sha)) return sha
    }
  }
  throw new Error(`ref ${ref} is unresolved (no loose ref, not in packed-refs)`)
}

// A fresh repository the builder has never written to. `--template` points at an empty
// directory so git installs no hooks at all (not even the inert .sample set), and
// core.hooksPath is additionally pinned at an empty directory on every command below, so a
// hook has neither a place to live nor a path to be found on.
export function createTrustedPushRepo(workspaceRef, { git = runGit } = {}) {
  const objects = workspaceObjectStore(workspaceRef)
  // mkdtemp: a fresh, unpredictable name created by this process, so nothing can be
  // pre-planted at the path the push is about to run from.
  const root = mkdtempSync(join(tmpdir(), 'mc-trusted-push-'))
  try {
    const template = join(root, 'template')
    const hooks = join(root, 'nohooks')
    const repo = join(root, 'repo')
    for (const d of [template, hooks, repo]) mkdirSync(d)
    git(root, ['init', '--quiet', `--template=${template}`, repo])
    // Belt and braces: if a host init.templateDir did materialise one anyway, it goes now.
    rmSync(join(repo, '.git', 'hooks'), { recursive: true, force: true })
    const info = join(repo, '.git', 'objects', 'info')
    mkdirSync(info, { recursive: true })
    writeFileSync(join(info, 'alternates'), `${objects}\n`, 'utf8')
    return { root, repo, hooks, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  } catch (e) {
    rmSync(root, { recursive: true, force: true })
    throw e
  }
}

// Push exactly `sha` to exactly `ref` on exactly `remote`, from a repository the builder has
// never touched. Returns the trusted repo path that was used (for logging).
export function trustedPush({ workspaceRef, sha, remote, ref, git = runGit }) {
  if (!SHA_RE.test(sha ?? '')) throw new Error(`refusing to push a source that is not a literal sha: ${sha}`)
  if (!/^refs\/heads\/[A-Za-z0-9._-]+$/.test(ref ?? '')) throw new Error(`refusing an unexpected destination ref: ${ref}`)
  if (typeof remote !== 'string' || remote === '') throw new Error('no push remote')

  const trusted = createTrustedPushRepo(workspaceRef, { git })
  const harden = ['-c', `core.hooksPath=${trusted.hooks}`]
  try {
    // The approved commit must be present and actually be a commit before anything is sent.
    git(trusted.repo, [...harden, 'cat-file', '-e', `${sha}^{commit}`])
    git(trusted.repo, [...harden, 'push', remote, `${sha}:${ref}`])
    return trusted.repo
  } finally {
    trusted.cleanup()
  }
}
