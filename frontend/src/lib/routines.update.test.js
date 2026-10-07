// Update a routine from a running session: the warm-ups added in the workout, and the rest and
// note edited on the exercise's settings sheet from inside it, can be written back to the slot.
import { describe, it, expect } from 'vitest'
import { routineSlotIndex, routineChangesFromEntry, updateRoutineFromEntry } from './routines.js'
import { MAX_PLANNED_WARMUPS } from './history.js'

const BENCH = '0025'    // barbell bench press
const ROW = '0027'      // barbell bent over row
const BIKE = '2138'     // stationary bike, cardio

const work = n => Array.from({ length: n }, () => ({ w: 60, r: 5, done: false }))
const warm = n => Array.from({ length: n }, () => ({ w: 30, r: 5, done: false, phase: 'warmup' }))
const entry = (id, sets, target = {}, rid = 'A') => ({ id, rid, sets, target: { id, ...target } })

describe('routineSlotIndex', () => {
  const routine = { id: 'A', ex: [{ id: BENCH }, { id: ROW }, { id: BENCH }] }

  it('finds the slot of the exercise in its own routine', () => {
    const entries = [entry(ROW, work(3))]
    expect(routineSlotIndex(routine, entries, 0)).toBe(1)
  })

  it('pairs twins by position: the second bench of the session is the second bench of the routine', () => {
    const entries = [entry(BENCH, work(3)), entry(ROW, work(3)), entry(BENCH, work(3))]
    expect(routineSlotIndex(routine, entries, 0)).toBe(0)
    expect(routineSlotIndex(routine, entries, 2)).toBe(2)
  })

  it('does not count twins that came from another routine', () => {
    const entries = [entry(BENCH, work(3), {}, 'B'), entry(BENCH, work(3))]
    expect(routineSlotIndex(routine, entries, 1)).toBe(0)
  })

  it('is -1 for an exercise the routine never had, another routine\'s, or a freestyle one', () => {
    expect(routineSlotIndex(routine, [entry(BIKE, work(1))], 0)).toBe(-1)
    expect(routineSlotIndex(routine, [entry(BENCH, work(3), {}, 'B')], 0)).toBe(-1)
    expect(routineSlotIndex(routine, [{ id: BENCH, sets: work(3), target: {} }], 0)).toBe(-1)
    expect(routineSlotIndex(routine, [entry(BENCH, work(3))], 5)).toBe(-1)
    expect(routineSlotIndex(null, [entry(BENCH, work(3))], 0)).toBe(-1)
  })
})

