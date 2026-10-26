import { beforeAll, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { state, REDIRECT } = vi.hoisted(() => ({
  state: { clientScope: 'sync' },
  REDIRECT: 'https://claude.ai/api/mcp/auth_callback',
}))

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { client_id: 'c1', redirect_uris: [REDIRECT], client_name: null, scope: state.clientScope },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

const ISSUER = 'https://mc.example.test'

import {
  isRegistrableRedirectUri, connectorForRedirects, signAccessToken, verifyAccessToken,
  grantForClientScope, CONNECTOR_GRANTS, type OAuthConfig,
} from '@/lib/oauth'
import { toolsForScope, isToolAllowed } from '@/lib/mcp-tools'

const cfg: OAuthConfig = {
  issuer: ISSUER, resource: `${ISSUER}/api/mcp-liaison`, jwtSecret: 's'.repeat(32),
  accessTokenTtl: 900, refreshTokenTtl: 7776000, refreshTokenMaxTtl: 31536000,
  chatgptRedirectUri: null, consentPasscode: 'p'.repeat(16), allowDcrBootstrap: false,
}

describe('claude.ai sync scope', () => {
  it('registers only the exact Claude callbacks, with bootstrap off', () => {
    expect(isRegistrableRedirectUri('https://claude.ai/api/mcp/auth_callback', cfg)).toBe(true)
    expect(isRegistrableRedirectUri('https://claude.com/api/mcp/auth_callback', cfg)).toBe(true)
    expect(isRegistrableRedirectUri('https://claude.ai/api/mcp/auth_callback/extra', cfg)).toBe(false)
    expect(isRegistrableRedirectUri('https://claude.ai.evil.com/api/mcp/auth_callback', cfg)).toBe(false)
  })

  it('assigns a connector per redirect set and rejects mixed sets', () => {
    expect(connectorForRedirects([REDIRECT])).toBe('claude')
    expect(connectorForRedirects(['https://chatgpt.com/connector/oauth/x'])).toBe('chatgpt')
    expect(connectorForRedirects([REDIRECT, 'https://chatgpt.com/connector/oauth/x'])).toBeNull()
  })

  it('mints sync tokens for Claude and liaison by default; unknown client scope gets liaison', () => {
    const claude = verifyAccessToken(signAccessToken(cfg, CONNECTOR_GRANTS.claude).token, cfg)
    expect(claude.valid).toBe(true)
    expect(claude.claims).toMatchObject({ scope: 'sync', sub: 'claude-ai' })
    expect(verifyAccessToken(signAccessToken(cfg).token, cfg).claims).toMatchObject({ scope: 'liaison', sub: 'chatgpt-liaison' })
    expect(grantForClientScope('full')).toBe(CONNECTOR_GRANTS.chatgpt)
  })

  it('sync sees reads plus exactly the three session bookends, never credentials', () => {
    const writes = toolsForScope('sync').filter(t => t.scope !== 'read').map(t => t.name).sort()
    expect(writes).toEqual(['mc_claim_task', 'mc_complete_task', 'mc_update_project_status'])
    for (const name of ['mc_get_credential', 'mc_capture_credential', 'mc_write_vault']) {
      expect(isToolAllowed(name, 'sync')).toBe(false)
    }
  })
})

describe('/oauth/authorize scope handling', () => {
  beforeAll(() => {
    process.env.OAUTH_ISSUER = ISSUER
    process.env.MCP_RESOURCE_URL = `${ISSUER}/api/mcp-liaison`
    process.env.OAUTH_JWT_SECRET = 's'.repeat(32)
    process.env.OAUTH_CONSENT_PASSCODE = 'p'.repeat(16)
  })

  async function authorize(scope: string) {
    const { GET } = await import('@/app/oauth/authorize/route')
    const qs = new URLSearchParams({
      response_type: 'code', client_id: 'c1', redirect_uri: REDIRECT, scope, state: 's',
      code_challenge: 'x'.repeat(43), code_challenge_method: 'S256',
    })
    return GET(new NextRequest(`${ISSUER}/oauth/authorize?${qs}`))
  }

  it('accepts every advertised scope but shows the client its own grant', async () => {
    state.clientScope = 'sync'
    const claude = await authorize('liaison sync offline_access')
    expect(claude.status).toBe(200)
    expect(await claude.text()).toContain('Authorize Claude')

    state.clientScope = 'liaison'
    const chatgpt = await authorize('liaison sync offline_access')
    expect(chatgpt.status).toBe(200)
    expect(await chatgpt.text()).toContain('Authorize ChatGPT liaison')
  })

  it('still rejects unknown scopes', async () => {
    state.clientScope = 'sync'
    const res = await authorize('sync admin')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('error=invalid_scope')
  })
})
