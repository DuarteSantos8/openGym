// @vitest-environment happy-dom
// The routine and folder menus: each item writes the right state, what takes something away asks
// first when it must, and Undo puts back only what was taken (shape of Plan.undo-sync.test.jsx).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
const shown = vi.hoisted(() => ({ menu: null, confirm: null }))
vi.mock('../sheets.jsx', async orig => ({
  ...(await orig()),
  menuSheet: o => { shown.menu = o },
  confirmSheet: o => { shown.confirm = o },
}))

import { routineMenu, folderMenu, moveSheet, archiveRoutineWithUndo } from './RoutineMenus.jsx'
import { folderNameSheet } from './RoutineFolder.jsx'

const S = () => useStore.getState().S
const clone = v => JSON.parse(JSON.stringify(v))
const routine = (id, name, extra = {}) => ({ id, name, emoji: null, _ts: 900, ex: [{ id: '0025', sets: 3, reps: 5 }], ...extra })
const items = () => (shown.menu.sections || [{ items: shown.menu.items }]).flatMap(s => s.items)
const pick = label => items().find(i => i.label === label)
const undo = () => useUI.getState().runToastAction()
const toast = () => useUI.getState().toastMsg

beforeEach(() => {
  localStorage.clear()
  shown.menu = shown.confirm = null
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  useStore.setState({
    user: null,
    S: Object.assign(clone(DEF), {
      _ts: 1000,
      routines: [routine('a', 'Upper A', { folder: 'Block 3' }), routine('b', 'Upper B', { folder: 'Block 3' }), routine('c', 'Mobility'), routine('d', 'Travel set', { folder: 'Travel' })],
      routineFolders: [{ name: 'Block 3', current: true }, { name: 'Travel' }],
      week: { 1: ['a'], 4: ['b'] },
    }),
  })
})
afterEach(() => { localStorage.clear() })

