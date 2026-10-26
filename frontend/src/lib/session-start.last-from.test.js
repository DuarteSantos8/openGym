// "Last time means → Any workout" (#770): the same lift on Monday and Thursday read as one line of
// progress instead of one per routine. The default keeps each routine's own last session (#216),
// for the lifter whose Monday is heavy and Thursday light.
import { describe, it, expect } from 'vitest'
import { defaultPlanRule } from './prescription/index.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { lastAcrossRoutines } from './history.js'

const BENCH = '0025'
const routine = (id, options = {}) => ({ id, name: id, ex: [{
  occurrenceId: 'occ-' + id, exerciseId: BENCH,
  rule: defaultPlanRule('linear', { id: 'rule-' + id, exerciseId: BENCH, routineId: id, completion: [], target: { mode: 'none' },
    sets: { min: 2, max: 2 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 100, unit: 'kg' }, ...options })
}] })
const profile = extra => ({ engineSchemaVersion: 2, unit: 'kg', routines: [routine('MON'), routine('THU')], workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {}, ...extra })

let day = 0
function start(p, id) {
  const now = Date.parse('2026-08-01T12:00:00Z') + day * 86400000
  const r = p.routines.find(x => x.id === id)
  const exposures = buildSessionExposures(p, r, { now, newId: s => s })
  return { id: 'w' + day, d: new Date(now).toISOString().slice(0, 10), start: now, routineIds: [id], exposures, entries: entriesForExposures(exposures, p.prescriptions) }
}
function train(p, id) {
  day++
  const active = start(p, id)
  active.entries.forEach(e => e.sets.forEach(row => { row.done = true }))
  const out = buildCompletedSession(active, p, { end: active.start + 3600000, unit: 'kg', newId: s => s })
  Object.assign(p.progression, out.progression)
  p.workouts.push(out.session)
}
const loads = a => a.entries[0].sets.map(s => s.w)

describe('"Last time means"', () => {
  it('is the routine\'s own last session by default, and for a profile that never chose', () => {
    expect(lastAcrossRoutines({})).toBe(false)
    expect(lastAcrossRoutines({ lastFrom: 'routine' })).toBe(false)
    expect(lastAcrossRoutines({ lastFrom: 'any' })).toBe(true)
  })

  it('per routine, Thursday progresses from last Thursday even after a better Monday', () => {
    day = 0
    const p = profile()
    train(p, 'THU'); train(p, 'MON'); train(p, 'MON')
    expect(loads(start(p, 'THU'))).toEqual([102.5, 102.5])
  })

  it('across workouts, Thursday picks up from Monday', () => {
    day = 0
    const p = profile({ lastFrom: 'any' })
    train(p, 'THU'); train(p, 'MON'); train(p, 'MON')
    expect(loads(start(p, 'THU'))).toEqual([107.5, 107.5])
  })

  it('across workouts, editing this routine\'s own plan still restarts it', () => {
    day = 0
    const p = profile({ lastFrom: 'any' })
    train(p, 'THU')
    p.routines[1] = routine('THU', { reps: { min: 8, max: 8 } })
    expect(start(p, 'THU').entries[0].sets.map(s => s.r)).toEqual([8, 8])
  })
})
