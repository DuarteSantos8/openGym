// A run's weeks are dates in its own timezone (api/engine/programme-run.js dateIn), the one its saved
// work is read back in. A session is placed by that date too, whatever the device's zone: a run
// kept in UTC (converted before the device's zone was known) still gets a Sydney Monday-morning or
// a Los Angeles Sunday-evening session as the work it is, on the slot that reads it back.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSessionExposures, missingOneRms, occurrenceFor } from './session-start.js'
import { buildCompletedSession } from './finish-session.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { isWarmupRow } from './workout-model.js'
import { programmeView, startProgramme } from './programmes.js'
import { convertLegacyProgramme } from '../../../api/migration/programme-upgrade.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'

const BENCH = '0025', SQUAT = '0043'
const was = process.env.TZ
afterEach(() => { vi.useRealTimers(); if (was === undefined) delete process.env.TZ; else process.env.TZ = was })
// This device in `zone`, its clock at `iso`.
const deviceAt = (zone, iso) => { process.env.TZ = zone; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse(iso)); return Date.parse(iso) }

const occ = (exId, oid) => occurrenceFor(exId, { sets: 3, reps: 5, weight: 60 }, { id: oid, routineId: 'A', preset: 'linear' })
const profile = oneRepMaxes => ({
  engineSchemaVersion: 2, engineContractRevision: 1, unit: 'kg', weekStart: 1, restSec: 90,
  routines: [{ id: 'A', name: 'Day A', ex: [occ(BENCH, 'a-bench'), occ(SQUAT, 'a-squat')] }],
  workouts: [], prescriptions: {}, progression: {}, oneRepMaxes, week: { 1: ['A'] }, programmes: {}, programme: null,
})
// Day A on Mondays from `startedOn` (a Monday), the run's weeks in `tz`.
function running(tz, { startedOn = '2026-11-02', weeks = [{}, {}, {}], oneRepMaxes = {} } = {}) {
  const S = profile(oneRepMaxes)
  S.programmes = { P: convertLegacyProgramme({ id: 'P', name: 'Block', at: 1, days: { 1: ['A'] }, weeks }, { routines: S.routines, catalogue: LIB_BY_ID }) }
  const policies = Object.fromEntries(S.programmes.P.tracks.map(t => [t.id, { onFailure: 'advance', onSkipped: 'advance' }]))
  expect(startProgramme(S, 'P', { policies, end: 'stop', today: startedOn, now: Date.parse(startedOn + 'T08:00:00Z') })).toEqual({ ok: true })
  S.programmeRuns[S.programme.runId].tz = tz
  return S
}
const benchTrack = 't:P:a-bench'

describe('a programme session is placed on the run\'s own date', () => {
  it('Monday morning in Sydney, a run in UTC (still Sunday there): week 1\'s work, read back on its slot', () => {
    const now = deviceAt('Australia/Sydney', '2026-11-08T20:00:00Z')   // Monday 9 November, 07:00 in Sydney
    const S = running('UTC')
    const exposures = buildSessionExposures(S, S.routines[0], { now, newId: s => s })
    expect(exposures.map(x => x.programme && [x.programme.slot, x.programme.role])).toEqual([['p1:a0:a-bench', 'work'], ['p1:a0:a-squat', 'work']])
    // Finished: the engine reads the work back on that same slot, so the week counts it.
    const A = { id: 'w', d: '2026-11-09', start: now, routineIds: ['A'], exposures, entries: entriesForExposures(exposures, S.prescriptions) }
    A.entries.forEach(e => e.sets.forEach(row => { if (!isWarmupRow(row)) row.done = true }))
    S.workouts = [buildCompletedSession(A, S, { end: now + 3600000, newId: s => s, unit: 'kg' }).session]
    expect(programmeView(S).tracks[benchTrack].slots[0]).toMatchObject({ id: 'p1:a0:a-bench', outcome: 'succeeded', exposureId: exposures[0].exposureId })
  })

  it('Sunday evening in Los Angeles, a run in UTC (already Monday there): week 2\'s work', () => {
    const now = deviceAt('America/Los_Angeles', '2026-11-09T04:00:00Z')   // Sunday 8 November, 20:00 in Los Angeles
    const S = running('UTC')
    const exposures = buildSessionExposures(S, S.routines[0], { now, newId: s => s })
    expect(exposures[0].programme).toMatchObject({ slot: 'p2:a0:a-bench', role: 'work' })
  })

  it('Monday evening in Los Angeles, a run kept in Los Angeles: Monday\'s work', () => {
    const now = deviceAt('America/Los_Angeles', '2026-11-10T04:00:00Z')   // Monday 9 November, 20:00 (Tuesday in UTC)
    const S = running('America/Los_Angeles')
    const exposures = buildSessionExposures(S, S.routines[0], { now, newId: s => s })
    expect(exposures[0].programme).toMatchObject({ slot: 'p2:a0:a-bench', role: 'work' })
  })

  it('a %1RM week with no 1RM yet is asked for on the run\'s first day, though the device is still on the day before', () => {
    deviceAt('America/Los_Angeles', '2026-11-09T04:00:00Z')   // Sunday evening here, Monday 9 November in UTC
    const S = running('UTC', { startedOn: '2026-11-09', weeks: [{ t: { [BENCH]: { pct: 75 } } }] })
    expect(missingOneRms(S, S.routines)).toEqual([BENCH])
  })
})
