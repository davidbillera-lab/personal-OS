import { describe, it, expect } from 'vitest'
import { sanitizeForMC } from '../scripts/lib/sanitize-result.mjs'

// Fakes only — none of these are real credentials.
const GIT_SHA = '3f2a91c0de4b7a5e18cc6d0f9b2e4a7c13d5f608' // 40 hex
const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('sanitizeForMC', () => {
  describe('redacts secret shapes', () => {
    it('redacts an OpenAI key', () => {
      const out = sanitizeForMC('leaked sk-Abcd1234Efgh5678Ijkl9012Mnop here')
      expect(out).toContain('[REDACTED:openai-key]')
      expect(out).not.toContain('Abcd1234Efgh')
    })

    it('redacts an Anthropic key and names it separately', () => {
      const out = sanitizeForMC('key sk-ant-api03-AbC123dEf456GhI789jKl012')
      expect(out).toContain('[REDACTED:anthropic-key]')
      expect(out).not.toContain('api03')
    })

    it('redacts a JWT (the Supabase service-role key shape)', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwfQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      const out = sanitizeForMC(`SUPABASE_SERVICE_ROLE_KEY=${jwt}`)
      expect(out).toContain('[REDACTED:')
      expect(out).not.toContain('eyJhbGciOi')
      expect(out).not.toContain('service_role')
    })

    it('redacts GitHub tokens (ghp_, gho_, github_pat_)', () => {
      expect(sanitizeForMC('ghp_16C7e42F292c6912E7710c838347Ae178B4a')).toContain('[REDACTED:github-token]')
      expect(sanitizeForMC('gho_16C7e42F292c6912E7710c838347Ae178B4a')).toContain('[REDACTED:github-token]')
      expect(sanitizeForMC('github_pat_11ABCDE0Y0abcdefghij_KLMNOPqrstuvwxyz0123456789')).toContain(
        '[REDACTED:github-token]',
      )
    })

    it('redacts an AWS access key id and a 40-char base64 secret', () => {
      const out = sanitizeForMC('AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
      expect(out).toContain('[REDACTED:aws-key-id]')
      expect(out).toContain('[REDACTED:base64-secret]')
      expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(out).not.toContain('wJalrXUtnFEMI')
    })

    it('redacts a Telegram bot token', () => {
      const out = sanitizeForMC('TELEGRAM_BOT_TOKEN 8012345678:AAHfakeTokenValue_1234567890abcdefg')
      expect(out).toContain('[REDACTED:telegram-bot-token]')
      expect(out).not.toContain('AAHfakeTokenValue')
    })

    it('redacts credentials embedded in URLs but keeps the scheme and host', () => {
      const out = sanitizeForMC('DB at postgres://admin:hunter2hunter2@db.example.com:5432/mc')
      expect(out).toContain('postgres://[REDACTED:url-credentials]@db.example.com')
      expect(out).not.toContain('hunter2hunter2')

      const https = sanitizeForMC('cloned https://user:ghtokenvalue123@github.com/foo/bar.git')
      expect(https).toContain('https://[REDACTED:url-credentials]@github.com')
      expect(https).not.toContain('ghtokenvalue123')
    })

    it('redacts keyword=value assignments of unknown shape', () => {
      const out = sanitizeForMC('exported API_KEY=8f3d1c9a2b7e4f60d5a1 and password: correcthorsebattery')
      expect(out).toContain('[REDACTED:secret-assignment]')
      expect(out).not.toContain('8f3d1c9a2b7e4f60d5a1')
      expect(out).not.toContain('correcthorsebattery')
    })

    it('redacts a bearer token', () => {
      const out = sanitizeForMC('Authorization: Bearer aVeryLongOpaqueTokenValue123')
      expect(out).toContain('Bearer [REDACTED:bearer-token]')
      expect(out).not.toContain('aVeryLongOpaqueTokenValue123')
    })

    it('redacts a long high-entropy base64url run with no known prefix', () => {
      const out = sanitizeForMC('blob aB3xY9zQ7mN2pR5tW8vK1jH4gF6dS0lC7bV3nM9qZ2xA')
      expect(out).toContain('[REDACTED:high-entropy]')
    })

    it('redacts long hex runs that are not git object ids', () => {
      expect(sanitizeForMC(`md5ish ${'a'.repeat(16)}${'9f3c'.repeat(4)}`)).toContain('[REDACTED:hex-secret]')
      expect(sanitizeForMC(`hexkey ${'ab12'.repeat(24)}`)).toContain('[REDACTED:hex-secret]') // 96 chars
    })
  })

  describe('does NOT over-redact operator-critical values', () => {
    it('passes a 40-char git SHA through untouched', () => {
      expect(sanitizeForMC(`commit ${GIT_SHA}`)).toBe(`commit ${GIT_SHA}`)
    })

    it('passes a 64-char git SHA-256 object id through untouched', () => {
      const sha256 = 'a'.repeat(10) + '3f2a91c0de4b7a5e18cc6d0f9b2e4a7c13d5f608' + 'b'.repeat(14)
      expect(sha256.length).toBe(64)
      expect(sanitizeForMC(`commit ${sha256}`)).toBe(`commit ${sha256}`)
    })

    it('passes request ids, attempt ids and build branch names through', () => {
      const text = `Request: ${UUID} Attempt: ${UUID} branch mc-build-${UUID}`
      expect(sanitizeForMC(text)).toBe(text)
    })

    it('keeps a realistic approval blocker readable and actionable', () => {
      const blocker =
        `built Add a hello-world file; CodexQC SHIP; push commit ${GIT_SHA} ` +
        `to davidbillera-lab/mc-spike-test@mc-build-${UUID} — approve via ChatGPT Voice`
      const out = sanitizeForMC(blocker)
      expect(out).toBe(blocker)
      expect(out).toContain(GIT_SHA)
      expect(out).toContain('davidbillera-lab/mc-spike-test')
      expect(out).toContain(`mc-build-${UUID}`)
      expect(out).toContain('SHIP')
    })

    it('keeps the verdict words and ordinary commit prose', () => {
      const text = 'built; CodexQC FIX-FIRST; RECONSIDER not returned; refactor lib/parser and add tests'
      expect(sanitizeForMC(text)).toBe(text)
    })

    it('does not eat prose that merely mentions secrets', () => {
      const text = 'updated the password requirements doc and the token handling module'
      expect(sanitizeForMC(text)).toBe(text)
    })
  })

  describe('bounds length', () => {
    it('truncates to maxLen with an ellipsis marker', () => {
      const out = sanitizeForMC('x'.repeat(1000), { maxLen: 50 })
      expect(out.length).toBe(50)
      expect(out.endsWith('…')).toBe(true)
    })

    it('defaults to 480 chars', () => {
      expect(sanitizeForMC('y'.repeat(5000)).length).toBe(480)
    })

    it('redacts BEFORE truncating so no secret prefix survives the cut', () => {
      const out = sanitizeForMC(`pad ${'sk-Abcd1234Efgh5678Ijkl9012Mnop'} tail`, { maxLen: 20 })
      expect(out).not.toContain('sk-Abcd')
    })

    it('joins array input (executor commit lists)', () => {
      expect(sanitizeForMC(['abc123 first commit', 'def456 second commit'])).toBe(
        'abc123 first commit; def456 second commit',
      )
    })

    it('handles null/undefined without throwing', () => {
      expect(sanitizeForMC(null)).toBe('')
      expect(sanitizeForMC(undefined)).toBe('')
    })
  })

  it('completes fast on adversarial input (no catastrophic backtracking)', () => {
    const adversarial = [
      'a'.repeat(200000),
      'eyJ' + 'a'.repeat(100000),
      'sk-ant-' + 'x'.repeat(100000),
      'https://' + 'u'.repeat(50000) + ':' + 'p'.repeat(50000),
      'password=' + 'Aa1'.repeat(30000),
      ('AKIA' + 'B'.repeat(15) + ' ').repeat(5000),
    ].join(' ')
    const started = Date.now()
    const out = sanitizeForMC(adversarial, { maxLen: 480 })
    const elapsed = Date.now() - started
    expect(out.length).toBeLessThanOrEqual(480)
    expect(elapsed).toBeLessThan(2000)
  })
})
