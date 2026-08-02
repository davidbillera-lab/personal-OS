import { createAdminSupabaseClient } from '@/lib/supabase'
import { QueueAutoRefresh } from '@/components/QueueAutoRefresh'

// Minimal local type for mc_requests (supabase/migrations/017_mc_requests.sql + 020_voice_slice.sql).
// No shared McRequest type exists in lib/types.ts yet — add one there if this table gains more consumers.
interface McRequest {
  id: string
  title: string | null
  request_text: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status:
    | 'submitted' | 'queued' | 'claimed' | 'in_progress' | 'blocked'
    | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
  assigned_to: string | null
  latest_progress: string | null
  blocker: string | null
  result_summary: string | null
  project_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  phase: string | null
  approved_by: string | null
  approved_at: string | null
  workspace_ref: string | null
  reviewed_sha: string | null
}

const statusColors: Record<string, string> = {
  submitted: 'bg-slate-100 text-slate-600',
  queued: 'bg-slate-100 text-slate-600',
  claimed: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-blue-100 text-blue-700',
  awaiting_approval: 'bg-amber-100 text-amber-700',
  blocked: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
}

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-slate-100 text-slate-500',
  low: 'bg-slate-100 text-slate-500',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function QueuePage() {
  const supabase = createAdminSupabaseClient()

  const [{ data: requests }, { data: projects }] = await Promise.all([
    supabase.from('mc_requests').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('projects').select('id, name'),
  ])

  const projectMap = new Map((projects ?? []).map(p => [p.id, p.name]))
  const items = (requests ?? []) as McRequest[]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Request Queue</h1>
        <QueueAutoRefresh />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No requests in the queue yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(req => {
            const projectName = req.project_id ? projectMap.get(req.project_id) ?? null : null
            const isBlocked = req.status === 'blocked' || !!req.blocker
            const title = req.title ?? req.request_text.slice(0, 80)

            return (
              <div key={req.id} className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[req.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {req.status.replace(/_/g, ' ')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityColors[req.priority] ?? 'bg-slate-100 text-slate-500'}`}>
                    {req.priority}
                  </span>
                  {projectName && (
                    <span className="text-[10px] text-muted-foreground">{projectName}</span>
                  )}
                  {req.assigned_to && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700">
                      {req.assigned_to}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground/60">{formatDate(req.created_at)}</span>
                </div>

                <p className="text-[11px] font-semibold text-foreground">{title}</p>
                <p className="text-[11px] text-muted-foreground leading-snug">{req.request_text}</p>

                {(req.phase || req.latest_progress) && (
                  <p className="text-[11px] text-foreground/80">
                    {req.phase && <span className="font-medium">{req.phase}</span>}
                    {req.phase && req.latest_progress && ' — '}
                    {req.latest_progress}
                  </p>
                )}

                {isBlocked && req.blocker && (
                  <p className="text-[11px] text-orange-700 bg-orange-50 rounded px-2 py-1">
                    Blocked: {req.blocker}
                  </p>
                )}

                {req.result_summary && (
                  <p className="text-[11px] text-muted-foreground italic">{req.result_summary}</p>
                )}

                {(req.reviewed_sha || req.workspace_ref || req.approved_by) && (
                  <div className="flex flex-wrap gap-x-3 text-[10px] text-muted-foreground/70">
                    {req.reviewed_sha && <span>sha {req.reviewed_sha.slice(0, 7)}</span>}
                    {req.workspace_ref && <span>{req.workspace_ref}</span>}
                    {req.approved_by && <span>approved by {req.approved_by}{req.approved_at ? ` · ${formatDate(req.approved_at)}` : ''}</span>}
                  </div>
                )}

                {req.completed_at && (
                  <p className="text-[10px] text-muted-foreground/60">Completed {formatDate(req.completed_at)}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
