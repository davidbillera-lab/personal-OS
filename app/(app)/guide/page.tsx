import Link from 'next/link'

export const dynamic = 'force-dynamic'

const escalaBranches = [
  {
    label: 'New idea?',
    destination: 'Inbox',
    href: '/inbox',
    border: 'border-violet-500/40',
    bg: 'bg-violet-900/10',
    text: 'text-violet-300',
    dot: 'bg-violet-500',
    desc: 'Drop any idea, task, or note. AI classifies it.',
  },
  {
    label: 'Check status?',
    destination: 'Dashboard',
    href: '/',
    border: 'border-blue-500/40',
    bg: 'bg-blue-900/10',
    text: 'text-blue-300',
    dot: 'bg-blue-500',
    desc: 'See all projects, blockers, agent activity.',
  },
  {
    label: 'Need credentials?',
    destination: 'Vault',
    href: '/vault',
    border: 'border-purple-500/40',
    bg: 'bg-purple-900/10',
    text: 'text-purple-300',
    dot: 'bg-purple-500',
    desc: 'API keys, skills, and encrypted credentials.',
  },
  {
    label: 'Ready to ship?',
    destination: 'Ship',
    href: '/ship',
    border: 'border-green-500/40',
    bg: 'bg-green-900/10',
    text: 'text-green-300',
    dot: 'bg-green-500',
    desc: 'Run the pre-ship checklist before going live.',
  },
  {
    label: 'Need strategy?',
    destination: 'Advisory Board',
    href: '/inbox',
    border: 'border-amber-500/40',
    bg: 'bg-amber-900/10',
    text: 'text-amber-300',
    dot: 'bg-amber-500',
    desc: 'Open Inbox → run Advisory Board on any item.',
  },
  {
    label: 'Run a procedure?',
    destination: 'Runbook',
    href: '/runbook',
    border: 'border-gray-500/40',
    bg: 'bg-gray-700/10',
    text: 'text-gray-300',
    dot: 'bg-gray-500',
    desc: 'Step-by-step SOPs from project repos.',
  },
]

const features = [
  {
    name: 'Dashboard',
    href: '/',
    what: "Tiered project overview. See every project's stage, blockers, agent activity, and spec-ready tasks at a glance.",
    who: ['Operator', 'JJ', 'Vinnie'],
    when: 'Daily check-in. Start every session here.',
    notFor: 'Editing individual project details — go to the project page for that.',
  },
  {
    name: 'Inbox',
    href: '/inbox',
    what: 'Single capture point for ideas, tasks, bugs, and notes. AI classifies each entry and routes it to the right project.',
    who: ['Operator', 'JJ', 'Vinnie'],
    when: 'Any time you have an idea or observation. Drop it here before it disappears.',
    notFor: 'Tracking tasks already in flight — use the project workspace for that.',
  },
  {
    name: 'Projects',
    href: '/',
    what: 'Deep workspace for a specific project — tasks, generated specs, agent handoffs, and kill criteria status.',
    who: ['Operator', 'JJ'],
    when: 'When actively working a build. Click any project card on the dashboard to open it.',
    notFor: 'Starting a brand-new project — begin in Inbox, let it route to a project.',
  },
  {
    name: 'Advisory Board',
    href: '/inbox',
    what: 'Four AI personas (Partner, Advisor, Colleague, Friend) debate any idea and deliver a hard directive recommendation.',
    who: ['Operator', 'JJ'],
    when: 'Before committing to a direction. Run on any Inbox item via the Advisory Board button.',
    notFor: "Execution questions like 'how do I code this' — that's Claude Code's job.",
  },
  {
    name: 'Vault',
    href: '/vault',
    what: 'Encrypted credential store for API keys. Agents access keys over MCP without ever seeing them in plaintext.',
    who: ['Operator', 'JJ'],
    when: 'Adding or rotating an API key. Checking what credentials agents have access to.',
    notFor: 'General notes or project context — put those in decisions.md or the project workspace.',
  },
  {
    name: 'Ship',
    href: '/ship',
    what: 'Pre-ship checklist that gates deployment. Confirms landing page, analytics, exit-readiness, and first-100-users plan.',
    who: ['Operator', 'JJ'],
    when: 'A project has passed validation and is ready to go live.',
    notFor: 'Daily tracking of in-flight builds.',
  },
  {
    name: 'Runbook',
    href: '/runbook',
    what: "Pulls step-by-step SOPs from project repos (docs/runbooks/*.md). Vinnie-safe: click-by-click, no code required.",
    who: ['Vinnie', 'JJ'],
    when: 'Running a defined procedure: estate sale intake, listing upload, client onboarding.',
    notFor: 'Ad-hoc decisions or new workflows — escalate to operator if no runbook exists for it.',
  },
  {
    name: 'Orchestrate',
    href: '/orchestrate',
    what: 'Hand off a spec to an AI agent. Bundles project context and task into a ready-to-paste briefing for Claude Code, Codex, or Manus.',
    who: ['Operator', 'JJ'],
    when: 'You have an approved spec and want to kick off a build session.',
    notFor: 'Simple tasks you can do directly in Claude Code without orchestration overhead.',
  },
]

