#!/usr/bin/env node
// Repoint the ChatGPT connector's git-main alias at the newest READY production
// deploy. Fixes the manual-alias pin (a `vercel alias set` on a -git- domain
// permanently disables auto-follow, so every push otherwise needs a hand repoint).
//
// Uses the Vercel CLI already authed on the rig — NO stored token, no new secret.
//
//   node scripts/repoint-alias.mjs            # point alias at latest prod deploy
//   node scripts/repoint-alias.mjs --dry-run  # show what it would do, change nothing
//   node scripts/repoint-alias.mjs <url>       # point alias at a specific deploy url
//
// Overridable via env: ALIAS_TARGET, VERCEL_PROJECT, VERCEL_SCOPE.
import { execSync } from 'node:child_process';

const ALIAS_TARGET = process.env.ALIAS_TARGET || 'personal-os-git-main-jsg1.vercel.app';
const PROJECT = process.env.VERCEL_PROJECT || 'personal-os';
const SCOPE = process.env.VERCEL_SCOPE || 'jsg1';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitUrl = args.find((a) => a.startsWith('https://'));

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function latestReadyProdUrl() {
  const out = sh(`vercel ls ${PROJECT} --prod --scope ${SCOPE} --yes 2>&1`);
  // Newest first; take the first row that is Ready and carries a deploy URL.
  for (const line of out.split('\n')) {
    if (!/Ready/i.test(line)) continue;
    const m = line.match(/https:\/\/[a-z0-9-]+\.vercel\.app/i);
    if (m) return m[0];
  }
  throw new Error('No READY production deployment found in `vercel ls` output.');
}

const source = explicitUrl || latestReadyProdUrl();
console.log(`Source deploy : ${source}`);
console.log(`Alias target  : ${ALIAS_TARGET}`);

if (dryRun) {
  console.log('\n[dry-run] Would run:');
  console.log(`  vercel alias set ${source} ${ALIAS_TARGET} --scope ${SCOPE}`);
  process.exit(0);
}

console.log('\nRepointing…');
const res = sh(`vercel alias set ${source} ${ALIAS_TARGET} --scope ${SCOPE}`);
console.log(res.trim());
console.log(`\n✅ ${ALIAS_TARGET} now serves ${source}`);
