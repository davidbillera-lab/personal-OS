# Spec: AI Tutor Standalone — Fresh Repo Port from College Climb Tutor Feature

**Project:** ai-tutor-standalone (new repo, no existing MC entry) | **Complexity tier:** 3 | **Recommended tool:** Claude Code
**Spec date:** 2026-07-07 | **Source of truth for the port:** github.com/davidbillera-lab/AI-Tutor (`campus-climb/` subfolder) — READ-ONLY

---

## Kill Check

**Functionality:** The core experience — session tutor, persistent memory, Hermes correction loop — is battle-tested and in production use today. Ports faithfully. Pass.

**Efficiency:** COGS is real. Each session runs Sonnet for streaming plus a Haiku memory update after every qualifying exchange. At $3/$15/MTok for Sonnet and typical session length, a $14.99-$19.99/mo price point needs careful COGS modeling. The memory distillation runs on Haiku (cheap). The main stream call is where cost concentrates. Flag for monitoring from day one via the `model_costs` table — do not ship without it. Conditional pass.

**Scalability:** Stateless API routes, Supabase as the only stateful layer. No in-memory session state. Architecture handles multi-tenant cleanly. Pass.

**Time-to-revenue:** Stripe checkout and webhook are already written and portable. The tutor UX already works. A focused port with brand swap can be live in 2-3 weeks. Pass.

**Verdict:** Build it. One real risk flag (COGS per session) but it's manageable with monitoring, not a blocker.

---

## 1. What We're Building

A standalone commercial AI tutoring app — separated entirely from College Climb — that tutors anyone on any subject: kids doing homework, college students cramming, adults learning a new skill, professionals researching a domain. The core experience is lifted directly from the working College Climb tutor: Socratic live sessions, document and image upload for grounding, six configurable teaching styles (including ADHD-friendly), and a persistent memory system that compounds across sessions so the tutor genuinely gets to know the learner over time. The "Hermes correction loop" (when a user switches teaching styles mid-session, that signal is distilled into permanent behavioral rules for that user) is the compounding moat and must survive the port unchanged. This is a fresh repo and fresh Supabase project — College Climb is not touched.

---

## 2. Proposed Names

**Default: Meridian** — Clean, adult, memorable. Works for a 10-year-old doing fractions and a 45-year-old learning Python. No obvious embarrassing associations. Executor should verify meridianapp.com / getmeridian.com / learnmeridian.com availability plus USPTO TESS search before locking it.

**Alternative 1: Tutora** — Short, product-y, clearly tutoring. Check tutora.com (may be taken by UK tutoring marketplace — verify).

**Alternative 2: Lumio** — Friendly, implies light/learning. Check lumio.com and USPTO. A UK ed-tech product called Lumio exists; verify conflict risk.

Executor uses Meridian as the working name for all files, routes, and copy. Domain/trademark confirmation is a separate pre-launch gate, not a blocker for the build.

---

## 3. Source Map

Clone the source read-only before touching anything:
```
git clone https://github.com/davidbillera-lab/AI-Tutor.git ai-tutor-source --depth 1
```
All source paths below are relative to `ai-tutor-source/campus-climb/`.

