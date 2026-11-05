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
import Plan, { deleteRoutineWithUndo } from './Plan.jsx'

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

// happy-dom 20.12+ runs Element.animate on its own clock, which fake timers do not move, so the
// row's collapse never finished: end each animation on the faked clock instead.
const fakeAnimate = () => vi.spyOn(Element.prototype, 'animate').mockImplementation(function (_, o) {
  const a = { onfinish: null, cancel: () => clearTimeout(t) }
  const t = setTimeout(() => a.onfinish?.(), o?.duration || 0)
  return a
})

beforeEach(() => {
  vi.useFakeTimers()
  fakeAnimate()
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
  vi.mocked(Element.prototype.animate).mockRestore?.()
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

describe('restoreRoutine', () => {
  const base = () => ({
    routines: [routine('a', 'A'), routine('b', 'B'), routine('c', 'C')],
    week: { 1: ['a', 'b'], 3: 'b' }, dayPlan: { '2099-01-01': 'b', '2099-01-02': 'a' },
    queue: { ids: ['c', 'b'] },
  })

  it('puts back what deleteRoutine took, at the same places', () => {
    const s = base()
    const snap = routineSnapshot(s, 'b')
    deleteRoutine(s, 'b')
    s.queue.ids = ['c']           // a save in between dropped it too
    expect(restoreRoutine(s, snap)).toBe(true)
    expect(s.routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(s.week).toEqual({ 1: ['a', 'b'], 3: ['b'] })
    expect(s.dayPlan).toEqual(base().dayPlan)
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
