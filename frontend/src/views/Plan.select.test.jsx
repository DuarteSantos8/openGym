// @vitest-environment happy-dom
// Plan → Routines, Edit with select (docs/dev/ROUTINE_FOLDERS.md): the groups stay, each routine
// has a check circle and a grip, folders have a grip, and a bar offers Archive, Move to folder and
// Delete for what is selected. Share is hidden while editing.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Plan from './Plan.jsx'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))
import { confirmSheet, menuSheet } from '../sheets.jsx'

const routine = (id, name, extra) => ({ id, name, emoji: null, ex: [{ id: '0025' }], ...extra })
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('gym_plan_view', 'routines')
  nav.mockClear(); confirmSheet.mockClear(); menuSheet.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { folder: 'Block 2' }), routine('b', 'Mobility'), routine('c', 'Old legs', { folder: 'Hyper' }),
      routine('d', 'Pull A', { folder: 'Block 2' }), routine('e', 'Core'), routine('x', 'Gone', { archived: true })],
    routineFolders: [{ name: 'Block 2', current: true }, { name: 'Hyper' }, { name: 'Travel' }], week: { 1: ['a'] }, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const label = l => host.querySelector(`[aria-label="${l}"]`)
const key = (el, k) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
const edit = () => click(button('Edit'))
const stored = () => useStore.getState().S.routines.map(r => r.name)
const live = () => useStore.getState().S.routines.filter(r => !r.archived).map(r => r.name)
const pick = (...names) => names.forEach(n => click(label('Select ' + n)))
const bar = () => host.querySelector('.plan-editbar')

