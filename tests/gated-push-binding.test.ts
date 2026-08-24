// The gated push is the last thing standing between an untrusted build and a real remote.
//
// TWO HOLES THIS PINS SHUT:
//   1. It verified `HEAD === reviewed_sha` and then pushed `HEAD:refs/heads/<branch>`. HEAD is
//      a moving target — anything committing in the workspace between the check and the push
//      shipped an unreviewed commit under a valid approval. It now pushes the LITERAL
//      approved sha.
//   2. Every gate ran against a row read before rev-parse and the filesystem checks. A reject
//      or a rebuild landing in that window was pushed straight past. There is now an
//      authoritative re-read immediately before the push that fails closed on any drift.
//
// Plus the workspace binding: workspace_ref was trusted as given, so a row rewrite could aim
// the push at any git repo on the rig. It must now BE builds/<request_id>/<attempt_id>.
//
// The push itself no longer runs here at all: the dispatcher hands the bound workspace to
// scripts/lib/trusted-push.mjs, which reads HEAD as plain files and runs the credentialed
// push from a repo it builds under the host temp dir. That module is mocked below — proving
// it survives a real hostile workspace is tests/trusted-push.test.ts's job. This file's job
// is what the GATES decide, and that the dispatcher never touches git itself.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const REQ = '11111111-1111-1111-1111-111111111111'
const ATTEMPT = '22222222-2222-2222-2222-222222222222'
const APPROVED = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const BRANCH = `mc-build-${REQ}`

let BUILDS: string
let WORKSPACE: string

type Row = Record<string, unknown>
type QueryResult = { data: Row | null; error: { message: string } | null }

// Only the slice of the supabase builder the dispatcher actually reaches. The filter methods
// (select/eq/in/...) all just return the chain, so one index signature covers them.
interface Chain {
  [method: string]: unknown
  update: (payload: Row) => Chain
  insert: () => Chain
  upsert: () => Chain
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (res: (value: QueryResult) => unknown, rej: (reason: unknown) => unknown) => Promise<unknown>
}

// What the dispatcher asked trusted-push to send, captured verbatim.
type Push = { workspaceRef: string; sha: string; remote: string; ref: string }

// `reads` is the queue of rows the authoritative SELECTs see, in order; an `undefined` entry
// stands for a read that found no row at all.
const state: {
  reads: Array<Row | undefined>
  updates: Row[]
  pushes: Push[]
  prepares: Array<{ workspaceRef: string; sha: string; ref: string }>
  cleanups: number
  subprocesses: unknown[][]
  head: string
  // Fires from inside the prepareTrustedPush mock — standing in for the real function's
  // (potentially long) object copy, during which a reject/rebuild/new-attempt can land.
  onPrepare: (() => void) | null
} = { reads: [], updates: [], pushes: [], prepares: [], cleanups: 0, subprocesses: [], head: APPROVED, onPrepare: null }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const ops: { method: string | null; payload: Row | null } = { method: null, payload: null }
      const c: Chain = {
        update: (p: Row) => {
          ops.method = 'update'
          ops.payload = p
          if (table === 'mc_requests') state.updates.push(p)
          return c
        },
        insert: () => c,
        upsert: () => c,
        single: async () => {
          const row = state.reads.shift()
          return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } }
        },
        maybeSingle: async () =>
          ops.method === 'update' ? { data: { id: REQ, ...ops.payload }, error: null } : { data: null, error: null },
        then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
      }
      for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit']) c[m] = () => c
      return c
    },
  }),
}))

// A path outside BUILDS, standing in for the throwaway repo trusted-push builds under the
// host temp dir. Never created on disk — nothing here reads it; it exists to prove the
// dispatcher accepts a push origin that is not the builder's workspace.
const TRUSTED_REPO = join(tmpdir(), 'mc-trusted-push-stub', 'repo')

