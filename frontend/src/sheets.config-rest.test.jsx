// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

// v1.3.11: an exercise's own rest is set on the same wheel as the default rest timer, where 0:00
// means "no rest of its own" and the row says which default applies then.
const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const restRow = host => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Rest for this exercise')
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()

describe('exercise settings: rest on the wheel', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('reads Default with the default rest when the exercise has none, and saves what the wheel picks', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 0 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('Default (2:00)')
    act(() => restRow(host).click())
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('h3').textContent).toBe('Rest for this exercise')
    expect(wheel.querySelector('.dw-read').textContent).toBe('Default (2:00)')
    // The copy names the wheel's 0:00, not a "0" the row never shows (QA 10-05).
    expect(host.textContent).toContain('0:00 means your default rest.')
    expect(host.textContent).not.toMatch(/Leave at 0/)
    // Done keeps 0:00, the default; the value shown stays the default's.
    act(() => [...wheel.querySelectorAll('button')].find(b => b.textContent === 'Done').click())
    act(() => save(host))
    expect(onSave.mock.calls[0][0].restSec || 0).toBe(0)
  })

  it('shows an exercise’s own rest as a time, and the wheel opens on it', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 75 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('1:15')
    act(() => restRow(host).click())
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('.dw-read').textContent).toBe('1:15')
    act(() => [...wheel.querySelectorAll('button')].find(b => b.textContent === 'Done').click())
    act(() => save(host))
    expect(onSave.mock.calls[0][0].restSec).toBe(75)
  })
})

// Discord "set-specific rest timers": the warm-ups' own rest and the break between sides, both
// optional; a config that never touched them saves the exact shape it had.
describe('exercise settings: rest for warm-ups and between sides', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })
  const row = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
  const lastMenuItems = () => useUI.getState().sheets.at(-1)

  it('untouched, nothing new is written; a per-side row only shows for a per-side exercise', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupSets: 2 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('Like the work sets')
    expect(row(host, 'Rest between sides')).toBeUndefined()
    act(() => save(host))
    const out = onSave.mock.calls[0][0]
    expect('warmupRestOff' in out || 'warmupRestSec' in out || 'sideRestSec' in out).toBe(false)
  })

  it('without its own, the row names the profile\'s warm-up rest and still writes nothing', () => {
    useStore.setState(s => ({ S: { ...s.S, warmupRestSec: 30 } }))
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupSets: 2 }, onSave)
    let host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('Default (30s)')
    act(() => save(host))
    expect('warmupRestOff' in onSave.mock.calls[0][0] || 'warmupRestSec' in onSave.mock.calls[0][0]).toBe(false)
    useStore.setState(s => ({ S: { ...s.S, warmupRestSec: 0 } }))
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupSets: 2 }, vi.fn())
    host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('Default (No timer)')
    useStore.setState(s => { const { warmupRestSec, ...rest } = s.S; return { S: rest } })
  })

  it('keeps what it was given: a warm-up rest from the Coach, "no timer", a break between sides', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', side: true, warmupRestSec: 45, sideRestSec: 20 }, onSave)
    let host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('45s')
    expect(row(host, 'Rest between sides').querySelector('.lrow-v').textContent).toBe('20s')
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).toMatchObject({ warmupRestSec: 45, sideRestSec: 20, side: true })

    const again = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupRestOff: true }, again)
    host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => save(host))
    expect(again.mock.calls[0][0].warmupRestOff).toBe(true)
    expect('warmupRestSec' in again.mock.calls[0][0]).toBe(false)
  })

  it('"No timer" from the menu is saved as that, and "Like the work sets" takes it away again', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupRestSec: 45 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    act(() => row(host, 'Rest between warm-ups').click())
    const menu = render(lastMenuItems())
    act(() => [...menu.querySelectorAll('.menu-item')].find(b => b.textContent.includes('No timer')).click())
    act(() => row(host, 'Rest between warm-ups').click())
    const menu2 = render(lastMenuItems())
    expect(row(host, 'Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => [...menu2.querySelectorAll('.menu-item')].find(b => b.textContent.includes('Like the work sets')).click())
    act(() => save(host))
    const out = onSave.mock.calls[0][0]
    expect('warmupRestOff' in out || 'warmupRestSec' in out).toBe(false)
  })
})