| Source file | What it does | Port notes |
|---|---|---|
| `src/lib/agents/config.ts` | Defines all 9 tutor agents with system prompts, subtopics, rendersMath/rendersCode flags. The `AGENTS` record and `AgentConfig` type. | Port as-is. Remove the `college-comp` subtopic under English (see §4). No other content is college-specific — all 9 agents are subject-matter prompts, not tied to CC features. |
| `src/lib/agents/buildPrompt.ts` | Assembles the full system prompt from agent config + student profile + CC context + memory + correction lessons. Contains the college-prep context block (lines 209–313) and college-specific profile fields (`grade_level`, `school_type`, `course_track`, `graduation_year`, `intended_majors`). | Port with surgery: remove the `CCContext` type and the entire CC context block (lines 209–313). Replace college-specific profile fields with generic learner profile fields (see §4). The session-mode directive and teaching-style injection are gold — keep verbatim. |
| `src/lib/agents/teachingStyles.ts` | Six teaching styles: adaptive, socratic, direct, adhd, visual, step_by_step. TEACHING_STYLES record, resolveTeachingStyle(), TEACHING_STYLE_LIST. | Port as-is. Zero college content. |
| `src/lib/claude/stream.ts` | Lazy Anthropic SDK singleton, streamTutorResponse() (SSE stream), summarizeStudentMemory() (Haiku Tier 1 memory update). | Port as-is. Model strings stay the same. Add `model_costs` logging after each API call (this is missing in the source and must be added here). |
| `src/lib/tutor/corrections.ts` | The Hermes loop: captureTutorCorrection(), fetchActiveLessons(), maybeDistillLessons(). Haiku distills style-switch signals into permanent per-user teaching rules. `DISTILL_MODEL = 'claude-haiku-4-5-20251001'`. | Port as-is. This is the moat. Do not modify the logic. Add `model_costs` logging to the Haiku call inside `maybeDistillLessons()`. |
| `src/lib/tutor/subjects.ts` | SUBJECTS array and SUBJECT_EMOJI map — client-side source of truth for subject/subtopic IDs and labels. | Port as-is. Executor may optionally add professional subtopics in a later piece — not v1 scope. |
| `src/app/api/chat/route.ts` | The tutor streaming endpoint. Handles auth, rate limiting (Upstash), profile fetch, memory fetch, Hermes correction capture, source grounding (size-capped), Gemini video analysis, SSE stream. References `subscriptions` table, `college_matches` table (optional CC context fetch), `deadlines` table. | Port with surgery: remove the CC context fetch block (lines 157–200) and the `ccContext` parameter to `buildPrompt()`. Remove `analyzeVideoForTutor` / Gemini dependency in v1 (video support is out of v1 scope — simplifies the port). Keep everything else including source grounding and size caps. |
| `src/app/api/conversations/route.ts` | GET (list user conversations) and POST (create conversation). References `teaching_style` and `sources` columns. | Port as-is. |
| `src/app/api/conversations/[id]/messages/route.ts` | GET messages for a conversation. | Port as-is. |
| `src/app/api/memory/route.ts` | GET student_memory for current user. Read-only surface. | Port as-is. |
| `src/app/api/upload/route.ts` | Generates signed upload URLs for tutor-uploads and video-uploads buckets. Has a `highlights-prints` branch that is CC-specific. | Port with the `highlights-prints` branch removed. Keep image/PDF path. Remove video path in v1. |
| `src/app/api/stripe/checkout/route.ts` | Creates or resumes a Stripe checkout session (7-day trial). References `price_1SySFGHqg2vAFif7Tr7U09V8` — that is the College Climb price ID. Creates `subscriptions` table rows via admin client. | Port with a new price ID (executor creates a new Stripe product+price, updates the hardcoded price ID and the webhook filter in `webhook/route.ts`). The checkout flow itself is identical. |
| `src/app/api/stripe/webhook/route.ts` | Handles subscription lifecycle events. Filters on `price_1SySFGHqg2vAFif7Tr7U09V8` — CC price. | Port with updated price ID to match the new Stripe product. |
| `src/app/(app)/tutor/new/page.tsx` | Subject picker grid. Imports `SUBJECTS` from `lib/tutor/subjects`. All College Climb branding is inline CSS (navy blue palette). | Port with brand update (name, colors per final brand). |
| `src/app/(app)/tutor/sessions/page.tsx` | Session history list. Links to `/tutor/[subject]/[subtopicId]?c=[id]`. All copy is tutor-generic — no CC references. | Port as-is, brand update only. |
| `src/app/(app)/tutor/[subject]/[subtopic]/page.tsx` | The main chat UX. SourcePane, AgentHeader, ChatThread, ChatInput, streaming SSE consumer, Hermes style-switch detection, rate-limit banner. References `/settings?tab=billing` for upgrade. | Port as-is with brand update and the Gemini video attachment path removed. |
| `src/components/tutor/SourcePane.tsx` | Left panel: file upload drop zone, session source list, TeachingStyleSelect, MemoryIndicator. | Port as-is. |
| `src/components/tutor/MemoryIndicator.tsx` | Shows the tutor's cross-session memory of the user. | Port as-is. |
| `src/components/tutor/TeachingStyleSelect.tsx` | Style picker dropdown in the source pane. | Port as-is. |
| `src/components/chat/AgentHeader.tsx` | Chat header with subject/subtopic label and user profile context. Currently shows `grade_level` and `course_track`. | Port with profile fields updated to generic equivalents (`learner_type`, `skill_level`). |
| `src/components/chat/ChatThread.tsx` | Message list with math (KaTeX) and code (Shiki) rendering. | Port as-is. |
| `src/components/chat/ChatInput.tsx` | Text input with file attachment support. | Port with video attachment type removed in v1. |

