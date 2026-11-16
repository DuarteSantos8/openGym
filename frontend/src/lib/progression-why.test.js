// The workout card's reason for today's numbers (v1 lib/progression.js `why`), read off the
// engine's own decisions: sessions are started and finished the way the app does it.
import { describe, it, expect } from 'vitest'
import { buildSessionExposures } from './session-start.js'
import { buildCompletedSession } from './finish-session.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { progressionGuidance } from './progression-copy.js'
import { ruleOccurrence } from './test-fixtures.js'

const BENCH = '0025', DAY = 86400e3
const profile = occ => ({ engineSchemaVersion: 2, engineContractRevision: 1, unit: 'kg', prescriptions: {}, progression: {}, oneRepMaxes: {}, customEx: [], routines: [{ id: 'r1', name: 'Push', ex: [occ] }], workouts: [] })
// Trains `how.length` sessions ('h' every rep, 'm' two reps short) and returns each session's plan.
function train(S, how) {
  let now = Date.parse('2026-09-01T10:00:00')
  return [...how].map((c, k) => {
    const exposures = buildSessionExposures(S, S.routines[0], { now, newId: s => s + ':' + k, unit: 'kg' })
    const entries = entriesForExposures(exposures, S.prescriptions)
    const plan = entries[0].plan
    entries[0].sets.forEach(s => { s.done = true; if (c === 'm') s.r = Math.max(1, s.r - 2) })
    const done = buildCompletedSession({ id: 'w' + k, d: new Date(now).toISOString().slice(0, 10), start: now, routineIds: ['r1'], name: 'Push', exposures, entries }, S, { end: now + 3600e3, newId: s => s + ':' + k, unit: 'kg' })
    expect(done.session.exposures[0].plan).toBeUndefined()   // session-only: never saved with the workout
    S.workouts.push(done.session); S.progression = { ...S.progression, ...done.progression }; now += 2 * DAY
    return plan
  })
}
const linear = () => ruleOccurrence(BENCH, { preset: 'linear', options: { load: { mode: 'absolute', value: 60, unit: 'kg' } } })

describe('why a session opens at its numbers', () => {
  it('linear: the baseline, a step up, misses counted down, then the reset', () => {
    const plans = train(profile(linear()), 'hhmmmh')
    expect(plans.map(p => p.kind)).toEqual(['first', 'up', 'up', 'hold', 'hold', 'deload'])
    expect(plans[0].why).toEqual(['Nothing logged yet, so this session sets the baseline.'])
    expect(plans[1].why).toEqual(['Every rep last time. {0} {1} more.', 2.5, 'kg'])
    expect(plans[3].why).toEqual(['Missed reps last time. Same weight again ({0} of {1} to go).', 2, 3])
    expect(plans[4].why[1]).toBe(1)
    expect(plans[5].why[0]).toMatch(/^(Missed reps 3|Stuck for)/)
    expect(plans.every(p => p.policy === 'linear')).toBe(true)
  })

  it('double progression aims for a rep more, then raises the weight at the top of the range', () => {
    const occ = ruleOccurrence(BENCH, { preset: 'double', options: { reps: { min: 8, max: 9 }, load: { mode: 'absolute', value: 60, unit: 'kg' } } })
    const plans = train(profile(occ), 'hhh')
    expect(plans.map(p => p.why[0])).toContain('Top of the rep range in every set. {0} {1} more, back to {2} reps.')
    expect(plans.some(p => p.why[0] === 'Same weight, aim for {0} reps this time.') || plans[1].kind === 'up').toBe(true)
  })

  it('an edited plan says so, and a rule that progresses nothing says nothing', () => {
    const S = profile(linear())
    train(S, 'h')
    S.routines[0].ex[0] = ruleOccurrence(BENCH, { occurrenceId: S.routines[0].ex[0].occurrenceId, preset: 'linear', options: { reps: { min: 8, max: 8 }, load: { mode: 'absolute', value: 60, unit: 'kg' } } })
    expect(train(S, 'h')[0].why).toEqual(['Plan changed, so starting from your new target.'])
    expect(train(profile(ruleOccurrence(BENCH, { preset: 'pyramid_reps' })), 'hh')).toEqual([undefined, undefined])
  })

  it('the card names the policy beside the reason', () => {
    const [first] = train(profile(linear()), 'h')
    expect(progressionGuidance(first)).toEqual({ policyLabel: 'Linear progression', why: first.why })
    expect(progressionGuidance({ policy: 'off', kind: 'off' })).toBeNull()
    expect(progressionGuidance(null)).toBeNull()
  })
})
