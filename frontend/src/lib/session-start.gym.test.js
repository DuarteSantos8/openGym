// A session opens from what was lifted in ITS gym (lib/gyms.js): the same cable stack reads 50 at
// one club and 20 at another. Sessions are started and finished the way the app does it, so the
// history has the shape the app saves.
import { describe, it, expect } from 'vitest'
import { buildCombinedEntries } from './session-merge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { reseedEntriesForGym } from './session-start.js'
import { isWarmupRow } from './workout-model.js'
import { carriedFromOtherGym } from './gyms.js'

const BENCH = '0025'
const work = e => e.sets.filter(s => !isWarmupRow(s))
const clone = v => JSON.parse(JSON.stringify(v))
const ROUTINE = { id: 'PUSH', name: 'Push', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 40, prog: 'linear' }] }
const state = (extra = {}) => ({ unit: 'kg', exWeights: {}, routines: [clone(ROUTINE)], workouts: [], week: {}, dayPlan: {}, ...extra })
const start = (st, gym) => buildCombinedEntries(gym ? { ...st, pendingGym: gym } : st, ['PUSH']).entries

let day = 1
function train(st, gym, w) {
  const entries = start(st, gym).map(e => ({ ...e, sets: e.sets.map(s => (isWarmupRow(s) ? { ...s, done: true } : { ...s, w, r: 5, done: true })) }))
  const d = `2026-09-${String(day).padStart(2, '0')}`
  const active = { id: 'w' + day, d, start: day * 1000, routineIds: ['PUSH'], name: 'Push', entries, ...(gym ? { gym } : {}) }
  day++
  st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
}

describe('a session in a gym', () => {
  it('saves the gym on the finished workout, and nothing when there is none', () => {
    const st = state()
    train(st, 'giga', 50)
    train(st, null, 50)
    expect(st.workouts[0].gym).toBe('giga')
    expect('gym' in st.workouts[1]).toBe(false)
  })

  it('opens from the last session in the same gym, not from the latest one anywhere', () => {
    const st = state()
    train(st, 'giga', 50)
    train(st, 'bf', 20)
    train(st, 'giga', 52.5)
    // The latest session was at Gigafit; Basic-Fit still remembers its own 20.
    const [bf] = start(st, 'bf')
    expect(Math.max(...work(bf).map(s => s.w))).toBeLessThan(30)
    expect(Math.min(...work(bf).map(s => s.w))).toBeGreaterThanOrEqual(20)
    const [giga] = start(st, 'giga')
    expect(Math.min(...work(giga).map(s => s.w))).toBeGreaterThanOrEqual(52.5)
  })

  it('starts a gym it has never trained at from what was lifted elsewhere', () => {
    const st = state()
    train(st, 'giga', 50)
    const [speed] = start(st, 'speedform')
    expect(Math.min(...work(speed).map(s => s.w))).toBeGreaterThanOrEqual(50)
    expect(carriedFromOtherGym(st, BENCH, 'speedform')).toBe(true)
  })

  it('without a gym, reads the log as it always did', () => {
    const st = state()
    train(st, 'giga', 50)
    train(st, 'bf', 20)
    const [plain] = start(st, null)
    expect(Math.max(...work(plain).map(s => s.w))).toBeLessThan(30)
  })
})

describe('changing the gym mid-session', () => {
  function running(st, gym) {
    return { ...st, active: { id: 'now', d: '2026-10-01', start: 1, routineIds: ['PUSH'], name: 'Push', entries: start(st, gym), ...(gym ? { gym } : {}) } }
  }

  it('rebuilds untouched exercises from the new gym\'s history', () => {
    const st = state()
    train(st, 'giga', 50)
    train(st, 'bf', 20)
    const s = running(st, 'giga')
    expect(Math.min(...work(s.active.entries[0]).map(x => x.w))).toBeGreaterThanOrEqual(50)
    s.active.gym = 'bf'
    expect(reseedEntriesForGym(s)).toBe(1)
    expect(Math.max(...work(s.active.entries[0]).map(x => x.w))).toBeLessThan(30)
  })

  it('leaves an exercise with a logged set alone', () => {
    const st = state()
    train(st, 'giga', 50)
    train(st, 'bf', 20)
    const s = running(st, 'giga')
    const typed = work(s.active.entries[0])[0]
    typed.done = true
    const before = JSON.stringify(s.active.entries[0])
    s.active.gym = 'bf'
    expect(reseedEntriesForGym(s)).toBe(0)
    expect(JSON.stringify(s.active.entries[0])).toBe(before)
  })

  it('does nothing with no session running', () => {
    expect(reseedEntriesForGym({ active: null })).toBe(0)
  })
})
