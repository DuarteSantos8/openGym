import { describe, expect, it } from 'vitest'
import { contentHash, defaultPlanRule, planPhase } from './prescription/index.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures, exposuresWithPerformance, rowsOfPerformance } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { exView, shownWeight, storedWeight, withExUnit } from './ex-unit.js'
import { convertStateUnit } from './units.js'
import { sessionVolume } from './history.js'
import { routineChangesFromEntry, updateRoutineFromEntry } from './routine-update.js'
import { startProgramme } from './programmes.js'

const BENCH = '0025'
const profile = (over = {}) => ({ engineSchemaVersion: 2, unit: 'kg', routines: [], workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {}, ...over })
const routine = (load = 60, extra = {}) => ({ id: 'r', ex: [{ occurrenceId: 'o', exerciseId: BENCH, rule: defaultPlanRule('linear', { id: 'rule', exerciseId: BENCH, routineId: 'r', sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: load, unit: 'kg' }, target: { mode: 'none' }, completion: [] }), ...extra }] })
const ctx = { now: Date.parse('2026-10-21T12:00:00Z'), newId: s => s }
function start(S, r, i = 0) {
  const exposures = buildSessionExposures(S, r, { ...ctx, now: ctx.now + i * 86400000 })
  return { id: 'w' + i, d: '2026-10-21', start: ctx.now, exposures, entries: entriesForExposures(exposures, S.prescriptions) }
}
function finish(S, a) {
  a.entries.forEach(e => e.sets.forEach(row => { row.done = true }))
  const result = buildCompletedSession(a, S, { end: ctx.now + 3600000, newId: s => s, unit: S.unit })
  S.workouts.push(result.session)
  Object.assign(S.progression, result.progression)
  return result
}

describe('new main features on the v2 session path', () => {
  it('progresses a pinned lb lift on its own five-pound step without stored-unit drift', () => {
    const S = profile({ exUnit: withExUnit({}, BENCH, 'lb', 1) })
    const r = routine(storedWeight(S, BENCH, 135)); S.routines = [r]
    const loads = []
    for (let i = 0; i < 6; i++) {
      const active = start(S, r, i)
      loads.push(shownWeight(S, BENCH, active.entries[0].sets[0].w))
      finish(S, active)
    }
    expect(loads).toEqual([135, 140, 145, 150, 155, 160])
    expect(planPhase(exView(S, BENCH).routines[0].ex[0].rule).parameters.load.unit).toBe('lb')
  })

  it('freezes programme targets and excludes its deload from advancement', () => {
    const r = routine(100)
    const S = profile({ routines: [r], oneRepMaxes: { one: { id: 'one', exerciseId: BENCH, value: 120, unit: 'kg', capturedAt: '2026-10-01T12:00:00Z', source: 'manual' } }, programmes: { p: { id: 'p', days: { 1: ['r'] }, weeks: [{ deload: true, t: { [BENCH]: { pct: 75, rpe: 7 } } }] } } })
    // Programme percent references actual estimated history, as before.
    S.workouts.push({ id: 'previous', d: '2026-10-01', exposures: [{ exerciseId: BENCH, performance: { sets: [{ role: 'work', status: 'completed', resistance: { kind: 'external-load', value: 100, unit: 'kg' }, observations: [{ metric: 'repetitions', value: 5 }] }] } }] })
    startProgramme(S, 'p', '2026-10-21', ctx.now)
    const a = start(S, r), p = S.prescriptions[a.exposures[0].prescriptionId]
    expect(a.entries[0].sets.map(row => row.w)).toEqual([87.5, 87.5, 87.5])
    expect(p.provenance.programme).toMatchObject({ week: 1, pct: 75, deload: true })
    expect(a.exposures[0].excludedFromProgression).toBe(true)
    const { contentHash: hash, ...body } = p
    expect(hash).toBe(contentHash(body))
    expect(finish(S, a).progression).toEqual({})
  })

  it('keeps set notes, videos, rests, warm-up recipe and gym through saving and reading', () => {
    const S = profile(), r = routine(100, { warmup: 'own', warmupRows: [{ wp: 50, r: 8 }], warmupRestOff: true, sideRestOff: true, autoHold: true, restOff: true })
    const a = start(S, r)
    a.gym = { id: 'gym', name: 'Home' }
    a.entries[0].sets[1] = { ...a.entries[0].sets[1], note: 'keep elbows in', hr: 128, restHr: 101, media: [{ id: 'video' }], at: 123, restOff: true, restSec: 0 }
    const result = finish(S, a), x = result.session.exposures[0]
    expect(x).toMatchObject({ warmupRestOff: true, sideRestOff: true, autoHold: true, restOff: true })
    expect(result.session.gym).toEqual(a.gym)
    expect(rowsOfPerformance(x.performance.sets, x.mode)[1]).toMatchObject({ note: 'keep elbows in', hr: 128, restHr: 101, media: [{ id: 'video' }], at: 123, restOff: true, restSec: 0 })
    expect(a.entries[0].sets[0]).toMatchObject({ phase: 'warmup', w: 50, r: 8, wp: 50 })
  })

  it('keeps explicit no timer and hand-edited warm-ups when updating a routine', () => {
    const S = profile(), r = routine(100, { warmup: 'auto' }); S.routines = [r]
    const a = start(S, r), e = a.entries[0]
    e.target.restOff = true
    e.target.restSec = 0
    e.sets = [{ w: 40, r: 10, done: false, phase: 'warmup', edited: true }, ...e.sets.filter(row => row.phase !== 'warmup')]
    const found = routineChangesFromEntry(r, a.exposures[0], e, 90)
    expect(found.changes).toContainEqual({ key: 'restSec', from: planPhase(r.ex[0].rule).parameters.restSeconds, to: -1 })
    updateRoutineFromEntry(r, found)
    expect(r.ex[0]).toMatchObject({ warmup: 'own', warmupRows: [{ wp: 40, r: 10 }], restOff: true })
  })

  it('converts pinned canonical history exactly during a profile unit switch', () => {
    const S = profile({ exUnit: withExUnit({}, BENCH, 'lb', 1) }), r = routine(storedWeight({ unit: 'kg', exUnit: withExUnit({}, BENCH, 'lb', 1) }, BENCH, 135))
    S.routines = [r]; finish(S, start(S, r))
    const next = convertStateUnit(S, 'lb')
    expect(next.workouts[0].exposures[0].performance.sets[0].resistance.value).toBe(135)
    expect(Object.values(next.prescriptions)[0].rows[0].load.value).toBe(135)
    expect(next.workouts[0].vol).toBe(2025)
  })
})
