import { describe, expect, it } from 'vitest'
import { editPlan } from './prescription/index.js'
import { ruleOccurrence } from './test-fixtures.js'
import { occurrenceChips, occurrenceTargets, plannedSets } from './occurrence-view.js'

const withPlan = (preset, options) => {
  const occ = ruleOccurrence('0025', { preset })
  return { ...occ, rule: editPlan(occ.rule, options) }
}

describe('occurrenceTargets', () => {
  it('reads sets, reps and the starting load off the rule', () => {
    const occ = withPlan('linear', { sets: { min: 4, max: 4 }, reps: { min: 8, max: 8 }, load: { mode: 'absolute', value: 60, unit: 'kg' } })
    expect(occurrenceTargets(occ)).toBe('4 × 8 @ 60 kg')
  })

  it('shows a range of reps and a percentage load', () => {
    const occ = withPlan('double', { sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 }, load: { mode: 'percent_1rm', percent: 75 } })
    expect(occurrenceTargets(occ)).toBe('3 × 8–12 @ 75% 1RM')
  })

  it('counts seconds for a timed hold, with no load', () => {
    const occ = withPlan('hold_seconds', { sets: { min: 3, max: 3 }, durationSeconds: { min: 30, max: 30 } })
    expect(occurrenceTargets(occ)).toMatch(/^3 × 30s/)
  })

  it('says a slot without a rule still needs setup', () => {
    expect(occurrenceTargets({ exerciseId: '0025' })).toBe('Needs setup')
  })
})

describe('plannedSets', () => {
  it('is the least number of sets the slot plans', () => {
    expect(plannedSets(withPlan('double', { sets: { min: 3, max: 5 } }))).toBe(3)
    expect(plannedSets({ exerciseId: '0025' })).toBe(0)
  })
})

describe('occurrenceChips', () => {
  const base = withPlan('linear', { sets: { min: 3, max: 3 } })

  it('leads with the progression and adds nothing else for a plain slot', () => {
    expect(occurrenceChips(base, { preset: 'Linear' })).toEqual(['Linear'])
  })

  it('names what was switched on, in the order the sheet offers it', () => {
    const occ = { ...base, side: true, warmup: { mode: 'smart', count: 2 }, intensifier: { type: 'dropset', count: 1, pct: 20 }, lastToFailure: true, backoff: true }
    expect(occurrenceChips(occ, { preset: 'Linear' })).toEqual(['Linear', 'Per side', 'Warm-ups', 'Drop-set', 'Taken to failure', 'Back-off sets'])
    expect(occurrenceChips({ ...base, intensifier: { type: 'restpause', totalReps: 8, restSec: 15 } }, { preset: 'Linear' })).toEqual(['Linear', 'Rest-pause'])
  })

  it('does not call a switched-off warm-up a chip', () => {
    expect(occurrenceChips({ ...base, warmup: { mode: 'off' } }, { preset: 'Linear' })).toEqual(['Linear'])
  })

  it('shows the target RIR only while the profile rates effort', () => {
    const occ = withPlan('linear', { rir: { min: 1, max: 3 } })
    expect(occurrenceChips(occ, { preset: 'Linear', effort: 'rir' })).toEqual(['Linear', 'RIR 1–3'])
    expect(occurrenceChips(occ, { preset: 'Linear', effort: 'rpe' })).toEqual(['Linear', 'RIR 1–3'])
    expect(occurrenceChips(occ, { preset: 'Linear', effort: 'none' })).toEqual(['Linear'])
  })

  it('calls a cardio slot Cardio, whatever its rule says', () => {
    expect(occurrenceChips({ ...base, mode: 'cardio' }, { preset: 'Autoregulated' })).toEqual(['Cardio'])
  })

  it('marks a program edited past its template as imported', () => {
    const edited = structuredClone(base)
    edited.rule.program.phases[0].groups[0].restSeconds = 17
    expect(occurrenceChips(edited, { preset: 'Linear' })).toEqual(['Linear', 'Imported'])
  })

  it('has nothing to say about a slot without a rule', () => {
    expect(occurrenceChips({ exerciseId: '0025' }, { preset: 'Linear' })).toEqual([])
  })
})
