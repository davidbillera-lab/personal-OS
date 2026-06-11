import Link from 'next/link'
// Badge removed (unused) — kept import commented out for quick re-enable if needed
// import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Project, KillCriteriaStatus, ProjectStage } from '@/lib/types'

const stageColors: Record<ProjectStage, string> = {
  idea:  'bg-slate-100 text-slate-700',
  spec:  'bg-blue-100 text-blue-700',
  build: 'bg-yellow-100 text-yellow-700',
  ship:  'bg-green-100 text-green-700',
  scale: 'bg-emerald-100 text-emerald-700',
  kill:  'bg-red-100 text-red-700',
}

const killColors: Record<KillCriteriaStatus, string> = {
  pass:    'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-800',
  fail:    'bg-red-100 text-red-700',
  exempt:  'bg-purple-100 text-purple-700',
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Card className="flex flex-col gap-0">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">
            {project.name}
            {project.protected && (
              <span className="ml-1.5 text-[10px] font-medium text-amber-600 tracking-wide">PROTECTED</span>
            )}
          </CardTitle>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${stageColors[project.stage]}`}>
            {project.stage}
          </span>
        </div>

        {project.kill_criteria_status && (
          <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ${killColors[project.kill_criteria_status]}`}>
            kill: {project.kill_criteria_status}
          </span>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-2 pt-0 text-xs text-muted-foreground">
        {project.status && (
          <p className="leading-snug">{project.status}</p>
        )}

        {project.blockers && (
          <div className="rounded-md bg-red-50 px-2 py-1 text-red-700">
            <span className="font-medium">Blocked:</span> {project.blockers}
          </div>
        )}

        {project.next_action && (
          <div className="rounded-md bg-muted px-2 py-1">
            <span className="font-medium text-foreground">Next:</span> {project.next_action}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/60">
          Updated {timeSince(project.last_update)}
        </p>

        <div className="flex items-center justify-between pt-1">
          <Link
            href={`/projects/${project.id}`}
            className="text-[11px] font-medium text-foreground hover:underline"
          >
            Open workspace →
          </Link>
          {project.local_path && (
            <a
              href={`vscode://file/${project.local_path?.replace(/\\/g, '/')}`}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Open in VS Code
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
