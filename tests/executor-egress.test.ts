// C6-P3 regression guard: the sandbox must never be argv'd onto a routable network.
import { describe, it, expect } from 'vitest'
import { buildDockerArgs, EXECUTOR_NET, EXECUTOR_PROXY_URL } from '../scripts/lib/claude-executor-adapter.mjs'

const argv = buildDockerArgs({
  workspace: 'C:\\ws', creds: 'C:\\creds.json', image: 'mc-executor:latest',
  containerName: 'mc-executor-test', prompt: 'x', skipPermissions: true,
})

describe('executor egress lockdown', () => {
  it('pins the container to the internal network', () => {
    expect(argv[argv.indexOf('--network') + 1]).toBe(EXECUTOR_NET)
    expect(argv).not.toContain('--network=host')
  })

  it('points well-behaved clients at the allowlisting proxy', () => {
    expect(argv).toContain(`HTTPS_PROXY=${EXECUTOR_PROXY_URL}`)
  })

  it('leaks no host env beyond the authored proxy vars', () => {
    const injected = argv.filter((a, i) => argv[i - 1] === '-e')
    expect(injected.every((v) => /^(HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy)=/.test(v))).toBe(true)
  })
})
