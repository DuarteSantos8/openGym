// @vitest-environment happy-dom
// Editing when a saved workout happened (#218). The sets are the record and are never touched;
// what moves is where the session sits in history — which is also what the PR badges and the
// legacy sync key depend on, so both are checked from the sheet, not just from the helper.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDateSheet, workoutDetailSheet, workoutDurationSheet } from './sheets.jsx'
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

const entry = (id, w) => ({ exerciseId: id, performance: { sets: [{ role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: w } }] } })
const workout = (id, d, time, min, exposures, prs = []) => {
  const start = backfillStart(d, time)
  return { id, d, start, end: start + min * 60000, name: id, vol: 100, exposures, prs }
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
    expect(moved.exposures).toEqual([entry('bench', 90)])
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

  // At 01:42, today at 23:30 passed the date check and filed the session 22 hours ahead.
  it('refuses a time today that has not happened yet, counting the length it keeps', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 26, 1, 42))
    try {
      const before = history()
      const host = render(() => workoutDateSheet(before[1]))   // 47 minutes long
      act(() => { type(host.querySelector('input[type=date]'), '2026-08-26') })
      for (const time of ['23:30', '01:00']) {
        act(() => { type(host.querySelector('input[type=time]'), time) })
        act(() => { button(host, 'Save').click() })
        expect(history(), time).toEqual(before)
        expect(useUI.getState().toast).toHaveBeenLastCalledWith('That’s still in the future. Try an earlier start.')
      }
      act(() => { type(host.querySelector('input[type=time]'), '00:50') })
      act(() => { button(host, 'Save').click() })
      expect(history().find(w => w.id === 'late').d).toBe('2026-08-26')
    } finally { vi.useRealTimers() }
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
    const legacy = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'Old', vol: 0, exposures: [], prs: [] }
    setHistory([legacy])
    const host = render(() => workoutDateSheet(legacy))
    act(() => { type(host.querySelector('input[type=date]'), '2026-08-18') })
    act(() => { button(host, 'Save').click() })
    expect(history()).toHaveLength(1)
    expect(history()[0].id).toBe('2026-08-25|1767636000000')
    expect(history()[0].d).toBe('2026-08-18')
  })

  // The sheet keeps the copy it opened with. A sync that brings in the same record with its old
  // key frozen as its id (moved or edited on the other device) must not make its note and date
  // rows quietly write nowhere.
  it('keeps writing to a record from before ids after a sync froze its key as its id', () => {
    const legacy = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'Old', vol: 0, exposures: [], prs: [] }
    setHistory([legacy])
    const host = render(() => workoutDetailSheet(legacy))
    setHistory([{ ...legacy, id: '2026-08-25|1767636000000', d: '2026-08-24', _ts: 5 }])
    act(() => { type(host.querySelector('textarea'), 'felt strong') })
    act(() => { host.querySelector('textarea').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(history()).toHaveLength(1)
    expect(history()[0].note).toBe('felt strong')
  })

  it('deletes only the workout it shows, also among records written before ids', () => {
    const a = { d: '2026-08-20', start: 1767200000000, end: 1767203600000, name: 'A', vol: 0, exposures: [], prs: [] }
    const b = { d: '2026-08-25', start: 1767636000000, end: 1767639600000, name: 'B', vol: 0, exposures: [], prs: [] }
    setHistory([a, b, history()[1]])
    const host = render(() => workoutDetailSheet(b))
    const confirm = render(() => button(host, 'Delete workout').click())
    act(() => { button(confirm, 'Delete').click() })
    expect(history().map(w => w.name)).toEqual(['A', 'late'])
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

// People forget to end a workout (Discord): a 47-minute session saved as five hours. The detail
// sheet corrects the length; the start, the day, the sets and the badges stay.
describe('changing the duration of a saved workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [], toast: vi.fn() })
    document.body.innerHTML = ''
    setHistory([
      workout('early', '2026-08-20', '18:00', 60, [entry('bench', 80)], ['bench']),
      workout('forgot', '2026-08-25', '07:30', 300, [entry('bench', 90)], ['bench']),
    ])
  })
  afterEach(unmountAll)

  it('is offered from the workout detail sheet and opens at the length it has', () => {
    const host = render(() => workoutDetailSheet(history()[1]))
    const open = button(host, 'Change duration')
    expect(open).toBeTruthy()
    const edit = render(() => open.click())
    expect(edit.querySelector('h3').textContent).toBe('Change duration')
    expect(edit.querySelector('input.num').value).toBe('300')
  })

  it('shortens the session from its start and leaves everything else as it was', () => {
    const before = history()[1]
    const host = render(() => workoutDurationSheet(before))
    act(() => { type(host.querySelector('input.num'), '50') })
    act(() => { host.querySelector('button[aria-label="Decrease"]').click() })
    act(() => { button(host, 'Save').click() })

    const after = history()[1]
    expect(after.end - after.start).toBe(45 * 60000)
    expect(after.start).toBe(before.start)
    expect(after.d).toBe(before.d)
    expect(after.exposures).toEqual(before.exposures)
    expect(after.prs).toEqual(['bench'])
    expect(after._ts).toBeGreaterThan(0)   // stamped: the sync keeps it over an older copy
    expect(history().map(w => w.id)).toEqual(['early', 'forgot'])
    expect(useUI.getState().toast).toHaveBeenCalledWith('Duration changed')
  })

  // The minimum of a minute used to apply on every keystroke: emptying the field put a 1 back
  // at once, and the 75 typed after it read 175 — saved as 2h 55m without a word.
  it('lets the field be emptied to type a new length, and saves what was typed', () => {
    const host = render(() => workoutDurationSheet(history()[1]))
    const field = host.querySelector('input.num')
    act(() => { type(field, '3') })
    act(() => { type(field, '') })
    expect(field.value).toBe('')
    act(() => { type(field, '75') })
    expect(field.value).toBe('75')
    act(() => { button(host, 'Save').click() })
    const after = history()[1]
    expect(after.end - after.start).toBe(75 * 60000)
  })

  // QA 1.3.9: a cleared field was put back to 1 as it lost focus to Save, and the session saved as
  // one minute long without a word. It is refused now, with the reason, and the length is kept.
  it('refuses a field left empty or at 0, says why, and keeps the saved length', () => {
    const before = history()[1]
    const host = render(() => workoutDurationSheet(before))
    const field = host.querySelector('input.num')
    for (const typed of ['', '0']) {
      act(() => { type(field, typed) })
      act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
      expect(field.value === '' || field.value === '0', typed).toBe(true)
      expect(host.textContent).toContain('Enter how long it took (at least 1 minute).')
      act(() => { button(host, 'Save').click() })
      expect(history()[1]).toEqual(before)
      expect(useUI.getState().toast).toHaveBeenLastCalledWith('Enter how long it took (at least 1 minute).')
    }
    act(() => { type(field, '40') })
    expect(host.textContent).not.toContain('at least 1 minute')
    act(() => { button(host, 'Save').click() })
    expect(history()[1].end - history()[1].start).toBe(40 * 60000)
  })

  // 99999 minutes saved as '1666h 39m', ending weeks from now.
  it('refuses more than a day, says why under the field, and keeps the saved length', () => {
    const before = history()[1]
    const host = render(() => workoutDurationSheet(before))
    const field = host.querySelector('input.num')
    act(() => { type(field, '99999') })
    expect(host.textContent).toContain('That’s more than a day. Keep it to 24 hours or less.')
    act(() => { button(host, 'Save').click() })
    expect(history()[1]).toEqual(before)
    expect(useUI.getState().toast).toHaveBeenLastCalledWith('That’s more than a day. Keep it to 24 hours or less.')
    act(() => { type(field, '1440') })
    expect(host.textContent).not.toContain('more than a day')
    act(() => { button(host, 'Save').click() })
    expect(history()[1].end - history()[1].start).toBe(1440 * 60000)
  })

  it('saving the same length closes and touches nothing', () => {
    const before = history()
    const host = render(() => workoutDurationSheet(before[1]))
    act(() => { button(host, 'Save').click() })
    expect(history()).toEqual(before)
    expect(useUI.getState().toast).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('keeps a note typed in the detail sheet but never blurred', () => {
    const host = render(() => workoutDetailSheet(history()[1]))
    act(() => { type(host.querySelector('textarea'), 'forgot to stop') })
    const edit = render(() => button(host, 'Change duration').click())
    act(() => { type(edit.querySelector('input.num'), '60') })
    act(() => { button(edit, 'Save').click() })
    unmountAll()
    const saved = history().find(w => w.id === 'forgot')
    expect(saved.note).toBe('forgot to stop')
    expect(saved.end - saved.start).toBe(60 * 60000)
  })
})
