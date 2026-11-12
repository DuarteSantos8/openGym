// @vitest-environment happy-dom
// The safety copies sheet (components/SafetyCopiesSheet.jsx): the list with what each copy holds,
// and a restore that brings a profile back through the store's importBackup.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SafetyCopiesSheet, { restoreCopy, summaryLine } from './SafetyCopiesSheet.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const mocks = vi.hoisted(() => ({ copies: [], deleted: [] }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))
vi.mock('../lib/safety-store.js', () => ({
  listCopies: () => Promise.resolve(mocks.copies.slice()),
  deleteCopy: id => { mocks.deleted.push(id); mocks.copies = mocks.copies.filter(c => c.id !== id); return Promise.resolve() },
  copyBefore: vi.fn(() => Promise.resolve(true)),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const copy = (at, reason, workouts) => ({
  id: `${at}-${reason}`, at, reason,
  summary: { workouts, routines: 1, plans: 0 },
  state: Object.assign(clone(DEF), { workouts: Array.from({ length: workouts }, (_, i) => ({ id: 'w' + i, d: '2026-11-01', entries: [] })), routines: [{ id: 'r1', name: 'A', entries: [] }] }),
})

let root, host
const mount = async (props = {}) => {
  useStore.setState({ S: clone(DEF), user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<SafetyCopiesSheet close={vi.fn()} {...props} />))
  await flush()
}

beforeEach(() => { mocks.copies = []; mocks.deleted = []; useUI.setState({ sheets: [], toastMsg: '' }) })
afterEach(() => { if (root) act(() => root.unmount()); if (host) host.remove(); root = host = null })

describe('the list', () => {
  it('says there are no copies yet', async () => {
    await mount()
    expect(host.textContent).toContain('Safety copies')
    expect(host.textContent).toContain('No copies yet')
  })
  it('shows each copy with why it was taken and what it holds', async () => {
    mocks.copies = [copy(Date.UTC(2026, 10, 12, 12), 'reset', 120), copy(Date.UTC(2026, 10, 11, 12), 'auto', 118)]
    await mount()
    expect(host.textContent).toContain('Before a reset')
    expect(host.textContent).toContain('120 workouts · 1 routines')
    expect(host.textContent).toContain('Automatic copy')
  })
  it('opened by the offer, it says the data looks empty', async () => {
    mocks.copies = [copy(1, 'auto', 5)]
    await mount({ offered: true })
    expect(host.textContent).toContain('Your data looks empty')
    expect([...host.querySelectorAll('button')].some(b => b.textContent.trim() === 'Not now')).toBe(true)
  })
  it('deleting a copy takes it off the list', async () => {
    mocks.copies = [copy(1, 'auto', 5)]
    await mount()
    act(() => host.querySelector('button[aria-label="Delete copy"]').click())
    await flush()
    expect(mocks.deleted).toEqual(['1-auto'])
    expect(host.textContent).toContain('No copies yet')
  })
  it('a tap on a copy asks before restoring, and restoring brings the profile back', async () => {
    mocks.copies = [copy(Date.UTC(2026, 10, 12, 12), 'reset', 3)]
    await mount()
    act(() => host.querySelector('.cardio-plan-pick').click())
    const confirm = useUI.getState().sheets.at(-1)
    expect(confirm).toBeTruthy()
    const h = document.createElement('div'); document.body.appendChild(h)
    const r = createRoot(h)
    act(() => r.render(confirm.render(() => useUI.getState().closeSheet(confirm.id))))
    expect(h.textContent).toContain('Restore this copy?')
    expect(useStore.getState().S.workouts).toHaveLength(0)
    act(() => [...h.querySelectorAll('button')].find(b => b.textContent.trim() === 'Restore').click())
    await flush()
    expect(useStore.getState().S.workouts).toHaveLength(3)
    expect(useStore.getState().S.routines).toHaveLength(1)
    act(() => r.unmount()); h.remove()
  })
})

describe('restoreCopy', () => {
  it('puts the copy back and says so', () => {
    useStore.setState({ S: clone(DEF), user: null })
    restoreCopy(copy(1, 'auto', 2))
    expect(useStore.getState().S.workouts).toHaveLength(2)
    expect(useUI.getState().toastMsg).toBe('Copy restored')
  })
})

describe('summaryLine', () => {
  it('joins what is there, and says "Settings only" when nothing is', () => {
    expect(summaryLine({ workouts: 2, routines: 0, plans: 1 })).toBe('2 workouts · 1 cardio plans')
    expect(summaryLine({})).toBe('Settings only')
  })
})
