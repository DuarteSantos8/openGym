// @vitest-environment happy-dom
// Issue #142: routines were stuck in the order they were created. `S.routines` is the single
// order every screen reads — Plan, the Start screen, the day-assignment sheets — so moving one
// here moves it everywhere. Since v1.3.11 the order changes in the Routines view's Edit mode,
// like on an iPhone: a handle to drag (or to move with the arrow keys) and a red minus that
// deletes behind a confirmation. No ▲▼ on every row any more.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Plan from './Plan.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))

import { confirmSheet } from '../sheets.jsx'

const routine = (id, name) => ({ id, name, emoji: null, ex: [{ id: '0025' }] })
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('gym_plan_view', 'routines')
  confirmSheet.mockClear(); nav.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [routine('a', 'Push A'), routine('b', 'Pull A'), routine('c', 'Legs A')], week: { 1: ['b'] }, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.removeItem('gym_plan_view') })

const mount = () => act(() => root.render(<Plan />))
const rows = () => [...host.querySelectorAll('.plan-routines .plan-routine')]
const names = () => rows().map(e => e.querySelector('.tt').textContent)
const stored = () => useStore.getState().S.routines.map(r => r.name)
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const handles = () => [...host.querySelectorAll('[data-reorder-handle]')]
const edit = () => click(button('Edit'))
// happy-dom lays nothing out: give the rows 60px each, 68px apart (an 8px gap).
const layOut = () => rows().forEach((row, i) => {
  row.getBoundingClientRect = () => ({ top: i * 68, bottom: i * 68 + 60, height: 60, left: 0, right: 300, width: 300 })
})
const pointer = (el, type, y) => act(() => { el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientY: y })) })

describe('routine order', () => {
  it('shows no move buttons outside Edit, and the days a routine is on', () => {
    mount()
    expect(names()).toEqual(['Push A', 'Pull A', 'Legs A'])
    expect(host.querySelector('button[aria-label="Move up"]')).toBe(null)
    expect(host.querySelector('button[aria-label="Move down"]')).toBe(null)
    expect(handles()).toEqual([])
    expect(rows()[1].querySelector('.ss').textContent).toBe('1 exercise · Mo')
  })

  it('Edit shows a handle and a delete button per row; tapping a row then opens nothing', () => {
    mount()
    edit()
    expect(handles().length).toBe(3)
    // each named for its routine, so a screen reader can tell three of them apart
    expect([...host.querySelectorAll('.plan-minus')].map(b => b.getAttribute('aria-label'))).toEqual(['Delete Push A', 'Delete Pull A', 'Delete Legs A'])
    expect(handles().map(b => b.getAttribute('aria-label'))).toEqual(['Move Push A', 'Move Pull A', 'Move Legs A'])
    expect(host.textContent).toContain('Drag to reorder. Tap the minus to delete.')
    click(rows()[0])
    expect(nav).not.toHaveBeenCalled()
    click(button('Done'))
    expect(handles()).toEqual([])
  })

  it('moves a routine with the arrow keys on its handle, and the stored order follows', () => {
    mount()
    edit()
    act(() => { handles()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(stored()).toEqual(['Pull A', 'Push A', 'Legs A'])
    expect(names()).toEqual(['Pull A', 'Push A', 'Legs A'])
    // the ends cannot go further
    act(() => { handles()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    act(() => { handles()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(stored()).toEqual(['Pull A', 'Push A', 'Legs A'])
  })

  it('drags a routine by its handle to a new place', () => {
    mount()
    edit()
    layOut()
    const h = handles()[0]
    pointer(h, 'pointerdown', 30)
    pointer(h, 'pointermove', 100)
    // while held, the row follows and the one it passed slides up into the gap
    expect(rows()[0].style.transform).toBe('translateY(70px)')
    expect(rows()[1].style.transform).toBe('translateY(-68px)')
    pointer(h, 'pointermove', 170)
    pointer(h, 'pointerup', 170)
    expect(stored()).toEqual(['Pull A', 'Legs A', 'Push A'])
    expect(rows()[0].style.transform).toBe('')
  })

  it('a drag that ends where it started changes nothing, and a cancelled one neither', () => {
    mount()
    edit()
    layOut()
    const h = handles()[1]
    pointer(h, 'pointerdown', 98)
    pointer(h, 'pointermove', 110)
    pointer(h, 'pointerup', 110)
    expect(stored()).toEqual(['Push A', 'Pull A', 'Legs A'])
    pointer(h, 'pointerdown', 98)
    pointer(h, 'pointermove', 200)
    pointer(h, 'pointercancel', 200)
    expect(stored()).toEqual(['Push A', 'Pull A', 'Legs A'])
  })

  // v1.3.11: an Undo in place of the confirmation, the same as the row's swipe (Plan.swipe.test.jsx).
  it('the red minus deletes at once, routine, days and all, and Undo puts it all back', () => {
    mount()
    edit()
    const week = useStore.getState().S.week
    click(rows()[1].querySelector('button[aria-label="Delete Pull A"]'))
    expect(confirmSheet).not.toHaveBeenCalled()
    expect(stored()).toEqual(['Push A', 'Legs A'])
    expect(useStore.getState().S.week).toEqual({})
    expect(useUI.getState().toastMsg).toBe('“Pull A” gone.')
    act(() => useUI.getState().runToastAction())
    expect(stored()).toEqual(['Push A', 'Pull A', 'Legs A'])
    expect(useStore.getState().S.week).toEqual(week)
  })

  it('leaves the handle out when there is nothing to reorder', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [routine('a', 'Only one')] } }))
    mount()
    edit()
    expect(handles()).toEqual([])
    expect(host.querySelector('.plan-minus')).toBeTruthy()
  })

  it('New routine sits at the top and opens the editor on the new routine', () => {
    mount()
    const add = button('New routine')
    expect(add.compareDocumentPosition(rows()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    click(add)
    const created = useStore.getState().S.routines.at(-1)
    expect(created.name).toBe('New routine')
    expect(nav).toHaveBeenCalledWith('/plan/r/' + created.id)
  })
})
