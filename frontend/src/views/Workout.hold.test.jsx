// @vitest-environment happy-dom
// The end of a hold, against the real store and work timer: it sounds once. The chime and its
// buzz pattern belong to the timer (store/useUI.js); the set it ticks adds neither its own beep,
// which clipped the chime's first note, nor its short buzz, which cut the pattern off.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { removeActiveExercise, deleteActiveSet, copyActiveSet } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI, restoreWork, restoreRest, WORK_KEY, REST_KEY } from '../store/useUI.js'
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

  // When the exercise runs itself, the right side starts itself when the switch pause ends: left
  // hold, switch pause, right hold, then the set's rest, from one tap.
  it('run from its first hold: left, switch, right, the set\'s rest, the next left, all from one tap', () => {
    renderWorkout([sidePlank()])
    holdRow(0)                                                   // left held to the end
    expect(useUI.getState().timer).toMatchObject({ kind: 'switch', total: 10 })
    act(() => { vi.advanceTimersByTime(10_000) })                // the switch pause runs out
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().work).toMatchObject({ total: 10, owner: { idx: 0, i: 1 } })   // the right side, by itself
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(doneOf()).toEqual([true, true, false, false])
    const tm = useUI.getState().timer
    expect(tm).toMatchObject({ kind: 'set', total: useStore.getState().S.restSec, chain: { i: 2 } })
    act(() => { vi.advanceTimersByTime(tm.total * 1000) })       // the set's rest runs out
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 2 } })               // the next left
  })

  it('a left side ticked by hand still waits for a tap on the right', () => {
    renderWorkout([sidePlank()])
    const tick = container.querySelectorAll('[role="checkbox"]')[0]
    act(() => tick.click())
    expect(useUI.getState().timer).toMatchObject({ kind: 'switch' })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().work).toBeNull()
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
    // The exercise runs itself: the rest that is left runs on screen into the next hold.
    act(() => { vi.advanceTimersByTime((restSec - 30) * 1000) })
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 1 } })
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
    // A rest that ran out unseen starts no hold: the next one waits for a tap.
    expect(useUI.getState().work).toBeNull()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(useUI.getState().work).toBeNull()
  })
})

