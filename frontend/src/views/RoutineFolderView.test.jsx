// @vitest-environment happy-dom
// The folder screen (docs/dev/ROUTINE_FOLDERS.md): title, count and current-plan state, the folder's
// routines as Plan's rows, "New routine in this folder", the header "…", unknown name back to Plan.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'

const nav = vi.hoisted(() => vi.fn())
const params = vi.hoisted(() => ({ name: 'Block 2' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useParams: () => params }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

import RoutineFolderView from './RoutineFolderView.jsx'

const routine = (id, name, extra) => ({ id, name, emoji: null, ex: [{ id: '0025' }], ...extra })
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  nav.mockClear()
  params.name = 'Block 2'
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { folder: 'Block 2' }), routine('b', 'Mobility'), routine('d', 'Pull A', { folder: 'Block 2', fav: true }),
      routine('e', 'Gone', { folder: 'Block 2', archived: true })],
    routineFolders: [{ name: 'Block 2', current: true }, { name: 'Travel' }], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<RoutineFolderView />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('Folder screen', () => {
  it('shows the title, the count, the current plan state and only its live routines', () => {
    mount()
    expect(host.querySelector('h1').textContent).toBe('Block 2')
    expect(host.querySelector('.sub').textContent).toBe('2 routines · Current plan')
    expect([...host.querySelectorAll('.plan-routine .tt')].map(e => e.textContent)).toEqual(['Push A', 'Pull A'])
    expect(host.querySelectorAll('.fav-star')).toHaveLength(1)
  })

  it('says it is not the current plan', () => {
    params.name = 'Travel'
    mount()
    expect(host.querySelector('.sub').textContent).toBe('0 routines · Not the current plan')
  })

  it('an empty folder says so and offers a new routine', () => {
    params.name = 'Travel'
    mount()
    expect(host.textContent).toContain('No routines here yet.')
    expect(host.textContent).toContain('New routine in this folder')
  })

  it('New routine in this folder makes one in the folder with a colour and opens it', () => {
    mount()
    click(host.querySelector('.plan-new-here'))
    const r = useStore.getState().S.routines.at(-1)
    expect(r.folder).toBe('Block 2')
    expect(r.color).toBeTruthy()
    expect(nav).toHaveBeenCalledWith('/plan/r/' + r.id)
  })

  it('a row opens its routine; Plan goes back; the header "…" opens the folder menu', async () => {
    const { menuSheet } = await import('../sheets.jsx')
    mount()
    click(host.querySelector('.plan-routine'))
    expect(nav).toHaveBeenCalledWith('/plan/r/a')
    click(host.querySelector('[aria-label="Plan"]'))
    expect(nav).toHaveBeenCalledWith('/plan')
    click(host.querySelector(".plan-crumb [aria-label=\"More for Block 2\"]"))
    expect(menuSheet).toHaveBeenCalledWith(expect.objectContaining({ title: 'Block 2' }))
  })

  it('an unknown folder goes back to Plan', () => {
    params.name = 'Nope'
    mount()
    expect(nav).toHaveBeenCalledWith('/plan', { replace: true })
    expect(host.querySelector('h1')).toBeNull()
  })

  it('a folder named like another in capitals is that folder', () => {
    params.name = 'block 2'
    mount()
    expect(host.querySelectorAll('.plan-routine')).toHaveLength(2)
  })
})
