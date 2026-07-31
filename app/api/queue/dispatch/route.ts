import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { callTool } from '@/lib/mcp-tools'

export const runtime = 'nodejs'

// Hermes queue watcher (serverless). Invoked by Vercel Cron (Authorization:
// Bearer <CRON_SECRET>). Picks up queued Mission Control requests, claims + routes
// each to a worker, and pings Telegram so a human runs the worker session.
//
// It ORCHESTRATES ONLY — it never executes, completes, or fails a request, and
// it holds no credential/vault power. Execution stays with a real Claude/Codex
// worker. The only side effects here are a queued→claimed status move and a
// notification, both safe and reversible. Idempotent by state: a request leaves
// 'queued' on first pass, so it is never double-claimed.

const MAX_PER_RUN = 25
const ACTOR = 'hermes' // orchestrator identity for the audit trail

async function logAudit(tool: string, ok: boolean, error?: string) {
  try {
    await createAdminSupabaseClient().from('mcp_audit_log').insert({ actor: ACTOR, tool, ok, error: error ?? null })
  } catch (e) {
    console.error('[queue/dispatch] audit write failed (non-fatal):', e)
  }
}

// Route a request to a worker: honour an explicit preferred_worker, else default
// to claude (the executor). hermes never routes work to itself — it dispatches.
function routeWorker(preferred: string | null): string {
  if (preferred && preferred !== 'auto' && preferred !== 'hermes') return preferred
  return 'claude'
}

export async function GET(req: NextRequest) {
  // Fail-closed cron auth — same contract as the alerts digest.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 401 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const { data: queued, error } = await supabase
    .from('mc_requests')
    .select('id, title, preferred_worker, priority, created_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN)
  if (error) {
    console.error('[queue/dispatch] queue read failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!queued || queued.length === 0) {
    return NextResponse.json({ picked_up: 0, reason: 'queue_empty' })
  }

  const routed: { id: string; title: string | null; worker: string }[] = []
  for (const r of queued) {
    const worker = routeWorker(r.preferred_worker)
    try {
      // Claim as the orchestrator, then route to the executing worker. Both go
      // through the validated state machine in callTool.
      await callTool('mc_claim_request', { request_id: r.id, worker: ACTOR })
      await logAudit('mc_claim_request', true)
      await callTool('mc_reassign_request', { request_id: r.id, worker })
      await logAudit('mc_reassign_request', true)
      routed.push({ id: r.id, title: r.title, worker })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await logAudit('mc_claim_request', false, msg)
      console.error(`[queue/dispatch] failed to route ${r.id}:`, msg)
    }
  }

  // Notify so a human dispatches a worker. Best-effort; silence if nothing routed.
  if (routed.length > 0) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (botToken && chatId) {
      const lines = routed.map(r => `• ${r.title || r.id.slice(0, 8)} → ${r.worker}`)
      const text = `🤖 Mission Control: picked up ${routed.length} queued request${routed.length > 1 ? 's' : ''} and routed ${routed.length > 1 ? 'them' : 'it'}. Run a worker session to execute:\n${lines.join('\n')}`
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        })
      } catch (e) {
        console.error('[queue/dispatch] telegram notify failed (non-fatal):', e)
      }
    }
  }

  return NextResponse.json({ picked_up: routed.length, routed })
}
