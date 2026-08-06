// Proves C6-P5 on the REAL return path: dispatcher.runAttempt() → mc_requests writes →
// Telegram payload. Supabase and the executor adapter are stubbed; everything between them
// (classifier gate, clip/sanitize, blocker + latest_progress composition, telegram-notify)
// is the production code. No network, no docker, no pm2.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const REQ_ID = '550e8400-e29b-41d4-a716-446655440000'
const GIT_SHA = '3f2a91c0de4b7a5e18cc6d0f9b2e4a7c13d5f608'

// Fake secrets of each shape, echoed by a hostile build into its commit messages / stderr.
const FAKE = {
  openai: 'sk-Abcd1234Efgh5678Ijkl9012Mnop',
  anthropic: 'sk-ant-api03-AbC123dEf456GhI789jKl012',
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  github: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
  aws: 'AKIAIOSFODNN7EXAMPLE',
  telegram: '8012345678:AAHfakeTokenValue_1234567890abcdefg',
  pg: 'postgres://admin:hunter2hunter2@db.example.com:5432/mc',
}
const ALL_SECRETS = [
  FAKE.openai, FAKE.anthropic, 'eyJhbGciOi', FAKE.github, FAKE.aws,
  'AAHfakeTokenValue', 'hunter2hunter2',
]

const state: {
  updates: any[]
  telegram: string[]
  launch: () => any
} = { updates: [], telegram: [], launch: () => ({}) }

const BASE_ROW = {
  id: REQ_ID,
  title: 'Add a hello file',
  request_text: 'Create hello.txt with one line.',
  attempt_id: null,
  status: 'claimed',
}

vi.mock('@supabase/supabase-js', () => {
  function makeChain(table: string) {
    const ops: any = { table, method: null, args: [], payload: null }
    const chain: any = {}
    for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit', 'single', 'maybeSingle']) {
      chain[m] = (...a: any[]) => { ops.args.push([m, ...a]); return chain }
    }
    chain.update = (p: any) => { ops.method = 'update'; ops.payload = p; return chain }
    chain.insert = (p: any) => { ops.method = 'insert'; ops.payload = p; return chain }
    chain.then = (res: any, rej: any) => Promise.resolve(resolveOp(ops)).then(res, rej)
    return chain
  }
  function resolveOp(ops: any) {
    if (ops.table === 'mcp_audit_log') return { data: null, error: null }
    if (ops.method === 'update') {
      state.updates.push(ops.payload)
      return { data: { ...BASE_ROW, ...ops.payload }, error: null }
    }
    if (ops.method === 'insert') return { data: null, error: null }
    const eqs = ops.args.filter((a: any[]) => a[0] === 'eq')
    if (ops.args.some((a: any[]) => a[0] === 'in')) return { data: [], error: null } // faultRecovery
    if (eqs.some((a: any[]) => a[1] === 'status' && a[2] === 'in_progress')) return { data: [], error: null } // findPushable
    if (eqs.some((a: any[]) => a[1] === 'status' && a[2] === 'queued')) return { data: [{ id: REQ_ID }], error: null }
    return { data: [], error: null }
  }
  return { createClient: () => ({ from: (table: string) => makeChain(table) }) }
})

vi.mock('../scripts/lib/claude-executor-adapter.mjs', () => ({
  pickAdapter: () => ({ name: 'stub', launch: async () => state.launch() }),
}))

async function runOneTick() {
  state.updates = []
  state.telegram = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role'
  process.env.TELEGRAM_BOT_TOKEN = 'stub-bot-token'
  process.env.TELEGRAM_CHAT_ID = '12345'
  process.env.DISPATCHER_ONCE = '1'
  process.env.DISPATCHER_PAUSE_FILE = 'tests/.no-such-pause-file'
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    state.telegram.push(JSON.parse(init.body).text)
    return { ok: true, status: 200 }
  })
  vi.resetModules()
  await import('../scripts/dispatcher.mjs')
  await vi.waitFor(() => expect(state.updates.length).toBeGreaterThanOrEqual(2), { timeout: 5000 })
}

describe('C6-P5 sanitization on the live dispatcher return path', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('scrubs secrets a build echoed into its commit messages (success path)', async () => {
    state.launch = () => ({
      reviewedSha: GIT_SHA,
      qcVerdict: 'SHIP',
      commits: [
        `abc1234 add config: OPENAI_API_KEY=${FAKE.openai}`,
        `def5678 wire anthropic ${FAKE.anthropic} and ${FAKE.github}`,
        `9012abc dump env: ${FAKE.jwt}`,
        `345def6 aws ${FAKE.aws} tg ${FAKE.telegram} db ${FAKE.pg}`,
      ],
    })
    await runOneTick()

    const approval = state.updates.find((u) => u.status === 'awaiting_approval')
    expect(approval).toBeTruthy()
    if (process.env.P5_DEMO) {
      console.log('\n=== mc_requests.blocker ===\n' + approval.blocker)
      console.log('\n=== mc_requests.latest_progress ===\n' + approval.latest_progress)
      console.log('\n=== telegram payload ===\n' + state.telegram[0] + '\n')
    }
    const outbound = [approval.blocker, approval.latest_progress, ...state.telegram].join('\n')
    for (const secret of ALL_SECRETS) expect(outbound).not.toContain(secret)
    expect(state.telegram[0]).toContain('[REDACTED:')

    // ...and the operator-critical fields survive intact.
    expect(approval.reviewed_sha).toBe(GIT_SHA)
    expect(approval.blocker).toContain(GIT_SHA)
    expect(approval.blocker).toContain('davidbillera-lab/mc-spike-test')
    expect(approval.blocker).toContain(`mc-build-${REQ_ID}`)
    expect(approval.blocker).toContain('SHIP')
    expect(approval.latest_progress).toContain(GIT_SHA)
    expect(state.telegram[0]).toContain(GIT_SHA)
  })

  it('scrubs secrets in raw executor stderr (build-FAILED path)', async () => {
    state.launch = () => {
      throw new Error(`executor container exited 1: fatal: auth ${FAKE.anthropic} rejected; fell back to ${FAKE.jwt}`)
    }
    await runOneTick()

    const failed = state.updates.find((u) => u.status === 'failed')
    expect(failed).toBeTruthy()
    if (process.env.P5_DEMO) console.log('\n=== mc_requests.blocker (FAILED path) ===\n' + failed.blocker + '\n')
    expect(failed.blocker).toContain('build failed: executor container exited 1')
    expect(failed.blocker).toContain('[REDACTED:anthropic-key]')
    expect(failed.blocker).toContain('[REDACTED:jwt]')
    for (const secret of ALL_SECRETS) expect(failed.blocker).not.toContain(secret)
  })
})