**System prompt college-specific lines that must change** (in `src/lib/agents/config.ts` — per-agent prompts):

- English agent line 123: `"For AP Lit/Lang: frame everything in terms of the College Board rubric and scoring criteria"` — change to `"For advanced composition: frame feedback in terms of clarity, argumentation, and academic standards appropriate to the student's stated goal."`
- English agent line 125: `"For college comp: bridge high school writing habits to college-level academic expectations"` — change to `"Calibrate expectations to the student's stated level — high school, college, or professional writing contexts."`
- Science agent line 89: `"For AP courses: be explicit about what College Board expects students to know"` — change to `"For advanced coursework: be explicit about what professional or academic programs expect at this level."`
- Social Studies agent line 163: `"For AP courses: teach the DBQ, LEQ, and SAQ formats explicitly; address historical thinking skills"` — change to `"For advanced coursework: address discipline-specific writing formats (historiographical essays, policy briefs) as relevant to the student's goals."`
- CS agent line 219: `"For AP CS A: focus on Java syntax, OOP principles, and the AP exam question types"` — change to `"For formal CS coursework: focus on Java syntax, OOP principles, and problem decomposition relevant to university curricula."`
- CS agent line 221: `"For AP CS Principles: emphasize concepts over syntax — abstraction, algorithms, data, impact of computing"` — keep, remove "AP" label, change to `"For intro-level CS: emphasize concepts over syntax..."`

**System prompt in `buildPrompt.ts`** — lines 164–201 inject college-specific profile context (`grade_level`, `school_type`, `course_track`, `graduation_year`, `intended_majors`). Replace with a generic learner profile block (see §4).

The CC context block (`ccContext`, lines 209–313 in `buildPrompt.ts`) is the English-agent deadline urgency logic and CS-agent target-school logic. Remove entirely — has no meaning outside CC.

---

## 4. What Ports As-Is vs. What Changes

### Faithful port (do not modify, copy verbatim):

- The six teaching styles (`teachingStyles.ts`) — complete, general, no college content
- The Hermes correction loop (`corrections.ts`) — the compounding moat, port unchanged
- `streamTutorResponse()` and `summarizeStudentMemory()` in `stream.ts` — Haiku memory update logic is subject-agnostic
- The SSE streaming client implementation in the tutor page
- The source grounding pipeline (upload → signed URL → size-capped per-session grounding → Anthropic URL blocks)
- `conversations` and `messages` API routes
- `memory` API route
- The SourcePane, MemoryIndicator, TeachingStyleSelect, ChatThread, ChatInput components
- Stripe checkout and webhook routes (logic identical, price IDs updated)
- Rate limiting via Upstash (20 messages/hour free tier)
- The 9 subject agents and all subtopic lists in `config.ts` and `subjects.ts`
- The session-mode directive in `buildPrompt.ts`: *"You are running a live, one-on-one tutoring session — not a Q&A bot..."* — keep verbatim, it is the behavioral spine

### The delta (what changes):

**1. De-college-ify the learner profile.** The `profiles` table and `buildPrompt.ts` currently carry `grade_level`, `school_type`, `course_track`, `graduation_year`, `intended_majors`. Replace with a generic learner profile:

