// @vitest-environment happy-dom
// A session recorded on the watch (lib/wear-bridge.js) closes through the same code as the Finish
// button, end to end through the real store: snapshot -> watch logs -> finishWatchWorkout -> the
// next session starts from it. The parity test is the point: the same sets, logged on the phone or
// on the watch, must leave the same workout in history.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginWorkout, finishWorkout, finishWatchWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { isWarmupRow } from './lib/workout-model.js'
import { routineToWatchSnapshot, watchSessionToActive, watchSessionEnd, classifyWatchSession } from './lib/wear-bridge.js'

const BENCH = '0025'
const WATCH_ID = '3f2b8c1e-5d7a-4c9e-8a11-0f6d2b9e7c44'
const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const upd = fn => act(() => useStore.getState().update(fn))
const ROUTINE = { id: 'A', name: 'Plan A', emoji: 'dumbbell', prog: 'linear', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 60, mode: 'reps', prog: 'linear' }] }

function install(extra = {}) {
  const st = clone(DEF)
  Object.assign(st, { routines: [clone(ROUTINE)], week: { 1: ['A'] }, active: null, workouts: [], weighIn: false }, extra)
  useStore.setState({ S: st, user: null })
}

// What the watch would send after the person lifted `weights`/`reps` on every planned row.
function watchSession(snapshot, { weight, reps, start, end }) {
  return {
    v: 1, id: WATCH_ID, routineId: snapshot.routineId, name: snapshot.name, unit: snapshot.unit, start, end,
    exercises: snapshot.exercises.map(ex => ({
      id: ex.id, ctx: ex.ctx,
      sets: ex.sets.map(({ rest, ...s }, i) => ({ ...s, ...(weight ? { w: weight } : {}), ...(reps ? { r: reps } : {}), done: true, at: start + (i + 1) * 90000 })),
    })),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  localStorage.clear()
  useUI.setState({ sheets: [], toasts: [] })
})
afterEach(() => { vi.useRealTimers() })

describe('finishWatchWorkout', () => {
  it('saves the session under the watch id, dated by when it started, ending when the watch says', () => {
    install()
    vi.setSystemTime(new Date('2026-09-07T20:30:00'))
    const snap = routineToWatchSnapshot(S().routines[0], S())
    const start = new Date('2026-09-07T18:00:00').getTime()
    const payload = watchSession(snap, { start, end: start + 55 * 60000 })
    act(() => finishWatchWorkout(watchSessionToActive(payload, S()), { end: watchSessionEnd(payload) }))

    expect(S().workouts).toHaveLength(1)
    const w = S().workouts[0]
    expect(w).toMatchObject({ id: WATCH_ID, d: '2026-09-07', start, end: start + 55 * 60000, routineId: 'A', name: 'Plan A' })
    expect(w.vol).toBe(60 * 5 * 2)
    expect(S().exWeights[BENCH]).toMatchObject({ w: 60 })
    // No summary sheet, no beeps: a toast says it is in.
    expect(useUI.getState().sheets).toEqual([])
  })

  it('leaves a workout the phone has going exactly as it was', () => {
    install()
    vi.setSystemTime(new Date('2026-09-07T17:00:00'))
    act(() => beginWorkout(['A'], null))
    const mine = S().active
    const before = JSON.stringify(mine)

    const snap = routineToWatchSnapshot(S().routines[0], S())
    const start = new Date('2026-09-07T10:00:00').getTime()
    const payload = watchSession(snap, { start, end: start + 3000000 })
    expect(classifyWatchSession(payload, S()).action).toBe('conflict')
    act(() => finishWatchWorkout(watchSessionToActive(payload, S()), { end: watchSessionEnd(payload) }))

    expect(S().workouts.map(w => w.id)).toEqual([WATCH_ID])
    expect(JSON.stringify(S().active)).toBe(before)
  })

  it('counts for the next session: hitting the plan on the watch moves the weight up', () => {
    install()
    vi.setSystemTime(new Date('2026-09-07T20:00:00'))
    // Three sessions on the watch at 60 x 5 earn the linear step.
    for (const [n, day] of [[1, '07'], [2, '09'], [3, '11']]) {
      vi.setSystemTime(new Date(`2026-09-${day}T20:00:00`))
      const snap = routineToWatchSnapshot(S().routines[0], S())
      const start = new Date(`2026-09-${day}T18:00:00`).getTime()
      const payload = { ...watchSession(snap, { start, end: start + 3000000 }), id: 'watch-session-' + n }
      act(() => finishWatchWorkout(watchSessionToActive(payload, S()), { end: watchSessionEnd(payload) }))
    }
    vi.setSystemTime(new Date('2026-09-14T17:00:00'))
    act(() => beginWorkout(['A'], null))
    const work = S().active.entries[0].sets.filter(s => !isWarmupRow(s))
    expect(work[0].w).toBeGreaterThan(60)
  })

  it('leaves the same workout in history as the Finish button does for the same sets', () => {
    // Phone: begin, tick, finish.
    install()
    vi.setSystemTime(new Date('2026-09-07T17:00:00'))
    act(() => beginWorkout(['A'], null))
    const stamp = new Date('2026-09-07T17:10:00').getTime()
    upd(s => s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true; x.at = stamp })))
    vi.setSystemTime(new Date('2026-09-07T17:20:00'))
    act(() => finishWorkout())
    useUI.setState({ sheets: [] })
    const phone = clone(S().workouts[0])

    // Watch: the same routine, the same sets, the same stamps.
    install()
    vi.setSystemTime(new Date('2026-09-07T17:20:00'))
    const snap = routineToWatchSnapshot(S().routines[0], S())
    const payload = watchSession(snap, { start: phone.start, end: phone.end })
    payload.exercises.forEach(e => e.sets.forEach(s => { s.at = stamp }))
    act(() => finishWatchWorkout(watchSessionToActive(payload, S()), { end: watchSessionEnd(payload) }))
    const watch = clone(S().workouts[0])

    const strip = w => { const { id, _ts, ...rest } = w; return rest }
    expect(strip(watch)).toEqual(strip(phone))
  })
})
