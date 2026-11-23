// @vitest-environment happy-dom
// Q11 (Discord, D#858): routines in folders. Loose ones on top, each folder a header that folds
// its routines away, Archive folded to begin with, the choice remembered on the device.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))

const routine = (id, name, folder) => ({ id, name, emoji: null, ex: [{ id: '0025' }], ...(folder ? { folder } : {}) })
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('gym_plan_view', 'routines')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [routine('a', 'Push A', 'Block 2'), routine('b', 'Mobility'), routine('c', 'Old legs', 'Archive'), routine('d', 'Pull A', 'Block 2')], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))
const names = () => [...host.querySelectorAll('.plan-routines .plan-routine .tt')].map(e => e.textContent)
const folder = name => [...host.querySelectorAll('.plan-folder')].find(b => b.textContent.includes(name))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('routine folders in Plan', () => {
  it('lists loose routines first, then each folder; Archive starts folded', () => {
    mount()
    expect(names()).toEqual(['Mobility', 'Push A', 'Pull A'])
    expect(folder('Block 2').getAttribute('aria-expanded')).toBe('true')
    expect(folder('Archive').getAttribute('aria-expanded')).toBe('false')
  })

  it('folds and unfolds a folder, and remembers it', () => {
    mount()
    click(folder('Block 2'))
    expect(names()).toEqual(['Mobility'])
    click(folder('Archive'))
    expect(names()).toEqual(['Mobility', 'Old legs'])
    act(() => root.unmount())
    root = createRoot(host)
    mount()
    expect(names()).toEqual(['Mobility', 'Old legs'])
  })

  it('has a "…" on each routine row and folder header that opens its menu', async () => {
    const { menuSheet } = await import('../sheets.jsx')
    mount()
    const more = n => host.querySelector(`[aria-label="More for ${n}"]`)
    click(more('Mobility'))
    expect(menuSheet).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Mobility' }))
    click(more('Block 2'))
    expect(menuSheet).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Block 2' }))
    expect(host.querySelector('.plan-folder[aria-expanded="true"]')).toBeTruthy()   // the tap did not fold it
  })

  it('does not list an archived routine', () => {
    useStore.setState(st => ({ S: { ...st.S, routines: st.S.routines.map(r => (r.id === 'b' ? { ...r, archived: true } : r)) } }))
    mount()
    expect(names()).toEqual(['Push A', 'Pull A'])
  })

  it('ends with an Archive row that counts what is archived and opens the Archive screen', () => {
    const archiveRow = () => [...host.querySelectorAll('.lrow')].find(e => e.textContent.includes('Archive'))
    mount()
    expect(archiveRow()).toBeUndefined()
    act(() => root.unmount()); root = createRoot(host)
    useStore.setState(st => ({ S: { ...st.S, routines: st.S.routines.map(r => (r.id === 'b' ? { ...r, archived: true } : r)) } }))
    mount()
    const row = archiveRow()
    expect(row.textContent).toContain('1 routine')
    click(row)
    expect(nav).toHaveBeenCalledWith('/plan/archive')
  })
})
