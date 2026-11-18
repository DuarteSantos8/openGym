// @vitest-environment happy-dom
// Finishing a workout while a cardio set's clock runs (store/useCardioClock.js): the minutes it
// counted are on the saved row, and the clock is gone with the workout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { CARDIO_CLOCK_KEY, useCardioClock } from './store/useCardioClock.js'
import { finishWorkoutNow } from './sheets.jsx'

vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))

const T0 = new Date('2026-11-18T10:00:00Z').getTime()

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  localStorage.clear()
  useCardioClock.setState({ run: null })
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  useCardioClock.setState({ run: null })
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.useRealTimers()
})

describe('finishing while a cardio set is timed', () => {
  it('writes the clock’s minutes to the saved row and clears the slot', () => {
    const st = JSON.parse(JSON.stringify(DEF))
    st.active = {
      id: 'fin-clock', d: '2026-11-18', start: T0 - 30 * 60000, routineId: null, name: 'Cardio', bw: null, cur: 0,
      entries: [{ id: '2259', target: { sets: 2, min: 20, speed: 5 }, sets: [{ min: 20, speed: 5, done: true, at: T0 }, { min: 20, speed: 5, done: false }] }],
    }
    useStore.setState({ S: st, user: null })
    useCardioClock.getState().start(0, 1)
    expect(localStorage.getItem(CARDIO_CLOCK_KEY)).not.toBeNull()
    vi.setSystemTime(T0 + 31 * 60000)
    finishWorkoutNow()
    const S = useStore.getState().S
    expect(S.active).toBeNull()
    const saved = S.workouts.find(w => w.id === 'fin-clock') || S.workouts.at(-1)
    expect(saved.entries[0].sets[1].min).toBe(31)
    expect(useCardioClock.getState().run).toBeNull()
    expect(localStorage.getItem(CARDIO_CLOCK_KEY)).toBeNull()
  })
})
