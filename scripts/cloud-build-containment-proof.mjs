#!/usr/bin/env node
// Containment proof for cloud builds (spec: specs/2026-11-24-mc-step3-cloud-builds.md, "Git containment").
// Pushes as the builder bot through a git remote named `bot` and reports what GitHub refused.
// Holds no token: git's credential manager supplies the bot's token for the `bot` remote.
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
const push = (remote, refspec) => {
  const r = spawnSync('git', ['push', remote, refspec], { encoding: 'utf8' })
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

if (!git(['remote']).split('\n').includes(BOT)) {
  console.error(`No "${BOT}" remote. Add it first:\n  git remote add bot https://mc-builder-bot@github.com/davidbillera-lab/personal-OS.git`)
  process.exit(2)
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
if (!first.ok) stop('the bot push failed. Check the bot remote and its token, then run again.')
// ...and it must really be the bot. If git signed in as the owner instead, nothing below proves anything.
const pusher = () => spawnSync('gh', ['api', `repos/${REPO}/activity?ref=refs/heads/mc-build-proof&per_page=1`, '-q', '.[0].actor.login'], { encoding: 'utf8' }).stdout.trim()
let who = ''
for (let i = 0; i < 5 && !who; i++) { who = pusher(); if (!who) spawnSync('node', ['-e', 'setTimeout(()=>{},2000)']) }
report(who === BOT_LOGIN, `that push was made by ${BOT_LOGIN}`, `GitHub recorded: ${who || 'nothing yet'}`)
if (who !== BOT_LOGIN) stop(`git pushed as "${who}", not the bot. Run with --cleanup, sign the bot remote in with the bot's token, and run again.`)

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
