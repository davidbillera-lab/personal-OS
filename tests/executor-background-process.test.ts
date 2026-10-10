import { describe, expect, it } from 'vitest'

import { dockerSpawnOptions } from '../scripts/lib/claude-executor-adapter.mjs'

describe('Docker background process options', () => {
  it('prevents idle Docker health checks from opening a Windows terminal', () => {
    expect(dockerSpawnOptions()).toMatchObject({ windowsHide: true })
  })
})