// Owner's call: the chain stops when you go to another exercise during the rest between two holds,
// or during the hold itself. Nothing in it moves the screen.
describe('a timed exercise that runs itself, and a move', () => {
  const bench = () => ({ id: '0025', target: { mode: 'reps', sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }] })
  const plank3 = () => ({ ...plank(), sets: [0, 1, 2].map(() => ({ sec: 10, w: 0, done: false })) })
  const restRunsOut = () => act(() => { vi.advanceTimersByTime(useUI.getState().timer.left * 1000) })

  it('during its rest: the next hold waits for a tap, and the screen stays where you went', () => {
    renderWorkout([plank(), bench()])
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })               // held to the end: its rest starts
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', chain: { i: 1 } })
    act(() => useStore.getState().update(s => { s.active.cur = 1 }))
    restRunsOut()
    expect(useUI.getState().work).toBeNull()
    expect(useStore.getState().S.active.cur).toBe(1)
    expect(doneOf()).toEqual([true, false])
  })

  it('during the hold itself: its rest hands over nothing', () => {
    renderWorkout([plank(), bench()])
    startHold()
    act(() => { vi.advanceTimersByTime(4_000) })
    act(() => useStore.getState().update(s => { s.active.cur = 1 }))
    act(() => { vi.advanceTimersByTime(7_000) })                // held to the end: its rest starts
    expect(doneOf()).toEqual([true, false])
    expect(useUI.getState().timer).toMatchObject({ kind: 'set' })
    expect(useUI.getState().timer.chain).toBeUndefined()
    restRunsOut()
    expect(useUI.getState().work).toBeNull()
    expect(useStore.getState().S.active.cur).toBe(1)
  })

  // Moving or removing exercises shifts the indexes under the marker without anyone going
  // anywhere: the chain carries on.
  it('moving the timed exercise itself up during its rest is not going anywhere', () => {
    renderWorkout([bench(), plank3()], () => { useStore.getState().update(s => { s.wc = { exerciseButtons: true }; s.active.cur = 1 }) })
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })
    act(() => container.querySelector('button[aria-label="Move up"]').click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '0025'])
    restRunsOut()
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 1, id: '1001' } })
  })

  it('nor, in the List layout, moving the exercise the marker is on past it', () => {
    renderWorkout([bench(), plank3()], () => { useStore.getState().update(s => { s.wc = { exerciseButtons: true }; s.active.workoutView = 'list' }) })
    startHold()                                                 // the plank's, with the marker on the bench
    act(() => { vi.advanceTimersByTime(11_000) })
    act(() => container.querySelector('button[aria-label="Move down"]').click())   // the bench, below the plank
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '0025'])
    expect(useStore.getState().S.active.cur).toBe(1)
    restRunsOut()
    expect(useStore.getState().S.active.cur).toBe(1)
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 1, id: '1001' } })
  })

  it('nor removing an exercise above the marker', () => {
    const row = { ...bench(), id: '0652' }
    renderWorkout([row, bench(), plank3()], () => { useStore.getState().update(s => { s.active.workoutView = 'list'; s.active.cur = 1 }) })
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })
    act(() => removeActiveExercise(0))
    expect(useStore.getState().S.active.cur).toBe(0)
    restRunsOut()
    expect(useStore.getState().S.active.cur).toBe(0)
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 1, i: 1, id: '1001' } })
  })

  // Removing the exercise the marker stood on is different: the marker lands on the one after it,
  // and that is another exercise. Nothing chains.
  it('removing the exercise the marker stood on leaves it on another one: the chain stops there', () => {
    const row = { ...bench(), id: '0652' }
    renderWorkout([row, bench(), plank3()], () => { useStore.getState().update(s => { s.active.workoutView = 'list'; s.active.cur = 0 }) })
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })
    act(() => removeActiveExercise(0))
    expect(useStore.getState().S.active.cur).toBe(0)
    restRunsOut()
    expect(useStore.getState().S.active.cur).toBe(0)
    expect(useUI.getState().work).toBeNull()
  })
})

// A reload keeps the chain: a rest is kept with the hold it hands over to (gym_rest), a hold with
// its row (gym_work), and the workout screen acts on both once it is back.
describe('a timed exercise that runs itself, across a reload', () => {
  it('a restored hold still hands its rest the next hold', () => {
    renderWorkout([plank()], () => {
      localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 5_000, total: 10, label: 'Plank', overtime: false, owner: { idx: 0, i: 0, id: '1001' } }))
      expect(restoreWork()).toBe(true)
    })
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(doneOf()).toEqual([true, false])
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', chain: { id: '1001', i: 1, n: 2 } })
  })

  it('in the List layout, a restored hold away from the marker still hands its rest the next hold', () => {
    const bench = { id: '0025', target: { mode: 'reps', sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }] }
    renderWorkout([bench, plank()], () => {
      useStore.getState().update(s => { s.active.workoutView = 'list' })
      localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() + 5_000, total: 10, label: 'Plank', overtime: false, owner: { idx: 1, i: 0, id: '1001' } }))
      expect(restoreWork()).toBe(true)
    })
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', chain: { id: '1001', i: 1, n: 2 } })
    act(() => { vi.advanceTimersByTime(useUI.getState().timer.total * 1000) })
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 1, i: 1, id: '1001' } })
  })

  it('a restored rest still starts the next hold when it runs out', () => {
    const entries = [plank()]
    entries[0].sets[0].done = true
    renderWorkout(entries, () => {
      localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() + 5_000, total: 90, forIdx: 0, forSet: 0, kind: 'set', chain: { id: '1001', i: 1, n: 2, cur: 0 }, paused: false, left: 5 }))
      expect(restoreRest()).toBe(true)
    })
    act(() => { vi.advanceTimersByTime(6_000) })
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 1, id: '1001' } })
  })
})

