import { describe, expect, it } from 'vitest'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { ruleOccurrence } from './test-fixtures.js'

// start -> finish -> write state -> start, on real functions and a store-shaped profile.
const DAY = 24 * 3600 * 1000
const T0 = Date.UTC(2026, 8, 1)
const linear = (target = 25, revision = 1) => ruleOccurrence('0025', { patch: r => ({ ...r, revision, target: { mode: 'absolute', value: target, unit: 'kg' } }) })
const profile = () => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {} })
const start = (S, occ, day) => {
  const exposures = buildSessionExposures(S, { id: 'r1', ex: [occ] }, { now: T0 + day * DAY, newId: s => s, unit: 'kg' })
  return { id: 'w' + day, d: 'd' + day, start: 1, routineIds: ['r1'], name: 'Push', exposures, entries: entriesForExposures(exposures, S.prescriptions) }
}
const finish = (S, active, day) => {
  active.entries[0].sets.forEach(s => { s.done = true })
  const { session, progression } = buildCompletedSession(active, S, { end: T0 + day * DAY + 1000, newId: s => s, unit: 'kg' })
  S.workouts.push(session)
  Object.assign(S.progression, progression)
  return session.exposures[0]
}
const loadOf = (S, active) => S.prescriptions[active.exposures[0].prescriptionId].parameters.load.resolved.value
const session = (S, occ, day) => { const a = start(S, occ, day); return { a, log: finish(S, a, day) } }

describe('prescription lifecycle (linear 20 kg -> 25 kg, +2.5)', () => {
  it('increments once per finished session; an abandoned start adds nothing', () => {
    const S = profile(), occ = linear()
    const { a: a1 } = session(S, occ, 0)
    expect(loadOf(S, a1)).toBe(20)
    start(S, occ, 1)                          // generated, never finished
    const a2 = start(S, occ, 2)               // next start: still one step from the finished session
    expect(loadOf(S, a2)).toBe(22.5)
  })

  it('completes at the target, holds, and later sessions are not out-of-plan for it alone', () => {
    const S = profile(), occ = linear()
    session(S, occ, 0); session(S, occ, 1)
    const a3 = start(S, occ, 2); expect(loadOf(S, a3)).toBe(25)
    finish(S, a3, 2)
    expect(S.progression['occ-0025']).toMatchObject({ status: 'completed', readyToIncrement: false })
    const a4 = start(S, occ, 3)
    expect(S.prescriptions[a4.exposures[0].prescriptionId]).toMatchObject({ statusAtGeneration: 'completed' })
    expect(loadOf(S, a4)).toBe(25)
    const log4 = finish(S, a4, 3)
    expect(log4.audit.map(f => f.code)).toContain('completed_track')
    const a5 = start(S, occ, 4)
    expect(loadOf(S, a5)).toBe(25)
    expect(S.prescriptions[a5.exposures[0].prescriptionId].provenance.derivedFromOutOfPlan).toBe(false)
  })

  it('an edited rule reopens the track and the finished session is not audited as completed', () => {
    const S = profile()
    session(S, linear(), 0); session(S, linear(), 1); session(S, linear(), 2)
    const edited = linear(30, 2)
    const a4 = start(S, edited, 3)
    expect(S.prescriptions[a4.exposures[0].prescriptionId].statusAtGeneration).toBe('active')
    const log4 = finish(S, a4, 3)
    expect(log4.audit.map(f => f.code)).not.toContain('completed_track')
    expect(S.progression['occ-0025']).toMatchObject({ status: 'active', planRuleRevision: 2 })
  })
})
