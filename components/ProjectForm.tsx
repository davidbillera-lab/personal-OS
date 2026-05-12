import type { Project, ProjectStage, ProjectTier } from '@/lib/types'

const STAGES: ProjectStage[] = ['idea', 'spec', 'build', 'ship', 'scale', 'kill']
const TIERS: { value: ProjectTier; label: string }[] = [
  { value: 1, label: 'Tier 1 — Protect & Accelerate' },
  { value: 2, label: 'Tier 2 — Active Build' },
  { value: 3, label: 'Tier 3 — Personal / Family' },
]
const LEAD_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
  'codex-mini-latest',
]

interface Props {
  action: (formData: FormData) => Promise<void>
  project?: Project
  submitLabel?: string
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
const selectCls = `${inputCls} cursor-pointer`
const textareaCls = `${inputCls} resize-none`

export function ProjectForm({ action, project, submitLabel = 'Save' }: Props) {
  return (
    <form action={action} className="flex flex-col gap-5">
      {/* Name */}
      <Field label="Project Name *">
        <input
          name="name"
          required
          defaultValue={project?.name ?? ''}
          placeholder="e.g. VZT Multi-tenant"
          className={inputCls}
        />
      </Field>

      {/* Tier + Stage row */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tier *">
          <select name="tier" required defaultValue={project?.tier ?? 2} className={selectCls}>
            {TIERS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Stage *">
          <select name="stage" required defaultValue={project?.stage ?? 'idea'} className={selectCls}>
            {STAGES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Protected */}
      <Field label="Protected">
        <select name="protected" defaultValue={project?.protected ? 'true' : 'false'} className={selectCls}>
          <option value="false">No</option>
          <option value="true">Yes — Tier 1 protection rules apply</option>
        </select>
      </Field>

      {/* Description */}
      <Field label="Description">
        <textarea
          name="description"
          rows={2}
          defaultValue={project?.description ?? ''}
          placeholder="One sentence on what this project is."
          className={textareaCls}
        />
      </Field>

      {/* Repo URL + Local Path row */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="GitHub Repo URL">
          <input
            name="repo_url"
            type="url"
            defaultValue={project?.repo_url ?? ''}
            placeholder="https://github.com/you/repo"
            className={inputCls}
          />
        </Field>

        <Field label="Local Path">
          <input
            name="local_path"
            defaultValue={project?.local_path ?? ''}
            placeholder="C:\Users\david\Documents\..."
            className={inputCls}
          />
        </Field>
      </div>

      {/* Status */}
      <Field label="Status">
        <input
          name="status"
          defaultValue={project?.status ?? ''}
          placeholder="One sentence on where things stand."
          className={inputCls}
        />
      </Field>

      {/* Next Action */}
      <Field label="Next Action">
        <textarea
          name="next_action"
          rows={2}
          defaultValue={project?.next_action ?? ''}
          placeholder="What should the next agent or session tackle first?"
          className={textareaCls}
        />
      </Field>

      {/* Blockers */}
      <Field label="Blockers">
        <input
          name="blockers"
          defaultValue={project?.blockers ?? ''}
          placeholder="What's blocking progress? Leave blank if none."
          className={inputCls}
        />
      </Field>

      {/* Exit Thesis */}
      <Field label="Exit Thesis">
        <input
          name="exit_thesis"
          defaultValue={project?.exit_thesis ?? ''}
          placeholder="e.g. Flippa at 3x ARR, or strategic acquisition by estate SaaS"
          className={inputCls}
        />
      </Field>

      {/* Lead Model */}
      <Field label="Lead Model">
        <select name="lead_model" defaultValue={project?.lead_model ?? 'claude-sonnet-4-6'} className={selectCls}>
          {LEAD_MODELS.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
