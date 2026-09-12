import { describe, it, expect } from 'vitest'
import { policyName } from '../src/labels.js'
import { POLICY_NAME } from '../../frontend/src/lib/progression.js'

describe('policyName', () => {
  it('resolves every policy the frontend registers, triple included', () => {
    for (const policy of Object.keys(POLICY_NAME)) {
      expect(policyName(policy)).toBe(POLICY_NAME[policy])
    }
  })
})
