import { ProjectForm } from '@/components/ProjectForm'
import { createProject } from './actions'

export default function NewProjectPage() {
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a project to Mission Control. You can fill in details now or come back later.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <ProjectForm action={createProject} submitLabel="Create Project" />
      </div>
    </div>
  )
}
