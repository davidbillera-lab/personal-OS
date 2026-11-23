#!/usr/bin/env node
// Turn a reviewed sandbox build into a draft PR on the real repo (step 3 spike, piece 2).
//
//   node scripts/build-to-pr.mjs --workspace <path> --sha <reviewed sha> --repo <owner/repo> \
//     --request <mc request id> --allow <glob> [--allow <glob> ...] [--push]
//
// Default is a DRY RUN: prints the full diff and the branch name, then stops. Read that diff
// before re-running with --push. --push pushes the branch and opens a DRAFT PR against main
// with your own git/gh login. It never merges.
//
// --repo must be on DISPATCHER_CLONEABLE_REPOS in this shell's environment.
import { parseArgs } from 'util'
import { exportBuild, githubCloneUrl } from './lib/build-patch.mjs'

try {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      sha: { type: 'string' },
      repo: { type: 'string' },
      request: { type: 'string' },
      allow: { type: 'string', multiple: true },
      push: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const res = exportBuild({ ...values, allow: values.allow || [], cloneUrlFor: githubCloneUrl })
  console.log(res.diff)
  console.log(`\nbranch: ${res.branch}`)
  console.log(`QC verdict: ${res.verdict}`)
  if (res.prUrl) console.log(`draft PR: ${res.prUrl}`)
  else console.log('DRY RUN: nothing was pushed. Re-run with --push after reading the diff above.')
} catch (e) {
  console.error(`build-to-pr: ${e.message}`)
  process.exit(1)
}
