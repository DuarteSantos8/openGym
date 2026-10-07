// @vitest-environment happy-dom
// Swipe actions on Plan (v1.3.11). The routines list: toward the start deletes with an Undo (no
// confirm), toward the end duplicates. The loop: toward the start takes the routine out, with an
// Undo, and nothing on the other side. Weekday rows do not swipe. The rows stay keyboard buttons.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { closeOpenRow } from '../lib/use-swipe-row.js'
import { restoreRoutine, routineSnapshot, deleteRoutine } from '../lib/routines.js'
import Plan, { deleteRoutineWithUndo, takeOutOfLoop } from './Plan.jsx'
import { chooseFixedWeek, saveRotation, scheduleModeOf } from '../lib/rotation.js'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
const confirmSheet = vi.hoisted(() => vi.fn())
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet,
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const routine = (id, name) => ({ id, name, emoji: null, ex: [{ id: '0025' }] })
let host, root, widthSpy

function mount(view, extra = {}) {
  localStorage.setItem('gym_plan_view', view)
  const S = clone(DEF)
  Object.assign(S, {
    routines: [routine('a', 'Push A'), routine('b', 'Pull A'), routine('c', 'Legs')],
    week: { 1: ['a', 'b'], 3: ['b'], 5: ['c'] }, dayPlan: { '2099-01-01': 'b' },
  }, extra)
  useStore.setState({ S, user: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Plan />))
}
const S = () => useStore.getState().S
const swrows = () => [...host.querySelectorAll('.swrow')]
const rowOf = name => swrows().find(r => r.querySelector('.tt')?.textContent === name)
function pointer(target, type, x, y = 300) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y })
  act(() => { target.dispatchEvent(event) })
}
const click = target => act(() => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
function swipe(target, x0, x1) {
  pointer(target, 'pointerdown', x0)
  pointer(target, 'pointermove', (x0 + x1) / 2)
  pointer(target, 'pointermove', x1)
  pointer(target, 'pointerup', x1)
  click(target)
  act(() => vi.advanceTimersByTime(800))
}
const undo = () => act(() => useUI.getState().runToastAction())

beforeEach(() => {
  vi.useFakeTimers()
  nav.mockClear(); confirmSheet.mockClear()
  document.documentElement.dir = 'ltr'
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  // happy-dom lays nothing out: a phone's width, so the thresholds mean what they do there.
  widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
})
afterEach(() => {
  closeOpenRow(true)
  act(() => root.unmount()); host.remove()
  localStorage.removeItem('gym_plan_view')
  widthSpy.mockRestore()
  vi.clearAllTimers(); vi.useRealTimers()
})

describe('the routines list', () => {
  it('rows stay keyboard buttons that open the routine, with both panes out of reach while shut', () => {
    mount('routines')
    expect(swrows()).toHaveLength(3)
    const r = rowOf('Pull A').querySelector('.item')
    expect(r.getAttribute('role')).toBe('button')
    expect(r.tabIndex).toBe(0)
    act(() => { r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(nav).toHaveBeenLastCalledWith('/plan/r/b')
    click(rowOf('Push A').querySelector('.item'))
    expect(nav).toHaveBeenLastCalledWith('/plan/r/a')
    const panes = rowOf('Push A').querySelectorAll('.swpane')
    expect(panes).toHaveLength(2)
    for (const pane of panes) {
      expect(pane.getAttribute('aria-hidden')).toBe('true')
      expect(pane.hasAttribute('inert')).toBe(true)
      expect(pane.querySelector('button').tabIndex).toBe(-1)
    }
    expect(rowOf('Push A').querySelector('.swpane.cp').textContent).toBe('Duplicate')
  })

  it('a long swipe toward the start deletes without a confirm, and Undo puts everything back', () => {
    mount('routines')
    const before = clone(S())
    swipe(rowOf('Pull A'), 330, 60)
    expect(confirmSheet).not.toHaveBeenCalled()
    expect(S().routines.map(r => r.id)).toEqual(['a', 'c'])
    expect(S().week).toEqual({ 1: ['a'], 5: ['c'] })
    expect(S().dayPlan).toEqual({})
    expect(useUI.getState().toastMsg).toBe('“Pull A” gone.')
    expect(nav).not.toHaveBeenCalled()

    undo()
    // the same routines in the same order, the one put back without an edit time it never had
    // (stamped "now", it beat a rename an older app made offline before the swipe)
    expect(S().routines).toEqual(before.routines)
    expect(S().week).toEqual(before.week)
    expect(S().dayPlan).toEqual(before.dayPlan)
    expect(rowOf('Pull A')).toBeTruthy()
  })

  it('a long swipe toward the end duplicates right below, and stays on the list', () => {
    mount('routines')
    swipe(rowOf('Push A'), 100, 330)
    expect(S().routines.map(r => r.name)).toEqual(['Push A', 'Push A (Copy)', 'Pull A', 'Legs'])
    const copy = S().routines[1]
    expect(copy.id).not.toBe('a')
    expect(copy.ex).toEqual(S().routines[0].ex)
    expect(S().week).toEqual({ 1: ['a', 'b'], 3: ['b'], 5: ['c'] })   // a copy is not planned anywhere
    expect(useUI.getState().toastMsg).toBe('Copied as “Push A (Copy)”.')
    expect(nav).not.toHaveBeenCalled()
  })

  it('the duplicate’s toast has its own Undo, which takes the copy away again', () => {
    mount('routines')
    swipe(rowOf('Push A'), 100, 330)
    expect(S().routines).toHaveLength(4)
    expect(useUI.getState().toastAction).toBeTruthy()
    undo()
    expect(S().routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('an Undo that finds the routine already back says so instead of nothing', () => {
    mount('routines')
    act(() => { deleteRoutineWithUndo('b') })
    const pending = useUI.getState().toastAction
    act(() => useStore.getState().update(s => { s.routines.splice(1, 0, routine('b', 'Pull A')) }))   // a sync brought it back
    act(() => pending.run())
    expect(S().routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(useUI.getState().toastMsg).toBe('It’s already back.')
  })

  it('Edit’s minus deletes the same way, with the Undo in place of the confirm', () => {
    mount('routines')
    click(host.querySelector('.plan-textbtn'))
    click(host.querySelector('button[aria-label="Delete Legs"]'))
    expect(confirmSheet).not.toHaveBeenCalled()
    expect(S().routines.map(r => r.id)).toEqual(['a', 'b'])
    undo()
    expect(S().routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(S().week[5]).toEqual(['c'])
  })

  it('is a plain list with the setting off', () => {
    mount('routines', { wc: { ...DEF.wc, swipeSets: false } })
    expect(swrows()).toHaveLength(0)
    expect(host.querySelectorAll('.item.plan-routine')).toHaveLength(3)
  })
})

describe('the loop', () => {
  const loop = { rotation: { id: 'rot', sequence: ['a', 'b', 'c'], label: 'My loop' },
    queue: { ids: ['a', 'b', 'c'], since: 1, startsOn: '2026-10-01', label: 'My loop', rotationId: 'rot' },
    scheduleMode: 'rotation', week: {}, dayPlan: { '2099-01-01': 'b' } }

  it('a swipe toward the start takes the routine out, and Undo puts the loop and its pin back', () => {
    mount('schedule', clone(loop))
    expect(swrows()).toHaveLength(3)
    // remove-only: no copy pane, and a swipe toward the end does nothing
    expect(rowOf('Pull A').querySelector('.swpane.cp')).toBeNull()
    expect(rowOf('Pull A').querySelector('.swpane.del').textContent).toBe('Remove')
    swipe(rowOf('Pull A'), 60, 330)
    expect(S().queue.ids).toEqual(['a', 'b', 'c'])

    swipe(rowOf('Pull A'), 330, 60)
    expect(S().queue.ids).toEqual(['a', 'c'])
    expect(S().rotation.sequence).toEqual(['a', 'c'])
    expect(S().dayPlan).toEqual({})          // its future pin was swept with it
    expect(S().routines).toHaveLength(3)     // out of the loop, not deleted
    expect(useUI.getState().toastMsg).toBe('“Pull A” is out of the loop.')

    undo()
    expect(S().queue).toEqual(loop.queue)
    expect(S().rotation).toEqual(loop.rotation)
    expect(S().dayPlan).toEqual(loop.dayPlan)
  })

  it('Undo after the loop changed again slots the routine back at its old place', () => {
    mount('schedule', clone(loop))
    swipe(rowOf('Pull A'), 330, 60)
    const pending = useUI.getState().toastAction
    act(() => useStore.getState().update(s => { s.queue = { ...s.queue, ids: ['c', 'a'] }; s.rotation = { ...s.rotation, sequence: ['c', 'a'] } }))
    act(() => pending.run())
    expect(S().queue.ids).toEqual(['c', 'b', 'a'])
    expect(S().rotation.sequence).toEqual(['c', 'b', 'a'])
  })

  // The store's update, the way Plan's editor saves (Plan.jsx setSeq).
  const setSeq = ids => useStore.getState().update(s => {
    if (ids.length) saveRotation(s, ids, 'My loop')
    else { s.queue = null; s.rotation = { ...s.rotation, sequence: [] }; s.scheduleMode = 'rotation' }
  })

  it('Undo after switching to Fixed week puts the routine back in the saved loop and stays on Fixed week', () => {
    mount('schedule', clone(loop))
    act(() => { takeOutOfLoop('b', setSeq, ['a', 'b', 'c'], 'My loop') })
    const pending = useUI.getState().toastAction
    act(() => useStore.getState().update(s => { chooseFixedWeek(s) }))
    act(() => pending.run())
    expect(S().queue).toBeNull()
    expect(scheduleModeOf(S())).toBe('week')
    expect(S().rotation.sequence).toEqual(['a', 'b', 'c'])
  })

  it('the same after taking out the last routine, where the loop itself did not change', () => {
    mount('schedule', { ...clone(loop), rotation: { ...loop.rotation, sequence: ['a'] }, queue: { ...loop.queue, ids: ['a'] } })
    act(() => { takeOutOfLoop('a', setSeq, ['a'], 'My loop') })
    expect(S().queue).toBeNull()
    const pending = useUI.getState().toastAction
    act(() => useStore.getState().update(s => { chooseFixedWeek(s) }))
    act(() => pending.run())
    expect(S().queue).toBeNull()
    expect(scheduleModeOf(S())).toBe('week')
    expect(S().rotation.sequence).toEqual(['a'])
  })

  it('a coach’s queue written meanwhile is left alone by the Undo', () => {
    mount('schedule', clone(loop))
    act(() => { takeOutOfLoop('b', setSeq, ['a', 'b', 'c'], 'My loop') })
    const pending = useUI.getState().toastAction
    const coach = { ids: ['c', 'a'], since: 5, startsOn: '2026-10-02', label: 'Coach' }
    act(() => useStore.getState().update(s => { s.queue = clone(coach) }))
    act(() => pending.run())
    expect(S().queue).toEqual(coach)
    expect(S().rotation.sequence).toEqual(['a', 'b', 'c'])
  })

  it('Undo for a routine deleted meanwhile says it is too late', () => {
    mount('schedule', clone(loop))
    act(() => { takeOutOfLoop('b', setSeq, ['a', 'b', 'c'], 'My loop') })
    const pending = useUI.getState().toastAction
    act(() => useStore.getState().update(s => { deleteRoutine(s, 'b') }))
    act(() => pending.run())
    expect(S().queue.ids).toEqual(['a', 'c'])
    expect(useUI.getState().toastMsg).toBe('Too late, that one’s gone')
  })

  it('the edit-mode minus has the same Undo, and weekday rows never swipe', () => {
    mount('schedule', { ...clone(loop), week: { 1: ['c'], 2: ['a'] } })
    click([...host.querySelectorAll('.plan-textbtn')].find(b => b.textContent === 'Edit'))
    click(host.querySelector('button[aria-label="Remove Legs"]'))
    expect(S().queue.ids).toEqual(['a', 'b'])
    undo()
    expect(S().queue.ids).toEqual(['a', 'b', 'c'])
    act(() => root.unmount()); host.remove()

    mount('schedule', { week: { 1: ['a'], 3: ['b'] } })   // a fixed week
    expect(host.querySelectorAll('.plan-day').length).toBeGreaterThan(0)
    expect(swrows()).toHaveLength(0)
  })

  it('a coach’s own queue does not swipe', () => {
    mount('schedule', { ...clone(loop), queue: { ...loop.queue, rotationId: 'someone-else' } })
    expect(swrows()).toHaveLength(0)
  })
})

describe('restoreRoutine', () => {
  const base = () => ({
    routines: [routine('a', 'A'), routine('b', 'B'), routine('c', 'C')],
    week: { 1: ['a', 'b'], 3: 'b' }, dayPlan: { '2099-01-01': 'b', '2099-01-02': 'a' },
    rotation: { id: 'r', sequence: ['b', 'c'] }, queue: { ids: ['c', 'b'] },
  })

  it('puts back what deleteRoutine took, at the same places', () => {
    const s = base()
    const snap = routineSnapshot(s, 'b')
    deleteRoutine(s, 'b')
    s.rotation.sequence = ['c']; s.queue.ids = ['c']           // a save in between dropped it too
    expect(restoreRoutine(s, snap)).toBe(true)
    expect(s.routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(s.week).toEqual({ 1: ['a', 'b'], 3: ['b'] })
    expect(s.dayPlan).toEqual(base().dayPlan)
    expect(s.rotation.sequence).toEqual(['b', 'c'])
    expect(s.queue.ids).toEqual(['c', 'b'])
  })

  it('fits into lists that got shorter, keeps a date planned since, and never doubles a routine', () => {
    const s = base()
    const snap = routineSnapshot(s, 'b')
    deleteRoutine(s, 'b')
    s.routines = [s.routines[1]]          // A deleted meanwhile
    delete s.week[1]
    s.dayPlan['2099-01-01'] = 'c'
    expect(restoreRoutine(s, snap)).toBe(true)
    expect(s.routines.map(r => r.id)).toEqual(['c', 'b'])
    expect(s.week[1]).toEqual(['b'])
    expect(s.dayPlan['2099-01-01']).toBe('c')
    expect(restoreRoutine(s, snap)).toBe(false)
    expect(s.routines.map(r => r.id)).toEqual(['c', 'b'])
  })
})
