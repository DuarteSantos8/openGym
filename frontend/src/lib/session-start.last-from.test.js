// "Last time means → Any workout" (#770): the same lift on Monday and Thursday read as one line of
// history instead of one per routine. The default keeps each routine's own last session (#216),
// for the lifter whose Monday is heavy and Thursday light. Sessions are started and finished the
// way the app does it, so the history has the shape the app saves.
import { describe, it, expect } from 'vitest'
import { buildCombinedEntries } from './session-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { lastEntryFor, lastAcrossRoutines } from './history.js'
import { isWarmupRow } from './workout-model.js'

const BENCH = '0025'   // barbell bench press, 2.5 kg step
const work = e => e.sets.filter(s => !isWarmupRow(s))
const clone = v => JSON.parse(JSON.stringify(v))
const state = (routines, extra = {}) => ({ unit: 'kg', exWeights: {}, routines: clone(routines), workouts: [], week: {}, dayPlan: {}, ...extra })
const start = (st, rids) => buildCombinedEntries(st, rids).entries

let day = 1
function train(st, rids, typed) {
  const entries = start(st, rids).map(e => ({ ...e, sets: e.sets.map(s => (isWarmupRow(s) ? { ...s, done: true } : { ...s, ...(typed || {}), done: true })) }))
  const d = `2026-08-${String(day).padStart(2, '0')}`
  const active = { id: 'w' + day, d, start: day * 1000, routineIds: rids, name: 'x', entries }
  day++
  st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
}

const twoDays = (a = {}, b = {}) => [
  { id: 'MON', name: 'Monday', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 100, prog: 'linear', ...a }] },
  { id: 'THU', name: 'Thursday', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 100, prog: 'linear', ...b }] },
]

describe('"Last time means"', () => {
  it('is the routine\'s own last session by default, and for a profile that never chose', () => {
    expect(lastAcrossRoutines({})).toBe(false)
    expect(lastAcrossRoutines({ lastFrom: 'routine' })).toBe(false)
    expect(lastAcrossRoutines({ lastFrom: 'any' })).toBe(true)
  })

  it('per routine, Thursday progresses from last Thursday even after a better Monday', () => {
    const st = state(twoDays())
    train(st, ['THU'])
    train(st, ['MON'])
    train(st, ['MON'])   // Monday is up to 102.5 now
    const [thu] = start(st, ['THU'])
    expect(work(thu).map(s => s.w)).toEqual([102.5, 102.5])
    expect(lastEntryFor(st, BENCH, 'THU').d).toBe('2026-08-01')
  })

  it('across workouts, Thursday picks up from Monday', () => {
    const st = state(twoDays(), { lastFrom: 'any' })
    train(st, ['THU'])
    train(st, ['MON'])
    train(st, ['MON'])   // one line now: 100 Thursday, 102.5 and 105 on Monday
    const [thu] = start(st, ['THU'])
    expect(thu.plan.kind).toBe('up')
    expect(work(thu).map(s => s.w)).toEqual([107.5, 107.5])
    // The "Your last session" line reads the same session the rows came from.
    const last = lastEntryFor(st, BENCH, 'THU')
    expect(last.rid).toBe('MON')
    expect(last.sets.map(s => s.w)).toEqual([105, 105])
  })

  it('across workouts, another routine\'s different plan is no reason to restart', () => {
    const st = state(twoDays({}, { reps: 8, weight: 80 }), { lastFrom: 'any' })
    train(st, ['THU'])
    train(st, ['MON'])
    const [thu] = start(st, ['THU'])
    expect(thu.plan.why[0]).not.toBe('Plan changed, so starting from your new target.')
    expect(thu.plan.why[0]).not.toBe('First time in this routine, so starting from its own target.')
    expect(work(thu).map(s => s.r)).toEqual([8, 8])
  })

  it('across workouts, editing this routine\'s own plan still restarts it', () => {
    const st = state(twoDays(), { lastFrom: 'any' })
    train(st, ['THU'])
    st.routines[1].ex[0].reps = 8
    const [thu] = start(st, ['THU'])
    expect(thu.plan.why[0]).toBe('Plan changed, so starting from your new target.')
  })

  it('with progression off and "Your last session", the rows copy the newest session anywhere', () => {
    const st = state(twoDays({ prog: 'off' }, { prog: 'off' }), { lastFrom: 'any', startFrom: 'last' })
    train(st, ['THU'], { w: 90, r: 6 })
    train(st, ['MON'], { w: 110, r: 4 })
    const [thu] = start(st, ['THU'])
    expect(work(thu).map(s => [s.w, s.r])).toEqual([[110, 4], [110, 4]])
    st.lastFrom = 'routine'
    const [own] = start(st, ['THU'])
    expect(work(own).map(s => [s.w, s.r])).toEqual([[90, 6], [90, 6]])
  })

  it('still skips a deload session, wherever it was', () => {
    const st = state([...twoDays(), { id: 'DL', name: 'Deload', excludeFromProgression: true, ex: [{ id: BENCH, sets: 2, reps: 5, weight: 60 }] }], { lastFrom: 'any' })
    train(st, ['MON'])
    train(st, ['DL'])
    expect(lastEntryFor(st, BENCH, 'THU').rid).toBe('MON')
  })
})