describe('Edit with select', () => {
  it('keeps the groups, adds a check circle and a grip per routine, a grip per folder, and drops the "…" and Share', () => {
    mount()
    expect(label('Plan options')).toBeTruthy()
    edit()
    expect(host.querySelector('.plan-current')).toBeTruthy()
    expect(host.querySelector('.plan-hdr').textContent).toBe('Not in a folder')
    expect([...host.querySelectorAll('.plan-routine [role="checkbox"]')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Select Push A', 'Select Pull A', 'Select Mobility', 'Select Core'])
    expect([...host.querySelectorAll('[data-reorder-handle]')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Move Push A', 'Move Pull A', 'Move Mobility', 'Move Core', 'Move Hyper', 'Move Travel'])
    expect(host.querySelector('.plan-more')).toBeNull()
    expect(label('Plan options')).toBeNull()
    expect(host.querySelector('.plan-pill')).toBeNull()
    click(button('Done'))
    expect(host.querySelector('[data-reorder-handle]')).toBeNull()
    expect(label('Plan options')).toBeTruthy()
  })

  it('a tap on a row selects it and opens nothing; Select all and Select none flip; Done clears', () => {
    mount()
    edit()
    expect(bar().querySelectorAll('button')[0].disabled).toBe(true)
    click(host.querySelector('.plan-routine [role="checkbox"]'))   // the check circle is the row's stretched primary
    expect(nav).not.toHaveBeenCalled()
    expect(label('Select Push A').getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('1 selected')
    click(button('Select all'))
    expect(host.textContent).toContain('4 selected')
    click(button('Select none'))
    expect(host.textContent).not.toContain('selected')
    pick('Core')
    click(button('Done')); edit()
    expect(label('Select Core').getAttribute('aria-checked')).toBe('false')
  })

  it('the bar reads Archive, Move to folder, Delete; Archive takes the selection off the list, Undo puts it back', () => {
    mount()
    edit()
    pick('Mobility', 'Core')
    expect([...bar().querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Archive', 'Move to folder', 'Delete'])
    click(button('Archive'))
    expect(confirmSheet).not.toHaveBeenCalled()
    expect(live()).toEqual(['Push A', 'Old legs', 'Pull A'])
    expect(useUI.getState().toastMsg).toBe('2 routines archived.')
    expect(host.textContent).not.toContain('selected')
    act(() => useUI.getState().runToastAction())
    expect(live()).toEqual(['Push A', 'Mobility', 'Old legs', 'Pull A', 'Core'])
  })

  it('Archive asks first when a ticked routine is on the schedule, then takes it off, and Undo puts it back', () => {
    mount()
    edit()
    pick('Push A', 'Core')
    click(button('Archive'))
    expect(live()).toContain('Push A')
    expect(confirmSheet.mock.calls[0][0].message).toBe('2 routines are on your schedule. Archive takes them off the schedule.')
    act(() => confirmSheet.mock.calls[0][0].onConfirm())
    expect(live()).toEqual(['Mobility', 'Old legs', 'Pull A'])
    expect(useStore.getState().S.week[1] || []).toEqual([])
    act(() => useUI.getState().runToastAction())
    expect(live()).toEqual(['Push A', 'Mobility', 'Old legs', 'Pull A', 'Core'])
    expect(useStore.getState().S.week[1]).toEqual(['a'])
  })

  it('one scheduled routine goes the routine menu way: a confirm that names its days', () => {
    mount()
    edit()
    pick('Push A')
    click(button('Archive'))
    expect(confirmSheet.mock.calls[0][0].message).toContain('Push A is on')
  })

  it('focus lands on Select all when Edit opens and on Edit when Done closes it', () => {
    mount()
    edit()
    expect(document.activeElement).toBe(button('Select all'))
    click(button('Done'))
    expect(document.activeElement).toBe(button('Edit'))
  })

  it('Edit takes the header and tabs away: Select all and Done, then "Select items" until something is ticked', () => {
    mount()
    expect(host.querySelector('.hdr .plan-edit')).toBeTruthy()
    edit()
    expect(host.querySelector('.hdr')).toBeNull()
    expect(host.querySelector('.plan-views')).toBeNull()
    expect(host.querySelector('.plan-selcount').textContent).toBe('Select items')
    pick('Core')
    expect(host.querySelector('.plan-selcount').textContent).toBe('1 selected')
  })

  it('Move to folder opens the sheet for the selection', () => {
    mount()
    edit()
    pick('Mobility', 'Core')
    click(button('Move to folder'))
    expect(menuSheet.mock.lastCall[0].title).toBe('Move 2 routines')
  })

  it('Delete confirms with the count, then removes them with an Undo', () => {
    mount()
    edit()
    pick('Mobility', 'Core')
    click(button('Delete'))
    expect(confirmSheet.mock.lastCall[0].message).toBe('Delete 2 routines for good? Your past workouts stay in History.')
    expect(live()).toContain('Core')
    act(() => confirmSheet.mock.lastCall[0].onConfirm())
    expect(live()).toEqual(['Push A', 'Old legs', 'Pull A'])
    expect(useUI.getState().toastMsg).toBe('2 routines gone.')
    act(() => useUI.getState().runToastAction())
    expect(live()).toEqual(['Push A', 'Mobility', 'Old legs', 'Pull A', 'Core'])
  })

  it('deleting every routine leaves Done on screen so Edit can be left', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [routine('b', 'Mobility'), routine('e', 'Core')], routineFolders: [], week: {} } }))
    mount()
    edit()
    click(button('Select all'))
    click(button('Delete'))
    act(() => confirmSheet.mock.lastCall[0].onConfirm())
    expect(button('Done')).toBeTruthy()
    click(button('Done'))
    expect(document.querySelector('.plan-editbar')).toBeNull()
  })

  it('Delete is off with nothing selected', () => {
    mount()
    edit()
    click(button('Delete'))
    expect(confirmSheet).not.toHaveBeenCalled()
  })

  it('a routine moves by its grip within its own section only', () => {
    mount()
    edit()
    key(label('Move Push A'), 'ArrowDown')
    expect(stored().filter(n => ['Push A', 'Pull A'].includes(n))).toEqual(['Pull A', 'Push A'])
    key(label('Move Push A'), 'ArrowDown')   // last of the plan: stays
    expect(stored().filter(n => ['Push A', 'Pull A'].includes(n))).toEqual(['Pull A', 'Push A'])
    key(label('Move Mobility'), 'ArrowDown')
    expect(stored().filter(n => ['Mobility', 'Core'].includes(n))).toEqual(['Core', 'Mobility'])
  })

  it('a folder moves by its grip and the folder list keeps the order', () => {
    mount()
    edit()
    key(label('Move Travel'), 'ArrowUp')
    expect(useStore.getState().S.routineFolders.map(f => f.name)).toEqual(['Block 2', 'Travel', 'Hyper'])
    expect(useStore.getState().S.routineFolders[0].current).toBe(true)
  })
})
