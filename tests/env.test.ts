import { describe, it, expect, afterEach } from 'vitest'
import { cleanEnv, requireEnv } from '@/lib/env'

const KEY = 'TEST_ENV_SANITIZER_KEY'
afterEach(() => { delete process.env[KEY] })

describe('cleanEnv', () => {
  it('strips a leading BOM (the ByteString header crash)', () => {
    process.env[KEY] = '﻿sk-ant-123'
    expect(cleanEnv(KEY)).toBe('sk-ant-123')
  })

  it('strips zero-width characters and surrounding whitespace', () => {
    process.env[KEY] = '  sk-ant​-123\n'
    expect(cleanEnv(KEY)).toBe('sk-ant-123')
  })

  it('returns undefined for unset or blank values', () => {
    expect(cleanEnv(KEY)).toBeUndefined()
    process.env[KEY] = '﻿  '
    expect(cleanEnv(KEY)).toBeUndefined()
  })
})

describe('requireEnv', () => {
  it('names the variable when it is missing', () => {
    expect(() => requireEnv(KEY)).toThrow(KEY)
  })
})
