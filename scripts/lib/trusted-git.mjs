// Trusted reads of untrusted build output (step 3 spike, piece 1).
//
// WHY THIS EXISTS
// After the sandbox exits, <workspace>/.git is HOSTILE INPUT. The box could write
// .git/config, and a `core.fsmonitor` or `diff.external` entry there runs a command on the
// host the next time host git touches that repo — with the dispatcher's credentials in its
// environment. So after the container starts, no host git/node process ever runs with its
// cwd or --git-dir inside the workspace. Instead:
//   - HEAD is read as plain text (readWorkspaceHead), and
//   - the object store is COPIED into a fresh host repo we initialised ourselves
//     (openTrusted). Only objects cross: never config, hooks, info/, packed-refs or
//     objects/info (no alternates are followed). Git objects are content-addressed data;
//     they cannot carry configuration.
// Every git call on the trusted repo also passes HARDEN flags as a second layer.

import { spawnSync } from 'child_process'
import {
  mkdtempSync, mkdirSync, lstatSync, readdirSync, copyFileSync, readFileSync, writeFileSync, rmSync,
} from 'fs'
import { join, resolve, relative, isAbsolute } from 'path'
import { tmpdir } from 'os'

// The container's limits stop applying once it exits, so the host enforces its own.
export const BUDGET = {
  objectsBytes: 200 * 1024 * 1024,
  objectsFiles: 50_000,
  checkoutBytes: 500 * 1024 * 1024,
  patchBytes: 5 * 1024 * 1024,
  gitTimeoutMs: 120_000,
}

export class OverBudgetError extends Error {
  constructor(what) { super(`output over budget: ${what}`); this.name = 'OverBudgetError' }
}

const SHA_RE = /^[0-9a-f]{40}$/
export const isSha = (s) => typeof s === 'string' && SHA_RE.test(s)

// ---- records kept BESIDE the workspace (outside the mount) ----
const base = (workspace) => resolve(workspace)
export const provisionRecordPath = (workspace) => `${base(workspace)}.provision.json`
export const qcRecordPath = (workspace) => `${base(workspace)}.qc.json`
export const qcReportDir = (workspace) => `${base(workspace)}.qc`

export function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2))
}

// ---- hardened git ----
// An empty hooks dir, created once per process outside any workspace.
let emptyHooks = null
function emptyHooksDir() {
  if (!emptyHooks) emptyHooks = mkdtempSync(join(tmpdir(), 'mc-nohooks-'))
  return emptyHooks
}

function hardenFlags() {
  return [
    '-c', 'core.fsmonitor=',
    '-c', `core.hooksPath=${emptyHooksDir()}`,
    '-c', 'gc.auto=0', // the copied objects are unreferenced; never let auto-gc prune them
    '-c', 'core.longpaths=true',
    '-c', 'advice.detachedHead=false',
  ]
}

// Diff options, not global ones. Every `diff` / `log -p` on build output passes these.
export const SAFE_DIFF = ['--no-ext-diff', '--no-textconv', '--no-renames']

/**
 * Run git in `dir` with the hardening flags, a timeout and an output cap.
 * Returns stdout (string, or Buffer when encoding === 'buffer'). Throws on any failure.
 */
export function hardGit(dir, args, { timeoutMs = BUDGET.gitTimeoutMs, maxBuffer = 64 * 1024 * 1024, encoding = 'utf8', input } = {}) {
  const r = spawnSync('git', [...hardenFlags(), '-C', dir, ...args], {
    encoding, timeout: timeoutMs, maxBuffer, windowsHide: true, input,
  })
  if (r.error?.code === 'ENOBUFS') throw new OverBudgetError(`git ${args[0]} output over ${maxBuffer} bytes`)
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`git ${args[0]} timed out after ${timeoutMs}ms`)
  if (r.error) throw new Error(`git ${args[0]} failed: ${r.error.code || r.error.message}`)
  if (r.status !== 0) {
    const err = Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : (r.stderr || '')
    throw new Error(`git ${args.join(' ').slice(0, 120)} failed (${r.status}): ${err.trim().slice(0, 300)}`)
  }
  return encoding === 'buffer' ? r.stdout : (r.stdout || '').trim()
}

// ---- plain-text reads inside the workspace ----
// lstat every component from `root` down, so no symlink/junction anywhere on the path is
// followed. Returns the absolute path of a regular file, or null when the leaf is absent.
function regularFileUnder(root, rel) {
  const parts = rel.split('/').filter(Boolean)
  let p = root
  for (let i = 0; i < parts.length; i++) {
    p = join(p, parts[i])
    let st
    try { st = lstatSync(p) } catch (e) {
      if (e.code === 'ENOENT' && i === parts.length - 1) return null
      throw new Error(`workspace path ${rel} unreadable: ${e.code || e.message}`)
    }
    if (st.isSymbolicLink()) throw new Error(`refusing symlink in workspace .git: ${rel}`)
    if (i < parts.length - 1 && !st.isDirectory()) throw new Error(`workspace path ${rel} is not a directory chain`)
    if (i === parts.length - 1 && !st.isFile()) throw new Error(`workspace path ${rel} is not a regular file`)
  }
  return p
}

function gitDirOf(workspace) {
  const gitDir = join(resolve(workspace), '.git')
  let st
  try { st = lstatSync(gitDir) } catch { throw new Error('workspace has no .git directory') }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('workspace .git is not a plain directory')
  return gitDir
}