const WHO_COLORS: Record<string, string> = {
  Operator: 'bg-violet-900/50 text-violet-300',
  JJ: 'bg-blue-900/50 text-blue-300',
  Vinnie: 'bg-amber-900/50 text-amber-300',
}

const roadmap = [
  {
    label: 'Near',
    sub: '≤30 days',
    colorText: 'text-green-400',
    colorBar: 'bg-green-500',
    items: [
      'College Climb: JJ runs his real college search end-to-end (Phase 1 smoke test)',
      'VZT: Multi-tenant milestone — first paying tenant onboarding prep begins',
      'MC: Finance module stub → first real dashboard view (JSG P&L, estate sale revenue)',
    ],
  },
  {
    label: 'Medium',
    sub: '1–3 months',
    colorText: 'text-yellow-400',
    colorBar: 'bg-yellow-500',
    items: [
      'Finance module: JSG P&L view, estate sale revenue per event, consignment payout tracking',
      'Kill criteria dashboard: live pass / warn / fail per project in one view',
      'Voice inbox: drop ideas via voice-to-text from mobile, classified same as text dumps',
    ],
  },
  {
    label: 'Later',
    sub: '3+ months',
    colorText: 'text-gray-400',
    colorBar: 'bg-gray-500',
    items: [
      'Creative hub: REELFLOW asset library, campaign tracking, content calendar',
      'CRM lite: contacts for JSG clients, Marblism clients, and leads tied to project context',
      'Multi-user roles: Vinnie view (ops + runbooks only), JJ view (tech-capable, no admin)',
    ],
  },
]

