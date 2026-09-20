// @vitest-environment happy-dom
// Editing when a saved workout happened (#218). The sets are the record and are never touched;
// what moves is where the session sits in history — which is also what the PR badges and the
// legacy sync key depend on, so both are checked from the sheet, not just from the helper.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDateSheet, workoutDetailSheet } from './sheets.jsx'
import { backfillStart } from './lib/backfill.js'
import { startTimeOf } from './lib/workout-date.js'

const mounted = []
function render(open) {
  open()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const unmountAll = () => act(() => { mounted.splice(0).forEach(r => r.unmount()) })

const entry = (id, w) => ({ id, sets: [{ w, r: 5, done: true }] })
const workout = (id, d, time, min, entries, prs = []) => {
  const start = backfillStart(d, time)
  return { id, d, start, end: start + min * 60000, name: id, vol: 100, entries, prs }
}
const history = () => useStore.getState().S.workouts
const setHistory = workouts => useStore.setState(s => ({ S: { ...s.S, workouts } }))

describe('changing the date of a saved workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toast: vi.fn() })
    document.body.innerHTML = ''
    setHistory([
      workout('early', '2026-08-20', '18:00', 60, [entry('bench', 80)], ['bench']),
      workout('late', '2026-08-25', '07:30', 47, [entry('bench', 90)], ['bench']),
    ])
  })
  afterEach(unmountAll)

  it('is offered from the workout detail sheet and opens prefilled', () => {
    const host = render(() => workoutDetailSheet(history()[1]))
    const open = button(host, 'Change date & time')
    expect(open).toBeTruthy()
    const edit = render(() => open.click())
    expect(edit.querySelector('h3').textContent).toBe('Change date & time')
    expect(edit.querySelector('input[type=date]').value).toBe('2026-08-25')
    expect(edit.querySelector('input[type=time]').value).toBe('07:30')
  })

  it('moves the session, keeps the length it had and re-files it in date order', () => {
    const host = render(() => workoutDateSheet(history()[1]))
    act(() => { type(host.querySelector('input[type=date]'), '2026-08-18') })
    act(() => { type(host.querySelector('input[type=time]'), '06:15') })
    act(() => { button(host, 'Save').click() })

    expect(history().map(w => w.id)).toEqual(['late', 'early'])
    const moved = history()[0]
    expect(moved.d).toBe('2026-08-18')
    expect(startTimeOf(moved)).toBe('06:15')
    expect(moved.end - moved.start).toBe(47 * 60000)
    expect(moved.entries).toEqual([entry('bench', 90)])
    expect(useUI.getState().toast).toHaveBeenCalledWith('Workout moved')
  })

  it('rebuilds the PR badges the new order implies', () => {
    // 90 kg was logged second, so 80 kg held the badge too. Moved first, the 80 kg session
    // is no longer a record and the 90 kg one is.
    const host = render(() => workoutDateSheet(history()[1]))
    act(() => { type(host.querySelector('input[type=date]'), '2026-08-18') })
    act(() => { button(host, 'Save').click() })
    expect(history().map(w => [w.id, w.prs])).toEqual([['late', ['bench']], ['early', []]])
  })

  it('refuses a day in the future and leaves history alone', () => {
    const before = history()
    const host = render(() => workoutDateSheet(before[1]))
    act(() => { type(host.querySelector('input[type=date]'), '2099-01-01') })
    act(() => { button(host, 'Save').click() })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).toHaveBeenCalledWith('Pick a day up to today')
    expect(useUI.getState().sheets).toHaveLength(1)   // still open to correct the date
  })

  it('an empty date is refused rather than moving the workout to nowhere', () => {
    const before = history()
    const host = render(() => workoutDateSheet(before[1]))
    act(() => { type(host.querySelector('input[type=date]'), '') })
    act(() => { button(host, 'Save').click() })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).toHaveBeenCalledWith('Pick a day up to today')
  })

  it('saving without changing anything closes and touches nothing', () => {
    const before = history()
    const host = render(() => workoutDateSheet(before[1]))
    act(() => { button(host, 'Save').click() })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('leaves a second workout on the same day in start-time order', () => {
    const host = render(() => workoutDateSheet(history()[1]))
    act(() => { type(host.querySelector('input[type=date]'), '2026-08-20') })
    act(() => { type(host.querySelector('input[type=time]'), '21:00') })
    act(() => { button(host, 'Save').click() })
    expect(history().map(w => w.id)).toEqual(['early', 'late'])
    expect(history()).toHaveLength(2)
  })

  // The note field only writes on blur, and moving a legacy record re-keys it — so a note
  // typed and left focused has to be flushed before the move, not after it.
  it('keeps a note typed but never blurred', () => {
    const host = render(() => workoutDetailSheet(history()[1]))
    act(() => { type(host.querySelector('textarea'), 'felt strong') })
    const edit = render(() => button(host, 'Change date & time').click())
    act(() => { type(edit.querySelector('input[type=date]'), '2026-08-18') })
    act(() => { button(edit, 'Save').click() })
    unmountAll()
    expect(history().find(w => w.id === 'late').note).toBe('felt strong')
  })

  it('a record written before ids keeps one identity for sync', () => {
    const legacy = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'Old', vol: 0, entries: [], prs: [] }
    setHistory([legacy])
    const host = render(() => workoutDateSheet(legacy))
    act(() => { type(host.querySelector('input[type=date]'), '2026-08-18') })
    act(() => { button(host, 'Save').click() })
    expect(history()).toHaveLength(1)
    expect(history()[0].id).toBe('2026-08-25|1767636000000')
    expect(history()[0].d).toBe('2026-08-18')
  })

  it('does nothing when the workout was deleted from another sheet meanwhile', () => {
    const host = render(() => workoutDateSheet(history()[1]))
    setHistory([history()[0]])
    act(() => { type(host.querySelector('input[type=date]'), '2026-08-18') })
    act(() => { button(host, 'Save').click() })
    expect(history().map(w => w.id)).toEqual(['early'])
    expect(useUI.getState().toast).not.toHaveBeenCalledWith('Workout moved')
  })
})
