// @vitest-environment happy-dom
// Hardware keys on the workout screen (issue #133), against the real store and timers: what a
// key press does to the session, not only what lib/workout-keys.js decides.
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import TabBar from '../components/TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/', webauthnOK: () => false }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, done, extra = {}) => ({
  id,
  target: { sets: done.length, reps: 5, weight: 60 },
  sets: done.map(d => ({ w: 60, r: 5, done: d })),
  ...extra,
})

let root
let container

function WorkoutWithAction() {
  const [action, setAction] = useState(null)
  return <><Workout onActionChange={setAction} /><TabBar workoutAction={action} onStart={() => {}} /></>
}

function renderWorkout(entries, cur = 0, extra = {}, withAction = false) {
  const S = clone(DEF)
  S.active = { id: 'keys-test', d: '2026-09-23', start: Date.now(), routineId: null, name: 'Keys', bw: null, cur, entries, ...extra }
  useStore.setState({ S, user: null })
  if (withAction) localStorage.setItem('gym_guest', '1')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={['/workout']}>{withAction ? <WorkoutWithAction /> : <Workout />}</MemoryRouter>))
}

const press = (key, target = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => { target.dispatchEvent(event) })
  return event
}
const active = () => useStore.getState().S.active
const doneOf = idx => active().entries[idx].sets.map(s => s.done)

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null
  container = null
})