// The push path is a module boundary now, so mock the module, not the subprocess: git never
// runs from this test. The WORKSPACE PATH stays real — the binding check resolves it on disk.
// Two stages, mirroring the real prepare/push split: prepareTrustedPush() is where the real
// implementation does the (potentially slow) object copy + cat-file validation, so onPrepare
// hooks there to simulate a row mutation landing during that window. pushTrustedRepo() only
// ever sees what prepareTrustedPush() already validated (sha/ref come from the handle).
vi.mock('../scripts/lib/trusted-push.mjs', () => ({
  resolveWorkspaceHead: () => state.head,
  prepareTrustedPush: ({ workspaceRef, sha, ref }: { workspaceRef: string; sha: string; ref: string }) => {
    state.prepares.push({ workspaceRef, sha, ref })
    state.onPrepare?.()
    return {
      repo: TRUSTED_REPO,
      sha,
      ref,
      workspaceRef,
      cleanup: () => { state.cleanups += 1 },
    }
  },
  pushTrustedRepo: (
    prepared: { repo: string; sha: string; ref: string; workspaceRef: string },
    { remote }: { remote: string },
  ) => {
    state.pushes.push({ workspaceRef: prepared.workspaceRef, sha: prepared.sha, remote, ref: prepared.ref })
    return prepared.repo
  },
}))

// Tripwire, not a git stub: every git invocation on the push path belongs behind
// trusted-push. If the dispatcher ever shells out again, it lands here and the assertions
// below fail instead of the regression passing quietly.
vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => {
    state.subprocesses.push(args)
    return { status: 0, stdout: '', stderr: '' }
  },
  spawn: () => ({ on: () => {}, unref: () => {}, kill: () => {} }),
}))

beforeAll(() => {
  BUILDS = mkdtempSync(join(tmpdir(), 'mc-gated-push-'))
  WORKSPACE = resolve(BUILDS, REQ, ATTEMPT)
  mkdirSync(WORKSPACE, { recursive: true })
  process.env.DISPATCHER_BUILDS_DIR = BUILDS
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub'
  process.env.DISPATCHER_PAUSE_FILE = join(BUILDS, '.no-such-pause-file')
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})
afterAll(() => rmSync(BUILDS, { recursive: true, force: true }))

beforeEach(() => {
  state.reads = []
  state.updates = []
  state.pushes = []
  state.prepares = []
  state.cleanups = 0
  state.subprocesses = []
  state.head = APPROVED
  state.onPrepare = null
})

const approvedRow = (over: Row = {}) => ({
  id: REQ,
  attempt_id: ATTEMPT,
  status: 'in_progress',
  phase: 'pushing',
  approved_at: '2026-08-21T00:00:00Z',
  approved_by: 'david',
  approved_sha: APPROVED,
  reviewed_sha: APPROVED,
  workspace_ref: WORKSPACE,
  ...over,
})

