#!/usr/bin/env node
// Provision the executor sandbox's egress boundary (C6-P3).
//
//   npm run executor:net          # up   (idempotent — safe to run repeatedly)
//   npm run executor:net:status   # show what exists
//   npm run executor:net:down     # tear down (only OUR network/container)
//
// Shape:
//   mc-executor-net     --internal  -> NO route to the internet, enforced by Docker
//   mc-executor-egress  bridge      -> normal outbound, proxy only
//   mc-executor-proxy               -> sits on both; allowlisting forward proxy
//
// The executor runs on mc-executor-net alone, so the proxy is the ONLY egress
// path that exists. Ignoring HTTPS_PROXY gets a build nothing: there is no route.
//
// Only ever touches objects named exactly as the constants below — unrelated
// Docker networks/containers on this rig are never enumerated or removed.

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import {
  EXECUTOR_NET, EXECUTOR_EGRESS_NET, EXECUTOR_NET_SUBNET,
  EXECUTOR_PROXY_CONTAINER, EXECUTOR_PROXY_IMAGE,
} from './lib/claude-executor-adapter.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCKER = process.env.DOCKER_BIN || 'docker'

function d(args, { quiet = true } = {}) {
  return spawnSync(DOCKER, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' })
}
function out(args) {
  const r = d(args)
  return r.status === 0 ? (r.stdout || '').trim() : null
}
function must(args, what) {
  const r = d(args, { quiet: false })
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status})`)
}

function up() {
  console.log(`[executor-net] building ${EXECUTOR_PROXY_IMAGE} …`)
  must(['build', '-t', EXECUTOR_PROXY_IMAGE, join(REPO, 'docker', 'executor-proxy')], 'proxy image build')

  // 1. Internal network — the deny-by-default. Reuse if already correct.
  const internal = out(['network', 'inspect', EXECUTOR_NET, '--format', '{{.Internal}}'])
  if (internal === null) {
    must(['network', 'create', '--internal', '--subnet', EXECUTOR_NET_SUBNET, EXECUTOR_NET], 'network create')
    console.log(`[executor-net] created ${EXECUTOR_NET} (--internal, ${EXECUTOR_NET_SUBNET})`)
  } else if (internal !== 'true') {
    // Fail rather than silently running builds on a network with a route out.
    throw new Error(
      `network '${EXECUTOR_NET}' exists but is NOT --internal — that is an open-egress sandbox. ` +
      `Remove it (npm run executor:net:down) and re-run npm run executor:net.`,
    )
  } else {
    console.log(`[executor-net] ${EXECUTOR_NET} already present (--internal)`)
  }

  // 2. Egress bridge — the proxy's own route out. Nothing else joins it.
  if (out(['network', 'inspect', EXECUTOR_EGRESS_NET, '--format', '{{.Name}}']) === null) {
    must(['network', 'create', EXECUTOR_EGRESS_NET], 'egress network create')
    console.log(`[executor-net] created ${EXECUTOR_EGRESS_NET} (bridge)`)
  }

  // 3. Proxy — always recreated so an edited allowlist actually takes effect.
  d(['rm', '-f', EXECUTOR_PROXY_CONTAINER])
  must([
    'run', '-d',
    '--name', EXECUTOR_PROXY_CONTAINER,
    '--network', EXECUTOR_EGRESS_NET,
    '--restart', 'unless-stopped',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--memory=256m', '--pids-limit=128',
    // Deliberately NO -p: unreachable from the host or LAN, only from Docker networks.
    EXECUTOR_PROXY_IMAGE,
  ], 'proxy run')
  must(['network', 'connect', EXECUTOR_NET, EXECUTOR_PROXY_CONTAINER], 'proxy network connect')
  console.log(`[executor-net] ${EXECUTOR_PROXY_CONTAINER} up on ${EXECUTOR_EGRESS_NET} + ${EXECUTOR_NET}`)
  status()
}

function down() {
  d(['rm', '-f', EXECUTOR_PROXY_CONTAINER])
  d(['network', 'rm', EXECUTOR_NET])
  d(['network', 'rm', EXECUTOR_EGRESS_NET])
  console.log('[executor-net] torn down (proxy + both networks removed)')
}

function status() {
  const internal = out(['network', 'inspect', EXECUTOR_NET, '--format', '{{.Internal}}'])
  const running = out(['inspect', '-f', '{{.State.Running}}', EXECUTOR_PROXY_CONTAINER])
  const nets = out(['inspect', '-f', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}', EXECUTOR_PROXY_CONTAINER])
  console.log(`  network ${EXECUTOR_NET}: ${internal === null ? 'MISSING' : `present internal=${internal}`}`)
  console.log(`  proxy   ${EXECUTOR_PROXY_CONTAINER}: ${running === null ? 'MISSING' : `running=${running}`}${nets ? ` nets=[${nets.trim()}]` : ''}`)
}

const cmd = process.argv[2] || 'up'
try {
  if (cmd === 'up') up()
  else if (cmd === 'down') down()
  else if (cmd === 'status') status()
  else throw new Error(`unknown command '${cmd}' — use up | down | status`)
} catch (e) {
  console.error(`[executor-net] ${e.message}`)
  process.exit(1)
}