describe('routine menu', () => {
  it('lists the items in order, Delete apart and red', () => {
    routineMenu(S().routines[0])
    expect(shown.menu.sections.map(s => s.items.map(i => i.label))).toEqual([
      ['Start workout', 'Edit routine', 'Add to favourites', 'Colour and icon', 'Duplicate', 'Move to folder', 'Archive'], ['Delete']])
    expect(pick('Delete').danger).toBe(true)
  })

  it('stars and unstars, and duplicates right below with an Undo', () => {
    routineMenu(S().routines[2])
    pick('Add to favourites').onClick()
    expect(S().routines[2].fav).toBe(true)
    routineMenu(S().routines[2])
    expect(pick('Remove from favourites')).toBeTruthy()
    pick('Duplicate').onClick()
    expect(S().routines.map(r => r.name)).toEqual(['Upper A', 'Upper B', 'Mobility', 'Mobility (Copy)', 'Travel set'])
    undo()
    expect(S().routines.map(r => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('archives an unscheduled routine at once and Undo brings it back', () => {
    archiveRoutineWithUndo(S().routines[2])
    expect(S().routines[2].archived).toBe(true)
    expect(shown.confirm).toBeNull()
    undo()
    expect(S().routines[2].archived).toBeUndefined()
  })

  it('asks first for a scheduled routine, naming the day, and takes it off the week', () => {
    archiveRoutineWithUndo(S().routines[0])
    expect(shown.confirm.message).toBe('Upper A is on Monday. Archive takes it off the schedule.')
    expect(S().routines[0].archived).toBeUndefined()
    shown.confirm.onConfirm()
    expect(S().routines[0].archived).toBe(true)
    expect(S().week[1]).toBeUndefined()
    undo()
    expect(S().week[1]).toEqual(['a'])
  })

  it('Undo puts back only what it took when another device wrote in between', () => {
    archiveRoutineWithUndo(S().routines[0])
    shown.confirm.onConfirm()
    // Meanwhile: another device archived Mobility and scheduled Upper A on Wednesday.
    useStore.getState().update(s => { s.routines[2].archived = true; s.week[3] = ['a'] })
    undo()
    expect(S().routines[0].archived).toBeUndefined()
    expect(S().routines[2].archived).toBe(true)
    expect(S().week[1]).toEqual(['a'])
    expect(S().week[3]).toEqual(['a'])
  })

  it('Delete goes through the Undo toast', () => {
    routineMenu(S().routines[2])
    pick('Delete').onClick()
    expect(S().routines.some(r => r.id === 'c')).toBe(false)
    undo()
    expect(S().routines.some(r => r.id === 'c')).toBe(true)
  })
})

describe('folder menu', () => {
  it('flips the current plan', () => {
    folderMenu('Travel')
    pick('Make current plan').onClick()
    expect(S().routineFolders).toEqual([{ name: 'Block 3' }, { name: 'Travel', current: true }])
    folderMenu('Travel')
    pick('Not the current plan').onClick()
    expect(S().routineFolders.some(e => e.current)).toBe(false)
  })

  it('keeps Delete folder and routines alone in its own group', () => {
    folderMenu('Block 3')
    expect(shown.menu.sections.map(s => s.items.map(i => i.label))).toEqual([
      ['Not the current plan', 'Rename', 'New routine here', 'Archive folder and routines', 'Remove folder, keep routines'], ['Delete folder and routines']])
  })

  it('removes the folder, keeps the routines loose, Undo puts the folder back', () => {
    folderMenu('Block 3')
    pick('Remove folder, keep routines').onClick()
    expect(S().routines.filter(r => r.folder === 'Block 3')).toHaveLength(0)
    expect(S().routineFolders).toEqual([{ name: 'Travel' }])
    undo()
    expect(S().routines.filter(r => r.folder === 'Block 3').map(r => r.id)).toEqual(['a', 'b'])
    expect(S().routineFolders[0]).toEqual({ name: 'Block 3', current: true })
  })

  it('archives the folder with its routines (asking first for scheduled ones) and Undo restores them', () => {
    folderMenu('Block 3')
    pick('Archive folder and routines').onClick()
    expect(shown.confirm.message).toContain('Block 3 has routines on your schedule')
    shown.confirm.onConfirm()
    expect(S().routines.filter(r => r.archived).map(r => r.id)).toEqual(['a', 'b'])
    expect(S().routineFolders).toEqual([{ name: 'Travel' }])
    undo()
    expect(S().routines.some(r => r.archived)).toBe(false)
    expect(S().routineFolders[0].current).toBe(true)
  })

  it('delete asks with the count and the History note, then Undo restores the routines', () => {
    folderMenu('Block 3')
    expect(pick('Delete folder and routines').danger).toBe(true)
    pick('Delete folder and routines').onClick()
    expect(shown.confirm.message).toBe('Delete Block 3 and its 2 routines? Your past workouts stay in History.')
    expect(S().routines).toHaveLength(4)
    shown.confirm.onConfirm()
    expect(S().routines.map(r => r.id)).toEqual(['c', 'd'])
    undo()
    expect(S().routines.map(r => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('move to folder', () => {
  it('lists the current plan first with a check where the routine is, then No folder and New folder', () => {
    moveSheet(['d'])
    const list = shown.menu.sections[0].items
    expect(list.map(i => i.label)).toEqual(['Block 3', 'Travel', 'No folder', 'New folder'])
    expect(list.map(i => i.on)).toEqual([false, true, false, undefined])
    list[0].onClick()
    expect(S().routines.find(r => r.id === 'd').folder).toBe('Block 3')
    expect(S().routines.at(-1).id).toBe('d')
  })

  it('has a Cancel, says where it is now, and No folder explains itself', () => {
    moveSheet(['d'])
    expect(shown.menu.cancel).toBe(true)
    expect(shown.menu.title).toBe('Move Travel set')
    const list = shown.menu.sections[0].items
    expect(list[1].sub).toBe('Here now')
    expect(list.find(i => i.label === 'No folder').sub).toBe('Takes it out of its folder')
  })

  it('No folder makes it loose', () => {
    moveSheet(['a'])
    shown.menu.sections[0].items.find(i => i.label === 'No folder').onClick()
    expect(S().routines.find(r => r.id === 'a').folder).toBeUndefined()
  })
})

describe('folder name sheet', () => {
  let host, root
  const open = opts => {
    folderNameSheet(opts)
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(useUI.getState().sheets.at(-1).render(vi.fn())))
  }
  const type = v => act(() => {
    const input = host.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = () => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click() })
  beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('creates a folder and hands the name on', () => {
    const onDone = vi.fn()
    open({ mode: 'new', onDone })
    type('Cut')
    save()
    expect(S().routineFolders.map(e => e.name)).toEqual(['Block 3', 'Travel', 'Cut'])
    expect(onDone).toHaveBeenCalledWith('Cut')
  })

  it('refuses a name in use on rename, and the reserved one, in words', () => {
    open({ mode: 'rename', name: 'Travel' })
    type('block 3')
    save()
    expect(host.querySelector('[role=alert]').textContent).toBe('There’s already a folder called block 3.')
    type('archive')
    save()
    expect(host.querySelector('[role=alert]').textContent).toBe('That name is kept for the archive.')
    expect(S().routineFolders.map(e => e.name)).toEqual(['Block 3', 'Travel'])
  })

  it('renames', () => {
    open({ mode: 'rename', name: 'Travel' })
    type('Trips')
    save()
    expect(S().routines.find(r => r.id === 'd').folder).toBe('Trips')
  })
})