- `learner_type` text — 'student_k12' | 'student_college' | 'adult_learner' | 'professional' (drives tone calibration)
- `skill_level` text — 'beginner' | 'intermediate' | 'advanced' (replaces course_track for calibration)
- `learning_goals` text — free text, replaces intended_majors
- Keep `learning_style` (profile-default teaching style), `interests`, `values`, `proud_moment`, `challenge`, `athletics`, `leadership`, `work_experience`, `arts`, `community_service` — genuinely generic motivational context

The AP-track calibration block in `buildPrompt.ts` (lines 174–191) rewrites to a `skill_level`-driven calibration:
- `advanced`: "Use rigorous depth; introduce professional/academic standards and extension problems."
- `intermediate`: "Scaffold complexity gradually; introduce nuance once fundamentals are solid."
- `beginner`: "Ground explanations in concrete examples; reinforce fundamentals before extending."

**2. Generic onboarding flow** (new build, not a port). College Climb's onboarding is deeply college-prep specific. The new app needs a short onboarding: What do you want to learn? How experienced are you? How do you learn best? Three screens, 60 seconds. The learner profile populates from this.

**3. Remove the CC context fetch** from `chat/route.ts` (college list + deadlines optional fetch, lines 157–200 in the source). Remove entirely — no equivalent exists in this app.

**4. New brand** — name, colors, typography throughout. The source uses `#1e3a8a` / `#1d4ed8` (navy blue). Default: retain the navy blue palette, swap the College Climb wordmark for Meridian.

**5. New Supabase project** — fresh project, own credentials. Do NOT reuse College Climb's Supabase project. Run fresh migrations derived from the source (see §7).

**6. New Stripe product** — new product + price in Stripe, new `STRIPE_PRICE_ID` env var, updated in checkout and webhook routes. 7-day trial structure is identical.

**7. Video upload and Gemini video analysis** — removed in v1. Drop the video branch from `upload/route.ts`, remove the `analyzeVideoForTutor` import and video handling block from `chat/route.ts` (lines 379–403 in source), and remove video attachment type from `ChatInput`.

**8. model_costs logging** — the source app does not have this. Add it. Every Anthropic API call (streaming in `stream.ts`, Haiku memory update in `stream.ts`, Haiku distillation in `corrections.ts`) must write a row to `model_costs` after completion. Format: `{ project: 'meridian', model, input_tokens, output_tokens, cost_usd, endpoint, user_id, created_at }`.

**9. The highlights feature** — CC-specific, remove. Drop the `highlights-prints` bucket branch from `upload/route.ts`. Do not port the highlights API routes.

