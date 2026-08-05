// Ops-content classifier — v0 stopgap blocklist.
//
// Runs against a claimed request's title + request_text BEFORE the dispatcher
// hands it to the executor. Design: blocklist (build unless flagged dangerous).
// Catches live-ops / infra-account / secrets / spend / destructive language so
// a build never touches production, DNS, credentials, or money unattended.
//
// This is NOT a security boundary — it's a content heuristic. A blocklist can
// miss novel phrasings (e.g. paraphrased requests, indirect asks). The real
// fix is C6 (OS-sandboxing the worker so a flagged build literally cannot
// reach production/infra regardless of what the model decides to do).

const RULES = [
  // live-deploy
  { category: 'live-deploy', pattern: /\bdeploy\b/i },
  { category: 'live-deploy', pattern: /\bdeployment\b/i },
  { category: 'live-deploy', pattern: /\bgo live\b/i },
  { category: 'live-deploy', pattern: /\bproduction\b/i },
  { category: 'live-deploy', pattern: /\bprod\b/i },
  { category: 'live-deploy', pattern: /\bship to prod\b/i },

  // dns-domain
  { category: 'dns-domain', pattern: /\bdns\b/i },
  { category: 'dns-domain', pattern: /\bnameserver\b/i },
  { category: 'dns-domain', pattern: /\bname server\b/i },
  { category: 'dns-domain', pattern: /\bdomain\b/i },
  { category: 'dns-domain', pattern: /\bssl\b/i },
  { category: 'dns-domain', pattern: /\bcname\b/i },
  { category: 'dns-domain', pattern: /\bregistrar\b/i },
  { category: 'dns-domain', pattern: /\ba record\b/i },
  { category: 'dns-domain', pattern: /\bmx record\b/i },

  // infra-account
  { category: 'infra-account', pattern: /access the .*(account|dashboard)/i },
  { category: 'infra-account', pattern: /authorized .* to access/i },
  { category: 'infra-account', pattern: /connected (vercel|cloudflare|aws|supabase) account/i },
  { category: 'infra-account', pattern: /make .*(changes|corrections?) .*(yourself|directly|live)/i },
  { category: 'infra-account', pattern: /correct the .*(vercel|domain|dns) config/i },

  // protected-git
  { category: 'protected-git', pattern: /merge (to|into) (main|master|prod)/i },
  { category: 'protected-git', pattern: /push to (production|main|master)/i },

  // secrets
  { category: 'secrets', pattern: /\bcredential/i },
  { category: 'secrets', pattern: /\bsecret\b/i },
  { category: 'secrets', pattern: /\bapi[ -]?key\b/i },
  { category: 'secrets', pattern: /\btoken\b/i },
  { category: 'secrets', pattern: /\bpassword\b/i },
  { category: 'secrets', pattern: /\bprivate key\b/i },
  { category: 'secrets', pattern: /\.env\b/i },
  { category: 'secrets', pattern: /\benvironment variable\b/i },

  // spend
  { category: 'spend', pattern: /\bcharge\b/i },
  { category: 'spend', pattern: /\bpayment\b/i },
  { category: 'spend', pattern: /\bpurchase\b/i },
  { category: 'spend', pattern: /\bspend\b/i },
  { category: 'spend', pattern: /\binvoice\b/i },
  { category: 'spend', pattern: /\brefund\b/i },
  { category: 'spend', pattern: /\bstripe\b/i },

  // external-comms
  { category: 'external-comms', pattern: /send (an? )?(email|text|sms|message|dm)\b/i },
  { category: 'external-comms', pattern: /\bpost to \b/i },
  { category: 'external-comms', pattern: /\bpublish to \b/i },

  // destructive
  { category: 'destructive', pattern: /\bdrop table\b/i },
  { category: 'destructive', pattern: /\btruncate\b/i },
  { category: 'destructive', pattern: /rm -rf/i },
  { category: 'destructive', pattern: /delete .*(database|table|repo|project|production)/i },
]

// Categories that MAY be exempted when the request is read-only. Every other
// category (secrets, dns-domain, infra-account, protected-git, external-comms,
// destructive) is hard and can never be suppressed.
const SUPPRESSIBLE = new Set(['spend', 'live-deploy'])

const READ_ONLY_INTENT_PATTERN = /\b(measure|analyz(e|ing)|analys(e|ing)|estimate|report|forecast|calculate|review|audit|assess|evaluat(e|ing)|summariz(e|ing)|summaris(e|ing))\b|\bcost analysis\b|\bread[ -]only\b|\bdo not (make )?chang|\bdon't change|\bno changes\b|\bwithout chang|\bprohibits chang/i

// Two-tier action detection. Tier 1 fires bare on unambiguous action verbs.
// Tier 2 fires only when an ambiguous word is followed by an object/determiner,
// so "lower-cost" / "break-even" / "billing plan" do not count as actions.
const ACTION_WORDS = /\b(purchase|buy|refund|authoriz(e|es|ing)|authoris(e|es|ing)|approv(e|es|ing)|subscrib(e|es|ing)|unsubscrib(e|es|ing)|deploy(s|ing)?|redeploy|rotat(e|es|ing)|revok(e|es|ing)|provision(s|ing)?|migrat(e|es|ing))\b/i

const ACTION_PHRASE = /\b(increase|decrease|raise|lower|set|add|update|modify|edit|change|remove|delete|enable|disable|cancel|charge|pay|bill|issue|schedule|reschedule)\s+(the|a|an|our|your|its|their|this|that|these|those|all|new|more|additional|another|\d+)\b/i

/**
 * hasReadOnlyIntent(text) → true if the text contains an affirmative
 * analysis/read-only signal (e.g. "analyze", "report", "read-only",
 * "do not make changes").
 */
function hasReadOnlyIntent(text) {
  return READ_ONLY_INTENT_PATTERN.test(text)
}

/**
 * hasAction(text) → true if the text contains an authorization/mutation/action
 * signal: an unambiguous action word (Tier 1) OR an ambiguous word directly
 * governing an object (Tier 2).
 */
function hasAction(text) {
  return ACTION_WORDS.test(text) || ACTION_PHRASE.test(text)
}

/**
 * classifyOps(text) → { flagged, category, matched }
 * Scans text against the curated blocklist above and returns the FIRST match.
 * A match in a SUPPRESSIBLE category (spend, live-deploy) is skipped -- scanning
 * continues -- when the text has read-only intent AND no action signal.
 * Hard categories are never suppressed.
 */
export function classifyOps(text) {
  const input = String(text ?? '')
  const readOnlyExempt = hasReadOnlyIntent(input) && !hasAction(input)
  for (const { category, pattern } of RULES) {
    const m = input.match(pattern)
    if (!m) continue
    if (SUPPRESSIBLE.has(category) && readOnlyExempt) continue
    return { flagged: true, category, matched: m[0] }
  }
  return { flagged: false, category: null, matched: null }
}