// Drive gatedPush with an explicit sequence of authoritative reads: [gate read, pre-push
// re-read]. Passing one row means both reads see the same state (nothing drifted).
async function runGatedPush(rows: Array<Row | undefined>) {
  state.reads = rows.length === 1 ? [rows[0], { ...rows[0] }] : [...rows]
  const { gatedPush, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
  await gatedPush(createAdminSupabaseClient(), { id: REQ })
}

const pushes = () => state.pushes
const prepares = () => state.prepares
const cleanups = () => state.cleanups
const failure = () => state.updates.find((u) => u.status === 'failed')
const completion = () => state.updates.find((u) => u.status === 'completed')

describe('gatedPush — pushes the literal approved commit, never HEAD', () => {
  it('THE FIX: the refspec is the approved sha, not HEAD', async () => {
    await runGatedPush([approvedRow()])

    expect(pushes()).toHaveLength(1)
    const p = pushes()[0]
    expect(`${p.sha}:${p.ref}`).toBe(`${APPROVED}:refs/heads/${BRANCH}`)
    expect(p.sha, 'HEAD must never be handed over as the source').not.toContain('HEAD')
    // ...and to the fixed sandbox target only.
    expect(p.remote).toBe('https://github.com/davidbillera-lab/mc-spike-test.git')
  })

  it('records the approved sha (not a re-read of HEAD) as the completed artifact', async () => {
    await runGatedPush([approvedRow()])
    const done = completion()
    expect(done.result_summary).toContain(APPROVED)
    expect(done.artifact_refs).toContain(APPROVED)
  })

  it('gives trusted-push the bound workspace as an object source, and nothing more', async () => {
    await runGatedPush([approvedRow()])
    // The bound workspace is still what the commit comes FROM...
    expect(pushes()[0].workspaceRef).toBe(WORKSPACE)
    // ...but the dispatcher no longer runs git in it — or anywhere. It used to be
    // `git -C <workspace> push`, which handed the push credential to whatever hooks and
    // config the untrusted build had planted in that .git.
    expect(state.subprocesses, 'the push path must not shell out to git').toEqual([])
    // The credentialed push runs from a repo trusted-push builds outside the builds tree,
    // and the dispatcher completes on that origin. (The real boundary — objects only, no
    // builder config, no hooks — is proven in tests/trusted-push.test.ts.)
    expect(TRUSTED_REPO.startsWith(BUILDS), 'push origin must be outside the builds tree').toBe(false)
    expect(completion(), 'the run completes through the trusted repo').toBeTruthy()
  })
})

describe('gatedPush — approved_sha must exist and match the reviewed commit', () => {
  it('refuses when approved_sha was never stamped (approval predates the binding)', async () => {
    await runGatedPush([approvedRow({ approved_sha: null })])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('approved_sha missing')
  })

  it('THE RETARGET: refuses when reviewed_sha moved after the approval', async () => {
    // Consent was recorded for APPROVED; reviewed_sha now says something else.
    await runGatedPush([approvedRow({ reviewed_sha: OTHER_SHA })])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('approval retargeted')
  })

  it('refuses when the workspace HEAD moved off the approved commit', async () => {
    state.head = OTHER_SHA
    await runGatedPush([approvedRow()])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('SHA drift')
  })

  it('still refuses an unapproved row outright', async () => {
    await runGatedPush([approvedRow({ approved_at: null })])
    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('not approved-for-push')
  })
})

describe('gatedPush — workspace_ref is derived, not trusted', () => {
  it('refuses a workspace that is not this attempt/request pair', async () => {
    const foreign = resolve(BUILDS, '33333333-3333-3333-3333-333333333333', ATTEMPT)
    mkdirSync(foreign, { recursive: true })
    await runGatedPush([approvedRow({ workspace_ref: foreign })])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('workspace binding')
  })

  it('refuses a workspace belonging to a DIFFERENT attempt of the same request', async () => {
    const otherAttempt = resolve(BUILDS, REQ, '44444444-4444-4444-4444-444444444444')
    mkdirSync(otherAttempt, { recursive: true })
    await runGatedPush([approvedRow({ workspace_ref: otherAttempt })])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('workspace binding')
  })

  it('THE TRAVERSAL: refuses a workspace_ref that climbs out of the builds dir', async () => {
    for (const evil of [
      join(WORKSPACE, '..', '..', '..'),
      join(BUILDS, REQ, ATTEMPT, '..', '..'),
      resolve(BUILDS, '..'),
    ]) {
      state.updates = []
      state.pushes = []
      await runGatedPush([approvedRow({ workspace_ref: evil })])
      expect(pushes(), `workspace_ref=${evil}`).toHaveLength(0)
      expect(failure().blocker).toContain('workspace binding')
    }
  })

  it('refuses a traversal hidden in the ids themselves (never builds a path from them)', async () => {
    await runGatedPush([approvedRow({ attempt_id: '../../etc', workspace_ref: WORKSPACE })])
    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('attempt_id is not a uuid')
  })

  it('refuses a missing workspace_ref', async () => {
    await runGatedPush([approvedRow({ workspace_ref: null })])
    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('workspace_ref missing')
  })
})

describe('gatedPush — authoritative re-read immediately before the push', () => {
  it('THE WINDOW: a reject landing after the gates still stops the push', async () => {
    await runGatedPush([
      approvedRow(),
      approvedRow({ status: 'blocked', phase: null, approved_sha: null }),
    ])

    expect(pushes()).toHaveLength(0)
    expect(failure()?.blocker ?? '').toContain('pre-push drift')
  })

  it('a rebuild that re-stamped reviewed_sha in the window stops the push', async () => {
    await runGatedPush([
      approvedRow(),
      approvedRow({ reviewed_sha: OTHER_SHA }),
    ])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('pre-push drift')
    expect(failure().blocker).toContain('reviewed_sha')
  })

  it('a new attempt claiming the row in the window stops the push', async () => {
    await runGatedPush([
      approvedRow(),
      approvedRow({ attempt_id: '55555555-5555-5555-5555-555555555555' }),
    ])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('attempt_id')
  })

  it('a workspace_ref rewritten in the window stops the push', async () => {
    await runGatedPush([
      approvedRow(),
      approvedRow({ workspace_ref: resolve(BUILDS, '..') }),
    ])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('workspace_ref')
  })

  it('fails closed when the pre-push re-read returns nothing at all', async () => {
    // Two reads are expected; queue only the gate read so the second finds no row.
    await runGatedPush([approvedRow(), undefined])

    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('pre-push re-read failed')
  })
})

describe('gatedPush — cancellation/drift arriving WHILE the trusted repo is being prepared', () => {
  // THE FIX: prepareTrustedPush() is where the real implementation does the (potentially
  // long, for a large build) object copy and cat-file validation. Before this fix, the
  // authoritative re-read ran BEFORE that work started, so a reject/cancel/rebuild landing
  // during the copy sailed straight past a check that had already passed. `onPrepare` fires
  // exactly when that copy would be running and mutates the row the SUBSEQUENT authoritative
  // re-read sees, proving the re-read now runs after preparation, not before it.
  it('a cancel landing during preparation is caught by the re-read, not missed by it', async () => {
    state.reads = [approvedRow()]
    state.onPrepare = () => { state.reads.push(approvedRow({ status: 'blocked', phase: null, approved_sha: null })) }

    const { gatedPush, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
    await gatedPush(createAdminSupabaseClient(), { id: REQ })

    expect(prepares(), 'preparation must actually run for this test to prove anything').toHaveLength(1)
    expect(pushes()).toHaveLength(0)
    expect(failure()?.blocker ?? '').toContain('pre-push drift')
    expect(cleanups(), 'the prepared trusted repo must be torn down, not leaked').toBe(1)
  })

  it('a reviewed_sha rewrite landing during preparation stops the push', async () => {
    state.reads = [approvedRow()]
    state.onPrepare = () => { state.reads.push(approvedRow({ reviewed_sha: OTHER_SHA })) }

    const { gatedPush, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
    await gatedPush(createAdminSupabaseClient(), { id: REQ })

    expect(prepares()).toHaveLength(1)
    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('pre-push drift')
    expect(failure().blocker).toContain('reviewed_sha')
    expect(cleanups()).toBe(1)
  })

  it('a new attempt claiming the row during preparation stops the push', async () => {
    state.reads = [approvedRow()]
    state.onPrepare = () => { state.reads.push(approvedRow({ attempt_id: '55555555-5555-5555-5555-555555555555' })) }

    const { gatedPush, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
    await gatedPush(createAdminSupabaseClient(), { id: REQ })

    expect(prepares()).toHaveLength(1)
    expect(pushes()).toHaveLength(0)
    expect(failure().blocker).toContain('attempt_id')
    expect(cleanups()).toBe(1)
  })
})

describe('requestApproval — a new attempt inherits no consent', () => {
  it('clears approved_sha, approved_by and approved_at when asking for review', async () => {
    state.reads = []
    const { requestApproval, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
    await requestApproval(createAdminSupabaseClient(), { id: REQ, attempt_id: ATTEMPT, title: 't', request_text: 't' }, {
      reviewedSha: OTHER_SHA, qcVerdict: 'SHIP', commits: ['x'], workspace: WORKSPACE, runtimeSec: 1,
    })

    const ask = state.updates.find((u) => u.status === 'awaiting_approval')
    expect(ask.reviewed_sha).toBe(OTHER_SHA)
    expect(ask.approved_sha, 'a rebuild must not inherit the previous approval').toBeNull()
    expect(ask.approved_by).toBeNull()
    expect(ask.approved_at).toBeNull()
  })
})