export default function GuidePage() {
  return (
    <div className="flex flex-col gap-10 pb-16">

      {/* Hero */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
          Mission Control — User Guide
        </div>
        <h1 className="text-2xl font-bold text-white">Your portfolio operating system.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-300">
          Mission Control is the command layer for every JSG portfolio business. Every idea, task, decision,
          credential, and agent handoff flows through here. If you don&apos;t know where something lives,
          start in Inbox. If you don&apos;t know what&apos;s happening, open the Dashboard. This guide tells
          you what every surface does, who uses it, and how to wire in AI agents.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          This page is for JJ and Vinnie. You don&apos;t need to know how this was built — you need to know how to use it.
        </p>
      </section>

      {/* Escalagram */}
      <section>
        <h2 className="mb-5 text-sm font-semibold uppercase tracking-widest text-gray-400">
          Where should I go?
        </h2>
        <div className="flex flex-col items-center">
          {/* Root node */}
          <div className="rounded-xl border border-violet-500/50 bg-violet-900/20 px-8 py-3 text-center text-sm font-semibold text-white shadow-[0_0_24px_theme(colors.violet.950)]">
            What do you want to do?
          </div>
          {/* Vertical connector */}
          <div className="h-5 w-px bg-white/20" />
          {/* Branch cards */}
          <div className="w-full grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {escalaBranches.map(b => (
              <Link
                key={b.destination}
                href={b.href}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors hover:bg-white/[0.06] ${b.border} ${b.bg}`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                <span className={`text-xs font-medium leading-tight ${b.text}`}>{b.label}</span>
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${b.text}`}>
                  {b.destination}
                </span>
                <span className="text-[10px] leading-snug text-gray-500">{b.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400">Feature Reference</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(f => (
            <div key={f.name} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={f.href} className="text-sm font-semibold text-white hover:text-violet-300 transition-colors">
                  {f.name} →
                </Link>
                <div className="flex flex-wrap justify-end gap-1">
                  {f.who.map(w => (
                    <span key={w} className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${WHO_COLORS[w]}`}>
                      {w}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">{f.what}</p>
              <div className="mt-auto space-y-1.5 border-t border-white/5 pt-3">
                <p className="text-[10px] text-gray-500">
                  <span className="font-medium text-green-400/80">Use when:</span> {f.when}
                </p>
                <p className="text-[10px] text-gray-500">
                  <span className="font-medium text-red-400/70">Not for:</span> {f.notFor}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* AI Agent Setup */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-gray-400">AI Agent Setup</h2>
        <p className="mb-4 text-xs text-gray-600">For Operator and JJ only. Vinnie: skip this section.</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* MCP connection */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-xs font-semibold text-white">MCP Server Connection</h3>
            <p className="mb-3 text-[11px] leading-relaxed text-gray-400">
              Any AI agent with MCP support can connect to Mission Control and read/write project state,
              credentials, and tasks without leaving their context window.
            </p>
            <div className="rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-gray-300">
              <div className="text-gray-600">{'{'}</div>
              <div className="pl-4">&quot;mcpServers&quot;: {'{'}</div>
              <div className="pl-8">&quot;mission-control&quot;: {'{'}</div>
              <div className="pl-12">&quot;type&quot;: &quot;http&quot;,</div>
              <div className="pl-12">
                &quot;url&quot;: &quot;<span className="text-violet-400">https://personal-os-jsg1.vercel.app/api/mcp</span>&quot;,
              </div>
              <div className="pl-12">&quot;headers&quot;: {'{'}</div>
              <div className="pl-16">
                &quot;Authorization&quot;: &quot;Bearer <span className="text-amber-400">YOUR_MCP_KEY</span>&quot;
              </div>
              <div className="pl-12">{'}'}</div>
              <div className="pl-8">{'}'}</div>
              <div className="pl-4">{'}'}</div>
              <div>{'}'}</div>
            </div>
            <p className="mt-2 text-[10px] text-gray-600">
              API key: Vault → Credentials → <span className="text-purple-400">MCP_API_KEY</span>
            </p>
          </div>

          {/* Model tiers */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-xs font-semibold text-white">Model Tier Cheat Sheet</h3>
            <p className="mb-3 text-[11px] leading-relaxed text-gray-400">
              Match the model to the job. Default to cheap. Escalate only when being wrong costs real time or money.
            </p>
            <div className="space-y-2">
              {[
                {
                  tier: '1',
                  model: 'Haiku 4.5',
                  color: 'text-green-400',
                  bg: 'bg-green-900/10',
                  use: 'Classify, tag, summarize, extract data, yes/no checks',
                },
                {
                  tier: '2',
                  model: 'Sonnet 4.6',
                  color: 'text-yellow-400',
                  bg: 'bg-yellow-900/10',
                  use: 'Plan, spec, review, multi-step reasoning, drafts',
                },
                {
                  tier: '3',
                  model: 'Opus 4.7+',
                  color: 'text-red-400',
                  bg: 'bg-red-900/10',
                  use: 'Architecture, complex debug, novel builds — use sparingly',
                },
              ].map(t => (
                <div key={t.tier} className={`flex gap-3 rounded-lg p-2.5 ${t.bg} border border-white/5`}>
                  <span className={`mt-0.5 shrink-0 text-xs font-bold ${t.color}`}>T{t.tier}</span>
                  <div>
                    <p className="text-[11px] font-medium text-white">{t.model}</p>
                    <p className="text-[10px] text-gray-500">{t.use}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tool routing */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-xs font-semibold text-white">Tool Routing</h3>
            <p className="mb-3 text-[11px] leading-relaxed text-gray-400">
              Different tools for different jobs. Route correctly or you waste tokens and time.
            </p>
            <div className="space-y-2">
              {[
                {
                  tool: 'Claude Code',
                  use: 'Deep refactors, multi-file builds, anything needing full codebase context.',
                },
                {
                  tool: 'Codex',
                  use: 'QC review only — read-only analysis. Documents issues and suggestions. Does NOT implement changes.',
                },
                {
                  tool: 'Manus',
                  use: 'Browser automation, multi-step web tasks where the path is uncertain. Not for core dependencies.',
                },
                {
                  tool: 'Lovable',
                  use: 'Rapid prototyping only. Not for production builds — clashes with multi-agent GitHub pushes.',
                },
              ].map(t => (
                <div key={t.tool} className="rounded-lg bg-white/5 p-2.5">
                  <p className="text-[11px] font-semibold text-white">{t.tool}</p>
                  <p className="mt-0.5 text-[10px] text-gray-500">{t.use}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* Roadmap */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400">Roadmap</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {roadmap.map(phase => (
            <div key={phase.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center gap-2">
                <div className={`h-3 w-0.5 rounded-full ${phase.colorBar}`} />
                <span className={`text-xs font-semibold uppercase tracking-widest ${phase.colorText}`}>
                  {phase.label}
                </span>
                <span className="text-xs text-gray-600">{phase.sub}</span>
              </div>
              <ul className="space-y-2">
                {phase.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[11px] leading-snug text-gray-400">
                    <span className="mt-0.5 shrink-0 text-gray-600">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
