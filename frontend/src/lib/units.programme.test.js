import { describe, expect, it } from 'vitest'
import { programmeHistoryForExercise } from './programme-timeline.js'
import { mergeStates } from './sync-merge.js'
import { convertStateUnit } from './units.js'

const cfg = { id: 'fixture', mode: 'reps', sets: 1, reps: 5, weight: 60, inc: 2.5 }
const routine = { id: 'routine', name: 'Routine', ex: [cfg] }
const weeks = [{ days: [{ weekday: 1, sessions: [{
  id: 'session', sessionTemplateId: 'session', routineId: routine.id, routineSnapshot: routine,
}]}] }]
const definition = { id: 'programme', name: 'Programme', updatedAt: '2026-10-01T00:00:00Z', weeks }
const cycle = {
  id: 'cycle', programmeId: definition.id, status: 'active', updatedAt: '2026-10-01T00:00:00Z',
  snapshot: { weeks }, programmeSnapshot: definition,
}
const workout = {
  id: 'workout', d: '2026-10-01', start: 1, end: 2, unit: 'kg',
  programmeInstance: { cycleId: cycle.id, instanceId: 'cycle:first', weekIndex: 1, date: '2026-10-01' },
  entries: [{
    id: cfg.id, occurrenceId: `${cfg.id}#1`, unit: 'kg',
    target: { ...cfg, weightUnit: 'kg' },
    sets: [{ w: 60, r: 5, done: true, loadUnit: 'kg' }],
  }],
}
const state = (over = {}) => ({
  unit: 'kg', restSec: 90, week: {}, dayPlan: {}, routines: [routine], workouts: [workout],
  bodyweight: [], customEx: [], favEx: [], exWeights: {}, exNotes: {}, barWeights: {},
  equipProfiles: [], gymCards: [], programmes: { version: 1, definitions: [definition], cycles: [cycle] },
  _ts: 100, ...over,
})
const frozenWeight = value => value.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight

describe('Programme unit conversion', () => {
  it('converts every frozen Programme copy and its history markers without mutating the source', () => {
    const source = state({ active: workout })
    const before = structuredClone(source)
    const out = convertStateUnit(source, 'lb')

    expect(out.routines[0].ex[0]).toMatchObject({ weight: 132.5, inc: 5.5 })
    expect(frozenWeight(out.programmes.definitions[0])).toBe(132.5)
    expect(frozenWeight(out.programmes.cycles[0].snapshot)).toBe(132.5)
    expect(frozenWeight(out.programmes.cycles[0].programmeSnapshot)).toBe(132.5)
    for (const session of [out.workouts[0], out.active]) {
      expect(session.unit).toBe('lb')
      expect(session.entries[0]).toMatchObject({
        unit: 'lb', target: { weight: 132.5, weightUnit: 'lb' },
        sets: [{ w: 132.5, loadUnit: 'lb' }],
      })
    }
    expect(source).toEqual(before)
  })

  it('keeps Programme history usable when sync converts the other copy into the chosen unit', () => {
    const kg = state({ _ts: 300 })
    const lb = { ...convertStateUnit(kg, 'lb'), _ts: 200, unitSet: { at: 400, convert: true } }
    const merged = mergeStates(kg, lb)
    const future = { cycleId: cycle.id, instanceId: 'cycle:second', weekIndex: 2, date: '2026-10-08', ordinal: 1 }

    expect(merged.unit).toBe('lb')
    expect(frozenWeight(merged.programmes.definitions[0])).toBe(132.5)
    expect(merged.workouts[0]).toMatchObject({ unit: 'lb', entries: [{ unit: 'lb', sets: [{ w: 132.5 }] }] })
    expect(programmeHistoryForExercise(merged, cycle, future, cfg, 0, [cfg])).toHaveLength(1)
    expect(kg.unit).toBe('kg')
    expect(frozenWeight(kg.programmes.definitions[0])).toBe(60)
  })
})
