#!/usr/bin/env node
// Generate the STABLE signing CA for the TLS-terminating executor proxy (C6, Case 7 fix).
//
//   node docker/executor-proxy/gen-ca.mjs         # generate if absent (idempotent)
//   node docker/executor-proxy/gen-ca.mjs --force # regenerate a fresh CA
//
// Why a baked CA and not mitmproxy's default: mitmproxy generates a NEW ephemeral CA on
// first run. That CA is unknowable at executor-image build time, so the executor could
// never pin/trust it. We generate ONE stable CA here, bake the PRIVATE key into the proxy
// image (docker/executor-proxy/ca/mitmproxy-ca.pem) and the PUBLIC cert into the executor
// image (docker/executor/... trusts mitmproxy-ca-cert.pem). The executor then trusts the
// MITM leaf certs the proxy mints for api.anthropic.com — and ONLY that host is intercepted.
//
// SECRETS CONTRACT (see .gitignore):
//   ca/mitmproxy-ca.pem       = private key + cert  -> proxy image ONLY, GITIGNORED (never commit)
//   ca/mitmproxy-ca-cert.pem  = public cert only    -> executor image + repo, COMMITTED (audit anchor)
//
// A leaked CA private key would let anyone mint an api.anthropic.com cert the executor trusts.
// Inside this sandbox the proxy already sees plaintext, so the blast radius is local — but we
// still keep the key out of git. On a fresh clone with no key, this script mints a new CA; you
// must then rebuild BOTH images (npm run executor:net + npm run executor:image) so they share it.

import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CA_DIR = join(HERE, 'ca')
const CA_KEYCERT = join(CA_DIR, 'mitmproxy-ca.pem')       // key + cert (proxy image, gitignored)
const CA_CERT = join(CA_DIR, 'mitmproxy-ca-cert.pem')     // cert only (executor image, committed)
// Public-cert copy inside the executor image build context (docker/executor/). The
// executor build context cannot reach ../executor-proxy/ca, so we place a copy here.
// Same public cert, single generator — kept in lockstep by this script.
const EXECUTOR_CERT = join(HERE, '..', 'executor', 'executor-proxy-ca.crt')
const FORCE = process.argv.includes('--force')

function openssl(args, opts = {}) {
  const r = spawnSync('openssl', args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${(r.stderr || r.stdout || '').trim()}`)
  return r.stdout || ''
}

if (existsSync(CA_KEYCERT) && existsSync(CA_CERT) && !FORCE) {
  // Idempotent, but keep the executor-context copy in sync in case it drifted/was cleaned.
  if (!existsSync(EXECUTOR_CERT) || readFileSync(EXECUTOR_CERT, 'utf8') !== readFileSync(CA_CERT, 'utf8')) {
    writeFileSync(EXECUTOR_CERT, readFileSync(CA_CERT, 'utf8'))
    console.log(`[gen-ca] refreshed executor-context copy ${EXECUTOR_CERT}`)
  }
  console.log(`[gen-ca] CA already present at ${CA_KEYCERT} — reusing (pass --force to regenerate).`)
  process.exit(0)
}

mkdirSync(CA_DIR, { recursive: true })
const keyPath = join(CA_DIR, '_ca.key.tmp')
const certPath = join(CA_DIR, '_ca.crt.tmp')

try {
  // RSA-2048 CA, 10y. CA:TRUE + keyCertSign so mitmproxy can mint leaf certs from it.
  openssl(['genrsa', '-out', keyPath, '2048'])
  openssl([
    'req', '-x509', '-new', '-nodes', '-key', keyPath, '-sha256', '-days', '3650',
    '-out', certPath,
    '-subj', '/O=personal-os/CN=MC Executor Sandbox CA',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ])

  const key = readFileSync(keyPath, 'utf8')
  const cert = readFileSync(certPath, 'utf8')
  // mitmproxy-ca.pem: private key FIRST, then the cert (mitmproxy's expected format).
  writeFileSync(CA_KEYCERT, key.trimEnd() + '\n' + cert.trimEnd() + '\n')
  writeFileSync(CA_CERT, cert.trimEnd() + '\n')
  writeFileSync(EXECUTOR_CERT, cert.trimEnd() + '\n')
  console.log(`[gen-ca] wrote ${CA_KEYCERT} (key+cert, gitignored), ${CA_CERT} + ${EXECUTOR_CERT} (public cert, committed).`)
} finally {
  for (const p of [keyPath, certPath]) if (existsSync(p)) rmSync(p)
}