describe('routineChangesFromEntry', () => {
  const routineWith = slot => ({ id: 'A', ex: [{ id: BENCH, sets: 3, mode: 'reps', reps: 5, weight: 60, ...slot }] })

  it('offers the warm-ups added during the session', () => {
    const entries = [entry(BENCH, [...warm(2), ...work(3)], { warmupSets: 1 })]
    expect(routineChangesFromEntry(routineWith({ warmupSets: 1 }), entries, 0))
      .toEqual({ at: 0, changes: [{ key: 'warmupSets', from: 1, to: 2 }] })
  })

  it('reads a slot that never planned warm-ups as 0', () => {
    const entries = [entry(BENCH, [...warm(1), ...work(3)])]
    expect(routineChangesFromEntry(routineWith({}), entries, 0).changes).toEqual([{ key: 'warmupSets', from: 0, to: 1 }])
  })

  it('offers the rest and the note edited on the settings sheet mid-session', () => {
    const entries = [entry(BENCH, work(3), { restSec: 150, note: ' pause on the chest ' })]
    expect(routineChangesFromEntry(routineWith({ restSec: 90 }), entries, 0).changes).toEqual([
      { key: 'restSec', from: 90, to: 150 },
      { key: 'note', from: '', to: 'pause on the chest' },
    ])
  })

  it('offers removing warm-ups the session left out', () => {
    const entries = [entry(BENCH, work(3), { warmupSets: 2 })]
    expect(routineChangesFromEntry(routineWith({ warmupSets: 2 }), entries, 0).changes)
      .toEqual([{ key: 'warmupSets', from: 2, to: 0 }])
  })

  it('caps warm-ups at what the settings sheet allows', () => {
    const entries = [entry(BENCH, [...warm(MAX_PLANNED_WARMUPS + 2), ...work(3)])]
    expect(routineChangesFromEntry(routineWith({}), entries, 0).changes[0].to).toBe(MAX_PLANNED_WARMUPS)
  })

  it('is null when the slot already says what the session did', () => {
    const entries = [entry(BENCH, [...warm(2), ...work(3)], { warmupSets: 2, restSec: 120, note: 'pause' })]
    expect(routineChangesFromEntry(routineWith({ warmupSets: 2, restSec: 120, note: 'pause' }), entries, 0)).toBeNull()
  })

  it('is null for an exercise with no slot', () => {
    expect(routineChangesFromEntry(routineWith({}), [entry(ROW, [...warm(1), ...work(3)])], 0)).toBeNull()
  })

  it('never offers sets, reps or weight — the progression engine moves those every session', () => {
    const entries = [entry(BENCH, work(5), { sets: 5, reps: 8, weight: 100 })]
    expect(routineChangesFromEntry(routineWith({}), entries, 0)).toBeNull()
  })

  it('leaves warm-ups alone on cardio and rest-pause, which the settings sheet does not offer them for', () => {
    const bikeRoutine = { id: 'A', ex: [{ id: BIKE, sets: 1, min: 20, speed: 8, warmupSets: 2 }] }
    expect(routineChangesFromEntry(bikeRoutine, [entry(BIKE, work(1))], 0)).toBeNull()
    const rp = [entry(BENCH, [...warm(1), ...work(1)], { intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } })]
    expect(routineChangesFromEntry(routineWith({}), rp, 0)).toBeNull()
  })
})

describe('updateRoutineFromEntry', () => {
  it('writes the changes into the slot and nothing else', () => {
    const routine = { id: 'A', ex: [{ id: BENCH, sg: 'g', sets: 3, mode: 'reps', reps: 5, weight: 60, prog: 'linear' }] }
    const entries = [entry(BENCH, [...warm(2), ...work(3)], { restSec: 120, note: 'pause' })]
    const applied = updateRoutineFromEntry(routine, entries, 0)
    expect(applied.map(c => c.key)).toEqual(['warmupSets', 'restSec', 'note'])
    expect(routine.ex[0]).toEqual({ id: BENCH, sg: 'g', sets: 3, mode: 'reps', reps: 5, weight: 60, prog: 'linear', warmupSets: 2, restSec: 120, note: 'pause' })
  })

  it('removes a key that goes back to nothing, as the settings sheet does, instead of storing 0', () => {
    const routine = { id: 'A', ex: [{ id: BENCH, sets: 3, warmupSets: 2, restSec: 90, note: 'x' }] }
    updateRoutineFromEntry(routine, [entry(BENCH, work(3), { restSec: 0, note: '' })], 0)
    expect(routine.ex[0]).toEqual({ id: BENCH, sets: 3 })
    expect('warmupSets' in routine.ex[0]).toBe(false)
  })

  it('changes only the twin the session entry stands for', () => {
    const routine = { id: 'A', ex: [{ id: BENCH, sets: 3 }, { id: ROW, sets: 3 }, { id: BENCH, sets: 3 }] }
    const entries = [entry(BENCH, work(3)), entry(ROW, work(3)), entry(BENCH, [...warm(1), ...work(3)])]
    updateRoutineFromEntry(routine, entries, 2)
    expect(routine.ex.map(e => e.warmupSets)).toEqual([undefined, undefined, 1])
  })

  it('returns null and leaves the routine alone when there is nothing to update', () => {
    const routine = { id: 'A', ex: [{ id: BENCH, sets: 3 }] }
    expect(updateRoutineFromEntry(routine, [entry(BENCH, work(3))], 0)).toBeNull()
    expect(routine.ex[0]).toEqual({ id: BENCH, sets: 3 })
  })
})
