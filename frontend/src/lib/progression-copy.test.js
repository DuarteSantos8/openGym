import { describe, expect, it } from 'vitest'
import { progressionGuidance } from './progression-copy.js'

describe('policy-labelled progression guidance', () => {
  it('keeps the calculated outcome and identifies the policy that produced it', () => {
    const why = ['Every rep last time. {0} {1} more.', 2.5, 'kg']

    expect(progressionGuidance({ policy: 'linear', kind: 'up', weight: 62.5, why }))
      .toEqual({ policyLabel: 'Linear progression', why })
  })

  it('labels hold and deload outcomes without changing their calculated reasons', () => {
    const hold = ['Missed reps last time. Same weight again ({0} of {1} to go).', 2, 3]
    const deload = ['Missed reps. Reset to {0} {1} and work back up.', 55, 'kg']

    expect(progressionGuidance({ policy: 'double', kind: 'hold', why: hold }))
      .toEqual({ policyLabel: 'Double progression', why: hold })
    expect(progressionGuidance({ policy: 'greyskull', kind: 'deload', why: deload }))
      .toEqual({ policyLabel: 'Greyskull LP', why: deload })
  })

  it('labels a rest-pause outcome as rest-pause, the rule that decided it', () => {
    const why = ['{0} reps in total last time. Go for {1} at the same weight.', 20, 21]
    expect(progressionGuidance({ policy: 'linear', kind: 'up', rpAim: 21, why }))
      .toEqual({ policyLabel: 'Rest-pause', why })
    expect(progressionGuidance({ policy: 'off', kind: 'off', rpAim: 20 })).toBeNull()
  })

  it('labels a baseline outcome and omits policies with no visible outcome', () => {
    const baseline = ['Nothing logged yet, so this session sets the baseline.']
    expect(progressionGuidance({ policy: 'linear', kind: 'first', why: baseline }))
      .toEqual({ policyLabel: 'Linear progression', why: baseline })
    expect(progressionGuidance({ policy: 'off', kind: 'off' })).toBeNull()
    expect(progressionGuidance({ policy: 'linear', kind: 'first' })).toBeNull()
    expect(progressionGuidance(null)).toBeNull()
  })
})