**Memory system and Hermes loop call-out:** These two systems are why this product is defensible. Every session's final exchange is summarized by Haiku into a `student_memory` row (summary + learning_notes). That memory is injected into every future session's system prompt under "Who This Learner Is" and "What You've Learned About How They Learn." The Hermes loop adds a second compounding layer: when a user switches teaching styles mid-session (direct signal that the current approach isn't landing), `captureTutorCorrection()` fires and asynchronously accumulates correction rows. Once 3 accumulate for a user, `maybeDistillLessons()` calls Haiku to distill them into up to 8 general behavioral rules injected into every future session's prompt. These rules outrank default style preferences. The result: the tutor gets meaningfully better for each individual user over time, in a way a generic ChatGPT wrapper cannot replicate. Port both systems without modification.

---

## 5. Out of Scope for v1

- Video upload and Gemini video analysis (removed — simplifies port, adds back in v2)
- College matching, scholarship matching, essay coaching, deadlines tracker, financial aid assistant — College Climb features
- The highlights feature
- Mobile / Capacitor (web-only in v1)
- Custom "add a subject" flow (professional custom domains, e.g., real estate, medicine)
- Group or family accounts
- Admin dashboard / operator analytics UI
- SEO / marketing landing page (separate task after core app ships)
- Gamification, streaks, progress tracking dashboards

---

## 6. Build Phases

This is a 9-piece sequential build. Executor should invoke `phase-relay` (or `davids-agents`) before starting. Each piece gets its own fresh context window.

**Phase 1 — Scaffold and data model**
- Create fresh repo at `C:\Users\david\ai-tutor-standalone`
- Initialize: `npx create-next-app@latest . --typescript --tailwind --app --src-dir` (name: meridian)
- Install deps: `@anthropic-ai/sdk @supabase/ssr @supabase/supabase-js @upstash/ratelimit @upstash/redis stripe katex react-katex react-markdown remark-gfm remark-math rehype-katex rehype-highlight shiki lucide-react` (copy exact version strings from source package.json)
- Create new Supabase project (operator action — executor documents what's needed, waits for credentials)
- Write and apply 5 migrations: 001 profiles/conversations/messages (+RLS +handle_new_user trigger), 002 student_memory, 003 hermes loop (tutor_corrections, tutor_correction_lessons), 004 subscriptions, 005 model_costs
- Create Supabase storage bucket: `tutor-uploads` with file size limits
- Write CLAUDE.md, kill-criteria.md, decisions.md seed files
- Commit: "feat: scaffold + data model"

**Phase 2 — Core lib layer**
- Port `config.ts` (with the 6 AP-reference edits), `teachingStyles.ts`, `subjects.ts` verbatim
- Port `buildPrompt.ts` with CCContext removed, generic learner profile fields, skill_level calibration
- Port `stream.ts` verbatim + model_costs logging
- Port `corrections.ts` verbatim + model_costs logging on the Haiku distill call
- Write Supabase SSR helpers, `upstash.ts` (port `getTutorRatelimit()` as-is)
- Commit: "feat: lib layer — agents, prompts, stream, corrections, memory"

**Phase 3 — API routes**
- Port `chat/route.ts` (remove CC context fetch lines 157–200, remove Gemini video lines 379–403; keep rate limit, source grounding, memory update, Hermes detection)
- Port `conversations/`, `conversations/[id]/messages/`, `memory/` as-is
- Port `upload/route.ts` (image/PDF only)
- Port stripe checkout + webhook with `STRIPE_PRICE_ID` env var (de-hardcode)
- Write `profile/route.ts` — GET/PUT for learner profile
- Commit: "feat: api routes — chat, conversations, memory, upload, stripe, profile"

**Phase 4 — Tutor components**
- Port SourcePane (no video types), MemoryIndicator, TeachingStyleSelect as-is
- Port AgentHeader (generic profile fields), ChatThread as-is, ChatInput (no video)
- Commit: "feat: tutor components"

**Phase 5 — Tutor pages**
- Port `tutor/new`, `tutor/sessions`, `tutor/[subject]/[subtopic]` pages (brand update, no video)
- Write authenticated app shell layout + SubjectTree sidebar (no college prep section)
- Commit: "feat: tutor pages + app shell"
- Verify: /tutor/new → pick Math → /tutor/math/pre-algebra → send message → streamed response

**Phase 6 — Auth and onboarding**
- Supabase Auth (email/password + Google OAuth)
- Login/signup pages; 3-screen onboarding (learning_goals → skill_level → learning_style); middleware gates
- Include the COPPA age gate (see §9) — operator decides block-under-13 vs. parent-email path before this phase
- Commit: "feat: auth + onboarding"

**Phase 7 — Stripe and subscription gate**
- Create new Stripe product "Meridian Pro" ($14.99/mo suggested — operator decides; 7-day trial)
- Settings page with billing tab; wire rate-limit upgrade CTA
- Commit: "feat: stripe + subscription gate"
- Verify: checkout → test payment → webhook → subscriptions row 'active' → rate limit bypassed

**Phase 8 — Docs and final wiring**
- Finalize CLAUDE.md, kill-criteria.md, decisions.md
- Confirm admin-client pattern for all writes; `npm run build` passes
- Commit: "docs: CLAUDE.md, kill-criteria.md, decisions.md + build passes"

**Phase 9 — Deploy**
- Push to GitHub `davidbillera-lab/meridian` (or `ai-tutor-standalone`)
- Vercel deploy, env vars, Stripe webhook endpoint registration
- Smoke test: auth, onboarding, session, memory update, checkout
- Commit: "chore: vercel deploy + stripe webhook configured"

---

## 7. Data Model

Derived from actual migrations in the source. All fresh tables in a new Supabase project.

**`profiles`**
```sql
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  learner_type text,          -- 'student_k12' | 'student_college' | 'adult_learner' | 'professional'
  skill_level text,           -- 'beginner' | 'intermediate' | 'advanced'
  learning_goals text,
  learning_style text,        -- profile-default teaching style key
  interests text,
  values text,
  proud_moment text,
  challenge text,
  athletics jsonb DEFAULT '[]',
  leadership jsonb DEFAULT '[]',
  work_experience jsonb DEFAULT '[]',
  arts jsonb DEFAULT '[]',
  community_service jsonb DEFAULT '[]',
  onboarding_complete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**`conversations`**
```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  sub_topic text,
  title text,
  teaching_style text,
  sources jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**`messages`**
```sql
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  attachments jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);
```

**`student_memory`** (mirrors source exactly)
```sql
CREATE TABLE student_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  summary text,
  learning_notes text,
  updated_at timestamptz DEFAULT now()
);
```

**`tutor_corrections`** and **`tutor_correction_lessons`** — mirror source migration `20260701090000_tutor_hermes_correction_loop.sql` exactly, including indexes and RLS.

**`subscriptions`**
```sql
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text,
  status text,               -- 'active' | 'trialing' | 'inactive' | 'canceled' | 'past_due'
  current_period_end timestamptz,
  updated_at timestamptz DEFAULT now()
);
-- RLS: SELECT for auth.uid() = user_id; writes via service role only
```

**`model_costs`** (new — not in source)
```sql
CREATE TABLE model_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project text NOT NULL DEFAULT 'meridian',
  model text NOT NULL,
  endpoint text,             -- 'chat_stream' | 'memory_update' | 'hermes_distill'
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,6),
  created_at timestamptz DEFAULT now()
);
-- No RLS — service role writes only
```

Storage buckets: `tutor-uploads` (public, 20MB image / 10MB PDF limits enforced at bucket level, matching source migration `20260613000000_storage_bucket_limits.sql`).

---

## 8. Env Vars Needed

```
NEXT_PUBLIC_SUPABASE_URL           # New Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY      # New Supabase project anon key
SUPABASE_SERVICE_ROLE_KEY          # New Supabase project service role key
ANTHROPIC_API_KEY                  # Existing key or new key
UPSTASH_REDIS_REST_URL             # Rate limiting (can reuse or create new)
UPSTASH_REDIS_REST_TOKEN
STRIPE_SECRET_KEY                  # New Stripe product or new account
STRIPE_WEBHOOK_SECRET              # Set after webhook endpoint registered
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_PRICE_ID                    # New Meridian Pro price ID (replaces hardcoded CC price)
NEXT_PUBLIC_APP_URL                # https://[vercel-domain] or custom domain
```

The source hardcodes `price_1SySFGHqg2vAFif7Tr7U09V8` in two files. The port replaces both with `process.env.STRIPE_PRICE_ID` so it is not hardcoded again.

The source's `GEMINI_API_KEY` / `@google/generative-ai` dependency (video analysis) is not needed in v1.

---

## 9. Honest Risk Read

- **Free ChatGPT competition is real.** ChatGPT, Gemini, and Perplexity all answer tutoring questions for free. The defensible surface here is the persistent memory, the Hermes correction loop (truly personal adaptation over time), and the session-not-Q&A UX. These are real differentiators — but only if users come back for multiple sessions. Week-2 retention is the number to watch. If users don't return after session 1, the moat doesn't compound and the value prop collapses to a feature anyone can clone.

- **COGS per session needs monitoring from day one.** Each session runs Sonnet streaming plus a Haiku memory update after every qualifying exchange. A heavy user doing 30-message sessions daily could cost $5-10/month in Claude API costs alone at $14.99/mo revenue, leaving thin margin. The `model_costs` table is non-negotiable — the operator needs per-user COGS before end of month 1. If COGS exceeds 40% of revenue per user, pricing or model routing needs adjustment.

- **Retention depends on memory compounding, which requires repeat sessions.** The MemoryIndicator shows users the tutor "remembers" them — the stickiness hook — but it takes 3+ sessions to become visible. Onboarding copy and first-session UX must explicitly set this expectation ("the more you use this, the better it knows you") so users come back for session 2 before they have a reason to.

- **COPPA applies if under-13 users sign up.** The app is designed for "any age" including kids. COPPA requires verifiable parental consent for under-13 users. V1 approach: age gate at signup ("Are you 13 or older?") — if under 13, either block signup or require a parent email (minimal compliance path). Do not launch without this gate — it is a legal blocker. Operator decides between the two options before Phase 6 is built.

- **Naming collision risk.** "Meridian" has some ed-tech usage. Executor must verify USPTO TESS and domain availability before any customer-facing materials go live. Meridian is working-name only; Tutora and Lumio are fallbacks with the same verify-first caveat.

---

## 10. Kill Criteria Draft

Killed if any of the following are true at the 60-day post-launch checkpoint:

- **Functionality:** Core tutor loop broken (chat route fails, memory updates fail, or Hermes loop fails) for more than 4 hours without operator acknowledgment. Any payment flow that charges users but does not grant Pro access is an immediate halt.
- **Efficiency (COGS):** Average COGS per active paying user exceeds 50% of monthly revenue per user (a $14.99/mo user costing >$7.50/mo in API calls). Kill or re-price. Monitor via `model_costs` weekly starting week 1.
- **Scalability:** Any in-memory session state, any API route failing under concurrent load on Vercel, or Supabase connection pool exhaustion during normal use.
- **Time-to-revenue:** Zero paying users (excluding the operator) after 60 days of the app being live and publicly accessible. If the free tier attracts users but nobody converts, that is a pricing or value-prop failure — evaluate and decide within 30 days of that signal.

---

## 11. First Message for the Fresh Window

Paste the following as the first message in a fresh Claude Code window to begin Phase 1:

---

Read this spec in full before touching any code: `C:\Users\david\Documents\personal-os\specs\ai-tutor-standalone-spec.md`

You are building a standalone AI tutoring app (working name: Meridian). This is a port of the tutor feature from an existing College Climb app — you will read the source code as reference but will NOT modify it.

Before writing a single line of code, clone the source read-only:
```
git clone https://github.com/davidbillera-lab/AI-Tutor.git C:\Users\david\ai-tutor-source --depth 1
```

The source tutor code lives in `C:\Users\david\ai-tutor-source\campus-climb\`. You may read it but must never commit to it.

Your new repo lives at `C:\Users\david\ai-tutor-standalone`. Create that directory.

You are starting Phase 1 of 9 sequential phases (invoke phase-relay or davids-agents before starting). Phase 1 scope only:
1. Initialize a new Next.js app at `C:\Users\david\ai-tutor-standalone` using `npx create-next-app@latest . --typescript --tailwind --app --src-dir` (name: meridian)
2. Install all dependencies listed in Section 8 of the spec (copy exact version strings from `C:\Users\david\ai-tutor-source\campus-climb\package.json`)
3. Write the 5 SQL migration files to `supabase/migrations/` using the schemas in Section 7 of the spec
4. Write `CLAUDE.md`, `kill-criteria.md`, and `decisions.md` seed files using the spec's Section 10 for kill criteria
5. Create a `.env.local.example` listing all required env vars from Section 8

Do not write any TypeScript application code in Phase 1. Scaffold only.

At the end of Phase 1, commit with message "feat: scaffold + data model" and push to a new GitHub repo `davidbillera-lab/meridian`.

Then stop and report: what is ready, what env vars the operator needs to supply (new Supabase project URL/keys, new Stripe product), and what the Phase 2 kickoff message should be.
