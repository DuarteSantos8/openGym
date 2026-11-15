// @vitest-environment happy-dom
// The Archive screen: archived folders as headers with their routines, then loose archived ones;
// the menus restore or delete for good, and every delete names the count and offers an Undo.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
const shown = vi.hoisted(() => ({ menu: null, confirm: null }))
vi.mock('../sheets.jsx', async orig => ({
  ...(await orig()),
  menuSheet: o => { shown.menu = o },
  confirmSheet: o => { shown.confirm = o },
}))

import RoutineArchive from './RoutineArchive.jsx'

const S = () => useStore.getState().S
const clone = v => JSON.parse(JSON.stringify(v))
const routine = (id, name, extra = {}) => ({ id, name, emoji: null, _ts: 900, ex: [{ id: '0025', sets: 3, reps: 5 }], ...extra })
const pick = label => (shown.menu.sections || [{ items: shown.menu.items }]).flatMap(s => s.items).find(i => i.label === label)
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
let host, root
const mount = () => act(() => root.render(<RoutineArchive />))
const more = n => host.querySelector(`[aria-label="More for ${n}"]`)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  nav.mockClear()
  shown.menu = shown.confirm = null
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState({
    user: null,
    S: Object.assign(clone(DEF), {
      _ts: 1000,
      routines: [
        routine('a', 'Old push', { folder: 'Block 2', archived: true }), routine('b', 'Old pull', { folder: 'Block 2', archived: true }),
        routine('c', 'Loose old', { archived: true }), routine('d', 'Live one'), routine('e', 'Live in block', { folder: 'Block 2' }),
      ],
      routineFolders: [{ name: 'Travel' }],
    }),
  })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Archive screen', () => {
  it('shows archived folders with their routines, then loose ones, and goes back to Plan', () => {
    mount()
    expect([...host.querySelectorAll('.arch-folder .grow, .arch-routine .tt')].map(e => e.textContent))
      .toEqual(['Block 2', 'Old push', 'Old pull', 'Loose old'])
    expect(host.textContent).not.toContain('Live one')
    // the loose ones sit in their own card under a caption, not under the last folder
    const cards = [...host.querySelectorAll('.plan-group')]
    expect(cards.map(c => c.textContent.includes('Loose old'))).toEqual([false, true])
    expect(host.textContent).toContain('Not in a folder')
    const back = host.querySelector('[data-back="/plan"]')
    expect(back.getAttribute('aria-label')).toBe('Plan')
    click(back)
    expect(nav).toHaveBeenCalledWith('/plan')
  })

  it('routine menu: Restore puts it back in its folder, Delete for good confirms then undoes', () => {
    mount()
    click(more('Loose old'))
    expect(shown.menu.sections.flatMap(s => s.items).map(i => i.label)).toEqual(['Restore', 'Delete for good'])
    act(() => pick('Restore').onClick())
    expect(S().routines.find(r => r.id === 'c').archived).toBeUndefined()
    click(more('Old push'))
    act(() => pick('Delete for good').onClick())
    expect(shown.confirm.message).toContain('Old push')
    expect(S().routines.some(r => r.id === 'a')).toBe(true)
    act(() => shown.confirm.onConfirm())
    expect(S().routines.some(r => r.id === 'a')).toBe(false)
    act(() => useUI.getState().runToastAction())
    expect(S().routines.find(r => r.id === 'a').archived).toBe(true)
  })

  it('a Restore pill on the row puts that routine back without opening the menu', () => {
    mount()
    click(host.querySelector('[aria-label="Loose old: Restore"]'))
    expect(S().routines.find(r => r.id === 'c').archived).toBeUndefined()
    expect(host.textContent).toContain('They stay out of Plan until you restore them.')
  })

  it('folder menu: Restore folder and Delete folder for good touch only its archived routines', () => {
    mount()
    click(more('Block 2'))
    expect(shown.menu.sections.flatMap(s => s.items).map(i => i.label)).toEqual(['Restore folder', 'Delete folder for good'])
    act(() => pick('Delete folder for good').onClick())
    expect(shown.confirm.message).toContain('2 routines')
    act(() => shown.confirm.onConfirm())
    expect(S().routines.map(r => r.id)).toEqual(['c', 'd', 'e'])
    act(() => pick('Restore folder').onClick())
    expect(S().routines.find(r => r.id === 'e').folder).toBe('Block 2')
  })

  it('folder menu: Restore folder un-archives its routines and keeps their folder', () => {
    mount()
    click(more('Block 2'))
    act(() => pick('Restore folder').onClick())
    for (const id of ['a', 'b']) expect(S().routines.find(r => r.id === id)).toMatchObject({ folder: 'Block 2' })
    expect(S().routines.filter(r => r.id === 'a' || r.id === 'b').some(r => r.archived)).toBe(false)
    expect(S().routines.find(r => r.id === 'e').archived).toBeUndefined()
  })

  it('Delete all names the count, then undoes in one step', () => {
    mount()
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Delete all 3 for good')
    click(btn)
    expect(shown.confirm.message).toContain('3 routines')
    act(() => shown.confirm.onConfirm())
    expect(S().routines.map(r => r.id)).toEqual(['d', 'e'])
    act(() => useUI.getState().runToastAction())
    expect(S().routines.filter(r => r.archived).length).toBe(3)
  })

  it('says so when nothing is archived', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.filter(r => !r.archived) } }))
    mount()
    expect(host.textContent).toContain('Nothing archived.')
    expect(host.textContent).not.toContain('Delete all')
  })
})
