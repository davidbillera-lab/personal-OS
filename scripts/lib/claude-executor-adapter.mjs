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
import { join } from 'path'
import { homedir } from 'os'

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
// Provisions an isolated push-denied workspace, stamps trust, injects OPENAI_API_KEY,
// unsets CLAUDECODE, and runs headless Claude with a hard timeout. The workspace's
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

export const claudeExecutorAdapter = {
  name: 'claude',
  async launch({ workspace, request, env, timeoutMs, skipPermissions }) {
    // 1. Provision isolated, push-denied workspace.
    gitInitRepo(workspace)
    mkdirSync(join(workspace, '.claude'), { recursive: true })
    writeFileSync(join(workspace, '.claude', 'settings.json'), JSON.stringify(WORKSPACE_SETTINGS, null, 2))

    // 2. Stamp trust so headless Claude doesn't block on the trust dialog.
    stampTrust(workspace)

    // 3. Minimal env — the executor is treated as untrusted. Pass only what claude + CodexQC
    // need; NEVER the dispatcher's secrets (service-role key, GitHub/Telegram/MCP keys).
    // If the rig's `claude` auth needs an env var (it authed via subscription in Phase 0, so
    // likely not), add it to ALLOWED_ENV.
    const ALLOWED_ENV = ['PATH','Path','SystemRoot','windir','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','HOMEDRIVE','HOMEPATH','LANG','LC_ALL','NUMBER_OF_PROCESSORS','OS','PATHEXT','COMSPEC']
    const childEnv = {}
    for (const k of ALLOWED_ENV) if (process.env[k] !== undefined) childEnv[k] = process.env[k]
    if (process.env.OPENAI_API_KEY) childEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY
    // CLAUDECODE deliberately omitted (recursion guard must stay unset).

    // 4. Launch headless Claude with a hard timeout. Deny-list blocks push regardless.
    const task = request?.request_text || request?.title || 'the requested build'
    const shortMsg = (request?.title || task).slice(0, 60)
    const prompt = [
      'Build this in the current empty git repo, then self-review and commit.',
      `Task: ${task}.`,
      'Steps: (1) implement it as minimal working files;',
      '(2) `git add -A`;',
      '(3) run `node ~/.claude/skills/CodexQC/codex-qc.mjs --staged` and read the verdict;',
      '(4) apply any Blocking/Should-fix items it raises;',
      '(5) `git add -A` again;',
      `(6) \`git commit -m "${shortMsg}"\`;`,
      '(7) print the final CodexQC verdict word (SHIP/FIX-FIRST/RECONSIDER) ALONE on the LAST line.',
      'DO NOT run git push or gh — you cannot, and must not try.',
    ].join(' ')

    // Default relies on the trust-stamp so the workspace deny-list is ENFORCED.
    // --dangerously-skip-permissions is an opt-in escape hatch that NULLIFIES the
    // deny-list — enable only if headless trust-only doesn't run, and treat as a
    // documented risk.
    const cliArgs = ['-p', prompt, '--output-format', 'text']
    if (skipPermissions) cliArgs.push('--dangerously-skip-permissions')

    const r = spawnSync(
      'claude',
      cliArgs,
      { cwd: workspace, env: childEnv, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' },
    )
    if (r.error && r.error.code === 'ETIMEDOUT') {
      throw new Error(`executor timed out after ${timeoutMs}ms`)
    }
    if (r.status !== 0) {
      throw new Error(`executor exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`)
    }

    // 5. Harvest the reviewed commit.
    const output = r.stdout || ''
    const qcVerdict = parseVerdict(output)
    let reviewedSha
    try { reviewedSha = git(workspace, ['rev-parse', 'HEAD']) } catch { reviewedSha = null }
    if (!reviewedSha) throw new Error('no commit produced by executor')
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
