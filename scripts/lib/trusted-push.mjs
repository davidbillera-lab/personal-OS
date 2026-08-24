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
// process, containing exactly the objects the builder actually wrote — copied in, one
// validated file at a time, never chained in through objects/info/alternates. Alternates were
// tried first and rejected: git follows an object store's alternates chain recursively, so
// pointing the trusted repo at the builder's store would also silently follow any alternates
// file the builder planted INSIDE that store, pulling in objects from a second, unreviewed
// repository the sandbox never built and workspaceObjectStore() never bound. Copying means the
// builder's own objects/info is never opened at all — only physically-present loose objects
// and pack/idx files, name- and type-checked, make it into the trusted repo. Objects are
// content-addressed, so the approved sha names exactly the commit the operator reviewed and
// nothing else can be substituted for it. No builder config is on the lookup path, no builder
// hooks directory exists, and the push runs from a repo whose only refs are the ones we just
// wrote.
//
// The workspace's own HEAD still has to be checked for drift, and that check must not become
// the hole the push no longer is: resolveWorkspaceHead() reads HEAD, the loose ref and
// packed-refs as plain files. No git process is ever started inside the builder workspace.

import { spawnSync } from 'child_process'
import {
  mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, realpathSync, readdirSync,
  lstatSync, copyFileSync,
} from 'fs'
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

// A loose object shard directory (`objects/<xx>/`) and the sha-1 (38 hex) or sha-256 (62 hex)
// remainder git names the file after inside it.
const LOOSE_DIR_RE = /^[0-9a-f]{2}$/
const LOOSE_FILE_RE = /^(?:[0-9a-f]{38}|[0-9a-f]{62})$/
// Normal Git maintenance may emit sidecars alongside .pack/.idx. Accept only documented,
// hash-bound pack names; unknown files still fail closed.
const PACK_FILE_RE = /^pack-[0-9a-f]{40,64}\.(?:pack|idx|rev|bitmap|mtimes|promisor|keep)$/i
// Generous but finite: real build objects are source files and packs, not multi-gigabyte
// blobs. Caps exist so a planted object can't be used to exhaust disk on the host running the
// dispatcher; they are not tuned to a specific attack, just to "this cannot be legitimate".
const MAX_LOOSE_OBJECT_BYTES = 200 * 1024 * 1024
const MAX_PACK_BYTES = 2 * 1024 * 1024 * 1024
const MAX_PACK_SIDECAR_BYTES = 200 * 1024 * 1024
const MAX_PACK_MARKER_BYTES = 1024 * 1024

function maxPackEntryBytes(name) {
  if (/\.pack$/i.test(name)) return MAX_PACK_BYTES
  if (/\.(?:keep|promisor)$/i.test(name)) return MAX_PACK_MARKER_BYTES
  return MAX_PACK_SIDECAR_BYTES
}

// Copy one object-store file after checking, with `lstat` (never `stat`), that what's on disk
// is actually a regular file of a sane size. `lstat` is required here specifically: `stat`
// follows symlinks/junctions and would happily report a redirect target as "a regular file",
// which is exactly the escape this function exists to close.
function copyValidatedObjectFile(srcPath, destPath, label, maxBytes) {
  const st = lstatSync(srcPath)
  if (!st.isFile()) throw new Error(`refusing non-regular-file object store entry: ${label}`)
  if (st.size > maxBytes) throw new Error(`refusing oversized object store entry: ${label} (${st.size} bytes)`)
  copyFileSync(srcPath, destPath)
}

// Populate a fresh repo's object store from the builder's, without ever reading the builder's
// objects/info — that directory is where alternates (and commit-graph pointers) live, and
// alternates chain recursively, so reading it is exactly how a nested, builder-planted pointer
// to a second repository would get followed. Every other entry is name- and type-checked
// before being copied; anything that doesn't look like a loose object or a pack/idx file fails
// closed rather than being silently skipped.
export function importTrustedObjects(sourceObjects, destObjects) {
  for (const top of readdirSync(sourceObjects)) {
    if (top === 'info') continue // never opened — see the module header.

    const topPath = join(sourceObjects, top)
    const topStat = lstatSync(topPath) // lstat: a symlinked/junctioned `pack` or `xx` dir must not pass as real.

    if (top === 'pack') {
      if (!topStat.isDirectory()) throw new Error('objects/pack is not a directory')
      const destDir = join(destObjects, 'pack')
      mkdirSync(destDir, { recursive: true })
      for (const name of readdirSync(topPath)) {
        if (!PACK_FILE_RE.test(name)) throw new Error(`unexpected entry in objects/pack: ${name}`)
        copyValidatedObjectFile(
          join(topPath, name), join(destDir, name), `pack/${name}`, maxPackEntryBytes(name),
        )
      }
      continue
    }

    if (LOOSE_DIR_RE.test(top)) {
      if (!topStat.isDirectory()) throw new Error(`objects/${top} is not a directory`)
      const destDir = join(destObjects, top)
      mkdirSync(destDir, { recursive: true })
      for (const name of readdirSync(topPath)) {
        if (!LOOSE_FILE_RE.test(name)) throw new Error(`unexpected entry in objects/${top}: ${name}`)
        copyValidatedObjectFile(join(topPath, name), join(destDir, name), `${top}/${name}`, MAX_LOOSE_OBJECT_BYTES)
      }
      continue
    }

    // Not `info`, not `pack`, not a two-hex-digit shard: a real git object store never has
    // this entry. Could be a decoy, a traversal attempt, or just corruption — refuse either way.
    throw new Error(`unexpected top-level object store entry: ${top}`)
  }
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
    importTrustedObjects(objects, join(repo, '.git', 'objects'))
    return { root, repo, hooks, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  } catch (e) {
    rmSync(root, { recursive: true, force: true })
    throw e
  }
}

