// Executor adapters for the autonomous dispatcher (Piece 4, Claude-only v0).
//
// Stable interface — every adapter satisfies:
//   launch({ workspace, request, env, timeoutMs }) -> { reviewedSha, qcVerdict, commits }
// The dispatcher never knows which worker ran; future hermes/kimi/codex/docker
// adapters slot in here with ZERO dispatcher changes. That seam is the whole point.
//
// Two adapters ship in v0:
//   - claudeExecutorAdapter : the real headless-Claude build (NOT run in the mock
//     verification session; that is the operator's rig DoD run).
//   - mockExecutorAdapter    : deterministic, no Claude/no secrets — used to prove
//     every dispatcher safety path (claim, gate, recovery) with a local bare remote.

import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

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
function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').trim()}`)
  }
  return (r.stdout || '').trim()
}

function gitInitRepo(workspace) {
  mkdirSync(workspace, { recursive: true })
  const r = spawnSync('git', ['-C', workspace, 'init'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git init failed: ${(r.stderr || '').trim()}`)
  // Local identity so commits work even on a machine with no global git config.
  git(workspace, ['config', 'user.email', 'dispatcher@local'])
  git(workspace, ['config', 'user.name', 'MC Dispatcher'])
  // Windows: nested per-request/per-attempt UUID dirs can exceed MAX_PATH (260).
  git(workspace, ['config', 'core.longpaths', 'true'])
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
    const reviewedSha = git(workspace, ['rev-parse', 'HEAD'])
    return { reviewedSha, qcVerdict: 'SHIP', commits: ['mock build'] }
  },
}

// ---- real adapter ----
// Provisions an isolated push-denied workspace, stamps trust, unsets CLAUDECODE, and runs
// headless Claude with a hard timeout. The executor child holds ZERO secrets (C6-P1) — QC
// runs host-side, after the child exits, on the diff the child committed. The workspace's
// .claude/settings.json denies git push / gh / curl / rm — the build loop STRUCTURALLY
// cannot push. Only the dispatcher (this adapter's caller) ever pushes, post-approval.
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

// Review exactly the diff `sha` introduced. Fresh build workspaces usually have a single
// commit (no parent), so fall back to the empty tree — `git diff <empty-tree> HEAD` is the
// whole build. Never throws: a missing key or a QC failure returns UNKNOWN, not a dead build.
export function runHostQc({ workspace, sha, timeoutMs = 300000 }) {
  const script = codexQcPath()
  if (!script) return { verdict: 'UNKNOWN', output: 'host QC skipped: codex-qc.mjs not found' }

  let base
  try { base = git(workspace, ['rev-parse', '--verify', '--quiet', `${sha}^`]) } catch { base = EMPTY_TREE }

  // HOST env on purpose — this is where the OpenAI key legitimately lives.
  const r = spawnSync('node', [script, '--base', base], {
    cwd: workspace, env: process.env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
  })
  const output = `${r.stdout || ''}\n${r.stderr || ''}`.trim()
  if (r.error || r.status !== 0) {
    const why = r.error ? (r.error.code || r.error.message) : `exit ${r.status}`
    console.log(`[host-qc] unavailable (${why}): ${output.slice(0, 300)}`)
    return { verdict: 'UNKNOWN', output }
  }
  // Prefer the report's explicit verdict line; a bare keyword anywhere in the prose is a
  // false-RECONSIDER risk, and RECONSIDER fails the build.
  const explicit = output.match(/\*\*Verdict:\*\*\s*(SHIP|FIX-FIRST|RECONSIDER)/)
  return { verdict: explicit ? explicit[1] : parseVerdict(output), output }
}

export const claudeExecutorAdapter = {
  name: 'claude',
  async launch({ workspace, request, env, timeoutMs, skipPermissions }) {
    // 1. Provision isolated, push-denied workspace.
    gitInitRepo(workspace)
    mkdirSync(join(workspace, '.claude'), { recursive: true })
    writeFileSync(join(workspace, '.claude', 'settings.json'), JSON.stringify(WORKSPACE_SETTINGS, null, 2))

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
    const task = request?.request_text || request?.title || 'the requested build'
    const shortMsg = (request?.title || task).slice(0, 60)
    const prompt = [
      'Build this in the current empty git repo, then commit it.',
      `Task: ${task}.`,
      'Steps: (1) implement it as minimal working files;',
      '(2) `git add -A`;',
      `(3) \`git commit -m "${shortMsg}"\`.`,
      'Stay inside this workspace — do not read or write files outside it.',
      'DO NOT run git push or gh — you cannot, and must not try.',
    ].join(' ')

    // Default relies on the trust-stamp so the workspace deny-list is ENFORCED.
    // --dangerously-skip-permissions is an opt-in escape hatch that NULLIFIES the
    // deny-list — enable only if headless trust-only doesn't run, and treat as a
    // documented risk.
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

    // 5. Harvest the committed SHA, then QC it host-side (child has exited).
    let reviewedSha
    try { reviewedSha = git(workspace, ['rev-parse', 'HEAD']) } catch { reviewedSha = null }
    if (!reviewedSha) throw new Error('no commit produced by executor')
    const { verdict: qcVerdict } = runHostQc({ workspace, sha: reviewedSha })
    if (qcVerdict === 'RECONSIDER') throw new Error('CodexQC verdict RECONSIDER — build not approvable')
    const commits = git(workspace, ['log', '--oneline']).split('\n').filter(Boolean)
    return { reviewedSha, qcVerdict, commits }
  },
}

export function pickAdapter(name) {
  if (name === 'mock') return mockExecutorAdapter
  if (name === 'claude') return claudeExecutorAdapter
  throw new Error(`Unknown DISPATCHER_EXECUTOR '${name}' — must be 'claude' or 'mock'`)
}
