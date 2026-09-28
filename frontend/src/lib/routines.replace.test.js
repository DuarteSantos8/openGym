// Replace an exercise in a routine (#110): the slot keeps what was set up for it, only the
// exercise changes — and the new exercise does not inherit the old one's progress.
import { describe, it, expect } from 'vitest'
import { replaceSlotExercise } from './routines.js'
import { buildCombinedEntries } from './session-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { lastEntryFor } from './history.js'
import { isWarmupRow } from './workout-model.js'

const BENCH = '0025'      // barbell bench press
const DB_BENCH = '0289'   // dumbbell bench press
const PUSH_UP = '0662'    // push-up, body weight
const PULL_UP = '0652'    // pull-up, body weight
const BIKE = '2138'       // stationary bike, cardio
const ASSISTED_PULL_UP = '0015' // assisted pull-up, a leverage machine: the weight is help
const PULLDOWN = '0150'   // lat pulldown, cable

describe('replaceSlotExercise', () => {
  it('keeps the slot\'s sets, reps, weight, rule, rest, warm-ups, note and superset', () => {
    const slot = {
      id: BENCH, sg: 'sgA', sets: 4, mode: 'reps', reps: 8, repsMin: 6, weight: 60, prog: 'double', inc: 1.25,
      deloadFactor: 0.85, note: 'pause on the chest', warmupSets: 2, restSec: 150,
      intensifier: { type: 'dropset', count: 1, pct: 20 },
    }
    const next = replaceSlotExercise(slot, DB_BENCH)
    expect(next).toEqual({ ...slot, id: DB_BENCH })
    // A new object — the routine's own slot is not edited behind the store's back.
    expect(slot.id).toBe(BENCH)
  })

  it('drops the flags that describe the old movement, so the new exercise follows its own', () => {
    // A split squat's "per side" would turn a back squat's 16 reps into 8 a side with L/R rows.
    expect(replaceSlotExercise({ id: BENCH, sets: 3, mode: 'reps', reps: 16, weight: 40, side: true, assisted: false }, DB_BENCH))
      .toEqual({ id: DB_BENCH, sets: 3, mode: 'reps', reps: 16, weight: 40 })
  })

  it('changes nothing when the pick is the exercise already in the slot', () => {
    // A push-up the user loaded with 20 kg and marked as not bodyweight, picked again from "Chosen".
    const slot = { id: PUSH_UP, sg: 'sgA', sets: 3, mode: 'reps', reps: 8, weight: 20, bodyweight: false, side: true }
    const same = replaceSlotExercise(slot, PUSH_UP, { workouts: [] }, 'A')
    expect(same).toEqual(slot)
    expect(same).not.toBe(slot)
  })

  it('drops a weight that is help on one side of the swap and load on the other', () => {
    // 40 kg of help on an assisted pull-up is not a 40 kg pulldown …
    expect(replaceSlotExercise({ id: ASSISTED_PULL_UP, sets: 3, mode: 'reps', reps: 8, weight: 40 }, PULLDOWN))
      .toEqual({ id: PULLDOWN, sets: 3, mode: 'reps', reps: 8, weight: 0 })
    // … and a 50 kg pulldown is not 50 kg taken off a pull-up.
    expect(replaceSlotExercise({ id: PULLDOWN, sets: 3, mode: 'reps', reps: 8, weight: 50 }, ASSISTED_PULL_UP))
      .toEqual({ id: ASSISTED_PULL_UP, sets: 3, mode: 'reps', reps: 8, weight: 0 })
  })

  it('keeps a timed slot timed', () => {
    const next = replaceSlotExercise({ id: BENCH, sets: 3, mode: 'time', sec: 40, weight: 20 }, DB_BENCH)
    expect(next).toEqual({ id: DB_BENCH, sets: 3, mode: 'time', sec: 40, weight: 20 })
  })

  it('drops a load that means something else once the exercise is bodyweight, or stops being', () => {
    // 60 kg on a bar is not 60 kg added to a push-up …
    expect(replaceSlotExercise({ id: BENCH, sets: 3, mode: 'reps', reps: 10, weight: 60 }, PUSH_UP))
      .toEqual({ id: PUSH_UP, sets: 3, mode: 'reps', reps: 10, weight: 0 })
    // … and a push-up's rep ceiling and belt are not a bench press's numbers.
    expect(replaceSlotExercise({ id: PUSH_UP, sets: 3, mode: 'reps', reps: 12, weight: 10, repsMax: 20, bodyweight: true }, BENCH))
      .toEqual({ id: BENCH, sets: 3, mode: 'reps', reps: 12, weight: 0 })
  })

  it('keeps an added weight from one bodyweight exercise to another, and lets the new one follow its own equipment', () => {
    expect(replaceSlotExercise({ id: PUSH_UP, sets: 3, mode: 'reps', reps: 8, weight: 10, repsMax: 15, bodyweight: true }, PULL_UP))
      .toEqual({ id: PULL_UP, sets: 3, mode: 'reps', reps: 8, weight: 10, repsMax: 15 })
    // A push-up the user had turned into a loaded exercise: that choice was about the push-up.
    expect(replaceSlotExercise({ id: PUSH_UP, sets: 3, mode: 'reps', reps: 8, weight: 20, bodyweight: false }, PULL_UP))
      .toEqual({ id: PULL_UP, sets: 3, mode: 'reps', reps: 8, weight: 0 })
  })

  it('starts from the new exercise\'s defaults between cardio and lifting, keeping the note, rest and superset', () => {
    expect(replaceSlotExercise({ id: BENCH, sg: 'sgA', sets: 4, mode: 'reps', reps: 8, weight: 60, note: 'n', restSec: 90 }, BIKE))
      .toEqual({ id: BIKE, sets: 1, min: 20, speed: 8, sg: 'sgA', note: 'n', restSec: 90 })
    expect(replaceSlotExercise({ id: BIKE, sets: 2, min: 30, speed: 12, note: 'easy' }, BENCH))
      .toEqual({ id: BENCH, sets: 3, reps: 10, weight: 0, mode: 'reps', note: 'easy' })
  })

  it('keeps a cardio slot\'s minutes and speed on another cardio exercise', () => {
    expect(replaceSlotExercise({ id: BIKE, sets: 2, min: 30, speed: 12 }, '3666'))
      .toEqual({ id: '3666', sets: 2, min: 30, speed: 12 })
  })
})