// A remote string is not just an address to git — two syntaxes turn it into a program to run.
// `<transport>::<address>` invokes `git-remote-<transport>` directly (this is how
// `ext::sh -c '...'` runs an arbitrary shell command), and any `<scheme>://` git doesn't
// implement natively triggers the same PATH lookup for `git-remote-<scheme>`. A leading `-`
// is the separate, older class of bug where the "remote" is parsed as a command-line option
// instead. None of this is reachable today — SANDBOX_REMOTE is an operator env var, never
// builder input — but trustedPush is the credentialed choke point, so it validates its own
// argument rather than trusting every caller to have done so.
const REMOTE_SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//
const ALLOWED_REMOTE_SCHEMES = new Set(['https', 'ssh', 'git'])

export function assertSafeRemote(remote) {
  if (typeof remote !== 'string' || remote === '') throw new Error('no push remote')
  if (remote.includes('::')) throw new Error(`refusing a remote-helper transport: ${remote}`)
  if (remote.startsWith('-')) throw new Error(`refusing a remote that looks like an option: ${remote}`)
  const scheme = REMOTE_SCHEME_RE.exec(remote)
  if (scheme && !ALLOWED_REMOTE_SCHEMES.has(scheme[1].toLowerCase())) {
    throw new Error(`refusing an unrecognised remote scheme: ${scheme[1]}`)
  }
  return remote
}

// Stage 1 of the credentialed push, split out so a caller can run the authoritative consent
// re-read AFTER this and still have the network push be the very next thing that happens.
// Everything that touches disk and can take real time on a large build lives here: mkdtemp,
// git init, copying every object, and the cat-file check that the approved sha is actually
// present and a commit. None of it spends the push credential, so re-checking consent right
// after this returns cannot race it. The handle is bound to the exact sha/ref validated here
// — pushTrustedRepo() below takes them from the handle, never a fresh argument, so stage 2
// can never be pointed at a different commit than the one cat-file just confirmed.
export function prepareTrustedPush({ workspaceRef, sha, ref, git = runGit }) {
  if (!SHA_RE.test(sha ?? '')) throw new Error(`refusing to push a source that is not a literal sha: ${sha}`)
  if (!/^refs\/heads\/[A-Za-z0-9._-]+$/.test(ref ?? '')) throw new Error(`refusing an unexpected destination ref: ${ref}`)

  const trusted = createTrustedPushRepo(workspaceRef, { git })
  const harden = ['-c', `core.hooksPath=${trusted.hooks}`]
  try {
    // The approved commit must be present and actually be a commit before anything is sent.
    git(trusted.repo, [...harden, 'cat-file', '-e', `${sha}^{commit}`])
  } catch (e) {
    trusted.cleanup()
    throw e
  }
  return { repo: trusted.repo, hooks: trusted.hooks, sha, ref, cleanup: trusted.cleanup }
}

// Stage 2: the credentialed network push, and nothing else. Takes the handle prepareTrustedPush()
// returned — sha and ref come from it, not from `opts` — so this can only ever push what was
// already validated. The caller owns the handle's lifetime and must call `prepared.cleanup()`
// exactly once, whatever the outcome.
export function pushTrustedRepo(prepared, { remote, git = runGit }) {
  assertSafeRemote(remote)
  const harden = ['-c', `core.hooksPath=${prepared.hooks}`]
  git(prepared.repo, [...harden, 'push', remote, `${prepared.sha}:${prepared.ref}`])
  return prepared.repo
}

// Push exactly `sha` to exactly `ref` on exactly `remote`, from a repository the builder has
// never touched. Returns the trusted repo path that was used (for logging). A convenience
// wrapper over the two stages above for callers that want it done atomically with no consent
// re-check in between — gatedPush() in dispatcher.mjs calls the two stages directly instead,
// so it can re-check consent between preparing and pushing.
export function trustedPush({ workspaceRef, sha, remote, ref, git = runGit }) {
  if (!SHA_RE.test(sha ?? '')) throw new Error(`refusing to push a source that is not a literal sha: ${sha}`)
  if (!/^refs\/heads\/[A-Za-z0-9._-]+$/.test(ref ?? '')) throw new Error(`refusing an unexpected destination ref: ${ref}`)
  assertSafeRemote(remote)

  const prepared = prepareTrustedPush({ workspaceRef, sha, ref, git })
  try {
    return pushTrustedRepo(prepared, { remote, git })
  } finally {
    prepared.cleanup()
  }
}