describe('the persistent workout action', () => {
  const button = () => container.querySelector('#tabbar .start')
  const tap = () => act(() => button().click())

  it.each(['cards', 'list', 'compact', 'focus'])('completes a set and offers Next without logging unseen work in %s', workoutView => {
    renderWorkout([entry('1001', [false]), entry('1002', [false])], 0, { workoutView }, true)
    expect(button().getAttribute('aria-label')).toBe('Complete set')
    tap()
    expect(doneOf(0)).toEqual([true])
    expect(useUI.getState().timer).not.toBeNull()
    expect(button().textContent).toBe('Next')
    tap()
    expect(active().cur).toBe(1)
    expect(active().workoutView).toBe(workoutView)
    expect(doneOf(1)).toEqual([false])
    tap()
    expect(doneOf(1)).toEqual([true])
    expect(button().textContent).toBe('Finish')
    // The set completion sheet may already be open; dismiss it before reopening Finish.
    act(() => useUI.setState({ sheets: [] }))
    tap()
    expect(useUI.getState().sheets.length).toBeGreaterThan(0)
    expect(active()).not.toBeNull()
  })

  it('starts a hold, ignores a bouncing tap, then logs the actual held duration', () => {
    const plank = { id: '1001', target: { mode: 'time', sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    renderWorkout([plank, entry('1002', [false])], 0, {}, true)
    expect(button().textContent).toBe('Start')
    tap()
    expect(button().textContent).toBe('Done')
    tap()
    expect(doneOf(0)).toEqual([false])
    act(() => vi.advanceTimersByTime(10_000))
    tap()
    expect(active().entries[0].sets[0].sec).toBe(10)
    expect(doneOf(0)).toEqual([true])
    expect(button().textContent).toBe('Next')
  })

  it.each(['cards', 'list', 'compact', 'focus'])('logs cardio without starting a hold in %s', workoutView => {
    const row = { min: 20, speed: 6, incline: 8, done: false }
    renderWorkout([{ id: '3666', target: { mode: 'cardio' }, sets: [row] }, entry('1002', [false])], 0, { workoutView }, true)
    expect(button().textContent).toBe('Complete')
    tap()
    expect(active().entries[0].sets[0]).toMatchObject({ ...row, done: true })
    expect(useUI.getState().work).toBeNull()
    expect(button().textContent).toBe('Next')
    tap()
    expect(active().cur).toBe(1)
    expect(doneOf(1)).toEqual([false])
  })

  it.each(['cards', 'list', 'compact', 'focus'])('times both sides with switch and full rest in %s', workoutView => {
    renderWorkout([{ id: '1001', target: { mode: 'time', sets: 1, sec: 10, side: true }, sets: [
      { sec: 10, w: 0, done: false, side: 'L' }, { sec: 10, w: 0, done: false, side: 'R' },
    ] }, entry('1002', [false])], 0, { workoutView }, true)
    tap()
    act(() => vi.advanceTimersByTime(11_000))
    expect(doneOf(0)).toEqual([true, false])
    expect(useUI.getState().timer).toMatchObject({ kind: 'switch', total: 10 })
    expect(button().textContent).toBe('Start')
    tap()
    act(() => vi.advanceTimersByTime(4_000))
    tap()
    expect(doneOf(0)).toEqual([true, true])
    expect(active().entries[0].sets.map(s => s.sec)).toEqual([10, 4])
    expect(useUI.getState().timer.total).toBe(useStore.getState().S.restSec)
    expect(useUI.getState().timer.kind).toBeUndefined()
    expect(button().textContent).toBe('Next')
  })

  it.each([
    { phase: 'warmup', warmup: true },
    { type: 'dropset', drops: [{ w: 40, r: 6 }, { w: 30, r: 5 }] },
    { type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 2, restSec: 15 }] },
  ])('completes a specialised rep row without changing its details: %j', details => {
    const row = { w: 60, r: 12, done: false, ...details }
    renderWorkout([entry('1001', [], { sets: [row, { w: 60, r: 5, done: false }] })], 0, {}, true)
    tap()
    expect(active().entries[0].sets[0]).toMatchObject({ ...row, done: true })
    expect(doneOf(0)).toEqual([true, false])
    expect(button().textContent).toBe('Complete')
  })

  it('keeps a superset in round order', () => {
    renderWorkout([entry('1001', [false, false], { sg: 'pair' }), entry('1002', [false, false], { sg: 'pair' })], 0, {}, true)
    tap()
    expect(active().cur).toBe(1)
    tap()
    expect(active().cur).toBe(0)
    expect(doneOf(0)).toEqual([true, false])
    expect(doneOf(1)).toEqual([true, false])
  })

  it('reveals the next unfinished Focus set before completing when another set is being inspected', () => {
    renderWorkout([entry('1001', [false, false, false])], 0, { workoutView: 'focus' }, true)
    act(() => container.querySelector('button[aria-label="Set 3"]').click())
    expect(button().textContent).toBe('Next')
    tap()
    expect(doneOf(0)).toEqual([false, false, false])
    expect(active().workoutView).toBe('focus')
    expect(button().getAttribute('aria-label')).toBe('Complete set')
    tap()
    expect(doneOf(0)).toEqual([true, false, false])
  })

  it('names and completes each side separately', () => {
    renderWorkout([entry('1001', [], { sets: [{ done: false, sides: {
      L: { w: 10, r: 5, done: false }, R: { w: 10, r: 5, done: false },
    } }] }), entry('1002', [false])], 0, {}, true)
    expect(button().textContent).toBe('Complete left side')
    tap()
    expect(doneOf(0)).toEqual([false])
    expect(button().textContent).toBe('Complete right side')
    tap()
    expect(doneOf(0)).toEqual([true])
  })

  it('does not complete behind a sheet or double-log when a keyboard shortcut is used', () => {
    renderWorkout([entry('1001', [false, false, false])], 0, {}, true)
    act(() => useUI.getState().openSheet(() => null))
    tap()
    expect(doneOf(0)).toEqual([false, false, false])
    act(() => useUI.setState({ sheets: [] }))
    expect(press('Enter', button()).defaultPrevented).toBe(true)
    expect(doneOf(0)).toEqual([true, false, false])
  })

  it.each([{ editingWorkoutId: 'saved' }, { backfill: true }])('leaves historical workout controls unchanged: %j', flags => {
    renderWorkout([entry('1001', [false])], 0, flags, true)
    expect(button().textContent).toBe('Workout')
    tap()
    expect(doneOf(0)).toEqual([false])
  })

  it('leaves an empty workout as navigation', () => {
    renderWorkout([], 0, {}, true)
    expect(button().textContent).toBe('Workout')
  })
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('workout keys (issue #133)', () => {
  it('Space ticks the next open set of the current exercise and starts its rest', () => {
    renderWorkout([entry('1001', [true, false, false]), entry('1002', [false])])
    const event = press(' ')
    expect(event.defaultPrevented).toBe(true)   // the page does not scroll as well
    expect(doneOf(0)).toEqual([true, true, false])
    expect(useUI.getState().timer).not.toBeNull()
    press('Enter')
    expect(doneOf(0)).toEqual([true, true, true])
  })

  it('Space and Enter tick Focus sets through the same handler', () => {
    renderWorkout([entry('1001', [false, false])], 0, { workoutView: 'focus' })
    expect(container.querySelector('[data-testid="focus-view"]')).toBeTruthy()
    press(' ')
    press('Enter')
    expect(doneOf(0)).toEqual([true, true])
  })

  it('once the exercise on screen is finished, a press brings up the next one and the next press ticks it', () => {
    renderWorkout([entry('1001', [true]), entry('1002', [false, false])])
    press(' ')
    expect(active().cur).toBe(1)
    expect(doneOf(1)).toEqual([false, false])
    press(' ')
    expect(doneOf(1)).toEqual([true, false])
  })

  it('the arrows switch exercise', () => {
    renderWorkout([entry('1001', [false]), entry('1002', [false]), entry('1003', [false])])
    press('ArrowRight')
    expect(active().cur).toBe(1)
    press('ArrowRight')
    expect(active().cur).toBe(2)
    press('ArrowRight')
    expect(active().cur).toBe(2)
    press('ArrowLeft')
    expect(active().cur).toBe(1)
    expect(doneOf(0).concat(doneOf(1), doneOf(2))).toEqual([false, false, false])
  })

  it('in the list, an arrow that moves the current exercise brings it into view', () => {
    const scrolled = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { scrolled.push(this) }
    try {
      renderWorkout([entry('1001', [false]), entry('1002', [false])], 0, { workoutView: 'list' })
      act(() => { vi.advanceTimersByTime(100) })
      scrolled.length = 0
      press('ArrowRight')
      act(() => { vi.advanceTimersByTime(100) })
      expect(active().cur).toBe(1)
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0].classList.contains('cur')).toBe(true)
      expect(scrolled[0].getAttribute('data-exidx')).toBe('1')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('keys typed into a set\'s field stay in the field', () => {
    renderWorkout([entry('1001', [false, false]), entry('1002', [false])])
    const input = container.querySelector('.setrow input')
    expect(input).toBeTruthy()
    input.focus()
    for (const key of [' ', 'Enter', 'ArrowRight']) expect(press(key, input).defaultPrevented).toBe(false)
    expect(doneOf(0)).toEqual([false, false])
    expect(active().cur).toBe(0)
  })

  it('does nothing while a sheet is open on top', () => {
    renderWorkout([entry('1001', [false]), entry('1002', [false])])
    useUI.getState().openSheet(() => null)
    press(' ')
    press('ArrowRight')
    expect(doneOf(0)).toEqual([false])
    expect(active().cur).toBe(0)
  })

  it('a timed set is started rather than ticked, and the next press is its Done', () => {
    const plank = { id: '1001', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    renderWorkout([plank])
    press(' ')
    expect(useUI.getState().work).not.toBeNull()
    expect(doneOf(0)).toEqual([false])
    act(() => { vi.advanceTimersByTime(10_000) })
    press(' ')
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(0)).toEqual([true])
    expect(active().entries[0].sets[0].sec).toBe(10)
  })

  it('a second press right after it starts a hold does not log the hold at a second', () => {
    // A USB button that bounces, or a double press.
    const plank = { id: '1001', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    renderWorkout([plank])
    press(' ')
    act(() => { vi.advanceTimersByTime(200) })
    const second = press(' ')
    expect(second.defaultPrevented).toBe(true)   // still the workout's key, it just does nothing
    expect(useUI.getState().work).not.toBeNull()
    expect(doneOf(0)).toEqual([false])
    act(() => { vi.advanceTimersByTime(2_000) })
    press(' ')
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(0)).toEqual([true])
    expect(active().entries[0].sets[0].sec).toBe(2)
  })

  it('stops listening when the workout screen goes away', () => {
    renderWorkout([entry('1001', [false])])
    act(() => root.unmount())
    root = null
    press(' ')
    expect(doneOf(0)).toEqual([false])
  })
})
