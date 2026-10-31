// An exercise opens from what was lifted on ITS machine (lib/gyms.js): the same press reads 50 on
// one make and 20 on another. Sessions are started and finished the way the app does it, so the
// history has the shape the app saves.
import { describe, it, expect } from 'vitest'
import { buildCombinedEntries } from './session-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { setEntryGym } from './session-start.js'
import { repeatSessionEntries } from './session-repeat.js'
import { isWarmupRow } from './workout-model.js'

const BENCH = '0025'
const LIST = [{ id: 'bf', name: 'Basic-Fit' }, { id: 'tg', name: 'Technogym' }]
const work = e => e.sets.filter(s => !isWarmupRow(s))
const clone = v => JSON.parse(JSON.stringify(v))
const ROUTINE = { id: 'PUSH', name: 'Push', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 40, prog: 'linear' }] }
const state = (extra = {}) => ({ unit: 'kg', exWeights: {}, routines: [clone(ROUTINE)], workouts: [], week: {}, dayPlan: {}, gyms: clone(LIST), ...extra })
const start = st => buildCombinedEntries(st, ['PUSH']).entries
const lowest = e => Math.min(...work(e).map(s => s.w))
const highest = e => Math.max(...work(e).map(s => s.w))

// A running session as the store holds it: entries built at the start.
const running = st => ({ ...st, active: { id: 'now', d: '2026-10-01', start: 1, routineIds: ['PUSH'], name: 'Push', entries: start(st) } })

let day = 1
// Pick the machine on the first exercise (as its tag does), type `w` on every work set, finish.
function train(st, machine, w) {
  const s = running(st)
  if (machine !== undefined) setEntryGym(s, 0, machine)
  const entries = s.active.entries.map(e => ({ ...e, sets: e.sets.map(x => (isWarmupRow(x) ? { ...x, done: true } : { ...x, w, r: 5, done: true })) }))
  const d = `2026-09-${String(day).padStart(2, '0')}`
  const active = { id: 'w' + day, d, start: day * 1000, routineIds: ['PUSH'], name: 'Push', entries }
  day++
  st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
}

describe('the machine of an exercise', () => {
  it('is saved on the finished entry, and nothing is written when there is none', () => {
    const st = state()
    train(st, 'tg', 50)
    train(st, null, 50)
    expect(st.workouts[0].entries[0].gym).toBe('tg')
    expect('gym' in st.workouts[1].entries[0]).toBe(false)
  })

  it('opens on the machine it was last done on, with that machine\'s weights', () => {
    const st = state()
    train(st, 'tg', 50)
    train(st, 'bf', 20)
    train(st, 'tg', 52.5)
    const [e] = start(st)
    expect(e.gym).toBe('tg')
    expect(lowest(e)).toBeGreaterThanOrEqual(52.5)
  })

  it('opens from the last time on whichever machine it was last done on, not from the heaviest', () => {
    const st = state()
    train(st, 'tg', 50)
    train(st, 'bf', 20)
    const [e] = start(st)
    expect(e.gym).toBe('bf')
    expect(highest(e)).toBeLessThan(30)
  })

  it('writes no machine and reads the whole log when none is listed', () => {
    const st = state({ gyms: [] })
    train(st, undefined, 50)
    train(st, undefined, 20)
    const [e] = start(st)
    expect('gym' in e).toBe(false)
    expect(highest(e)).toBeLessThan(30)
  })

  it('stops being the default once it is deleted from the list', () => {
    const st = state()
    train(st, 'tg', 50)
    st.gyms = [LIST[0]]
    const [e] = start(st)
    expect('gym' in e).toBe(false)
  })
})

describe('repeating a workout', () => {
  it('keeps each exercise on the machine it was done on, while that machine is listed', () => {
    const st = state()
    train(st, 'tg', 50)
    expect(repeatSessionEntries(st, st.workouts[0]).entries[0].gym).toBe('tg')
    st.gyms = [LIST[0]]
    expect('gym' in repeatSessionEntries(st, st.workouts[0]).entries[0]).toBe(false)
  })
})

describe('moving an exercise to another machine mid-session', () => {
  it('rebuilds untouched rows from that machine\'s history', () => {
    const st = state()
    train(st, 'tg', 50)
    train(st, 'bf', 20)
    train(st, 'tg', 52.5)
    const s = running(st)
    expect(lowest(s.active.entries[0])).toBeGreaterThanOrEqual(52.5)
    expect(setEntryGym(s, 0, 'bf')).toBe(true)
    expect(s.active.entries[0].gym).toBe('bf')
    expect(highest(s.active.entries[0])).toBeLessThan(30)
  })

  it('starts a machine it has never been on from what was lifted elsewhere', () => {
    const st = state()
    train(st, 'tg', 50)
    const s = running(st)
    setEntryGym(s, 0, 'bf')
    expect(lowest(s.active.entries[0])).toBeGreaterThanOrEqual(50)
    expect(s.active.entries[0].gym).toBe('bf')
  })

  it('only retags an exercise with a logged set, and leaves its rows alone', () => {
    const st = state()
    train(st, 'tg', 50)
    train(st, 'bf', 20)
    const s = running(st)
    work(s.active.entries[0])[0].done = true
    const rows = JSON.stringify(s.active.entries[0].sets)
    expect(setEntryGym(s, 0, 'tg')).toBe(false)
    expect(s.active.entries[0].gym).toBe('tg')
    expect(JSON.stringify(s.active.entries[0].sets)).toBe(rows)
  })

  it('clears the machine with null', () => {
    const st = state()
    train(st, 'tg', 50)
    const s = running(st)
    expect(s.active.entries[0].gym).toBe('tg')
    setEntryGym(s, 0, null)
    expect('gym' in s.active.entries[0]).toBe(false)
  })

  it('does nothing for an exercise that is not there', () => {
    expect(setEntryGym({ active: null }, 0, 'tg')).toBe(false)
    expect(setEntryGym(running(state()), 5, 'tg')).toBe(false)
  })
})