// Per-slot history is the routine and the exercise together (#216), so a replaced slot is a new
// line of progress: the new exercise opens at the slot's numbers, and the old exercise's
// sessions stay its own. These start and finish sessions the way the app does.
describe('history after a replace', () => {
  const work = e => e.sets.filter(s => !isWarmupRow(s))
  let day = 1
  function train(st, rid) {
    const entries = buildCombinedEntries(st, [rid]).entries
      .map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, done: true })) }))
    const active = { id: 'w' + day, d: `2026-08-${String(day).padStart(2, '0')}`, start: day * 1000, routineIds: [rid], name: 'x', entries }
    day++
    st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
  }
  const state = () => ({
    unit: 'kg', exWeights: {}, workouts: [], week: {}, dayPlan: {},
    routines: [{ id: 'A', name: 'Push', ex: [{ id: BENCH, sets: 2, mode: 'reps', reps: 10, weight: 60 }] }],
  })

  it('starts the new exercise fresh at the slot\'s numbers, and leaves the old one\'s progress where it was', () => {
    const st = state()
    train(st, 'A')
    train(st, 'A')
    // The bench has moved on from the plan's 60 in this routine.
    const [bench] = buildCombinedEntries(st, ['A']).entries
    expect(work(bench).map(s => s.w)).toEqual([65, 65])

    st.routines[0].ex[0] = replaceSlotExercise(st.routines[0].ex[0], DB_BENCH, st, 'A')
    const [db] = buildCombinedEntries(st, ['A']).entries
    expect(db.id).toBe(DB_BENCH)
    // Not the bench's 65: the dumbbells have never been logged, so they open at the slot's own
    // sets × reps × weight, and say why.
    expect(work(db).map(s => [s.w, s.r])).toEqual([[60, 10], [60, 10]])
    expect(db.plan.why[0]).toBe('Nothing logged yet — this session sets the baseline.')
    expect(lastEntryFor(st, DB_BENCH, 'A')).toBeNull()

    // The bench's sessions in this routine are still there if it comes back.
    expect(lastEntryFor(st, BENCH, 'A')?.sets.map(s => s.w)).toEqual([62.5, 62.5])
    st.routines[0].ex[0] = replaceSlotExercise(st.routines[0].ex[0], BENCH, st, 'A')
    // The bench's own planned weight goes back into the slot, not whatever the dumbbells had.
    expect(st.routines[0].ex[0].weight).toBe(60)
    const [back] = buildCombinedEntries(st, ['A']).entries
    expect(work(back).map(s => s.w)).toEqual([65, 65])
  })

  // An exercise the user already trains in another routine brings its own numbers. The slot's
  // weight belongs to the exercise that was in it, and the next session reads a slot weight that
  // differs from its last planned one as an edit to open at (#275) — so an 80 kg barbell bench
  // carried onto dumbbells trained at 30 opened them at 80, and only when the rep schemes
  // differed: a matching scheme carried on from the dumbbells' own history instead.
  function twoRoutines(dbReps) {
    const st = state()
    st.routines = [
      { id: 'A', name: 'Push', ex: [{ id: BENCH, sets: 3, mode: 'reps', reps: 8, weight: 80 }] },
      { id: 'B', name: 'Upper', ex: [{ id: DB_BENCH, sets: 3, mode: 'reps', reps: dbReps, weight: 30 }] },
    ]
    train(st, 'B')
    train(st, 'B')
    return st
  }

  it('opens a replacement that has history elsewhere at its own weight when the rep schemes differ', () => {
    const st = twoRoutines(10)
    // Routine B's dumbbells: 30, then 32.5, and 35 next.
    expect(work(buildCombinedEntries(st, ['B']).entries[0]).map(s => s.w)).toEqual([35, 35, 35])

    st.routines[0].ex[0] = replaceSlotExercise(st.routines[0].ex[0], DB_BENCH, st, 'A')
    expect(st.routines[0].ex[0]).toEqual({ id: DB_BENCH, sets: 3, mode: 'reps', reps: 8, weight: 30 })
    const [db] = buildCombinedEntries(st, ['A']).entries
    // Routine A's 3 × 8, at what the dumbbells were last lifted at — not the bench's 80.
    expect(work(db).map(s => [s.w, s.r])).toEqual([[32.5, 8], [32.5, 8], [32.5, 8]])
    expect(db.plan.why[0]).toBe('First time in this routine — starting from its own target.')
  })

  it('carries on from the replacement\'s own history when the rep schemes match', () => {
    const st = twoRoutines(8)
    st.routines[0].ex[0] = replaceSlotExercise(st.routines[0].ex[0], DB_BENCH, st, 'A')
    const [db] = buildCombinedEntries(st, ['A']).entries
    expect(work(db).map(s => [s.w, s.r])).toEqual([[35, 8], [35, 8], [35, 8]])
  })

  it('keeps the slot\'s weight for a replacement that has never been logged', () => {
    const st = twoRoutines(10)
    st.routines[0].ex[0] = replaceSlotExercise(st.routines[0].ex[0], '0047', st, 'A')
    expect(st.routines[0].ex[0].weight).toBe(80)
  })
})
