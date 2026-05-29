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
    title: 'brainstorming',
    description:
      'Use before any creative work — creating features, building components, adding functionality, or modifying behavior. Explores intent, requirements, and design through collaborative dialogue before any implementation.',
    tags: ['workflow', 'design', 'planning', 'pre-implementation', 'spec'],
    content: `---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Checklist

You MUST create a task for each of these items and complete them in order:

1. **Explore project context** — check files, docs, recent commits
2. **Offer visual companion** (if topic will involve visual questions) — this is its own message, not combined with a clarifying question. See the Visual Companion section below.
3. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to their complexity, get user approval after each section
6. **Write design doc** — save to \`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md\` and commit
7. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
8. **User reviews written spec** — ask user to review the spec file before proceeding
9. **Transition to implementation** — invoke writing-plans skill to create implementation plan

## Process Flow

\`\`\`dot
digraph brainstorming {
    "Explore project context" [shape=box];
    "Visual questions ahead?" [shape=diamond];
    "Offer Visual Companion\\n(own message, no other content)" [shape=box];
    "Ask clarifying questions" [shape=box];
    "Propose 2-3 approaches" [shape=box];
    "Present design sections" [shape=box];
    "User approves design?" [shape=diamond];
    "Write design doc" [shape=box];
    "Spec self-review\\n(fix inline)" [shape=box];
    "User reviews spec?" [shape=diamond];
    "Invoke writing-plans skill" [shape=doublecircle];

    "Explore project context" -> "Visual questions ahead?";
    "Visual questions ahead?" -> "Offer Visual Companion\\n(own message, no other content)" [label="yes"];
    "Visual questions ahead?" -> "Ask clarifying questions" [label="no"];
    "Offer Visual Companion\\n(own message, no other content)" -> "Ask clarifying questions";
    "Ask clarifying questions" -> "Propose 2-3 approaches";
    "Propose 2-3 approaches" -> "Present design sections";
    "Present design sections" -> "User approves design?";
    "User approves design?" -> "Present design sections" [label="no, revise"];
    "User approves design?" -> "Write design doc" [label="yes"];
    "Write design doc" -> "Spec self-review\\n(fix inline)";
    "Spec self-review\\n(fix inline)" -> "User reviews spec?";
    "User reviews spec?" -> "Write design doc" [label="changes requested"];
    "User reviews spec?" -> "Invoke writing-plans skill" [label="approved"];
}
\`\`\`

**The terminal state is invoking writing-plans.** Do NOT invoke frontend-design, mcp-builder, or any other implementation skill. The ONLY skill you invoke after brainstorming is writing-plans.

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → plan → implementation cycle.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

**Design for isolation and clarity:**

- Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently
- For each unit, you should be able to answer: what does it do, how do you use it, and what does it depend on?
- Can someone understand what a unit does without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work.
- Smaller, well-bounded units are also easier for you to work with - you reason better about code you can hold in context at once, and your edits are more reliable when files are focused. When a file grows large, that's often a signal that it's doing too much.

**Working in existing codebases:**

- Explore the current structure before proposing changes. Follow existing patterns.
- Where existing code has problems that affect the work (e.g., a file that's grown too large, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design - the way a good developer improves code they're working in.
- Don't propose unrelated refactoring. Stay focused on what serves the current goal.

## After the Design

**Documentation:**

- Write the validated design (spec) to \`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md\`
  - (User preferences for spec location override this default)
- Commit the design document to git

**Spec Self-Review:**
After writing the spec document, look at it with fresh eyes:

1. **Placeholder scan:** Any "TBD", "TODO", incomplete sections, or vague requirements? Fix them.
2. **Internal consistency:** Do any sections contradict each other? Does the architecture match the feature descriptions?
3. **Scope check:** Is this focused enough for a single implementation plan, or does it need decomposition?
4. **Ambiguity check:** Could any requirement be interpreted two different ways? If so, pick one and make it explicit.

Fix any issues inline. No need to re-review — just fix and move on.

**User Review Gate:**
After the spec review loop passes, ask the user to review the written spec before proceeding:

> "Spec written and committed to \`<path>\`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan."

Wait for the user's response. If they request changes, make them and re-run the spec review loop. Only proceed once the user approves.

**Implementation:**

- Invoke the writing-plans skill to create a detailed implementation plan
- Do NOT invoke any other skill. writing-plans is the next step.

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design, get approval before moving on
- **Be flexible** - Go back and clarify when something doesn't make sense

## Visual Companion

A browser-based companion for showing mockups, diagrams, and visual options during brainstorming. Available as a tool — not a mode.

**Offering the companion:** When you anticipate that upcoming questions will involve visual content (mockups, layouts, diagrams), offer it once for consent:
> "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. Want to try it? (Requires opening a local URL)"

**This offer MUST be its own message.** Do not combine it with clarifying questions or any other content. Wait for the user's response before continuing.

**Per-question decision:** Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. Use the browser only for content that IS visual — mockups, wireframes, layout comparisons, architecture diagrams. Use the terminal for text-based questions.`,
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
  {
    title: 'dynamic-workflow',
    description:
      'Use when the user types /dynamic-workflow, or asks to "run the dynamic workflow", "plan and build this", "complete this framework/project", or otherwise hands you a non-trivial multi-step build, feature, or refactor that deserves a real plan before code. Runs a disciplined five-phase loop — Explore → Design → Review → Write Plan → Approval Gate — then implements only after the user approves, and closes the session by pushing to GitHub (and, if configured, Mission Control). Do NOT use for trivial one-file edits, lookups, or quick fixes; those get surgical judgment, not ceremony.',
    tags: ['workflow', 'planning', 'plan-mode', 'build-loop', 'process', 'handoff'],
    content: `---
name: dynamic-workflow
description: Use when the user types /dynamic-workflow, or asks to "run the dynamic workflow", "plan and build this", "complete this framework/project", or otherwise hands you a non-trivial multi-step build, feature, or refactor that deserves a real plan before code. Runs a disciplined five-phase loop — Explore → Design → Review → Write Plan → Approval Gate — then implements only after the user approves, and closes the session by pushing to GitHub (and, if configured, Mission Control). Do NOT use for trivial one-file edits, lookups, or quick fixes; those get surgical judgment, not ceremony.
---

# Dynamic Workflow

A repeatable build loop that turns a vague request into an approved plan, then working code, then a synced session — without skipping the thinking. This is the workflow used to scope and ship JSG portfolio builds. It is **rigid about the gates** (Explore before designing, approval before building, push before ending) and **flexible about the depth** (scale each phase to the task).

Built for two readers: the operator (David) who wants operator-framing first, and a builder being trained (EsteCam) who can follow it solo.

---

## When to run it

| Situation | Run dynamic-workflow? |
|---|---|
| New feature, component, or service | **Yes** |
| Multi-file refactor or framework completion | **Yes** |
| "Build / complete / scope this for me" | **Yes** |
| Unknown bug across several files | **Yes** (Explore phase = root-cause trace) |
| One-line fix, config tweak, rename, lookup | **No** — just do it (see \`[[skill-invocation-scope]]\`) |

If unsure, run it. The phases collapse to a few sentences for small work; the gates still protect you.

---

## The Five Phases

\`\`\`
1. EXPLORE   →  2. DESIGN   →  3. REVIEW   →  4. WRITE PLAN   →  5. APPROVAL GATE
   (map it)      (shape it)     (break it)     (record it)        (ExitPlanMode)
                                                                       │
                                                          approved ────┘
                                                                       ▼
                                                   IMPLEMENT  →  SESSION-END SYNC
\`\`\`

**Enter plan mode first** (\`EnterPlanMode\`). You are scoping, not building, until Phase 5 clears.

### Phase 1 — Explore (map it)

Understand the ground truth before proposing anything. Read the relevant files, the README/spec, recent commits, and any \`CLAUDE.md\` / \`decisions.md\`.

- For broad sweeps (many files, naming conventions, "where does X live"), dispatch **read-only Explore agents in parallel** and ask for conclusions, not file dumps.
- Match the cost to the job: cheap models for mapping and classification; escalate only when being wrong is expensive (see the project's \`model-routing.md\` and the global routing rules).
- Output of this phase: a short, honest statement of what already exists, what's actually missing, and what the request really means. "Complete the framework" rarely means "fill in stubs" — find out what it means here.

### Phase 2 — Design (shape it)

Propose **2–3 approaches with trade-offs**, lead with your recommendation and why. Name what each approach gives up — no silent trade-offs.

- Ask the operator **one decision at a time** for genuine forks (use \`AskUserQuestion\`). Don't ask what the code or sensible defaults already answer.
- Break the work into small units with one clear purpose each. If you can't say what a unit does, how it's used, and what it depends on, the boundaries need work.
- Keep operator-framing first: cost, risk, time-to-revenue, sellability before implementation detail.

### Phase 3 — Review (break it)

Stress-test the design before it becomes a plan. Look for:

- **Placeholders / TBDs** — resolve them now, not in code.
- **Internal contradictions** — does the architecture match the feature list?
- **Scope creep** — is this one plan, or does it need decomposing into sub-projects?
- **Ambiguity** — any requirement readable two ways? Pick one, make it explicit.
- **Kill check** — does this still pass functionality / efficiency / scalability / time-to-revenue? If it's failing, say so plainly (global rule #8). Don't be polite about waste.

### Phase 4 — Write the Plan (record it)

Write the validated plan to a plan file (the harness plan file, or \`docs/specs/YYYY-MM-DD-<topic>.md\` if the project keeps specs). A good plan states:

- **Context** — why this work, what exists, what the request actually means, decisions already locked.
- **Steps** — grouped by part, each naming the exact files touched (new vs. modified vs. verified-unchanged).
- **Verification** — concrete checks that prove each part works.

Log any architecture- or scope-changing decision to \`decisions.md\` with date and reasoning (global rule #3).

### Phase 5 — Approval Gate (\`ExitPlanMode\`)

Call **\`ExitPlanMode\`** with a tight summary and wait. **Do not write a single line of implementation code until the user approves.** Approval of one phase is not approval of the next. If they revise, loop back to the phase that changed.

---

## After Approval — Implement

- Build in the plan's order. Match existing style, comment density, and idioms.
- Minimum code that solves the problem; nothing speculative.
- Customer-facing copy gets a human voice pass — no AI-template feel (global rule #6).
- **Cost-log every API call** — tokens + model to the project's \`model_costs\` table (global rule #7). Wrap logging best-effort so it never blocks the real work.
- Run the plan's verification steps and report results faithfully: if a test fails, say so with the output; if a step was skipped, say that.

---

## Session-End Sync (never leave without it)

Every run ends by syncing state (global rules #9, and \`[[mission-control]]\`):

1. **GitHub first — source of truth.** \`git add -A\`; commit with a clear message; push the **current branch**. Never push directly to \`main\` on protected projects; branch and open a PR. If there's no remote or push fails, commit locally and tell the operator — never crash the session, never end without pushing.
2. **Mission Control — gated.** Only if \`MC_SUPABASE_URL\` is set (and \`mission_control_id\` is in the project \`CLAUDE.md\`): update project \`status\` + \`next_action\` and log the agent handoff, using \`MC_SUPABASE_SERVICE_KEY\`. On Windows use PowerShell \`Invoke-RestMethod\`, not curl. If MC is unreachable, skip it and say so. Check project \`.env\` files for the creds before asking — never ask for a credential already in a file.
3. **Supabase — by hand.** No auto-push to the database. Schema lives in \`supabase/migrations/*.sql\` and is applied deliberately in the SQL editor or via \`supabase db push\`.

---

## Quick Reference (the loop in one screen)

1. \`EnterPlanMode\`
2. **Explore** — read/agents map reality; state what's really missing.
3. **Design** — 2–3 approaches, recommend one, decide forks one at a time.
4. **Review** — placeholders, contradictions, scope, ambiguity, kill check.
5. **Write plan** — context + per-part steps + verification; log decisions.
6. \`ExitPlanMode\` — **wait for approval. No code before this clears.**
7. **Implement** — in order, minimal, cost-logged, human-voiced copy, verify honestly.
8. **Sync** — GitHub (always) → MC (gated) → Supabase (by hand). Never end without pushing.`,
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
