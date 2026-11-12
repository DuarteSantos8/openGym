// @vitest-environment happy-dom
// A reload or the app being killed mid-hold (a timed set, a plank) used to drop the bar and the
// seconds with it. The hold is kept with the set it belongs to, carries on after the reload, and
// one that ended while the app was away is written to its set as held to the end.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { useUI, restoreWork, WORK_KEY } from './useUI.js'
import { useStore } from './useStore.js'

const saved = () => JSON.parse(localStorage.getItem(WORK_KEY) || 'null')
const plankSet = () => useStore.getState().S.active.entries[1].sets[0]
const owner = { idx: 1, i: 0, id: 'plank' }

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useStore.setState({ S: { ...original, sound: true, active: { id: 'a', entries: [
    { id: 'squat', sets: [{ w: 100, r: 5 }] },
    { id: 'plank', sets: [{ sec: 45 }, { sec: 45 }] },
  ] } } })
  useUI.setState({ timer: null, work: null })
  localStorage.clear()
})
afterEach(() => {
  useUI.getState().stopWork()
  useUI.getState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})

describe('a hold across a reload', () => {
  it('is kept with its set while it runs, and forgotten once it ends', () => {
    const done = vi.fn()
    useUI.getState().startWork(45, 'Plank', done, owner)
    expect(saved()).toMatchObject({ total: 45, label: 'Plank', owner })
    useUI.getState().finishWorkEarly()
    expect(done).toHaveBeenCalled()
    expect(saved()).toBeNull()
  })

  it('a hold without an owner is not kept', () => {
    useUI.getState().startWork(45, 'Plank', vi.fn())
    expect(saved()).toBeNull()
  })

  it('carries on after the reload, and the time lands on its set even before the screen is back', () => {
    const endsAt = Date.now() + 42_000
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt, total: 45, label: 'Plank', overtime: false, owner }))
    expect(restoreWork()).toBe(true)
    expect(useUI.getState().work).toMatchObject({ left: 42, total: 45, label: 'Plank', owner })
    vi.advanceTimersByTime(43_000)
    expect(useUI.getState().work).toBeNull()
    expect(plankSet()).toMatchObject({ sec: 45, done: true })
    expect(saved()).toBeNull()
  })

  it('the workout screen binds its own handler again, and Done goes to it', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 40_000, total: 45, label: 'Plank', overtime: false, owner }))
    restoreWork()
    const handler = vi.fn()
    useUI.getState().bindWork(wk => { expect(wk.owner).toEqual(owner); return handler })
    vi.advanceTimersByTime(10_000)
    useUI.getState().finishWorkEarly()
    expect(handler).toHaveBeenCalledWith(15)
    expect(plankSet().done).toBeUndefined()   // the screen's handler ticks it, not the fallback
  })

  it('one that ended while the app was away is written as held to the end', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() - 5_000, total: 45, label: 'Plank', overtime: false, owner }))
    expect(restoreWork()).toBe(true)
    expect(useUI.getState().work).toBeNull()
    expect(plankSet()).toMatchObject({ sec: 45, done: true })
    expect(saved()).toBeNull()
  })

  it('is dropped when its set is gone or already ticked', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 30_000, total: 45, label: 'Plank', overtime: false, owner: { idx: 0, i: 0, id: 'plank' } }))
    expect(restoreWork()).toBe(false)
    expect(useUI.getState().work).toBeNull()
    expect(saved()).toBeNull()
    useStore.getState().update(s => { s.active.entries[1].sets[0].done = true }, false)
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 30_000, total: 45, label: 'Plank', overtime: false, owner }))
    expect(restoreWork()).toBe(false)
  })
})

// A cardio segment (views/Workout.jsx startCardio) rides the same clock, counted in minutes: it
// keeps what to set the machine to and what comes next across a reload, and what lands on its row
// is minutes, never seconds.
describe('a cardio segment across a reload', () => {
  const cardioOwner = { idx: 1, i: 0, id: 'plank', cardio: true }
  const segment = () => useStore.getState().S.active.entries[1].sets[0]
  beforeEach(() => {
    useStore.getState().update(s => { s.active.entries[1].sets = [{ min: 20, speed: 5, incline: 4 }, { min: 10, speed: 5.4 }] }, false)
  })

  it('keeps its detail and what comes next, and a hold keeps none', () => {
    useUI.getState().startWork(1200, 'Treadmill', vi.fn(), cardioOwner, { detail: '5 km/h · 4% incline', next: 'Next: 10 min @ 5.4 km/h', overtime: false })
    expect(saved()).toMatchObject({ detail: '5 km/h · 4% incline', next: 'Next: 10 min @ 5.4 km/h', owner: cardioOwner })
    expect(useUI.getState().work.overtime).toBe(false)
    useUI.getState().stopWork()
    useUI.getState().startWork(45, 'Plank', vi.fn(), owner)
    expect(saved().detail).toBeUndefined()
    expect(saved().next).toBeUndefined()
  })

  it('carries on after the reload with its detail', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 600_000, total: 1200, label: 'Treadmill', overtime: false, owner: cardioOwner, detail: '5 km/h · 4% incline', next: 'Next: 10 min @ 5.4 km/h' }))
    expect(restoreWork()).toBe(true)
    expect(useUI.getState().work).toMatchObject({ left: 600, total: 1200, detail: '5 km/h · 4% incline', next: 'Next: 10 min @ 5.4 km/h' })
  })

  it('one that ended while the app was away is ticked with its minutes as planned, and no seconds', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() - 5_000, total: 1200, label: 'Treadmill', overtime: false, owner: cardioOwner }))
    expect(restoreWork()).toBe(true)
    expect(segment()).toMatchObject({ min: 20, done: true })
    expect('sec' in segment()).toBe(false)
  })

  it('an early Done with no screen to bind logs the minutes it ran', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 1_200_000, total: 1200, label: 'Treadmill', overtime: false, owner: cardioOwner }))
    restoreWork()
    vi.advanceTimersByTime(380_000)   // 6 min 20 s in
    useUI.getState().finishWorkEarly()
    expect(segment()).toMatchObject({ min: 6, done: true })
    expect('sec' in segment()).toBe(false)
  })
})
