// Host-side clone targeting for the autonomous builder.
//
// WHY THIS EXISTS
// gitInitRepo() git-inits an EMPTY directory, so every autonomous build started from zero
// and could only ever produce greenfield artifacts. Request e0afb33a was commissioned as a
// gap analysis of existing REELFLOW code and was unsatisfiable by construction — the build
// agent inspected the workspace, found nothing, and (correctly) refused to fabricate.
//
// SECURITY SHAPE — read before widening any of this
// The sandbox's whole safety story is "untrusted code in a box with zero credentials and no
// egress" (C6). Letting it see real code puts proprietary source INSIDE that box, so:
//
//   1. The HOST clones. The dispatcher already holds git credentials; the container never
//      receives a token and the zero-secrets invariant in childEnv is untouched.
//   2. Shallow, single-branch. --depth 1 means committed history never enters the box —
//      FlipRadar's leaked anon key lives in git history, and that class of exposure must
//      not be re-imported into an environment that can relay text out through inference.
//   3. Allowlisted, default EMPTY. DISPATCHER_CLONEABLE_REPOS unset ⇒ resolveCloneTarget()
//      always returns null ⇒ behaviour is byte-for-byte what it was before this file
//      existed. Enabling a repo is a deliberate operator act, never a default.
//   4. Credential files are scrubbed from the working tree after clone (see below).
//
// RESIDUAL RISK, STATED PLAINLY: C6's red team found the mounted OAuth credential still
// authorizes plain /v1/messages inference, so a build can relay small payloads out through
// ordinary model text. With an empty workspace there was nothing worth taking. With a repo
// cloned in, that residual becomes material. This is why the allowlist starts empty.

// Repos the dispatcher may clone, as `owner/repo`. Default EMPTY = feature off.
export function cloneAllowlist(env = process.env) {
  return (env.DISPATCHER_CLONEABLE_REPOS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Normalise any of https://host/owner/repo(.git), git@host:owner/repo.git, or owner/repo
 * to a bare `owner/repo` slug. Returns null for anything it cannot confidently parse —
 * an unparseable target must fail closed, never fall through to "clone it anyway".
 */
export function repoSlug(repoUrl) {
  if (typeof repoUrl !== 'string') return null
  const s = repoUrl.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!s) return null
  // scp-style: git@github.com:owner/repo
  const scp = s.match(/^[\w.-]+@[\w.-]+:([\w.-]+\/[\w.-]+)$/)
  if (scp) return scp[1]
  // url-style: https://github.com/owner/repo (ignores any deeper path)
  const url = s.match(/^https?:\/\/[\w.-]+(?::\d+)?\/([\w.-]+\/[\w.-]+)$/)
  if (url) return url[1]
  // bare slug
  const bare = s.match(/^([\w.-]+\/[\w.-]+)$/)
  if (bare) return bare[1]
  return null
}

/**
 * Decide whether this request may clone, and to what URL.
 * Returns { slug, url } or null. Null means "git init an empty repo", i.e. today's behaviour.
 *
 * Fails closed on every ambiguity: no repo_url, unparseable repo_url, empty allowlist, or
 * a slug not on the allowlist all return null.
 */
export function resolveCloneTarget(repoUrl, allowlist) {
  const list = Array.isArray(allowlist) ? allowlist : []
  if (list.length === 0) return null
  const slug = repoSlug(repoUrl)
  if (!slug) return null
  // Case-insensitive compare: GitHub slugs are case-preserving but not case-sensitive.
  const hit = list.find((a) => a.toLowerCase() === slug.toLowerCase())
  if (!hit) return null
  return { slug: hit, url: `https://github.com/${hit}.git` }
}

// ---- credential scrub ----
// Applied to the cloned working tree BEFORE the container starts. Derived directly from
// the CodexQC finding on request e0afb33a, which caught an inspector advertising "never
// reads credential files" while its denylist missed most of these.
//
// Deliberately NOT scrubbed: .env.example / .env.sample / .env.template. Codex's
// should-fix on the same review was that treating committed templates as secrets creates
// false positives — templates carry no secret and removing them costs the build real
// context about what configuration the project expects.
const CREDENTIAL_PATTERNS = [
  /(^|\/)\.env($|\.(?!example$|sample$|template$)[\w.-]+$)/i,
  /(^|\/)\.(npmrc|pypirc|netrc|htpasswd)$/i,
  /(^|\/)_netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|p12|pfx|key|jks|keystore|p8|ppk)$/i,
  /(^|\/)credentials(\.\w+)?$/i,
  /(^|\/)secrets?\.(ya?ml|json|toml|ini)$/i,
  /(^|\/)client_secret[\w.-]*\.json$/i,
  /(^|\/)[\w.-]*service[-_]?account[\w.-]*\.json$/i,
  /(^|\/)firebase-adminsdk[\w.-]*\.json$/i,
  /(^|\/)kubeconfig$/i,
  /\.kubeconfig$/i,
  /(^|\/)\.(aws|ssh|gnupg)\//i,
  /(^|\/)\.docker\/config\.json$/i,
]

/** Should this repo-relative path be removed from a cloned workspace before the build sees it? */
export function isCredentialPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false
  const p = relPath.replace(/\\/g, '/')
  return CREDENTIAL_PATTERNS.some((re) => re.test(p))
}