// The chain names the row it starts next and how many rows the exercise had; rows removed or
// copied during the rest move both, and removing that row takes the chain with it.
describe('a timed exercise that runs itself, and its rows changing during the rest', () => {
  const plank3 = () => ({ ...plank(), sets: [0, 1, 2].map(() => ({ sec: 10, w: 0, done: false })) })
  const restRunsOut = () => act(() => { vi.advanceTimersByTime(useUI.getState().timer.left * 1000) })
  const restAfterFirstHold = () => {
    renderWorkout([plank3()])
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(useUI.getState().timer).toMatchObject({ chain: { i: 1, n: 3 } })
  }

  it('a later row removed: the next hold still starts on its row', () => {
    restAfterFirstHold()
    act(() => { deleteActiveSet(0, 2) })
    expect(useUI.getState().timer.chain).toMatchObject({ i: 1, n: 2 })
    restRunsOut()
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 1 } })
  })

  it('a row copied above it: the next hold starts on its row where it now is', () => {
    restAfterFirstHold()
    act(() => { copyActiveSet(0, 0) })
    expect(useUI.getState().timer.chain).toMatchObject({ i: 2, n: 4 })
    restRunsOut()
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 2 } })
  })

  it('its own row removed: nothing starts', () => {
    restAfterFirstHold()
    act(() => { deleteActiveSet(0, 1) })
    expect(useUI.getState().timer.chain).toBeUndefined()
    restRunsOut()
    expect(useUI.getState().work).toBeNull()
  })
})

// In the Focus view a hold that started itself reports its end the way the tapped one did: the
// view steps to the next set, and after the last hold on to the next exercise, as it does for
// holds started by hand. While a hold runs, the view shows its set.
describe('a timed exercise that runs itself, in the Focus view', () => {
  const plank3 = () => ({ ...plank(), sets: [0, 1, 2].map(() => ({ sec: 10, w: 0, done: false })) })
  const bench = () => ({ id: '0025', target: { mode: 'reps', sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }] })
  const dot = () => [...container.querySelectorAll('.focus-dots button')].findIndex(b => b.classList.contains('active'))
  const restRunsOut = () => act(() => { vi.advanceTimersByTime(useUI.getState().timer.left * 1000) })

  it('steps through its sets and on to the next exercise, as tapped holds do', () => {
    renderWorkout([plank3(), bench()], () => { useStore.getState().update(s => { s.active.workoutView = 'focus' }) })
    startHold()
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(dot()).toBe(1)                                        // the next set, during the rest
    restRunsOut()
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 1 } })
    expect(dot()).toBe(1)                                        // the set being held
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(dot()).toBe(2)
    restRunsOut()
    expect(useUI.getState().work).toMatchObject({ owner: { idx: 0, i: 2 } })
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(doneOf()).toEqual([true, true, true])
    expect(useStore.getState().S.active.cur).toBe(1)             // on to the bench, as v1.4.0 does
  })
})

// The List layout lets a hold run on an exercise the marker is not on. The other layouts show only
// the marker's unit: switched to one during the rest, the next hold would start off screen.
describe('a timed exercise that runs itself, and the layout changing during its rest', () => {
  it('outside the List layout, the next hold waits for a tap unless the marker is on it', () => {
    const bench = { id: '0025', target: { mode: 'reps', sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }] }
    renderWorkout([bench, plank()], () => { useStore.getState().update(s => { s.active.workoutView = 'list' }) })
    startHold()                                                 // the plank's, with the marker on the bench
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(useUI.getState().timer).toMatchObject({ chain: { i: 1 } })
    act(() => useStore.getState().update(s => { s.active.workoutView = 'cards' }))
    act(() => { vi.advanceTimersByTime(useUI.getState().timer.left * 1000) })
    expect(useUI.getState().work).toBeNull()
  })
})

