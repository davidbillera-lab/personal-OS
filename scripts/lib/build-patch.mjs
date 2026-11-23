// Carry a reviewed sandbox build across to the real repo as a patch (step 3 spike, piece 2).
//
// The sandbox workspace shares no history with the real repo (provisionWorkspace re-inits
// .git to drop scrubbed blobs), so GitHub cannot open a PR from it. Instead, on the HOST:
// bind to the provision record and the QC record (both outside the mount), export exactly
// the range QC reviewed through the trusted reader, refuse anything off-policy, and rebuild
// the change on a fresh clone of the real repo from the recorded origin SHA.
//
// Nothing here ever enters the box. Push and PR use the operator's own git/gh login.

import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { cloneAllowlist, isCredentialPath } from './clone-target.mjs'
import {
  readWorkspaceHead, openTrusted, hardGit, isSha, provisionRecordPath, qcRecordPath, SAFE_DIFF, BUDGET,
} from './trusted-git.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VERDICTS = new Set(['SHIP', 'FIX-FIRST']) // allowlist: anything else is refused

export const githubCloneUrl = (slug) => `https://github.com/${slug}.git`

// ---- argument validation (pure) ----
export function validateArgs({ workspace, sha, repo, request, allow }, allowlist = cloneAllowlist()) {
  if (typeof workspace !== 'string' || !workspace) throw new Error('--workspace is required')
  if (!isSha(sha)) throw new Error('--sha must be 40 lowercase hex characters')
  if (typeof request !== 'string' || !UUID_RE.test(request)) throw new Error('--request must be a UUID')
  const slug = (allowlist || []).find((a) => typeof repo === 'string' && a.toLowerCase() === repo.toLowerCase())
  if (!slug) throw new Error(`--repo ${repo} is not on the clone allowlist (DISPATCHER_CLONEABLE_REPOS)`)
  if (!Array.isArray(allow) || allow.length === 0 || allow.some((a) => typeof a !== 'string' || !a)) {
    throw new Error('at least one --allow glob is required')
  }
  return { workspace: resolve(workspace), sha, slug, requestId: request.toLowerCase(), allow }
}

// ---- path policy (pure) ----
// `*` and `?` stay inside one path segment; `**` crosses segments.
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const REFUSED_DIRS = new Set(['.claude', '.github'])
const REFUSED_NAMES = new Set([
  'vercel.json', '.gitleaks.toml', 'package.json', 'claude.md', 'agents.md',
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'deno.lock',
])

/** Refused whatever --allow says. Returns the reason, or null. Any depth, case-insensitive. */
export function alwaysRefused(path) {
  const p = path.replace(/\\/g, '/')
  if (isCredentialPath(p)) return 'credential path'
  const segs = p.toLowerCase().split('/')
  if (segs.slice(0, -1).some((s) => REFUSED_DIRS.has(s))) return 'protected directory'
  if (REFUSED_NAMES.has(segs[segs.length - 1])) return 'protected file'
  return null
}

/**
 * Check every changed path. `changes` is [{ path, newMode }].
 * Returns the list of refusals; empty means the change is in policy.
 */
export function pathPolicy(changes, allowGlobs) {
  const allow = allowGlobs.map(globToRegExp)
  const refused = []
  for (const { path, newMode } of changes) {
    const why = alwaysRefused(path)
      || (newMode === '120000' ? 'symlink' : null)
      || (newMode === '160000' ? 'submodule' : null)
      || (allow.some((re) => re.test(path)) ? null : 'matches no --allow glob')
    if (why) refused.push({ path, reason: why })
  }
  return refused
}

// ---- records (pure parsers) ----
function readJson(path, what) {
  let text
  try { text = readFileSync(path, 'utf8') } catch { throw new Error(`${what} missing: ${path}`) }
  try { return JSON.parse(text) } catch { throw new Error(`${what} is not valid JSON`) }
}

export function checkProvisionRecord(rec, { requestId, slug }) {
  if (!rec || typeof rec !== 'object') throw new Error('provision record malformed')
  if (rec.requestId !== requestId) throw new Error('provision record is for a different request')
  if (typeof rec.slug !== 'string' || rec.slug.toLowerCase() !== slug.toLowerCase()) {
    throw new Error('provision record is for a different repo (or was not a clone)')
  }
  if (!isSha(rec.originSha)) throw new Error('provision record has no full origin SHA')
  if (!isSha(rec.baseSha)) throw new Error('provision record has no base SHA')
  return rec
}

export function checkQcRecord(rec, { requestId, baseSha, sha }) {
  if (!rec || typeof rec !== 'object') throw new Error('QC record malformed')
  if (typeof rec.requestId !== 'string' || !UUID_RE.test(rec.requestId)) throw new Error('QC record requestId is not a UUID')
  if (!isSha(rec.baseSha) || !isSha(rec.sha)) throw new Error('QC record SHAs are not 40 hex')
  if (!VERDICTS.has(rec.verdict)) throw new Error(`QC verdict ${JSON.stringify(rec.verdict)} is not SHIP or FIX-FIRST`)
  if (rec.requestId.toLowerCase() !== requestId) throw new Error('QC record is for a different request')
  if (rec.sha !== sha) throw new Error('QC record reviewed a different SHA')
  if (rec.baseSha !== baseSha) throw new Error('QC record reviewed from a different base')
  return rec
}

