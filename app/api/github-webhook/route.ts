import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServerSupabaseClient } from '@/lib/supabase'
import { captureToVault } from '@/lib/vault'

export const runtime = 'nodejs' // needs Node crypto + Supabase server client

// Normalize a repo URL for matching: strip trailing .git, strip trailing slash, lowercase.
function normalizeRepoUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
}

interface GitHubCommit {
  id: string
  message: string
  author?: { name?: string; username?: string }
  added?: string[]
  modified?: string[]
  removed?: string[]
}

interface PushPayload {
  ref?: string
  compare?: string
  pusher?: { name?: string }
  repository?: { html_url?: string; full_name?: string }
  commits?: GitHubCommit[]
  head_commit?: GitHubCommit | null
}

export async function POST(req: NextRequest) {
  // 1. Raw body first — signature is computed over the exact bytes GitHub signed.
  const raw = await req.text()

  // 2. Verify signature. This is the gate; without it anyone could forge vault rows.
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    console.error('[github-webhook] GITHUB_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const signature = req.headers.get('x-hub-signature-256') ?? ''
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 3. Event routing.
  const event = req.headers.get('x-github-event')
  if (event === 'ping') {
    return NextResponse.json({ ok: true })
  }
  if (event !== 'push') {
    return NextResponse.json({ ignored: true })
  }

  // 4. Parse push payload.
  let payload: PushPayload
  try {
    payload = JSON.parse(raw) as PushPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const htmlUrl = payload.repository?.html_url ?? ''
  const fullName = payload.repository?.full_name ?? 'unknown/repo'
  const branch = (payload.ref ?? '').replace(/^refs\/heads\//, '')
  const pusher = payload.pusher?.name ?? 'unknown'
  const commits = payload.commits ?? []
  const head = payload.head_commit

  // No head_commit (e.g. branch delete) — nothing meaningful to capture.
  if (!head) {
    return NextResponse.json({ ignored: 'no head_commit' })
  }

  // 5. Attribute to project via normalized repo_url match (nullable).
  let projectId: string | null = null
  if (htmlUrl) {
    const supabase = await createServerSupabaseClient()
    const { data: projects } = await supabase.from('projects').select('id, repo_url')
    const target = normalizeRepoUrl(htmlUrl)
    const match = (projects ?? []).find(
      (p) => p.repo_url && normalizeRepoUrl(p.repo_url) === target
    )
    projectId = match?.id ?? null
  }

  // 6. One git_push row per push (NOT per file — see plan tradeoff).
  const headSubject = head.message.split('\n')[0].slice(0, 80)

  const digest = commits
    .map((c) => {
      const shortSha = c.id.slice(0, 7)
      const subject = c.message.split('\n')[0]
      const author = c.author?.name ?? c.author?.username ?? 'unknown'
      const a = c.added?.length ?? 0
      const m = c.modified?.length ?? 0
      const d = c.removed?.length ?? 0
      return `${shortSha} · ${subject} · ${author} · (+${a} ~${m} -${d})`
    })
    .join('\n')

  const filesChanged = Array.from(
    new Set([...(head.added ?? []), ...(head.modified ?? []), ...(head.removed ?? [])])
  )

  await captureToVault({
    type: 'git_push',
    title: `Push to ${fullName} (${branch}): ${headSubject}`,
    content: digest || headSubject,
    project_id: projectId,
    source_table: 'github_webhook',
    // source_id stays null: it's a uuid column and a git SHA isn't a uuid.
    // The head commit SHA lives in metadata.head_sha instead.
    capture_source: 'git_push',
    tags: ['git', fullName, branch],
    metadata: {
      repo: htmlUrl,
      branch,
      pusher,
      head_sha: head.id,
      commit_count: commits.length,
      commit_shas: commits.map((c) => c.id),
      compare_url: payload.compare ?? null,
      files_changed: filesChanged,
    },
  })

  // 7. Done.
  return NextResponse.json({ captured: true, project_id: projectId })
}
