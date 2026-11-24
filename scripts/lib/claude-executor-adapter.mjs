// Executor adapters for the autonomous dispatcher (Piece 4, Claude-only v0).
//
// Stable interface — every adapter satisfies:
//   launch({ workspace, request, env, timeoutMs }) -> { reviewedSha, qcVerdict, commits }
// The dispatcher never knows which worker ran; future hermes/kimi/codex/docker
// adapters slot in here with ZERO dispatcher changes. That seam is the whole point.
//
// Three adapters:
//   - dockerClaudeExecutorAdapter : THE PRODUCTION PATH (C6). Headless Claude inside a
//     throwaway container on an --internal network with an allowlisting egress proxy.
//   - claudeExecutorAdapter  : legacy host path. UNSANDBOXED — fallback only, see below.
//   - mockExecutorAdapter    : deterministic, no Claude/no secrets — used to prove
//     every dispatcher safety path (claim, gate, recovery) with a local bare remote.

import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, lstatSync, appendFileSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { isCredentialPath } from './clone-target.mjs'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { sanitizeForMC } from './sanitize-result.mjs'
import {
  readWorkspaceHead, openTrusted, provisionRecordPath, qcRecordPath, qcReportDir, writeJson, BUDGET,
} from './trusted-git.mjs'

// ---- resolve the real claude binary ----
// On Windows, `claude` on PATH is an npm shim (claude.cmd/.ps1) that Node's spawnSync
// cannot launch without shell:true. shell:true would mangle the -p prompt arg, so
// instead we resolve the shim's location and spawn the real native binary directly.
export function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const r = spawnSync(whichCmd, ['claude'], { encoding: 'utf8' })
  const shimPath = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  if (shimPath) {
    const shimDir = dirname(shimPath)
    const candidate = join(shimDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
    if (existsSync(candidate)) return candidate
  }
  return 'claude'
}

// ---- git helpers (throw on nonzero) ----
// PRE-CONTAINER ONLY. This runs git with the repo's own config, which is trusted only
// until the box can write it. Everything after the container starts goes through
// trusted-git.mjs instead.
function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: BUDGET.gitTimeoutMs })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').trim()}`)
  }
  return (r.stdout || '').trim()
}

function gitIdentity(workspace) {
  // Local identity so commits work even on a machine with no global git config.
  git(workspace, ['config', 'user.email', 'dispatcher@local'])
  git(workspace, ['config', 'user.name', 'MC Dispatcher'])
  // Windows: nested per-request/per-attempt UUID dirs can exceed MAX_PATH (260).
  git(workspace, ['config', 'core.longpaths', 'true'])
}