/**
 * Resolve the workspace HEAD as text, never through git. Returns the 40-hex SHA, or null
 * when HEAD names a branch with no commit yet (nothing was built). Anything else throws:
 * packed refs are deliberately NOT consulted, so a build that packs its refs fails closed.
 */
export function readWorkspaceHead(workspace) {
  const gitDir = gitDirOf(workspace)
  const headPath = regularFileUnder(gitDir, 'HEAD')
  if (!headPath) throw new Error('workspace .git/HEAD missing')
  const head = readFileSync(headPath, 'utf8').trim()
  if (isSha(head)) return head
  const m = head.match(/^ref: (refs\/heads\/[A-Za-z0-9._\/-]+)$/)
  if (!m || m[1].split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new Error('workspace HEAD is neither a SHA nor a plain branch ref')
  }
  const refPath = regularFileUnder(gitDir, m[1])
  if (!refPath) return null
  const sha = readFileSync(refPath, 'utf8').trim()
  if (!isSha(sha)) throw new Error(`workspace ref ${m[1]} does not hold a 40-hex SHA`)
  return sha
}

// Copy <src> (objects/) into <dst>, regular files only, under budget.
function copyObjects(src, dst, budget) {
  let files = 0
  let bytes = 0
  const walk = (from, to, depth) => {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) {
      if (depth === 0 && name === 'info') continue // no alternates, no commit-graph
      const f = join(from, name)
      const st = lstatSync(f)
      if (st.isDirectory()) { walk(f, join(to, name), depth + 1); continue }
      if (!st.isFile()) throw new Error(`refusing non-regular file in workspace objects: ${relative(src, f)}`)
      files += 1
      bytes += st.size
      if (files > budget.objectsFiles) throw new OverBudgetError(`more than ${budget.objectsFiles} object files`)
      if (bytes > budget.objectsBytes) throw new OverBudgetError(`objects over ${budget.objectsBytes} bytes`)
      copyFileSync(f, join(to, name))
    }
  }
  walk(src, dst, 0)
}

function isInside(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Open the workspace's build output through a fresh host repo. The caller MUST close().
 * Returns { dir, git, hasCommit, isAncestor, diff, changes, log, checkout, close }.
 */
export function openTrusted(workspace, { budget = BUDGET } = {}) {
  const gitDir = gitDirOf(workspace)
  const objects = join(gitDir, 'objects')
  const ost = lstatSync(objects)
  if (ost.isSymbolicLink() || !ost.isDirectory()) throw new Error('workspace .git/objects is not a plain directory')

  const tmp = mkdtempSync(join(tmpdir(), 'mc-trusted-'))
  if (isInside(tmp, resolve(workspace))) throw new Error('trusted dir resolved inside the workspace')
  const dir = join(tmp, 'wt')
  const close = () => rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
  try {
    mkdirSync(dir)
    hardGit(dir, ['init', '-q'])
    copyObjects(objects, join(dir, '.git', 'objects'), budget)
  } catch (e) { close(); throw e }

  const git = (args, opts) => hardGit(dir, args, opts)
  const t = {
    dir,
    git,
    close,
    hasCommit(sha) {
      if (!isSha(sha)) return false
      try { git(['cat-file', '-e', `${sha}^{commit}`]); return true } catch { return false }
    },
    isAncestor(a, b) {
      const r = spawnSync('git', [...hardenFlags(), '-C', dir, 'merge-base', '--is-ancestor', a, b], {
        encoding: 'utf8', timeout: budget.gitTimeoutMs, windowsHide: true,
      })
      if (r.status === 0) return true
      if (r.status === 1) return false
      throw new Error(`git merge-base failed: ${(r.stderr || r.error?.message || '').trim().slice(0, 200)}`)
    },
    // The patch, as raw bytes (text files need not be UTF-8).
    diff(from, to) {
      return git(['diff', '--binary', ...SAFE_DIFF, '--src-prefix=a/', '--dst-prefix=b/', from, to],
        { encoding: 'buffer', maxBuffer: budget.patchBytes })
    },
    // [{ path, newMode }] for every path the range touches (renames split into delete + add).
    changes(from, to) {
      const out = git(['diff', '--raw', '-z', ...SAFE_DIFF, from, to])
      const toks = out.split('\0').filter((s) => s !== '')
      const res = []
      for (let i = 0; i + 1 < toks.length; i += 2) {
        const meta = toks[i].split(' ') // :oldmode newmode oldsha newsha status
        res.push({ path: toks[i + 1], newMode: meta[1] })
      }
      return res
    },
    // One line per commit reachable from `to`, newest first (same shape as before).
    log(to) {
      return git(['log', '--oneline', '--no-decorate', to]).split('\n').filter(Boolean)
    },
    // Check `sha` out into the trusted worktree (on a branch), within the checkout budget.
    checkout(sha) {
      const tree = git(['ls-tree', '-r', '-l', '-z', sha])
      let bytes = 0
      for (const entry of tree.split('\0')) {
        const size = Number(entry.split(/\s+/)[3])
        if (Number.isFinite(size)) bytes += size
        if (bytes > budget.checkoutBytes) throw new OverBudgetError(`checkout over ${budget.checkoutBytes} bytes`)
      }
      git(['checkout', '-q', '-f', '-B', 'qc', sha])
      return dir
    },
  }
  return t
}
