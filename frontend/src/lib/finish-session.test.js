import { describe, expect, it } from 'vitest'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession, recordsOf, workLoadOf } from './finish-session.js'
import { ruleOccurrence, loggedExposure } from './test-fixtures.js'

const profile = () => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {} })
const start = (S, occ, extra = {}) => {
  const exposures = buildSessionExposures(S, { id: 'r1', ex: [occ], ...extra }, { now: Date.UTC(2026, 8, 24), newId: s => s, unit: 'kg' })
  return { id: 'w1', d: '2026-09-24', start: 1, routineIds: ['r1'], name: 'Push', exposures, entries: entriesForExposures(exposures, S.prescriptions) }
}
const finish = (S, active) => buildCompletedSession(active, S, { end: Date.UTC(2026, 8, 24, 1), newId: s => s, unit: 'kg' })

describe('buildCompletedSession', () => {
  it('writes the log, its audit, the next progression state and a better 1RM estimate', () => {
    const S = profile()
    const active = start(S, ruleOccurrence('0025'))
    active.entries[0].sets.forEach(s => { s.done = true })
    active.entries[0].sets[2].w = 250   // out of plan, kept exactly
    const { session, progression, oneRepMaxes } = finish(S, active)
    const log = session.exposures[0]
    expect(log.completedAt).toBe('2026-09-24T01:00:00.000Z')
    expect(log.actual).toEqual({ sets: 3, reps: 5, load: { value: 20, unit: 'kg' } })
    expect(log.performance.sets[2].resistance.value).toBe(250)
    expect(log.audit.map(f => f.code)).toEqual(['above_range', 'above_cap'])
    expect(log.sourceAudit).toEqual({ derivedFromOutOfPlan: false, sourceLogId: null })
    expect(progression['occ-0025']).toMatchObject({ status: 'active', readyToIncrement: true, lastCompletedLogId: log.exposureId })
    expect(oneRepMaxes).toEqual([expect.objectContaining({ exerciseId: '0025', source: 'estimated', value: 291.7, capturedAt: '2026-09-24T01:00:00.000Z', sourceRecordId: log.exposureId })])
  })

  it('never advances an excluded exposure', () => {
    const S = profile()
    const active = start(S, ruleOccurrence('0025'), { excludeFromProgression: true })
    active.entries[0].sets.forEach(s => { s.done = true })
    expect(finish(S, active).progression).toEqual({})
  })
})

describe('recordsOf', () => {
  const past = w => ({ unit: 'kg', workouts: [{ id: 'old', d: '2026-09-01', start: 1, exposures: [loggedExposure('0025', [{ r: 5, w }], { exposureId: 'old-x' })] }] })
  const session = rows => ({ id: 'new', exposures: [loggedExposure('0025', rows, { exposureId: 'new-x' })] })
  it('a heavier work set is a load PR', () => {
    expect(recordsOf(past(60), session([{ r: 5, w: 65 }])).prs).toEqual(['0025'])
  })
  it('a heavier warm-up is not', () => {
    const out = recordsOf(past(60), session([{ role: 'warmup', r: 1, w: 100 }, { r: 5, w: 60 }]))
    expect(out.prs).toEqual([])
    expect(workLoadOf(session([{ role: 'warmup', r: 1, w: 100 }, { r: 5, w: 60 }]).exposures[0])).toBe(60)
  })
  it('same load for more reps is an estimated-1RM record, not a load PR', () => {
    const out = recordsOf(past(60), session([{ r: 8, w: 60 }]))
    expect(out.prs).toEqual([])
    expect(out.e1prs).toEqual([expect.objectContaining({ id: '0025', w: 60, r: 8 })])
  })
  it('on an assisted machine less help is the PR', () => {
    const S = { unit: 'kg', workouts: [{ id: 'old', d: '2026-09-01', exposures: [loggedExposure('0017', [{ r: 8, w: 40 }])] }] }
    expect(recordsOf(S, { exposures: [loggedExposure('0017', [{ r: 8, w: 30 }], { exposureId: 'n' })] }).prs).toEqual(['0017'])
    expect(recordsOf(S, { exposures: [loggedExposure('0017', [{ r: 8, w: 50 }], { exposureId: 'n' })] }).prs).toEqual([])
  })
  it('a backfilled session claims nothing', () => {
    expect(recordsOf(past(60), session([{ r: 5, w: 100 }]), { backfill: true })).toEqual({ prs: [], e1prs: [] })
  })
})