function gitInitRepo(workspace) {
  mkdirSync(workspace, { recursive: true })
  const r = spawnSync('git', ['-C', workspace, 'init'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git init failed: ${(r.stderr || '').trim()}`)
  gitIdentity(workspace)
}

// Remove credential-shaped files from a freshly cloned tree BEFORE the container starts.
// Returns the list of removed repo-relative paths (logged, never their contents).
// Uses git's own file list so it only ever considers tracked files. This runs on the host's
// own fresh clone, before the box exists, so git here is trusted.
//
// FAILS CLOSED: a listing failure or a removal failure throws, which fails the build before
// the container starts. `-z` output is parsed raw (the git() helper trims, and non-z output
// C-quotes non-ASCII names, which the old split silently missed). Absence is then confirmed
// on the FILESYSTEM — ls-files would still list a deleted file until the index changes.
//
// unlinkSync, not rmSync: on Node 24 / Windows, rmSync({ force: true }) silently no-ops on
// non-ASCII paths (no error, file stays). Found by this very check on 2026-11-23.
const unlinkIfPresent = (p) => {
  try { unlinkSync(p) } catch (e) { if (e.code !== 'ENOENT') throw e }
}
export function scrubClonedCredentials(workspace, { remove = unlinkIfPresent } = {}) {
  const r = spawnSync('git', ['-C', workspace, 'ls-files', '-z'], {
    encoding: 'utf8', timeout: BUDGET.gitTimeoutMs, maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error || r.status !== 0) {
    throw new Error(`credential scrub: git ls-files failed (${r.error?.code || `exit ${r.status}`})`)
  }
  const flagged = (r.stdout || '').split('\0').filter((p) => p !== '' && isCredentialPath(p))
  for (const rel of flagged) {
    try { remove(resolve(workspace, rel)) } catch (e) {
      throw new Error(`credential scrub: could not remove a flagged file (${e.code || e.message})`)
    }
  }
  for (const rel of flagged) {
    let present = true
    try { lstatSync(resolve(workspace, rel)) } catch (e) {
      if (e.code === 'ENOENT') present = false
      else throw new Error(`credential scrub: could not confirm removal (${e.code || e.message})`)
    }
    if (present) throw new Error('credential scrub: a flagged file is still present after removal')
  }
  return flagged
}

// Provision the build workspace. With no clone target this is exactly the old
// gitInitRepo() — an empty repo, byte-for-byte the prior behaviour. With one, the HOST
// clones shallow + single-branch (no history in the box), scrubs credential files, and
// commits the scrub so the build starts from a clean, reviewable base.
// Either way it writes <workspace>.provision.json BESIDE the workspace (only the workspace is
// mounted, so the box can't touch it). Origin and base come only from this record later.
// Returns { cloned, baseSha, removed } (+ originSha when cloned).
export function provisionWorkspace(workspace, cloneTarget, { requestId = null } = {}) {
  if (!cloneTarget) {
    gitInitRepo(workspace)
    writeJson(provisionRecordPath(workspace), { requestId, slug: null, originSha: null, baseSha: null })
    return { cloned: false, baseSha: null, removed: [] }
  }

  mkdirSync(dirname(workspace), { recursive: true })
  const r = spawnSync('git', ['clone', '--depth', '1', '--single-branch', cloneTarget.url, workspace], {
    encoding: 'utf8', timeout: 300000,
  })
  if (r.status !== 0) throw new Error(`git clone ${cloneTarget.slug} failed: ${(r.stderr || '').trim().slice(0, 300)}`)
  gitIdentity(workspace)

  const originSha = git(workspace, ['rev-parse', 'HEAD'])
  const removed = scrubClonedCredentials(workspace)

  // HISTORY IS DISCARDED, and this is load-bearing — not tidiness.
  // Deleting the files and committing the deletion is NOT enough: --depth 1 still ships the
  // base commit's trees and blobs in .git/objects, so a build could read every "scrubbed"
  // secret straight back out with `git show <base>:.env.local`. Verified: that command
  // returned the plaintext before this was added. Re-initialising the repo is what actually
  // removes the blobs, rather than just removing the paths that point at them.
  //
  // Nothing of value is lost — --depth 1 means there was only ever one commit of history.
  // The new initial commit becomes the recorded QC base (baseSha), so QC reviews the whole
  // build from exactly the pre-build tree, however many commits it makes.
  rmSync(join(workspace, '.git'), { recursive: true, force: true })
  // rmSync can no-op silently (see scrub note); a surviving .git would keep the old blobs.
  if (existsSync(join(workspace, '.git'))) throw new Error('could not discard clone history: .git survived removal')
  const r2 = spawnSync('git', ['-C', workspace, 'init'], { encoding: 'utf8' })
  if (r2.status !== 0) throw new Error(`git init after scrub failed: ${(r2.stderr || '').trim()}`)
  gitIdentity(workspace)
  git(workspace, ['add', '-A'])
  git(workspace, ['commit', '-m', `base: ${cloneTarget.slug} @ ${originSha.slice(0, 12)} (${removed.length} credential file(s) stripped)`])

  const baseSha = git(workspace, ['rev-parse', 'HEAD'])
  writeJson(provisionRecordPath(workspace), { requestId, slug: cloneTarget.slug, originSha, baseSha })
  return { cloned: true, baseSha, originSha, removed }
}

// Inject the executor's permission policy, and keep it OUT of the change: `.claude/` goes in
// .git/info/exclude first, so the builder's instructed `git add -A` never stages it. A build
// that force-adds it anyway is off-task, and build-to-pr refuses that change. Pre-container.
// If the source repo TRACKS .claude/settings.json, exclude has no effect on it, so it is also
// marked skip-worktree: `git add -A` then never stages the overwrite.
export function injectExecutorSettings(workspace) {
  const info = join(workspace, '.git', 'info')
  mkdirSync(info, { recursive: true })
  appendFileSync(join(info, 'exclude'), '\n.claude/\n')
  if (git(workspace, ['ls-files', '--', '.claude/settings.json'])) {
    git(workspace, ['update-index', '--skip-worktree', '--', '.claude/settings.json'])
  }
  mkdirSync(join(workspace, '.claude'), { recursive: true })
  writeFileSync(join(workspace, '.claude', 'settings.json'), JSON.stringify(WORKSPACE_SETTINGS, null, 2))
}

// ---- mock adapter ----
// mkdir + git init + one real commit → returns the real SHA. Fast + deterministic.
export const mockExecutorAdapter = {
  name: 'mock',
  async launch({ workspace }) {
    gitInitRepo(workspace)
    writeFileSync(join(workspace, 'BUILD.txt'), `mock build ${new Date().toISOString()}\n`)
    git(workspace, ['add', '-A'])
    git(workspace, ['commit', '-m', 'mock build'])
    const reviewedSha = readWorkspaceHead(workspace)
    return { reviewedSha, qcVerdict: 'SHIP', commits: ['mock build'] }
  },
}

// ---- workspace permission policy (both real adapters) ----
// Written into <workspace>/.claude/settings.json. The deny-list is the INNER layer of
// defense in depth: the build loop cannot push, cannot shell out to gh/curl, cannot rm.
// Verified enforced in-container on 2026-08-05 (C6-P4): a build told to run `rm victim.txt`
// reported "permission to run it was denied" and the file survived on the host mount.
// Enforcement depends on running WITHOUT --dangerously-skip-permissions — see skipPermissions.
//
// It is a layer, not the guarantee. The guarantee is the container + egress allowlist
// (docker adapter). On the host adapter there is no outer layer at all.
const WORKSPACE_SETTINGS = {
  permissions: {
    allow: [
      'Read', 'Write', 'Edit',
      'Bash(node:*)', 'Bash(npm:*)',
      'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git diff:*)',
      'Bash(git log:*)', 'Bash(git status:*)',
      'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)', 'Bash(echo:*)',
    ],
    deny: ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(curl:*)', 'Bash(rm:*)'],
  },
}

function stampTrust(absWorkspace) {
  const cfgPath = join(homedir(), '.claude.json')
  let cfg = {}
  if (existsSync(cfgPath)) {
    try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch { cfg = {} }
  }
  cfg.projects = cfg.projects || {}
  cfg.projects[absWorkspace] = { ...(cfg.projects[absWorkspace] || {}), hasTrustDialogAccepted: true }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
}

function parseVerdict(output) {
  const lines = (output || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const lastLine = lines.length ? lines[lines.length - 1] : ''
  const lastLineMatch = lastLine.match(/\b(SHIP|FIX-FIRST|RECONSIDER)\b/)
  if (lastLineMatch) return lastLineMatch[1]
  const anyMatch = (output || '').match(/\b(SHIP|FIX-FIRST|RECONSIDER)\b/g)
  return anyMatch && anyMatch.length ? anyMatch[anyMatch.length - 1] : 'UNKNOWN'
}

// ---- host-side QC (C6-P1) ----
// CodexQC used to run INSIDE the sandbox, which is why the OpenAI key was injected there.
// It now runs here, on the host, AFTER the untrusted child has exited — that key never
// enters childEnv. Report-only: the commit is reviewed, not auto-repaired.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

function codexQcPath() {
  const p = process.env.CODEX_QC_SCRIPT || join(homedir(), '.claude', 'skills', 'CodexQC', 'codex-qc.mjs')
  return existsSync(p) ? p : null
}

const listMd = (dir) => {
  try { return readdirSync(dir).filter((f) => f.endsWith('.md')) } catch { return [] }
}

// Review the WHOLE build: from the recorded base to `sha`, which is exactly the range
// build-to-pr exports. Empty-init builds have no base, so the empty tree stands in and
// `git diff <empty-tree> <sha>` is the whole build.
//
// QC never runs in the workspace (its .git is hostile). It runs in a checkout of `sha` made
// from the trusted repo, in a host temp dir. Before that dir is removed, the report and a
// verdict record are written BESIDE the workspace: <workspace>.qc/<sha>.md and
// <workspace>.qc.json. That record is the only place build-to-pr reads the verdict from.
//
// Never throws on a QC failure: a missing key or a QC crash records UNKNOWN, not a dead build.
export function runHostQc({ workspace, sha, baseSha = null, requestId = null, trusted, timeoutMs = 300000, script = codexQcPath() }) {
  const qcBase = baseSha || EMPTY_TREE
  const cwd = trusted.checkout(sha)
  const reportsDir = join(cwd, '.codex-qc')
  // A build can commit its own .codex-qc/*.md. Only files QC creates in THIS run count.
  const before = new Set(listMd(reportsDir))

  let verdict = 'UNKNOWN'
  let output
  if (!script) {
    output = 'host QC skipped: codex-qc.mjs not found'
  } else {
    // HOST env on purpose — this is where the OpenAI key legitimately lives.
    const r = spawnSync('node', [script, '--base', qcBase], {
      cwd, env: process.env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    })
    output = `${r.stdout || ''}\n${r.stderr || ''}`.trim()
    if (r.error || r.status !== 0) {
      const why = r.error ? (r.error.code || r.error.message) : `exit ${r.status}`
      // QC output is model-authored text — sanitize before it lands in the pm2 log (C6-P5).
      console.log(`[host-qc] unavailable (${why}): ${sanitizeForMC(output, { maxLen: 300 })}`)
    } else {
      // Prefer the report's explicit verdict line; a bare keyword anywhere in the prose is a
      // false-RECONSIDER risk, and RECONSIDER fails the build.
      const explicit = output.match(/\*\*Verdict:\*\*\s*(SHIP|FIX-FIRST|RECONSIDER)/)
      verdict = explicit ? explicit[1] : parseVerdict(output)
    }
  }

  // Durable record, written before the trusted checkout is cleaned up.
  const outDir = qcReportDir(workspace)
  mkdirSync(outDir, { recursive: true })
  const reportPath = join(outDir, `${sha}.md`)
  const fresh = listMd(reportsDir).filter((f) => !before.has(f))
    .map((f) => join(reportsDir, f))
    .filter((p) => lstatSync(p).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  // minimal: no report file → keep QC's stdout as the report, so the record always has evidence.
  if (fresh.length) copyFileSync(fresh[0], reportPath)
  else writeFileSync(reportPath, output || '')
  writeJson(qcRecordPath(workspace), { requestId, baseSha, sha, verdict, reportPath })
  return { verdict, output, reportPath }
}

// Docker adapter's teardown proof. Only a "no such container" answer counts as gone; a
// daemon error, a timeout, or a container that still exists all throw.
export function confirmContainerGone(containerName, dockerFn = docker) {
  const r = dockerFn(['inspect', containerName], { timeout: 30000 })
  if (r?.error) throw new Error(`teardown unconfirmed: docker inspect failed (${r.error.code || r.error.message})`)
  if (r?.status === 0) throw new Error(`teardown unconfirmed: container ${containerName} still exists`)
  if (!/no such (object|container)/i.test(`${r?.stderr || ''}${r?.stdout || ''}`)) {
    throw new Error(`teardown unconfirmed: unexpected docker inspect result (exit ${r?.status})`)
  }
}

// The post-build sequence, shared by both real adapters. Each step fails closed, in order:
//   1. confirm the writer is gone   2. read HEAD as text, open the trusted repo
//   3. no-op check                  4. QC from the recorded base   5. list commits
// Nothing here runs git or node with its cwd in the workspace.
export function finishBuild({
  workspace, requestId = null, baseSha = null, confirmWriterGone,
  readHead = readWorkspaceHead, open = openTrusted, runQc = runHostQc,
}) {
  if (typeof confirmWriterGone !== 'function') throw new Error('finishBuild: confirmWriterGone is required')
  confirmWriterGone()
  const reviewedSha = readHead(workspace)
  if (!reviewedSha) throw new Error('no commit produced by executor')
  if (baseSha && reviewedSha === baseSha) throw new Error('no change produced')
  const trusted = open(workspace)
  try {
    if (!trusted.hasCommit(reviewedSha)) throw new Error('workspace HEAD names a commit that is not in its object store')
    const { verdict: qcVerdict } = runQc({ workspace, sha: reviewedSha, baseSha, requestId, trusted })
    if (qcVerdict === 'RECONSIDER') throw new Error('CodexQC verdict RECONSIDER — build not approvable')
    const commits = trusted.log(reviewedSha)
    return { reviewedSha, qcVerdict, commits }
  } finally {
    trusted.close()
  }
}

// Gap B (second-half relay): a Hermes-deposited plan (mc_requests.plan) is the full
// build spec — prefer it over the one-line voice ask it was deposited against. Falls
// back to request_text/title when no plan was submitted (e.g. legacy/manual requests).
export function buildTaskSpec(request) {
  const plan = typeof request?.plan === 'string' ? request.plan.trim() : ''
  if (plan) return plan
  return request?.request_text || request?.title || 'the requested build'
}

// Shared by both real adapters — the sandbox prompt is identical whether the child
// runs on the host or in a container. Implement → git add -A → git commit. No QC
// (that is host-side, post-exit) and no push (structurally impossible).
// `cloned` must reflect the ACTUAL workspace state. Telling a build the repo is empty when
// it is not (or vice versa) is the failure mode that produced e0afb33a: a request to analyse
// existing code, run against an empty workspace, which could only ever come back "not present".
export function buildPrompt(request, { cloned = false } = {}) {
  const task = buildTaskSpec(request)
  const shortMsg = (request?.title || task).slice(0, 60)
  const opening = cloned
    ? 'This git repo already contains the real project source, checked out at a detached HEAD. Read it before changing anything, make the smallest change that does the job, then commit.'
    : 'Build this in the current empty git repo, then commit it.'
  const steps = cloned
    ? 'Steps: (1) read the existing code first; (2) make the minimal change; (3) `git add -A`;'
    : 'Steps: (1) implement it as minimal working files; (2) `git add -A`;'
  return [
    opening,
    `Task: ${task}.`,
    steps,
    `then \`git commit -m "${shortMsg}"\` as a SINGLE commit (host-side review covers everything since the starting commit).`,
    'Stay inside this workspace — do not read or write files outside it.',
    'DO NOT run git push or gh — you cannot, and must not try.',
  ].join(' ')
}

// ---- legacy host adapter (LEGACY / FALLBACK ONLY — NOT the production path) ----
// This runs the untrusted build directly ON THE HOST. There is NO sandbox: no container,
// no egress allowlist, no filesystem boundary beyond the prompt asking nicely. The only
// real controls are the workspace deny-list and the stripped childEnv — a build that
// escapes either has the operator's whole machine and network.
//
// Kept because it is the only thing that still works if Docker Desktop is down. It is NOT
// the supported production configuration: DISPATCHER_EXECUTOR=docker is. If you switch to
// this, you have consciously turned the sandbox off — treat every build as if it were
// running in your own shell, because it is.
export const claudeExecutorAdapter = {
  name: 'claude',
  async launch({ workspace, request, env, timeoutMs, skipPermissions, cloneTarget = null }) {
    // No sandbox here, so a real repo must never come this way. Refuse before provisioning.
    if (cloneTarget) throw new Error('host executor refuses clone targets: real repos build only in the docker sandbox')

    // 1. Provision isolated, push-denied workspace (an empty repo).
    const { baseSha } = provisionWorkspace(workspace, null, { requestId: request?.id ?? null })
    injectExecutorSettings(workspace)

    // 2. Stamp trust so headless Claude doesn't block on the trust dialog.
    stampTrust(workspace)

    // 3. Minimal env — the executor is treated as untrusted and holds ZERO secrets.
    // Only OS plumbing claude itself needs; NEVER any key (service-role, GitHub/Telegram/MCP,
    // OpenAI). Nothing in this env is exfiltratable because nothing in it is sensitive.
    // If the rig's `claude` auth needs an env var (it authed via subscription in Phase 0, so
    // likely not), add it to ALLOWED_ENV — and re-audit this comment if it is a secret.
    const ALLOWED_ENV = ['PATH','Path','SystemRoot','windir','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','LANG','LC_ALL','NUMBER_OF_PROCESSORS','OS','PATHEXT','COMSPEC']
    const childEnv = {}
    for (const k of ALLOWED_ENV) if (process.env[k] !== undefined) childEnv[k] = process.env[k]
    // CLAUDECODE deliberately omitted (recursion guard must stay unset).

    // 4. Launch headless Claude with a hard timeout. Deny-list blocks push regardless.
    const prompt = buildPrompt(request, { cloned: false })

    // skipPermissions defaults OFF and must stay off here. On the host path the
    // deny-list + stripped env are the ONLY controls that exist; turning permissions
    // off leaves an unsandboxed agent with nothing between it and the machine.
    const cliArgs = ['-p', prompt, '--output-format', 'text']
    if (skipPermissions) cliArgs.push('--dangerously-skip-permissions')

    const claudeBin = resolveClaudeBin()
    const r = spawnSync(
      claudeBin,
      cliArgs,
      { cwd: workspace, env: childEnv, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' },
    )
    if (r.error && r.error.code === 'ETIMEDOUT') {
      throw new Error(`executor timed out after ${timeoutMs}ms`)
    }
    if (r.error) {
      throw new Error(`executor spawn failed: ${r.error.code || r.error.message}`)
    }
    if (r.status !== 0) {
      throw new Error(`executor exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`)
    }

    // 5. Harvest + QC host-side. spawnSync returned, so the child has exited.
    return finishBuild({ workspace, requestId: request?.id ?? null, baseSha, confirmWriterGone: () => {} })
  },
}

// ---- docker adapter (C6-P2) ----
// Same contract as claudeExecutorAdapter, but the untrusted child runs inside a
// throwaway container instead of on the host. THIS IS THE PRODUCTION PATH
// (DISPATCHER_EXECUTOR=docker). The container is the boundary: only the workspace
// is mounted (rw), auth is one read-only credential file, and NO host env crosses
// in. Host-side we still do git init, the deny-list (a real inner layer as of
// C6-P4 — permissions run enforced), SHA harvest and CodexQC — all after the
// container is gone.
//
// Egress (C6-P3): the container joins EXECUTOR_NET only, which is a Docker
// `--internal` network — no route to the internet AT ALL. The single reachable
// host on it is the allowlisting forward proxy, so the proxy is not a policy the
// build can opt out of, it is the only wire that exists. The allowlist itself
// lives in ONE file: docker/executor-proxy/allowlist.txt.
const DOCKER_BIN = () => process.env.DOCKER_BIN || 'docker'
const EXECUTOR_IMAGE = () => process.env.EXECUTOR_IMAGE || 'mc-executor:latest'
const CONTAINER_WORKSPACE = '/workspace'
const CONTAINER_CREDS = '/home/builder/.claude/.credentials.json'

// Sandbox egress topology — shared with scripts/executor-net.mjs (single source).
export const EXECUTOR_NET = 'mc-executor-net'
export const EXECUTOR_EGRESS_NET = 'mc-executor-egress'
export const EXECUTOR_NET_SUBNET = '172.31.250.0/24'
export const EXECUTOR_PROXY_CONTAINER = 'mc-executor-proxy'
export const EXECUTOR_PROXY_IMAGE = 'mc-executor-proxy:latest'
export const EXECUTOR_PROXY_URL = `http://${EXECUTOR_PROXY_CONTAINER}:8888`
const NET_SETUP_CMD = 'npm run executor:net'

// Docker Desktop on Windows takes native `C:\path` sources; a POSIX-ified
// `/c/path` is not a real path inside the WSL2 VM. resolve() gives us exactly
// the drive-letter form the auth spike proved, on either platform.
export function toDockerMountPath(p) {
  return resolve(p)
}

export function dockerSpawnOptions(opts = {}) {
  return { encoding: 'utf8', windowsHide: true, ...opts }
}

function docker(args, opts = {}) {
  return spawnSync(DOCKER_BIN(), args, dockerSpawnOptions(opts))
}

// Fail loud and actionable BEFORE we spin a build: a missing daemon or image is
// an operator problem, not a build failure.
function preflight() {
  const v = docker(['version', '--format', '{{.Server.Version}}'])
  if (v.error || v.status !== 0) {
    throw new Error(
      `docker executor unavailable: cannot reach the Docker daemon (${v.error?.code || `exit ${v.status}`}). ` +
      'Start Docker Desktop. This is a stop condition: do not switch executors to get around it.',
    )
  }
  const image = EXECUTOR_IMAGE()
  const i = docker(['image', 'inspect', image])
  if (i.status !== 0) {
    throw new Error(`docker executor image '${image}' not found — build it with: npm run executor:image`)
  }
  const creds = join(homedir(), '.claude', '.credentials.json')
  if (!existsSync(creds)) {
    throw new Error(`docker executor: no Claude credentials at ${creds} — run \`claude\` once on the host to authenticate.`)
  }

  // --- egress boundary (C6-P3): every check FAILS CLOSED. There is deliberately
  // no fallback to default-bridge networking; an unverifiable boundary is a
  // no-build, never an open-network build.
  const net = docker(['network', 'inspect', EXECUTOR_NET, '--format', '{{.Internal}}'])
  if (net.status !== 0) {
    throw new Error(`docker executor: egress network '${EXECUTOR_NET}' missing — create it with: ${NET_SETUP_CMD}`)
  }
  if ((net.stdout || '').trim() !== 'true') {
    throw new Error(
      `docker executor: network '${EXECUTOR_NET}' is NOT --internal, so the sandbox would have open egress. ` +
      `Refusing to run. Fix with: npm run executor:net:down && ${NET_SETUP_CMD}`,
    )
  }
  const proxy = docker(['inspect', '-f', '{{.State.Running}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}', EXECUTOR_PROXY_CONTAINER])
  if (proxy.status !== 0) {
    throw new Error(`docker executor: proxy container '${EXECUTOR_PROXY_CONTAINER}' missing — start it with: ${NET_SETUP_CMD}`)
  }
  const [running, attached = ''] = (proxy.stdout || '').trim().split('|')
  if (running !== 'true') {
    throw new Error(`docker executor: proxy container '${EXECUTOR_PROXY_CONTAINER}' is not running — start it with: ${NET_SETUP_CMD}`)
  }
  if (!attached.split(/\s+/).includes(EXECUTOR_NET)) {
    throw new Error(
      `docker executor: proxy '${EXECUTOR_PROXY_CONTAINER}' is not attached to '${EXECUTOR_NET}' — ` +
      `the sandbox would have no egress at all. Fix with: ${NET_SETUP_CMD}`,
    )
  }
  return { image, creds }
}

// Polling the request queue every five seconds must not also hammer Docker Desktop with
// three CLI probes every five seconds. Cache the complete preflight result briefly; launch()
// still runs a fresh preflight immediately before creating a container, so this changes
// idle health-check load without weakening the build-time safety boundary.
export function createCachedHealthChecker(probe, { ttlMs = 60_000, now = Date.now } = {}) {
  let cached = null
  let checkedAt = -Infinity
  return () => {
    const current = now()
    if (cached && current - checkedAt < ttlMs) return cached
    try {
      probe()
      cached = { ok: true, reason: null }
    } catch (e) {
      cached = { ok: false, reason: e.message }
    }
    checkedAt = current
    return cached
  }
}

const cachedDockerHealth = createCachedHealthChecker(preflight)

export function buildDockerArgs({ workspace, creds, image, containerName, prompt, skipPermissions }) {
  const args = [
    'run', '--rm',
    '--name', containerName,
    // Hardening: no capabilities, no privilege escalation, bounded resources.
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--memory=${process.env.EXECUTOR_MEMORY || '4g'}`,
    `--cpus=${process.env.EXECUTOR_CPUS || '2'}`,
    `--pids-limit=${process.env.EXECUTOR_PIDS_LIMIT || '512'}`,
    // Only the build workspace is writable. Auth is read-only, single file.
    '-v', `${toDockerMountPath(workspace)}:${CONTAINER_WORKSPACE}`,
    '-v', `${toDockerMountPath(creds)}:${CONTAINER_CREDS}:ro`,
    '-w', CONTAINER_WORKSPACE,
    // Egress: an --internal network, so there is no route off this box except
    // through the allowlisting proxy. The proxy vars below are a convenience for
    // well-behaved clients (claude, npm) — NOT the control. A build that strips
    // them just gets no network at all.
    '--network', EXECUTOR_NET,
    '-e', `HTTPS_PROXY=${EXECUTOR_PROXY_URL}`,
    '-e', `https_proxy=${EXECUTOR_PROXY_URL}`,
    '-e', `HTTP_PROXY=${EXECUTOR_PROXY_URL}`,
    '-e', `http_proxy=${EXECUTOR_PROXY_URL}`,
    '-e', 'NO_PROXY=localhost,127.0.0.1',
    '-e', 'no_proxy=localhost,127.0.0.1',
    // Still NO host env crosses the boundary — the six vars above are values we
    // author here, not values read from process.env. CLAUDECODE stays unset.
    image,
    'claude', '-p', prompt, '--output-format', 'text',
  ]
  // Escape hatch, and it should stay unused. C6-P4 proved headless `claude -p` runs to
  // completion in this image WITHOUT it (the image pre-seeds onboarding + /workspace
  // trust), so leaving it off costs nothing and keeps the deny-list live behind the
  // container boundary. ecosystem.config.cjs ships DISPATCHER_SKIP_PERMISSIONS='0'.
  if (skipPermissions) args.push('--dangerously-skip-permissions')
  return args
}

export const dockerClaudeExecutorAdapter = {
  name: 'docker',
  // Non-throwing preflight, so the dispatcher can check the sandbox BEFORE claiming work
  // instead of discovering it mid-build. On 2026-08-11 Docker Desktop was down for hours:
  // the dispatcher was online, Realtime subscribed, everything looked healthy, and every
  // build would have failed one at a time with a "too big / errored" alert that pointed the
  // operator at the wrong problem. Cheap (three local docker inspects) and read-only.
  health() {
    return cachedDockerHealth()
  },
  async launch({ workspace, request, env, timeoutMs, skipPermissions, cloneTarget = null }) {
    const { image, creds } = preflight()

    // 1. Provision the workspace host-side (the container only ever sees the mount).
    // The HOST clones — the container never receives a git credential, so the zero-secrets
    // childEnv invariant is unchanged. See lib/clone-target.mjs for the security shape.
    const requestId = request?.id ?? null
    const { cloned, removed, baseSha } = provisionWorkspace(workspace, cloneTarget, { requestId })
    if (cloned) console.log(`[executor] cloned ${cloneTarget.slug} (scrubbed ${removed.length} credential file(s))`)
    injectExecutorSettings(workspace)
    // No stampTrust(): that mutates the HOST ~/.claude.json. The image pre-seeds
    // onboarding + /workspace trust instead, so the host config is never touched.

    const containerName = `mc-executor-${randomUUID().slice(0, 12)}`
    const args = buildDockerArgs({
      workspace, creds, image, containerName,
      prompt: buildPrompt(request, { cloned }),
      skipPermissions,
    })

    let r
    try {
      r = docker(args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 })
    } finally {
      // Killing the docker CLI does NOT kill the container. Always reap by name so
      // a timeout can never leave an orphan holding the workspace or a credential.
      docker(['rm', '-f', containerName], { timeout: 30000 })
    }
    if (r.error && r.error.code === 'ETIMEDOUT') {
      throw new Error(`executor container timed out after ${timeoutMs}ms (killed ${containerName})`)
    }
    if (r.error) throw new Error(`docker run failed: ${r.error.code || r.error.message}`)
    if (r.status !== 0) {
      throw new Error(`executor container exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`)
    }

    // 2. Prove the container is gone, then harvest + QC host-side through the trusted repo.
    return finishBuild({ workspace, requestId, baseSha, confirmWriterGone: () => confirmContainerGone(containerName) })
  },
}

export function pickAdapter(name) {
  if (name === 'mock') return mockExecutorAdapter
  if (name === 'claude') return claudeExecutorAdapter
  if (name === 'docker') return dockerClaudeExecutorAdapter
  throw new Error(`Unknown DISPATCHER_EXECUTOR '${name}' — must be 'docker', 'claude' or 'mock'`)
}
