// @vitest-environment happy-dom
// The end of a hold, against the real store and work timer: it sounds once. The chime and its
// buzz pattern belong to the timer (store/useUI.js); the set it ticks adds neither its own beep,
// which clipped the chime's first note, nor its short buzz, which cut the pattern off.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { beep, chime, vibrate, alertBuzz, hush, holdSession } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const plank = () => ({ id: '1001', target: { mode: 'time', sets: 2, sec: 10 }, sets: [{ sec: 10, w: 0, done: false }, { sec: 10, w: 0, done: false }] })

let root
let container

function renderWorkout(entries, beforeRender) {
  const S = clone(DEF)
  S.sound = true
  S.active = { id: 'hold-test', d: '2026-09-23', start: Date.now(), routineId: null, name: 'Hold', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  beforeRender?.()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const startHold = () => {
  const go = container.querySelector('button[aria-label="Start set"]')
  expect(go).toBeTruthy()
  act(() => go.click())
  expect(useUI.getState().work).not.toBeNull()
}
const tickBeeps = () => beep.mock.calls.filter(call => call[1] === 1040)
const doneOf = () => useStore.getState().S.active.entries[0].sets.map(s => s.done)

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(beep).mockClear(); vi.mocked(chime).mockClear(); vi.mocked(vibrate).mockClear(); vi.mocked(alertBuzz).mockClear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the end of a hold', () => {
  it('ran out on its own: the chime and its buzz pattern, and no tick beep or short buzz after them', () => {
    renderWorkout([plank()])
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(doneOf()).toEqual([true, false])
    expect(chime).toHaveBeenCalledOnce()
    expect(tickBeeps()).toEqual([])
    // The end's buzz goes through alertBuzz, which can buzz as an alarm on silent (#375).
    expect(alertBuzz.mock.calls).toEqual([[[200, 100, 200]]])
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('finished early with Done: the set ticks the way a tap does, beep and buzz', () => {
    renderWorkout([plank()])
    startHold()
    act(() => { vi.advanceTimersByTime(4_000) })
    act(() => useUI.getState().finishWorkEarly())
    expect(doneOf()).toEqual([true, false])
    expect(chime).not.toHaveBeenCalled()
    expect(tickBeeps()).toHaveLength(1)
    expect(vibrate).toHaveBeenLastCalledWith(30)
  })
})

// Owner's call: a timed per-side set pauses ten seconds to switch sides between its left and
// right hold, and rests in full only once both are held.
describe('a per-side hold', () => {
  const sidePlank = () => ({ id: '1001', target: { mode: 'time', sets: 2, sec: 10, side: true }, sets: [
    { sec: 10, w: 0, done: false, side: 'L' }, { sec: 10, w: 0, done: false, side: 'R' },
    { sec: 10, w: 0, done: false, side: 'L' }, { sec: 10, w: 0, done: false, side: 'R' },
  ] })
  const holdRow = n => {
    const go = container.querySelectorAll('button[aria-label="Start set"]')[n]
    act(() => go.click())
    act(() => { vi.advanceTimersByTime(11_000) })
  }

  it('left held: a 10 s "Switch sides" countdown, which ends with the chime and goes', () => {
    renderWorkout([sidePlank()])
    holdRow(0)
    expect(doneOf()).toEqual([true, false, false, false])
    const tm = useUI.getState().timer
    expect(tm).toMatchObject({ kind: 'switch', total: 10 })
    expect(chime).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(useUI.getState().timer).toBeNull()
    expect(chime).toHaveBeenCalledTimes(2)
    expect(alertBuzz).toHaveBeenCalledTimes(2)
  })

  it('right held too: the set\'s full rest, not another switch', () => {
    renderWorkout([sidePlank()])
    holdRow(0)
    holdRow(1)
    expect(doneOf()).toEqual([true, true, false, false])
    const tm = useUI.getState().timer
    expect(tm.kind).toBe('set')             // the rest before the next set, not a switch
    expect(tm.total).toBe(useStore.getState().S.restSec)
  })

  it('Left and Right pills carry both words, so they are one width (#322)', () => {
    renderWorkout([sidePlank()])
    const pills = [...container.querySelectorAll('.sidepill')]
    expect(pills.map(p => p.textContent)).toEqual(['Left', 'Right', 'Left', 'Right'])
    for (const p of pills) expect([p.dataset.l, p.dataset.r]).toEqual(['Left', 'Right'])
  })
})

// Moving an exercise up or down drops a hold's callback before the indexes shift (moveUnitAt), and
// that used to call off the count-in of the rest running at the time and hand the phone's volume
// buttons back to the ringer for the rest of it.
describe('a move during a rest', () => {
  it('leaves the rest counting you in, with the audio session still held', () => {
    const bench = () => ({ id: '0025', target: { mode: 'reps', sets: 2, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }] })
    renderWorkout([bench(), plank()], () => { useStore.getState().update(s => { s.wc = { exerciseButtons: true } }) })
    act(() => container.querySelectorAll('[role="checkbox"]')[0].click())
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', forIdx: 0 })
    vi.mocked(hush).mockClear(); vi.mocked(holdSession).mockClear()
    act(() => container.querySelector('button[aria-label="Move down"]').click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '0025'])
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', forIdx: 1 })
    expect(hush).not.toHaveBeenCalled()
    expect(holdSession).not.toHaveBeenCalled()
  })
})

// Owner's call: a hold that runs out while the phone is locked has been followed by its rest ever
// since. Back on screen the rest has the time that is really left.
describe('a hold that runs out while the phone is locked', () => {
  const setHidden = hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => setHidden(false))
  const plank3 = () => ({ ...plank(), sets: [0, 1, 2].map(() => ({ sec: 10, w: 0, done: false })) })

  it('back before its rest is over: the rest has been counting since the hold ended', () => {
    renderWorkout([plank3()])
    const restSec = useStore.getState().S.restSec
    const holdEnds = Date.now() + 10_000
    startHold()
    setHidden(true)
    act(() => { vi.advanceTimersByTime(40_000) })               // the hold ran out 30 s ago
    act(() => setHidden(false))
    expect(doneOf()).toEqual([true, false, false])
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', endsAt: holdEnds + restSec * 1000, left: restSec - 30 })
  })

  it('back after its rest is over too: Ready, and its toast', () => {
    renderWorkout([plank3()])
    const restSec = useStore.getState().S.restSec
    startHold()
    setHidden(true)
    act(() => { vi.advanceTimersByTime((10 + restSec + 5) * 1000) })
    act(() => setHidden(false))
    expect(doneOf()).toEqual([true, false, false])
    expect(useUI.getState().timer).toMatchObject({ ready: true, left: 0 })
    expect(useUI.getState().toastMsg).toBe('Rest’s over. Next set!')
  })
})

