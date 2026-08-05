import { describe, it, expect } from 'vitest'
import { classifyOps } from '../scripts/lib/ops-classifier.mjs'

describe('classifyOps', () => {
  describe('flags high-risk requests', () => {
    it('flags the Rayetta DNS/infra-account text', () => {
      const text = "fix Rayetta LP estate-sales domain DNS in Vercel - you're authorized to access the connected Vercel account and make the necessary corrective changes yourself"
      const result = classifyOps(text)
      expect(result.flagged).toBe(true)
    })

    it('flags "deploy to production"', () => {
      const result = classifyOps('deploy to production')
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('live-deploy')
    })

    it('flags "send an email to the client"', () => {
      const result = classifyOps('send an email to the client')
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('external-comms')
    })

    it('flags "charge the customer"', () => {
      const result = classifyOps('charge the customer')
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('spend')
    })

    it('flags "merge to main"', () => {
      const result = classifyOps('merge to main')
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('protected-git')
    })
  })

  describe('does not flag safe sandbox build requests', () => {
    it('does not flag creating a markdown file', () => {
      const result = classifyOps('Create a file DISPATCHER_TEST.md with one line.')
      expect(result.flagged).toBe(false)
      expect(result.category).toBeNull()
      expect(result.matched).toBeNull()
    })

    it('does not flag writing a reverse-string function with a unit test', () => {
      const result = classifyOps('Write a reverse-string function with a unit test.')
      expect(result.flagged).toBe(false)
    })

    it('does not flag adding a React component that renders a list', () => {
      const result = classifyOps('Add a React component that renders a list.')
      expect(result.flagged).toBe(false)
    })
  })

  describe('allows read-only cost analysis but holds authorized changes', () => {
    it('allows a read-only spend/cost report', () => {
      const result = classifyOps(
        'Analyze and report FlipRadar monthly operational spend. Read-only: do not make any changes.'
      )
      expect(result.flagged).toBe(false)
      expect(result.category).toBeNull()
      expect(result.matched).toBeNull()
    })

    it('holds a billing/purchase authorization as spend', () => {
      const result = classifyOps(
        'Authorize the purchase of additional API quota and update the billing plan.'
      )
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('spend')
    })

    it('holds a credential/secret change as secrets', () => {
      const result = classifyOps(
        'Rotate the FlipRadar API credentials and update the stored secret.'
      )
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('secrets')
    })

    it('still flags a bare mention with no read-only intent', () => {
      const result = classifyOps('charge the customer')
      expect(result.flagged).toBe(true)
      expect(result.category).toBe('spend')
    })

    it('allows a bare mention when read-only intent is stated', () => {
      const result = classifyOps('analyze our spend, read-only')
      expect(result.flagged).toBe(false)
    })
  })
})
