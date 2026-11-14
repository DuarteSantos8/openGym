// @vitest-environment happy-dom
// Long-press drag on Plan → Routines and on the folder screen (docs/dev/ROUTINE_FOLDERS.md):
// drop on a folder row or the current plan block moves the routine to the end of that folder,
// drop on "Plan" in a folder makes it loose, the pill hides while a row is lifted, and a move
// before the hold is a swipe, not a lift.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'
import RoutineFolderView from './RoutineFolderView.jsx'

const nav = vi.hoisted(() => vi.fn())
const params = vi.hoisted(() => ({ name: 'Travel' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useParams: () => params }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

const routine = (id, name, extra) => ({ id, name, emoji: null, ex: [{ id: '0025' }], ...extra })
const pe = (type, x, y, pointerType = 'mouse') => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerType: { value: pointerType }, pointerId: { value: 1 }, clientX: { value: x }, clientY: { value: y }, button: { value: 0 } })
  return e
}
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  localStorage.clear()
  localStorage.setItem('gym_plan_view', 'routines')
  nav.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { folder: 'Block 2' }), routine('b', 'Mobility'), routine('c', 'Old legs', { folder: 'Travel' }), routine('d', 'Pull A')],
    routineFolders: [{ name: 'Block 2', current: true }, { name: 'Travel' }], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const at = (el, top) => { el.getBoundingClientRect = () => ({ top, bottom: top + 50, left: 0, right: 300, height: 50, width: 300 }) }
const press = (el, x = 10, y = 10) => act(() => { el.dispatchEvent(pe('pointerdown', x, y)) })
const hold = () => act(() => { vi.advanceTimersByTime(460) })
const moveTo = (x, y) => act(() => { window.dispatchEvent(pe('pointermove', x, y)) })
// the hook swallows the click after a lift until the next tick; let it end
const release = (x, y) => act(() => { window.dispatchEvent(pe('pointerup', x, y)); vi.advanceTimersByTime(1) })
const folderOf = id => useStore.getState().S.routines.find(r => r.id === id).folder
const dragRow = id => host.querySelector(`[data-drag-row="${id}"]`)

describe('Plan drag', () => {
  it('dropping Mobility on the Travel row moves it to the end of Travel', () => {
    act(() => root.render(<Plan />))
    at(host.querySelector('[data-drop-target="Travel"]'), 300)
    press(dragRow('b')); hold()
    expect(host.querySelector('.plan-pill')).toBeNull()
    moveTo(50, 320)
    expect(host.querySelector('[data-drop-target="Travel"]').textContent).toContain('Move here')
    release(50, 320)
    const rs = useStore.getState().S.routines
    expect(folderOf('b')).toBe('Travel')
    expect(rs[rs.length - 1].id).toBe('b')
    expect(host.querySelector('.plan-pill')).not.toBeNull()
    expect(host.querySelector('[role="status"][aria-live="polite"]').textContent).toBe('Moved Mobility to Travel')
  })

  it('dropping on the current plan block moves it into the plan', () => {
    act(() => root.render(<Plan />))
    at(host.querySelector('[data-drop-target="Block 2"]'), 100)
    press(dragRow('d')); hold(); moveTo(50, 120); release(50, 120)
    expect(folderOf('d')).toBe('Block 2')
  })

  it('a move before the hold is a swipe: nothing lifts', () => {
    act(() => root.render(<Plan />))
    press(dragRow('b')); moveTo(80, 12); hold()
    expect(host.querySelector('.plan-pill')).not.toBeNull()
    expect(host.querySelector('.is-lifted')).toBeNull()
  })

  it('a lifted routine does not swipe open: sideways then release keeps it shut', () => {
    act(() => root.render(<Plan />))
    const sw = dragRow('b').querySelector('.swrow')
    Object.defineProperty(sw, 'clientWidth', { value: 300 })
    act(() => { sw.dispatchEvent(pe('pointerdown', 200, 10, 'touch')) }); hold()
    act(() => { window.dispatchEvent(pe('pointermove', 100, 12, 'touch')); window.dispatchEvent(pe('pointermove', 20, 12, 'touch')) })
    act(() => { sw.dispatchEvent(pe('pointermove', 20, 12, 'touch')); sw.dispatchEvent(pe('pointerup', 20, 12, 'touch')); window.dispatchEvent(pe('pointerup', 20, 12, 'touch')); vi.advanceTimersByTime(1000) })
    expect(sw.className).not.toContain('go-del') // not opened, so not deletable
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('no drag while Edit is on', () => {
    act(() => root.render(<Plan />))
    act(() => { host.querySelector('.plan-edit').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(host.querySelector('[data-drag-row]')).toBeNull()
  })
})

describe('Folder screen drag', () => {
  it('dropping on Plan makes the routine loose', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.map(r => (r.id === 'b' ? { ...r, folder: 'Travel' } : r)) } }))
    act(() => root.render(<RoutineFolderView />))
    at(host.querySelector('[data-drop-target=""]'), 0)
    press(dragRow('b')); hold(); moveTo(20, 20)
    expect(host.textContent).toContain('Move out to Plan')
    release(20, 20)
    expect(folderOf('b')).toBeUndefined()
  })

  it('dropping on the Move out pill also makes it loose', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.map(r => (r.id === 'b' ? { ...r, folder: 'Travel' } : r)) } }))
    act(() => root.render(<RoutineFolderView />))
    at(host.querySelector('[data-drop-target=""]'), 0)
    press(dragRow('b')); hold()
    const pill = host.querySelector('.plan-moveout')
    at(pill, 200); at(host.querySelector('[data-drop-target=""]'), 0)
    moveTo(20, 220); release(20, 220)
    expect(folderOf('b')).toBeUndefined()
  })
})
