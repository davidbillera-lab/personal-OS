# BUILD SPEC — Haunted Threads After Dark: Public Landing + Story Submissions + Posted Archive

**Date:** 2026-07-12 · **Execute in:** fresh window at `c:\Users\david\haunted-threads`
**Repo:** github.com/davidbillera-lab/haunted-threads · **Supabase:** `xgwlnynslqhhevqjdmya` · **MC id:** `fac2abfb-f549-420b-8ae2-d5be0d95a3ab`

## Session protocol (first, before code)

Invoke `davids-way`, then run the build as a `/davids-agents` serial relay — one fresh subagent per step below, lead verifies between steps, TodoWrite updated at every step so David can watch. Read the repo `CLAUDE.md` + `decisions.md` before touching anything. Commit per piece. Close with push → `mc_update_project_status` → decisions-sync.

## Operator intent

The existing app (Nicole's editorial dashboard) becomes the **backend** — and it is currently **publicly exposed: David found the entire dashboard reachable via a Google search**. Locking it behind a wall is priority zero. The public face of `https://hauntedthreadsafterdark.com` becomes a **landing page for the TikTok/YouTube channel** where followers drop their own spooky stories — landing + story drop zone are the ONLY public surfaces. Submissions go straight to **hauntedthreadsafterdark@gmail.com**; Nicole screens them and imports keepers via the existing paste-in mode (shipped 7/5). Also: a **Posted** archive mirroring the Passed-stories library. Creative license on the landing page is explicitly granted — go wild, show what Fable's got.

## Verified current state (from MC + repo CLAUDE.md, 2026-07-12)

- Next.js 16 App Router, Tailwind v4, Supabase magic-link auth (`ALLOWED_EMAILS` allowlist), Resend email (`lib/email.ts`), Vercel hosting, cron `0 12 * * * UTC` → `/api/cron/daily` guarded by `CRON_SECRET`.
- Server code MUST use `createAdminSupabaseClient()` from `lib/supabase-admin.ts`. All LLM = Haiku only (landing page needs zero LLM calls — keep it that way).
- Root `app/page.tsx` currently redirects to /login-or-dashboard. Dashboard lives in `app/(dashboard)/` behind the auth guard.
- Story statuses: `new / today / banked / posted / pass`. Passed-stories library exists — mirror it for Posted.
- Supabase migrations are numbered; latest is `0004` (reddit_greats_cache). Next is `0005`.
- Blockers on record: Reddit crawl paused pending Data Access Request (decision lands at nicbillera@gmail.com); **ICANN verification email for the domain is unclicked** — domain won't attach to Vercel until David clicks it.
- Repo CLAUDE.md locked decision #11 ("No Mission Control entry") is STALE — the MC entry exists (id above, asset_class `personal` as of tonight). Fix the doc at close, don't relitigate.

## Build order (one relay step each)

### Step 1 — SECURITY: wall off the exposed backend (priority zero, before ANY feature work)
The dashboard is publicly reachable and Google-indexed. Treat as an incident — systematic-debugging discipline, verify before and after:
1. **Reproduce:** hit the production URL logged out; confirm exactly which dashboard routes render without auth (and what Google indexed).
2. **Root-cause + fix:** the guard is likely client-side-only or a middleware matcher gap. Enforce **server-side** auth on every `(dashboard)` route — server-component/layout guard or middleware; unauthenticated → redirect to `/login` with NO data fetched on the way.
3. **Audit every `app/api/` route:** `stories`, `feedback`, `preferences` must require an authenticated allowlisted session. Cron keeps `CRON_SECRET`. The new `/api/submissions` (Step 3) will be the ONLY public API.
4. **De-index:** `robots.txt` disallowing dashboard/api paths + `noindex` (meta or X-Robots-Tag) on all non-landing routes. Once locked, Google drops them on recrawl.
5. **Leak check:** confirm no secrets or env values were serialized into exposed page payloads; rotate anything that was. Report findings to David either way.
6. **Then auth/domain groundwork:** verify magic-link login end-to-end; Supabase Auth Site URL + redirect allowlist gain `https://hauntedthreadsafterdark.com` (and `www`); update any `NEXT_PUBLIC_SITE_URL`-style usage.
7. **Root route restructure:** `app/page.tsx` stops redirecting — it becomes the public landing (Step 2). `/login` remains the door.
8. **Reddit OAuth check only:** if the Data Access Request was approved (David/Nicole confirm), wire creds per `lib/reddit.ts`, retire the 6am PC bridge, enable cloud cron. If not approved, skip — not a blocker for this build.

### Step 2 — Landing page at `/` (the showcase piece — go wild)
- **Audience:** TikTok/YouTube horror fans arriving on phones. Mobile-first, fast, no heavy animation libs — CSS-first effects (flicker, grain, candlelight glow, thread motif — "Haunted Threads" is a gift of a name; consider a stitched-thread divider, VHS-static hero, slow ember particles).
- **Content:** channel branding + hook copy (human voice, zero AI-template feel — this is customer-facing), links to the actual TikTok + YouTube channels (grep repo/preferences/DB for handles; if truly absent, ship with clearly marked placeholder hrefs and flag to David), and the **story submission form as the hero CTA** ("Drop your story… if you dare" energy — copywriter-agent pass before ship).
- **SEO/OG:** proper title/description/OG image — this site is future agency-portfolio proof, make the metadata clean.
- Accessibility is a non-negotiable: real labels, focus states, prefers-reduced-motion respected on every effect.

### Step 3 — Submission flow → Nicole's inbox
- Migration `0005`: `submissions` table — id, name (nullable), email (nullable), story_title, story_text, consent boolean, status (`new`/`reviewed`/`imported`), created_at. Stored as delivery insurance; email is the workflow.
- `POST /api/submissions`: server-side validation (length caps on every field — trust boundary), honeypot field, cheap rate limit (count recent rows per IP before insert), insert row, then Resend email **to hauntedthreadsafterdark@gmail.com** — story text, submitter info, consent flag, reply-to submitter if email given. Plain useful email, not fancy.
- **Consent checkbox (recommended, not locked):** "I give Haunted Threads After Dark permission to narrate and publish this story." A UGC channel narrating strangers' stories wants this on record. Required-to-submit if David doesn't object.
- NO dashboard submissions view — YAGNI. Nicole works from email + existing paste-in mode.

### Step 4 — Posted archive (the "quick subagent" piece)
- Mirror the Passed-stories library exactly for `status = 'posted'`: route under `(dashboard)`, same list/detail pattern, story + full content kit retrievable, same navigation placement. Match existing code's idioms — this is a clone-and-adapt, not a redesign.

### Step 5 — Deploy + domain
- Deploy to Vercel; smoke-test landing (public), login (allowlisted), submission (email arrives), posted archive.
- Attach `hauntedthreadsafterdark.com` + `www` in Vercel; DNS at registrar. **Blocked on David clicking the ICANN verification email** — surface loudly if unverified and finish everything else.

### Close
Update repo CLAUDE.md (landing/submissions/posted + fix stale decision #11), log decisions.md entries, push, `mc_update_project_status` on `fac2abfb-f549-420b-8ae2-d5be0d95a3ab`.

## On David (humans only)
1. Click the ICANN domain-verification email (domain attach is dead until then).
2. Confirm/relay the TikTok + YouTube channel URLs if the build can't find them.
3. Watch nicbillera@gmail.com for the Reddit Data Access Request decision.
4. Optional, after lockdown ships: Google Search Console removal request to purge the indexed dashboard pages faster than natural recrawl.
