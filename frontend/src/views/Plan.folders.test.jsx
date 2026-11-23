// @vitest-environment happy-dom
// Plan → Routines, direction C (docs/dev/ROUTINE_FOLDERS.md): the current plan block on top, a
// "Not in a folder" header over the loose routines, one row per other folder, the Archive row,
// and the pill with Starred and New.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

const routine = (id, name, extra) => ({ id, name, emoji: null, ex: [{ id: '0025' }], ...extra })
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('gym_plan_view', 'routines')
  nav.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { folder: 'Block 2' }), routine('b', 'Mobility'), routine('c', 'Old legs', { folder: 'Hyper & more' }),
      routine('d', 'Pull A', { folder: 'Block 2', fav: true }), routine('e', 'Gone', { archived: true })],
    routineFolders: [{ name: 'Block 2', current: true }, { name: 'Hyper & more' }, { name: 'Travel' }], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const label = l => host.querySelector(`[aria-label="${l}"]`)
const rowNames = () => [...host.querySelectorAll('.plan-hdr, .plan-current, .plan-routine, .plan-folder')].map(e => e.classList.contains('plan-hdr') ? '#' + e.textContent : e.querySelector('.tt').textContent)

describe('Routines list', () => {
  it('goes current plan, Not in a folder, loose, one row per other folder, Archive', () => {
    mount()
    expect(rowNames()).toEqual(['Block 2', 'Push A', 'Pull A', '#Not in a folder', 'Mobility', '#Folders', 'Hyper & more', 'Travel', 'Archive'])
    const cur = host.querySelector('.plan-current')
    expect(cur.textContent).toContain('Block 2')
    expect(cur.textContent).toContain('Current plan · 2 routines')
  })

  it('has no current plan block and no loose header when nothing is current or loose', () => {
    useStore.setState(s => ({ S: { ...s.S, routineFolders: [{ name: 'Block 2' }] } }))
    mount()
    expect(host.querySelector('.plan-current')).toBeNull()
    expect(rowNames().slice(0, 2)).toEqual(['#Not in a folder', 'Mobility'])
    act(() => root.unmount()); root = createRoot(host)
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.filter(r => r.id !== 'b') } }))
    mount()
    expect(host.textContent).not.toContain('Not in a folder')
  })

  it('has no Favourites group: a starred routine stays where it is, with its star', () => {
    mount()
    expect(host.textContent).not.toContain('Favourites')
    expect(host.querySelector('[data-favs]')).toBeNull()
    expect(host.querySelectorAll('.plan-routine .tt .fav-star')).toHaveLength(1)
  })

  it('a folder row shows its count, a "…" and opens its screen', async () => {
    const { menuSheet } = await import('../sheets.jsx')
    mount()
    const row = [...host.querySelectorAll('.plan-folder')].find(e => e.textContent.includes('Hyper'))
    expect(row.textContent).toContain('1 routine')
    click(row.querySelector('.plan-open') || row)
    expect(nav).toHaveBeenCalledWith('/plan/folder/' + encodeURIComponent('Hyper & more'))
    nav.mockClear()
    click(label('More for Hyper & more'))
    expect(menuSheet).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Hyper & more' }))
    expect(nav).not.toHaveBeenCalled()
  })

  it('a routine row has a "…" that opens its menu, and tapping the row opens the routine', async () => {
    const { menuSheet } = await import('../sheets.jsx')
    mount()
    click(label('More for Mobility'))
    expect(menuSheet).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Mobility' }))
    click([...host.querySelectorAll('.plan-routine')].find(e => e.textContent.includes('Mobility')))
    expect(nav).toHaveBeenCalledWith('/plan/r/b')
  })

  it('does not list an archived routine, and the Archive row counts what is archived', () => {
    mount()
    expect(host.textContent).not.toContain('Gone')
    const row = [...host.querySelectorAll('.plan-folder')].find(e => e.textContent.includes('Archive'))
    expect(row.textContent).toContain('1 routine')
    click(row)
    expect(nav).toHaveBeenCalledWith('/plan/archive')
  })

  it('has no Archive row when nothing is archived, and the old footer hint is gone', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.filter(r => r.id !== 'e') } }))
    mount()
    expect(host.textContent).not.toContain('Archive')
    expect(host.textContent).not.toContain('Tap a routine to edit it')
  })

  it('never cuts a long folder name', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const rules = css.split('}').filter(r => /\.plan-folder[^{]*\.tt/.test(r.split('{')[0]))
    expect(rules.join('')).not.toContain('text-overflow')
  })
})

describe('The pill', () => {
  it('has the Favourites star and New; New offers New routine and New folder', async () => {
    const { menuSheet } = await import('../sheets.jsx')
    const { folderNameSheet } = await import('../components/RoutineFolder.jsx')
    mount()
    const pill = host.querySelector('.plan-pill')
    expect(label('Favourites').getAttribute('aria-pressed')).toBe('false')
    expect(pill.querySelector('[data-tour="plan-new"]')).toBeTruthy()   // the tour's "Build your first plan" points here
    click([...pill.querySelectorAll('button')].find(b => b.textContent.includes('New')))
    const items = menuSheet.mock.lastCall[0].items
    expect(items.map(i => i.label)).toEqual(['New routine', 'New folder'])
    items[1].onClick()
    expect(folderNameSheet).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new' }))
    items[0].onClick()
    expect(nav).toHaveBeenLastCalledWith(expect.stringMatching(/^\/plan\/r\//))
  })

  it('The Favourites star lists only starred routines, and says so when there are none', () => {
    mount()
    click(label('Favourites'))
    expect(label('Favourites').getAttribute('aria-pressed')).toBe('true')
    expect(rowNames()).toEqual(['Pull A'])
    act(() => root.unmount()); root = createRoot(host)
    localStorage.removeItem('og_plan_starred') // the filter is remembered; start this half off
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.map(r => ({ ...r, fav: undefined })) } }))
    mount()
    click(label('Favourites'))
    expect(host.textContent).toContain('No favourites yet.')
    click([...host.querySelectorAll('button')].find(b => b.textContent === 'Show all routines'))
    expect(host.textContent).toContain('Mobility')
  })

  it('is not there in Edit', () => {
    mount()
    click([...host.querySelectorAll('.plan-textbtn')].find(b => b.textContent === 'Edit'))
    expect(host.querySelector('.plan-pill')).toBeNull()
  })
})
