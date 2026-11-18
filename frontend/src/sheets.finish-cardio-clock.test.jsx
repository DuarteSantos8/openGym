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

function install() {
  const st = JSON.parse(JSON.stringify(DEF))
  st.active = {
    id: 'fin-clock', d: '2026-11-18', start: T0 - 30 * 60000, routineId: null, name: 'Cardio', bw: null, cur: 0,
    entries: [{ id: '2259', target: { sets: 2, min: 20, speed: 5 }, sets: [{ min: 20, speed: 5, done: true, at: T0 }, { min: 20, speed: 5, done: false }] }],
  }
  useStore.setState({ S: st, user: null })
  useCardioClock.getState().start(0, 1)
}
const savedRow = () => useStore.getState().S.workouts.find(w => w.id === 'fin-clock').entries[0].sets[1]

describe('finishing while a cardio set is timed', () => {
  it('stops it at the end a watch’s Finish gives, not when the phone hears of it', () => {
    install()
    vi.setSystemTime(T0 + 40 * 60000)
    finishWorkoutNow({ end: T0 + 25 * 60000 })
    expect(savedRow().min).toBe(25)
  })

  it('stops it where a workout that ended by itself ended', () => {
    install()
    vi.setSystemTime(T0 + 90 * 60000)
    finishWorkoutNow({ end: T0 + 12 * 60000, auto: 'idle' })
    expect(savedRow().min).toBe(12)
  })

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

  // The saved end reads the sets' tick times (lib/finish-workout.js sessionEnd), and the row the
  // clock wrote is not ticked: 35 minutes after the last tick read as a session long over.
  describe('the saved end', () => {
    const MIN = 60000
    function installLastTickAt10() {
      const st = JSON.parse(JSON.stringify(DEF))
      st.active = {
        id: 'fin-end', d: '2026-11-18', start: T0 - 30 * MIN, routineId: null, name: 'Cardio', bw: null, cur: 0,
        entries: [{ id: '2259', target: { sets: 2, min: 20, speed: 5 }, sets: [{ speed: 5, done: true, at: T0 }, { min: 20, speed: 5, done: false }] }],
      }
      useStore.setState({ S: st, user: null })
    }
    const savedEnd = () => useStore.getState().S.workouts.find(w => w.id === 'fin-end').end

    it('reaches at least to where the clock stopped', () => {
      installLastTickAt10()
      vi.setSystemTime(T0 + 5 * MIN)
      useCardioClock.getState().start(0, 1)
      vi.setSystemTime(T0 + 35 * MIN)
      finishWorkoutNow()
      expect(useStore.getState().S.workouts.find(w => w.id === 'fin-end').entries[0].sets[1].min).toBe(30)
      expect(savedEnd()).toBeGreaterThanOrEqual(T0 + 35 * MIN)
    })

    it('is the last real work, as before, with no clock running', () => {
      installLastTickAt10()
      vi.setSystemTime(T0 + 35 * MIN)
      finishWorkoutNow()
      expect(savedEnd()).toBe(T0)
    })
  })
})
