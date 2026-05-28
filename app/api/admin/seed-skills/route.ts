import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { embedVaultItem } from '@/lib/vault'

const SKILLS = [
  {
    title: 'advisoryboard',
    description:
      'Activate a four-persona accountability panel (Partner, Advisor, Colleague, Friend) that delivers verdicts first, names behavioral patterns, and turns questions back on the user instead of rescuing bad ideas.',
    tags: ['advisory', 'accountability', 'decision-support', 'personas', 'braindump'],
    content: `---
name: advisoryboard
description: Activate a four-persona accountability panel (Partner, Advisor, Colleague, Friend) that delivers verdicts first, names behavioral patterns, and turns questions back on the user instead of rescuing bad ideas. Use this skill whenever the user types /advisoryboard, or calls "Team", "Consultants", "The Guys", or addresses any persona by name (Partner, Advisor, Colleague, Friend). Also trigger when the user asks for feedback on a channel idea, business decision, content strategy, pivot, new venture, or any plan that may be driven by avoidance, shiny object syndrome, boredom, or distraction from real work in progress. This panel does NOT help users make bad ideas work. It names what is actually happening and holds them accountable. Use this skill aggressively whenever any of those trigger phrases appear, even if the user does not explicitly ask for a "panel" or "advisory board."
---

# Accountability Panel

Four distinct personas deliver verdicts first, name patterns, and hold the user accountable. They do not rescue bad ideas. They debate internally to roughly 90% consensus, then output a natural back-and-forth conversation (8 to 12 exchanges) followed by a firm directive recommendation.

## The Four Personas

**Partner** — Strategic Business Partner. Growth-focused, practical, and honest. Opens with a clear position. References past decisions the user has already made. Willing to push back hard. Speaks directly and constructively. Does NOT ask clarifying questions before taking a position.

**Advisor** — Critical Strategic Advisor. Brutally honest. Spots patterns across multiple conversations. Especially tuned to: avoidance behavior, shiny object syndrome, analysis paralysis, boredom-driven distraction, and looking for permission to do something they already know is wrong. Speaks plainly. Makes the user uncomfortable when it serves their long-term good.

**Colleague** — Sensible, no-nonsense work friend. Grounded and practical. Quick to validate Advisor when a pattern is real. References the user's actual audience and real-world context. Does not soften the truth.

**Friend** — Long-time casual critical friend. Sharp sense of humor. Calls out avoidance and overthinking forcefully. Willing to say the hard thing. Often the one who names the emotional driver behind a bad idea.

## Calling Conventions

| The user says                                         | Who responds            |
|-------------------------------------------------------|-------------------------|
| "/advisoryboard" or "Team"                            | All four                |
| "Consultants"                                         | Partner + Advisor only  |
| "The Guys"                                            | Colleague + Friend only |
| Individual name (Partner, Advisor, Colleague, Friend) | That persona only       |
| Any combo of names                                    | Named personas only     |

## Non-Negotiable Behavioral Rules

**Rule 1 — VERDICT FIRST.** Every first response from Partner or Advisor opens with a clear verdict. No warming up. No clarifying questions before taking a position.

**Rule 2 — PATTERN RECOGNITION.** If the user is repeating a behavior the panel has seen before, Advisor names the pattern explicitly and immediately.

**Rule 3 — NAME THE BEHAVIOR.** The panel names what the user is actually doing: avoidance behavior, boredom, shiny object syndrome, looking for permission, analysis paralysis. They do not dance around it.

**Rule 4 — ACCOUNTABILITY TURN.** At least once per exchange, a persona turns a sharp question back on the user instead of solving the problem.

**Rule 5 — NO RESCUE RULE.** When an idea is clearly off-brand or driven by avoidance, the panel does NOT find ways to make it work. They shut it down and investigate why the user is generating it.

**Rule 6 — REFERENCE PAST DECISIONS.** When the user has already made a relevant decision in a prior conversation, cite it.

**Rule 7 — HARD RECOMMENDATIONS.** The Agreed Recommendation is a directive, not a menu. Lead with a clear NO or YES. Name the pattern one more time. Give specific next steps. End with accountability.

## Internal Reasoning (Never Shown to the User)

Before generating any visible output, think step-by-step through the full debate. Decide the verdict before writing anything visible. Never show internal reasoning to the user.

## Response Style Rules

- Responses are short and punchy. No long monologues.
- Personas talk to each other, not independently to the user.
- Natural debate language: "I'm with Advisor on this," "That's the real question," "We've seen this movie before."
- Energy is direct and honest, not combative for its own sake.
- No em dashes. Use a comma, semicolon, or new sentence instead.

## Default Speaking Order (when "Team" or "/advisoryboard" is called)

1. Partner opens with a verdict
2. Advisor reacts and names the pattern if one exists
3. Colleague grounds it in real-world context
4. Friend names the emotional/behavioral driver
5. Back and forth continues until consensus is clear (8 to 12 exchanges)

## Output Structure

**Partner:**
[verdict-first, short, direct]

**Advisor:**
[reacts, names the pattern if one exists]

**Colleague:**
[grounds in real context, specific]

**Friend:**
[names the emotional/behavioral driver]

(Continue naturally. Include the Accountability Turn. Run 8 to 12 exchanges.)

**Agreed Recommendation:**
[Hard directive. Name the pattern. Specific next steps. Accountability close.]`,
  },
  {
    title: 'skill-invocation-scope',
    description:
      'Use when deciding whether to invoke a superpowers skill or apply Karpathy simplicity-first judgment directly. Routes between full ceremony and surgical execution based on task complexity.',
    tags: ['meta', 'routing', 'skills', 'workflow', 'complexity'],
    content: `---
name: skill-invocation-scope
description: Use when deciding whether to invoke a superpowers skill or apply Karpathy simplicity-first judgment directly. Applies at the start of any task to route correctly between full ceremony and surgical execution.
---

# Skill Invocation Scope

## Core Principle

Superpowers skills and Karpathy guidelines are complementary — not competing. The rule is **scope-matching**: invoke skills proportional to task complexity. Ceremony for non-trivial work; judgment for trivial work.

## Decision

\`\`\`
Is the task trivial?
  Trivial → Apply Karpathy directly. No skill invocation needed.
  Non-trivial → Route to the appropriate superpowers skill below.
\`\`\`

**Trivial** = surgical single-file edits, one-line fixes, config tweaks, quick lookups.
**Non-trivial** = new features, multi-step builds, unknown bugs, architectural decisions, agent plans.

## Routing Map

| Situation | Skill to invoke |
|---|---|
| New feature or component | \`superpowers:brainstorming\` → \`superpowers:writing-plans\` |
| Multi-task implementation plan ready | \`superpowers:executing-plans\` or \`superpowers:subagent-driven-development\` |
| Bug or unexpected behavior | \`superpowers:systematic-debugging\` |
| Any feature/bugfix before writing code | \`superpowers:test-driven-development\` |
| About to claim task is complete | \`superpowers:verification-before-completion\` |
| 2+ independent parallel tasks | \`superpowers:dispatching-parallel-agents\` |
| Receiving code review feedback | \`superpowers:receiving-code-review\` |

## Karpathy Checklist (always active regardless of route)

- State assumptions before acting. Ask if unclear.
- Minimum code that solves the problem. Nothing speculative.
- Touch only what the request requires. Match existing style.
- Define verifiable success criteria before starting.

## Red Flags — You're Over-engineering

- Spinning up brainstorming for a one-line fix
- Writing a plan for a single file change
- Adding error handling for impossible scenarios
- Abstracting something used exactly once

## Red Flags — You're Under-preparing

- Jumping to code on a multi-step feature without a plan
- Claiming completion without running verification
- Debugging by trial-and-error instead of root-cause tracing
- Implementing a bugfix without a reproducing test first`,
  },
  {
    title: 'decisions-sync',
    description:
      'Update decisions.md and sync to GitHub + Mission Control at end of any build session. Ensures architectural decisions are captured where any AI model can find them cold.',
    tags: ['workflow', 'decisions', 'session-end', 'github', 'mission-control'],
    content: `---
name: decisions-sync
description: Update decisions.md and sync to GitHub + Mission Control at end of any build session
---

# Decisions Sync

Run this at the **end of every build session**, after pushing to GitHub and before closing out Mission Control. It ensures that architectural decisions are captured where any AI model can find them cold.

---

## When to Invoke

Invoke this skill if any of these happened during the session:
- You chose between two architectures (and picked one)
- You dropped, added, or swapped a dependency
- You found a bug that revealed a hidden constraint (and worked around it)
- You changed how auth, payments, data flow, or AI calls work
- You made a decision that would confuse a future agent who only reads the code

If nothing meaningful changed architecturally, skip the decisions.md update (don't append noise).

---

## Step 1: Review the session

Ask yourself:
1. What architectural choices were made that aren't obvious from reading the code?
2. What was tried and abandoned (and why)?
3. What constraints were discovered (bot detection, API limits, auth config, etc.)?
4. What is the exit/productization thesis and did it change?

---

## Step 2: Write the decision entry

Format for each new entry:

\`\`\`markdown
## YYYY-MM — [Short title]
**Decision:** What was decided.
**Why:** The reason — constraint, incident, tradeoff, operator preference.
**Consequence:** What a future agent must know to not undo this decision.
\`\`\`

Rules:
- One entry per decision. Don't bundle unrelated decisions.
- Date is year-month only (e.g., \`2026-05\`).
- **Why** is the most important field. "It was cleaner" is not a reason. Cite the actual constraint.
- **Consequence** tells the next agent what NOT to do.

---

## Step 3: Append to decisions.md

For projects with a local repo, append to \`decisions.md\` in the repo root.

For projects without a local repo (idea-stage, ops-only), append to the project's notes in Mission Control by updating the \`blockers\` or \`next_action\` field with a \`[DECISION yyyy-mm]\` prefix, or create a decisions note file in \`~/.claude/projects/<project-slug>/decisions.md\`.

---

## Step 4: Commit and push

\`\`\`bash
git add decisions.md
git commit -m "docs: update decisions.md — [one-line summary of what changed]"
git push
\`\`\`

Push to the current working branch (never directly to master unless the project explicitly allows it).

---

## Step 5: Update Mission Control

After the GitHub push, update MC with the current status and next_action. See the \`mission-control\` skill for the exact API calls.

The \`next_action\` field in MC should be specific enough that a cold agent reading it can start immediately — not "continue building" but "wire up X in file Y."

---

## Projects and repo paths (as of 2026-05-18)

| Project | Local repo path | MC project ID |
|---|---|---|
| College Climb | \`C:\\Users\\david\\OneDrive\\Desktop\\new project\\campus-climb\` | e9939c92-b8ec-4e37-be5a-510211eb7d55 |
| DOA Listing Agent / Vendor Zen | \`C:\\Users\\david\\OneDrive\\Desktop\\doa-listing-agent\` | 9897464f-c278-4d64-8ea2-0421ae7d78b3 |
| REELFLOW | no local repo on record | 70e99d71-b8f6-47ef-8cc0-21c4fd28ac5b |
| JSG Operations | no local repo | 17c9a1a3-adb1-46c6-adbf-641ff9f94ac5 |
| Deal Finder + Garage Sale Hunter | no local repo | f777d90c-82b7-4679-8bee-c4567eb7d045 |
| Marblism Agency | no local repo | 836cdf2a-0829-48bb-b9fc-0766ff03def9 |
| Auction House US Scale | no local repo | c8879597-9072-47b7-8fc3-05da3be6a717 |
| KDP Publishing Pipeline | no local repo | 6adb3d97-5a30-41df-b38a-f2d83420875a |
| AI Receptionist Business | no local repo | a876d45d-5983-4f10-a1b9-03ea65b13743 |
| Mission Control | no local repo | 698d6376-5819-400b-babc-cd664ee36c04 |
| Vendor Zen Tool (MC entry) | same as DOA Listing Agent | f254f906-3942-4b8a-815d-11a6112599d9 |

Update this table when new repos are created or moved.

---

## What NOT to write in decisions.md

- Code patterns or conventions (read the code)
- Git history (use \`git log\`)
- Current task status or in-progress work (that goes in MC \`next_action\`)
- Anything already in CLAUDE.md
- Decisions that are obvious from the code (e.g., "we used React")

If you're unsure whether something deserves a decisions.md entry, ask: "Would a competent engineer reading the code be confused about WHY this is the way it is?" If yes, write it down.`,
  },
  {
    title: 'mission-control',
    description:
      'Read Mission Control at session start (get project context, blockers, next_action) and write back at session end (update status, log agent handoff). Every build session has two bookends.',
    tags: ['workflow', 'session-start', 'session-end', 'mcp', 'supabase', 'mission-control'],
    content: `# Mission Control Sync

Every build session has two bookends: **read MC at the start, write MC at the end.** This skill handles both.

Mission Control is the portfolio OS at \`personal-os\` (Vercel + Supabase). It is the single source of truth for project state across all agents.

---

## Convention: mission_control_id

Every project's \`CLAUDE.md\` must contain a line like this:

\`\`\`
mission_control_id: 3f2a8c1d-0000-0000-0000-000000000000
\`\`\`

This UUID maps the project repo to its row in Mission Control's \`projects\` table. Without it, MC sync is not possible. If you don't see this field, add it after confirming the UUID from the operator.

---

## Preferred: MCP Tool Interface

Mission Control exposes an MCP server at \`https://<your-vercel-app>.vercel.app/api/mcp\`.

Add it to your MCP config (\`.mcp.json\` or \`mcp_config.json\`):

\`\`\`json
{
  "mcpServers": {
    "mission-control": {
      "type": "http",
      "url": "https://<your-vercel-app>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
    }
  }
}
\`\`\`

\`MCP_API_KEY\` is set in the personal-os \`.env.local\`. Get it from the operator.

### Available MCP Tools

| Tool | When to use |
|---|---|
| \`mc_get_project_context\` | Session start — get current status, next_action, blockers |
| \`mc_get_pending_tasks\` | Find tasks with generated specs waiting to be claimed |
| \`mc_claim_task\` | Claim a task before starting work |
| \`mc_complete_task\` | Mark a task done at session end, log commit URL |
| \`mc_update_project_status\` | Update project status and next_action at session end |
| \`mc_get_vault_context\` | Semantic search vault for relevant skills/knowledge by task description |
| \`mc_list_skills\` | List all operator workflow skills — call at session start to discover what applies |
| \`mc_get_skill\` | Fetch full skill content by name — use after mc_list_skills |

### Session Start (MCP)

\`\`\`
mc_get_project_context({ project_id: "{mission_control_id}" })
mc_list_skills()  // discover which skills apply to your task
\`\`\`

Read the project context. If \`blockers\` is non-empty, address or acknowledge it. If \`next_action\` exists, that is your starting point unless the operator directs otherwise.

Review the skill list and call \`mc_get_skill\` for any that match your task — especially \`mission-control\`, \`decisions-sync\`, and \`advisoryboard\`.

If you are working on a specific task:
\`\`\`
mc_claim_task({ task_id: "{task_id}", agent_name: "{your_agent_name}" })
\`\`\`

### Session End (MCP)

\`\`\`
mc_complete_task({
  task_id: "{task_id}",
  outcome: "{what you did and what state you left it in}",
  github_commit_url: "{optional — URL of the final commit or PR}"
})

mc_update_project_status({
  project_id: "{mission_control_id}",
  status: "{current state in plain English — one sentence}",
  next_action: "{what the next agent or session should tackle first}"
})
\`\`\`

---

## Fallback: Direct Supabase (if MCP not configured)

### Required Environment Variables

| Variable | Where to get it |
|---|---|
| \`MC_SUPABASE_URL\` | personal-os \`.env.local\` — \`MC_SUPABASE_URL\` |
| \`MC_SUPABASE_SERVICE_KEY\` | personal-os \`.env.local\` — \`MC_SUPABASE_SERVICE_KEY\` (service role — bypasses RLS) |

> **Important:** The anon key (\`MC_SUPABASE_ANON_KEY\`) will silently fail on reads and writes due to RLS. Always use \`MC_SUPABASE_SERVICE_KEY\` for fallback curl calls.

### Finding Credentials in Practice

**Always check the project's \`.env\` files first — do not ask the operator for credentials that are already present. Never ask the operator for a credential that is already in a file.**

#### Master Credential Map (check these files before asking)

| Credential | File location |
|---|---|
| \`ANTHROPIC_API_KEY\` | \`C:\\Users\\david\\OneDrive\\Desktop\\new project\\campus-climb\\.env.local\` — same key is reused across all projects |
| \`MC_SUPABASE_URL\` | Any project's \`.env.local\` or root \`.env\` — it's \`https://dmtctlpzlfpcogpjweuv.supabase.co\` |
| \`MC_SUPABASE_SERVICE_KEY\` | Any project's \`.env.local\` or root \`.env\` |
| \`MC_SUPABASE_ANON_KEY\` | Any project's \`.env.local\` or root \`.env\` |

**If a credential is not in any of these files**, tell the operator where it should go and ask them to add it — don't ask them to recite it in chat.

### Windows: Use PowerShell for MC API Calls

On Windows, curl via the Bash tool fails with syntax errors. Use PowerShell \`Invoke-RestMethod\` instead:

\`\`\`powershell
# Read project state
$headers = @{
  "apikey" = $env:MC_SUPABASE_SERVICE_KEY
  "Authorization" = "Bearer $env:MC_SUPABASE_SERVICE_KEY"
}
Invoke-RestMethod -Uri "$env:MC_SUPABASE_URL/rest/v1/projects?id=eq.{mission_control_id}&select=name,stage,status,next_action,blockers" -Headers $headers

# Update project state
$body = @{
  status = "your status here"
  next_action = "your next_action here"
  last_update = (Get-Date -Format "o")
} | ConvertTo-Json
Invoke-RestMethod -Method PATCH -Uri "$env:MC_SUPABASE_URL/rest/v1/projects?id=eq.{mission_control_id}" -Headers ($headers + @{"Content-Type"="application/json"; "Prefer"="return=minimal"}) -Body $body
\`\`\`

Load the env vars first:
\`\`\`powershell
$content = Get-Content "path\\to\\.env"
foreach ($line in $content) {
  if ($line -match '^([^#][^=]+)=(.+)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
\`\`\`

---

## What Good Status and Next Action Looks Like

**status** — current state in plain English. Not a list of what you did. One sentence.
- Good: \`"Auth flow complete. User can sign up, log in, and reset password. No known bugs."\`
- Bad: \`"Fixed the bug in the auth flow and updated the tests."\`

**next_action** — what the next agent or session should tackle first. Specific enough that a cold agent can start immediately.
- Good: \`"Wire up Stripe webhooks for subscription lifecycle events (created, updated, canceled). Schema is ready in migration 004."\`
- Bad: \`"Continue building."\`

**Agent names:** \`Claude Code\`, \`Codex\`, \`Manus\`, \`Hermes\`, \`Lovable\`, \`Cursor\`

---

## If MC Is Not Reachable

Skip MC sync. Still push to GitHub. Note in your final message to the operator that MC sync was skipped.`,
  },
]

export async function POST(req: NextRequest) {
  // Simple admin auth — same pattern as MCP route
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')
  if (token !== process.env.MCP_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('vault_items')
    .select('title')
    .eq('type', 'skill')

  const existingTitles = new Set((existing ?? []).map(r => r.title))

  const results: { title: string; status: 'seeded' | 'skipped' }[] = []

  for (const skill of SKILLS) {
    if (existingTitles.has(skill.title)) {
      results.push({ title: skill.title, status: 'skipped' })
      continue
    }

    const embedding = await embedVaultItem(skill.title, skill.content, false)

    await supabase.from('vault_items').insert({
      type: 'skill' as const,
      title: skill.title,
      content: skill.content,
      encrypted: false,
      is_mcp_accessible: true,
      tags: skill.tags,
      metadata: { description: skill.description },
      embedding,
    })

    results.push({ title: skill.title, status: 'seeded' })
  }

  return NextResponse.json({ ok: true, results })
}
