// Outbound result sanitizer for the autonomous dispatcher (C6-P5).
//
// The container sandbox (C6-P2/P3/P4) contains egress, but the BUILD RESULT is itself a
// legitimate outbound channel: executor → dispatcher → Supabase (mc_requests) → Telegram
// → the operator's chat surface. A build that echoes something secret-shaped into a commit
// message, a stack trace, or QC prose rides out through an allowed path. This module is the
// defense-in-depth net on that path: redact secret-shaped strings, then bound length.
//
// ONE place. Call sanitizeForMC() at every outbound point; never scatter regexes at call sites.
//
// Deliberately NOT redacted (the operator needs these to be readable and actionable):
//   - 40-char and 64-char lowercase/uppercase hex runs — git object ids. reviewed_sha is the
//     load-bearing field for the push gate; eating it breaks the approval flow.
//   - UUIDs (request id, attempt_id), branch names (mc-build-<uuid>), repo slugs, and the
//     verdict words (SHIP / FIX-FIRST / RECONSIDER).
//
// Every regex is linear: no nested quantifiers over overlapping character classes, and the
// long-run rules are anchored with a lookbehind + greedy match so the engine never retries
// inside a run it has already consumed.

const MARK = (kind) => `[REDACTED:${kind}]`

const isPureHex = (s) => /^[0-9a-fA-F]+$/.test(s)
// Mixed alphabet is the cheap high-entropy proxy: real tokens carry upper + lower + digit.
// Path fragments, kebab ids, and prose almost never do all three in one 32+ char run.
const isMixedAlphabet = (s) => /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)

// Applied in order. Specific provider shapes first (so the marker names the real kind),
// then keyword-assignment, then the generic high-entropy nets.
const RULES = [
  // Credentials embedded in a URL: postgres://user:pass@host, https://user:pass@host.
  // Keep the scheme (and the host, which follows) — drop only the userinfo.
  {
    re: /\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/:@]{1,256}:[^\s/:@]{1,256}@/gi,
    to: (_m, scheme) => `${scheme}${MARK('url-credentials')}@`,
  },
  // JWT — three dot-separated base64url segments. This is the shape of the Supabase
  // service-role key, which is the single worst thing that could ride out of a build.
  { re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, to: () => MARK('jwt') },
  { re: /\bsk-ant-[A-Za-z0-9_-]{8,}/g, to: () => MARK('anthropic-key') },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, to: () => MARK('openai-key') },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, to: () => MARK('github-token') },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, to: () => MARK('github-token') },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: () => MARK('slack-token') },
  { re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])/g, to: () => MARK('aws-key-id') },
  // Telegram bot token: <bot id>:<secret>. The published shape is 35 chars after the
  // colon; the window is wider so a format tweak can't slip the whole token through.
  { re: /\b\d{8,10}:[A-Za-z0-9_-]{30,48}(?![A-Za-z0-9_-])/g, to: () => MARK('telegram-bot-token') },
  // Authorization: Bearer <token>
  {
    re: /\b(bearer)(\s+)(?!\[REDACTED:)[A-Za-z0-9._~+/=-]{12,}/gi,
    to: (_m, word, ws) => `${word}${ws}${MARK('bearer-token')}`,
  },
  // key=value / key: value. Mandatory separator so prose ("password requirements") is safe.
  {
    re: /\b((?:aws[_-]?)?(?:api[_-]?key|apikey|secret[_-]?access[_-]?key|access[_-]?key[_-]?id|access[_-]?key|secret[_-]?key|client[_-]?secret|service[_-]?role(?:[_-]?key)?|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key|password|passwd|secret|token))(\s*[:=]\s*)(?!\[REDACTED:)["']?[A-Za-z0-9_+/.=~-]{12,}["']?/gi,
    to: (_m, key, sep) => `${key}${sep}${MARK('secret-assignment')}`,
  },
  // AWS secret access key shape: exactly 40 chars of standard base64. Pure hex is EXEMPT —
  // that is a git SHA-1, and it must survive.
  {
    re: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{40}={0,2}(?![A-Za-z0-9+/=])/g,
    to: (m) => (isPureHex(m) ? m : MARK('base64-secret')),
  },
  // Generic high-entropy base64url run. Pure hex defers to the hex rule below.
  {
    re: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}/g,
    to: (m) => (!isPureHex(m) && isMixedAlphabet(m) ? MARK('high-entropy') : m),
  },
  // Long hex runs (hex-encoded keys, 32-char API keys). 40 and 64 are git object id
  // lengths and pass through untouched — see the header note.
  {
    re: /(?<![A-Za-z0-9])[0-9a-fA-F]{32,}(?![A-Za-z0-9])/g,
    to: (m) => (m.length === 40 || m.length === 64 ? m : MARK('hex-secret')),
  },
]

/**
 * Redact secret-shaped strings and bound length. Call this on EVERY value that leaves the
 * dispatcher process — mc_requests writes, Telegram payloads, surfaced QC output.
 *
 * @param {unknown} input   string, array of strings, or anything String()-able
 * @param {{maxLen?: number}} [opts]  maxLen defaults to 480 (the dispatcher's existing clip)
 * @returns {string}
 */
export function sanitizeForMC(input, { maxLen = 480 } = {}) {
  let text = Array.isArray(input)
    ? input.map((x) => String(x ?? '')).join('; ')
    : String(input ?? '')
  for (const { re, to } of RULES) text = text.replace(re, to)
  if (maxLen > 0 && text.length > maxLen) text = `${text.slice(0, maxLen - 1)}…`
  return text
}
