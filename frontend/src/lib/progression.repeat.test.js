// "Repeat last session": a planned session opens exactly as this routine last logged the
// exercise — every set's weight and reps, or its hold, or its cardio — and nothing moves on its
// own. Started and finished the way the app does (buildCombinedEntries → buildCompletedWorkout),
// so the history each case reads has the shape the app saves.
import { describe, it, expect } from 'vitest'
import { buildCombinedEntries } from './session-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { nextPrescription, applyPrescription, policyFor, POLICY_NAME, POLICY_DESC } from './progression.js'
import { isWarmupRow } from './workout-model.js'
import { EXDB } from './exercises.js'

const BENCH = '0025'   // barbell bench press — loaded, 2.5 kg step
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
const work = e => e.sets.filter(s => !isWarmupRow(s))
const pairs = e => work(e).map(s => [s.w, s.r])
const clone = v => JSON.parse(JSON.stringify(v))
const state = (routines, extra = {}) => ({ unit: 'kg', exWeights: {}, routines: clone(routines), workouts: [], week: {}, dayPlan: {}, ...extra })
const start = (st, rids) => buildCombinedEntries(st, rids).entries

// Start the routines, type `typed` into the work rows (an object, or a function of the row
// index), tick everything and finish — what a real session leaves behind.
let day = 1
function train(st, rids, typed) {
  const entries = start(st, rids).map(e => {
    let i = -1
    return { ...e, sets: e.sets.map(s => {
      if (isWarmupRow(s)) return { ...s, done: true }
      i++
      return { ...s, ...(typeof typed === 'function' ? typed(i) : typed || {}), done: true }
    }) }
  })
  const d = `2026-08-${String(day).padStart(2, '0')}`
  const active = { id: 'w' + day, d, start: day * 1000, routineIds: rids, name: 'x', entries }
  day++
  st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
}

const bench = (extra = {}) => ({ id: BENCH, sets: 3, reps: 10, weight: 60, mode: 'reps', ...extra })

describe('Repeat last session', () => {
  it('is offered with a name and a description', () => {
    expect(POLICY_NAME.repeat).toBe('Repeat last session')
    expect(POLICY_DESC.repeat).toBeTruthy()
  })

  it('applies from the routine to every mode, timed holds and cardio included', () => {
    const routine = { prog: 'repeat' }
    expect(policyFor({ id: BENCH }, routine, 'reps')).toBe('repeat')
    expect(policyFor({ id: BENCH, mode: 'time' }, routine, 'time')).toBe('repeat')
    expect(policyFor({ id: CARDIO }, routine, 'cardio')).toBe('repeat')
  })

  it('opens at the routine\'s own numbers the first time', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [bench()] }])
    const [e] = start(st, ['A'])
    expect(pairs(e)).toEqual([[60, 10], [60, 10], [60, 10]])
    expect(e.plan.kind).toBe('restart')
  })

  it('opens every set at exactly what was logged last time, with no step up after a clean session', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [bench()] }])
    // Every rep hit, at more than the plan: linear would add 2.5 kg here.
    train(st, ['A'], i => [{ w: 70, r: 8 }, { w: 67.5, r: 9 }, { w: 65, r: 12 }][i])
    const [e] = start(st, ['A'])
    expect(pairs(e)).toEqual([[70, 8], [67.5, 9], [65, 12]])
    expect(e.plan).toMatchObject({ policy: 'repeat', kind: 'repeat' })
    expect(e.plan.why[0]).toBe('Same weight and reps as last time in this routine.')
  })

  it('never deloads, however many sessions came up short', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [bench()] }])
    for (let n = 0; n < 4; n++) train(st, ['A'], { w: 60, r: 6 })
    const [e] = start(st, ['A'])
    expect(pairs(e)).toEqual([[60, 6], [60, 6], [60, 6]])
  })

  it('follows what was changed during the last workout, session after session', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [bench()] }])
    train(st, ['A'], { w: 62.5, r: 10 })
    train(st, ['A'])                       // logged as it opened
    train(st, ['A'], { r: 11 })            // one more rep, same weight
    const [e] = start(st, ['A'])
    expect(pairs(e)).toEqual([[62.5, 11], [62.5, 11], [62.5, 11]])
  })

  it('works per exercise inside a routine that progresses', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'linear', ex: [bench({ prog: 'repeat' })] }])
    train(st, ['A'])
    const [e] = start(st, ['A'])
    expect(pairs(e)).toEqual([[60, 10], [60, 10], [60, 10]])
  })

  it('does not carry another routine\'s numbers in (!71)', () => {
    const st = state([
      { id: 'A', name: 'A', prog: 'repeat', ex: [bench({ sets: 2, reps: 10, weight: 60 })] },
      { id: 'B', name: 'B', ex: [bench({ sets: 2, reps: 15, weight: 40 })] },
    ])
    train(st, ['B'])
    const [a] = start(st, ['A'])
    expect(pairs(a)).toEqual([[60, 10], [60, 10]])
    expect(a.plan.why[0]).toBe('First time in this routine, so starting from its own target.')
  })

  it('starts from the new plan after the routine was edited', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [bench()] }])
    train(st, ['A'], { w: 70, r: 8 })
    const cfg = st.routines[0].ex[0]
    cfg.sets = 2
    cfg.reps = 5
    cfg.weight = 80
    const [e] = start(st, ['A'])
    expect(pairs(e)).toEqual([[80, 5], [80, 5]])
    expect(e.plan.kind).toBe('restart')
  })

  it('repeats a timed hold', () => {
    const plank = { id: BENCH, mode: 'time', sets: 2, sec: 30, weight: 0 }
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [plank] }])
    train(st, ['A'], { sec: 50 })
    const [e] = start(st, ['A'])
    expect(work(e).map(s => s.sec)).toEqual([50, 50])
  })

  it('repeats cardio', () => {
    const st = state([{ id: 'A', name: 'A', prog: 'repeat', ex: [{ id: CARDIO, sets: 1, min: 20, speed: 8 }] }])
    train(st, ['A'], { min: 25, speed: 9.5 })
    const [e] = start(st, ['A'])
    expect(work(e).map(s => [s.min, s.speed])).toEqual([[25, 9.5]])
  })

  it('leaves the rows alone when applied', () => {
    const rows = [{ w: 70, r: 8, done: false }]
    expect(applyPrescription(rows, { policy: 'repeat', kind: 'repeat' })).toBe(rows)
    expect(applyPrescription(rows, { policy: 'repeat', kind: 'restart' })).toBe(rows)
    const st = state([])
    expect(nextPrescription(st, bench({ prog: 'repeat' }), null).kind).toBe('restart')
  })
})
