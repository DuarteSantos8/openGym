// @vitest-environment happy-dom
// The Starred filter on Plan → Routines (docs/dev/ROUTINE_FOLDERS.md): a flat list of starred
// routines from every folder, a "3 of 12 routines" line with Show all, remembered per device.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

const routine = (id, name, extra) => ({ id, name, emoji: null, ex: [{ id: '0025' }], ...extra })
const KEY = 'og_plan_starred'
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('gym_plan_view', 'routines')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { folder: 'Block 2', fav: true }), routine('b', 'Mobility'), routine('c', 'Old legs', { folder: 'Hyper', fav: true }),
      routine('d', 'Loose fav', { fav: true }), routine('e', 'Gone', { archived: true, fav: true })],
    routineFolders: [{ name: 'Block 2', current: true }, { name: 'Hyper' }], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const star = () => host.querySelector('[aria-label="Favourites"]')
const names = () => [...host.querySelectorAll('.plan-routine .tt')].map(e => e.textContent)

describe('Starred filter', () => {
  it('lists starred routines from every folder, naming the folder, with the count line and Show all', () => {
    mount()
    click(star())
    expect(names()).toEqual(['Push A', 'Old legs', 'Loose fav'])
    const subs = [...host.querySelectorAll('.plan-routine .ss')].map(e => e.textContent)
    expect(subs[0]).toContain('Current plan')
    expect(subs[1]).toContain('Hyper')
    expect(host.querySelector('.plan-starred-bar').textContent).toContain('3 of 4 routines')
    click([...host.querySelectorAll('.plan-starred-bar button')].find(b => b.textContent === 'Show all'))
    expect(host.querySelector('.plan-starred-bar')).toBeNull()
    expect(names()).toContain('Mobility')
  })

  it('says how to star one when none is', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.map(r => ({ ...r, fav: undefined })) } }))
    mount()
    click(star())
    expect(host.textContent).toContain('No favourites yet.')
    expect(host.textContent).toContain('Open the menu on a routine and pick Add to favourites. It will show here.')
  })

  it('is remembered on this device', () => {
    mount()
    click(star())
    expect(localStorage.getItem(KEY)).toBe('1')
    act(() => root.unmount()); root = createRoot(host)
    mount()
    expect(star().getAttribute('aria-pressed')).toBe('true')
    click(star())
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
