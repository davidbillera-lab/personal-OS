import { notFound } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { ProjectForm } from '@/components/ProjectForm'
import { updateProject } from './actions'
import Link from 'next/link'

interface Props { params: Promise<{ id: string }> }

export default async function EditProjectPage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminSupabaseClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const boundAction = updateProject.bind(null, project.id)

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Project</h1>
          <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
        </div>
        <Link
          href={`/projects/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to workspace
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <ProjectForm action={boundAction} project={project} submitLabel="Save Changes" />
      </div>
    </div>
  )
}
