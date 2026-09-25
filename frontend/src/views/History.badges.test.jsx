import { describe, expect, it } from 'vitest'
import { auditFields, badgeFor } from './history-outcome.js'

const f = (code, field) => ({ code, field, expected: null, actual: null, severity: 'warning' })

describe('history badges', () => {
  it('reads the audit saved with the log, never a live rule', () => {
    expect(badgeFor({ audit: [] })).toBe('on-plan')
    expect(badgeFor({ audit: [f('below_range', 'reps'), f('above_cap', 'load')] })).toBe('out-of-plan')
    expect(badgeFor({ audit: [f('completed_track', 'track')] })).toBe('completed')
    expect(badgeFor({ performance: { sets: [] } })).toBe(null)
  })

  it('lists each field with a finding once', () => {
    expect(auditFields({ audit: [f('below_range', 'reps'), f('below_range', 'reps'), f('above_cap', 'load'), f('completed_track', 'track')] })).toEqual(['reps', 'load'])
  })
})