// ---- the export ----
/**
 * Dry run by default: returns { branch, diff, paths, verdict } and pushes nothing.
 * With push: true, also pushes the branch and opens a draft PR; returns { ..., prUrl }.
 * `cloneUrlFor` is the test seam; the CLI always passes githubCloneUrl.
 */
export function exportBuild({
  workspace, sha, repo, request, allow, push = false,
  cloneUrlFor, allowlist = cloneAllowlist(), budget = BUDGET,
}) {
  if (typeof cloneUrlFor !== 'function') throw new Error('exportBuild: cloneUrlFor is required')
  const args = validateArgs({ workspace, sha, repo, request, allow }, allowlist)
  const ws = args.workspace

  // 2. Bind to the provision record. Origin and base come only from here.
  const prov = checkProvisionRecord(readJson(provisionRecordPath(ws), 'provision record'), args)

  // 3. Bind to what QC reviewed.
  const head = readWorkspaceHead(ws)
  if (head !== args.sha) throw new Error(`workspace HEAD ${head} is not the reviewed SHA ${args.sha}`)
  const qc = checkQcRecord(readJson(qcRecordPath(ws), 'QC record'), { requestId: args.requestId, baseSha: prov.baseSha, sha: args.sha })

  const temps = []
  const trusted = openTrusted(ws, { budget })
  try {
    if (!trusted.hasCommit(prov.baseSha)) throw new Error('recorded base commit is missing from the build output')
    if (!trusted.isAncestor(prov.baseSha, args.sha)) throw new Error('reviewed SHA does not descend from the recorded base')

    // 4. The patch: exactly the range QC reviewed.
    const changes = trusted.changes(prov.baseSha, args.sha)
    if (changes.length === 0) throw new Error('the build produced an empty patch')
    const refused = pathPolicy(changes, args.allow)
    if (refused.length) {
      throw new Error(`refusing the change: ${refused.map((r) => `${r.path} (${r.reason})`).join(', ')}`)
    }
    const patch = trusted.diff(prov.baseSha, args.sha)
    if (patch.length === 0) throw new Error('the build produced an empty patch')
    const tmp = mkdtempSync(join(tmpdir(), 'mc-export-'))
    temps.push(tmp)
    const patchFile = join(tmp, 'build.patch')
    writeFileSync(patchFile, patch)

    // 5. Rebuild the change on a fresh clone of the real repo, from the recorded origin.
    const real = join(tmp, 'repo')
    const c = spawnSync('git', ['clone', '-q', cloneUrlFor(args.slug), real], {
      encoding: 'utf8', timeout: 300000, windowsHide: true,
    })
    if (c.status !== 0) throw new Error(`clone of ${args.slug} failed: ${(c.stderr || c.error?.message || '').trim().slice(0, 300)}`)
    const rg = (a, o) => hardGit(real, a, o)
    try { rg(['cat-file', '-e', `${prov.originSha}^{commit}`]) } catch {
      throw new Error(`recorded origin ${prov.originSha} is not in ${args.slug}`)
    }
    const branch = `mc-build-${args.requestId}`
    rg(['checkout', '-q', '-b', branch, prov.originSha])
    rg(['apply', '--index', '--3way', patchFile])
    rg(['commit', '-q', '-m', `mc-build ${args.requestId}\n\nBuilt in the MC sandbox. Reviewed SHA: ${args.sha}. CodexQC verdict: ${qc.verdict}.`])
    const diff = rg(['show', '--stat', '--patch', ...SAFE_DIFF, 'HEAD'])
    const paths = changes.map((ch) => ch.path)
    const result = { branch, diff, paths, verdict: qc.verdict }

    // 6. Dry run stops here. The operator reads the full diff before anything leaves.
    if (!push) return result

    // 7. Push + draft PR. Never merges.
    const remote = rg(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
    if (remote) throw new Error(`branch ${branch} already exists on the remote`)
    rg(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { timeoutMs: 300000 })
    const body = [
      `Request: ${args.requestId}`,
      `Reviewed SHA: ${args.sha}`,
      `CodexQC verdict: ${qc.verdict}`,
      '',
      'Built in the MC sandbox; CodexQC before merge.',
    ].join('\n')
    const pr = spawnSync('gh', [
      'pr', 'create', '--draft', '--base', 'main', '--head', branch, '--repo', args.slug,
      '--title', `mc-build ${args.requestId}`, '--body', body,
    ], { cwd: real, encoding: 'utf8', timeout: 120000, windowsHide: true })
    if (pr.status !== 0) throw new Error(`gh pr create failed: ${(pr.stderr || pr.error?.message || '').trim().slice(0, 300)}`)
    return { ...result, prUrl: (pr.stdout || '').trim() }
  } finally {
    // 8. Temp dirs go in every exit path.
    trusted.close()
    for (const t of temps) if (existsSync(t)) rmSync(t, { recursive: true, force: true, maxRetries: 3 })
  }
}
