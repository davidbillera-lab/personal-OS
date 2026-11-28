#!/usr/bin/env node
// Containment proof for cloud builds (spec: specs/2026-11-24-mc-step3-cloud-builds.md, "Git containment").
// Pushes as the builder bot and reports what GitHub refused.
// Reads the bot's token from the clipboard, keeps it in memory only, and hands it to git through
// the child process environment. It is never written to disk, printed, or put on a command line.
// Git's saved sign-ins are bypassed for bot pushes: they silently pushed as the owner (2026-11-28).
//
//   node scripts/cloud-build-containment-proof.mjs            run the proof
//   node scripts/cloud-build-containment-proof.mjs --cleanup  delete the proof branches afterwards
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BOT = 'bot'
const OWNER = 'origin'
const REPO = 'davidbillera-lab/personal-OS'
const BOT_LOGIN = 'mc-builder-bot'
const PROOF_REFS = [
  'refs/heads/mc-build-proof', 'refs/heads/mc-build-proof-wf', 'refs/heads/mc-review-proof',
  'refs/heads/proof-delete-me', 'refs/heads/not-mc-build-x', 'refs/tags/mc-proof-tag',
]

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim()
let botEnv = null
const push = (remote, refspec) => {
  const r = remote === BOT
    ? spawnSync('git', ['-c', 'credential.helper=', 'push', `https://github.com/${REPO}.git`, refspec],
      { encoding: 'utf8', env: botEnv })
    : spawnSync('git', ['push', remote, refspec], { encoding: 'utf8' })
  const why = (r.stderr || '').split('\n').map(l => l.trim())
    .filter(l => /^(remote: (- |error)|! |fatal:|error:)/.test(l)).slice(0, 2).join(' | ')
  return { ok: r.status === 0, why }
}

if (process.argv.includes('--cleanup')) {
  for (const ref of PROOF_REFS) {
    const r = push(OWNER, `:${ref}`)
    console.log(`${r.ok ? 'deleted' : 'absent '}  ${ref}`)
  }
  process.exit(0)
}

// The token comes from the clipboard: pasting into a hidden prompt froze the terminal (2026-11-28).
const clip = cmd => spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' })
const pasted = (clip('Get-Clipboard').stdout || '').trim()
if (!pasted.startsWith('ghp_')) {
  console.error(`Copy the ${BOT_LOGIN} classic token first (it starts with ghp_), then run this again. Nothing was pushed.`)
  process.exit(2)
}
clip("Set-Clipboard -Value ' '")
console.log('Token read from the clipboard and the clipboard cleared. Running the checks, about a minute...')
botEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: `http.https://github.com/${REPO}.git.extraheader`,
  GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${pasted}`).toString('base64')}`,
}

git(['fetch', '-q', OWNER, 'main'])
const base = git(['rev-parse', `${OWNER}/main`])

// Commits are built without touching the working tree or the real index.
const tmp = mkdtempSync(join(tmpdir(), 'mc-proof-'))
const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') }
const commitWith = (message, path, content) => {
  git(['read-tree', base], { env })
  if (path) {
    const blob = git(['hash-object', '-w', '--stdin'], { input: content })
    git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env })
  }
  return git(['commit-tree', git(['write-tree'], { env }), '-p', base, '-m', message])
}
const plain = commitWith('containment proof: empty commit')
const workflow = commitWith('containment proof: workflow', '.github/workflows/mc-proof.yml',
  'name: mc-proof\non: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo proof\n')
const vercel = JSON.parse(git(['show', `${base}:vercel.json`]))
delete vercel.git.deploymentEnabled['mc-build-*']
const noExclusion = commitWith('containment proof: vercel.json without the mc-build exclusion', 'vercel.json',
  JSON.stringify(vercel, null, 2) + '\n')
rmSync(tmp, { recursive: true, force: true })

let failed = 0
const report = (pass, label, why) => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${why ? `  (${why})` : ''}`)
}
const stop = msg => { console.log(`\nSTOPPED: ${msg}`); process.exit(1) }

// 1. The bot credential must work at all, or every "refused" below would be meaningless.
const first = push(BOT, `${plain}:refs/heads/mc-build-proof`)
report(first.ok, 'bot can push mc-build-proof', first.why)
if (!first.ok) stop('the bot push failed. The token was rejected or lacks the public_repo scope. Run again with the right one.')
// ...and it must really be the bot. If git signed in as the owner instead, nothing below proves anything.
const pusher = () => spawnSync('gh', ['api', `repos/${REPO}/activity?ref=refs/heads/mc-build-proof&per_page=1`, '-q', '.[0].actor.login'], { encoding: 'utf8' }).stdout.trim()
let who = ''
for (let i = 0; i < 5 && !who; i++) { who = pusher(); if (!who) spawnSync('node', ['-e', 'setTimeout(()=>{},2000)']) }
report(who === BOT_LOGIN, `that push was made by ${BOT_LOGIN}`, `GitHub recorded: ${who || 'nothing yet'}`)
if (who !== BOT_LOGIN) stop(`git pushed as "${who}", not the bot. Run with --cleanup, then run again with a token created while signed in to GitHub as the bot.`)

// 2. Owner setup. These also prove the admin bypass still works.
for (const ref of ['refs/heads/mc-review-proof', 'refs/heads/proof-delete-me']) {
  const r = push(OWNER, `${base}:${ref}`)
  report(r.ok, `owner can create ${ref.replace('refs/heads/', '')}`, r.ok ? '' : r.why)
  if (!r.ok) stop('the owner push failed, so the admin bypass is not working.')
}

// 3. Everything here must be refused for the bot.
const refusals = [
  ['bot refused on a non-mc-build branch', `${plain}:refs/heads/not-mc-build-x`],
  ['bot refused moving a review branch', `${plain}:refs/heads/mc-review-proof`],
  ['bot refused deleting a review branch', ':refs/heads/mc-review-proof'],
  ['bot refused deleting another branch', ':refs/heads/proof-delete-me'],
  ['bot refused pushing a tag', `${plain}:refs/tags/mc-proof-tag`],
  ['bot refused pushing a workflow file', `${workflow}:refs/heads/mc-build-proof-wf`],
]
for (const [label, refspec] of refusals) {
  const r = push(BOT, refspec)
  report(!r.ok, label, r.why)
}
// main goes last, and only if the bot was refused everywhere else: if the `bot` remote were
// quietly using the owner's login, this push would land on main.
if (failed) stop('a refusal did not happen. The push to main was not attempted. Run with --cleanup, fix, and repeat.')
const main = push(BOT, `${plain}:refs/heads/main`)
report(!main.ok, 'bot refused on main', main.why)

// 4. Vercel: a bot commit that removes the exclusion from vercel.json.
const v = push(BOT, `${noExclusion}:refs/heads/mc-build-proof`)
report(v.ok, 'bot pushed vercel.json without the exclusion to mc-build-proof', v.why)

console.log(failed
  ? `\n${failed} check(s) FAILED. Do not start piece 1.`
  : `\nGit containment passed.\nStill to check: no Vercel deployment exists for branch mc-build-proof (commits ${plain.slice(0, 7)} and ${noExclusion.slice(0, 7)}).\nThen run with --cleanup.`)
process.exit(failed ? 1 : 0)
