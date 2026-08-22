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

const state: {
  reads: any[]
  updates: any[]
  git: string[][]
  head: string
} = { reads: [], updates: [], git: [], head: APPROVED }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const ops: any = { method: null, payload: null }
      const c: any = {}
      for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit']) c[m] = () => c
      c.update = (p: any) => {
        ops.method = 'update'
        ops.payload = p
        if (table === 'mc_requests') state.updates.push(p)
        return c
      }
      c.insert = () => c
      c.upsert = () => c
      c.single = async () => {
        const row = state.reads.shift()
        return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } }
      }
      c.maybeSingle = async () =>
        ops.method === 'update' ? { data: { id: REQ, ...ops.payload }, error: null } : { data: null, error: null }
      c.then = (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej)
      return c
    },
  }),
}))

// git is stubbed, but the WORKSPACE PATH is real — the binding check resolves it on disk.
vi.mock('child_process', () => ({
  spawnSync: (_cmd: string, args: string[]) => {
    state.git.push(args)
    if (args.includes('rev-parse')) return { status: 0, stdout: `${state.head}\n`, stderr: '' }
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
  state.git = []
  state.head = APPROVED
})

const approvedRow = (over: any = {}) => ({
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
async function runGatedPush(rows: any[]) {
  state.reads = rows.length === 1 ? [rows[0], { ...rows[0] }] : [...rows]
  const { gatedPush, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
  await gatedPush(createAdminSupabaseClient(), { id: REQ })
}

const pushes = () => state.git.filter((args) => args.includes('push'))
const failure = () => state.updates.find((u) => u.status === 'failed')
const completion = () => state.updates.find((u) => u.status === 'completed')

describe('gatedPush — pushes the literal approved commit, never HEAD', () => {
  it('THE FIX: the refspec is the approved sha, not HEAD', async () => {
    await runGatedPush([approvedRow()])

    expect(pushes()).toHaveLength(1)
    const args = pushes()[0]
    expect(args[args.length - 1]).toBe(`${APPROVED}:refs/heads/${BRANCH}`)
    expect(args.join(' '), 'HEAD must never appear in the refspec').not.toContain('HEAD:refs/heads/')
    // ...and to the fixed sandbox target only.
    expect(args).toContain('https://github.com/davidbillera-lab/mc-spike-test.git')
  })

  it('records the approved sha (not a re-read of HEAD) as the completed artifact', async () => {
    await runGatedPush([approvedRow()])
    const done = completion()
    expect(done.result_summary).toContain(APPROVED)
    expect(done.artifact_refs).toContain(APPROVED)
  })

  it('runs the push from the bound workspace', async () => {
    await runGatedPush([approvedRow()])
    const args = pushes()[0]
    expect(args[0]).toBe('-C')
    expect(args[1]).toBe(WORKSPACE)
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
      state.git = []
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
