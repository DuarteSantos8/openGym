// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB, EXIDX } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

// An exercise's own rest: the default, "No timer" (Discord lajawi; a 0:00 used to mean the
// default, so there was no way to say none) or a time of its own, as for the warm-ups. The wheel
// opens on the rest that applies (#735), not on 0:00.
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
const pick = (menu, label) => act(() => [...menu.querySelectorAll('.menu-item')].find(b => b.textContent.includes(label)).click())
const done = wheel => act(() => [...wheel.querySelectorAll('button')].find(b => b.textContent === 'Done').click())

describe('exercise settings: rest for this exercise', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('reads Default with the default rest when the exercise has none, and saves nothing new', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 0 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('Default (2:00)')
    expect(host.textContent).toContain('No timer means no countdown')
    expect(host.textContent).not.toMatch(/0:00 means/)
    act(() => save(host))
    const out = onSave.mock.calls[0][0]
    expect(out.restSec || 0).toBe(0)
    expect('restOff' in out).toBe(false)
  })

  it('"No timer" is saved as restOff, and Default takes it away again', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 75 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    act(() => restRow(host).click())
    pick(render(useUI.getState().sheets.at(-1)), 'No timer')
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).toMatchObject({ restOff: true })
    expect('restSec' in onSave.mock.calls[0][0]).toBe(false)

    const again = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restOff: true }, again)
    const host2 = render(useUI.getState().sheets.at(-1))
    expect(restRow(host2).querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => restRow(host2).click())
    pick(render(useUI.getState().sheets.at(-1)), 'Default (2:00)')
    act(() => save(host2))
    expect('restOff' in again.mock.calls[0][0] || 'restSec' in again.mock.calls[0][0]).toBe(false)
  })

  it('cardio keeps its "No timer" too', () => {
    const onSave = vi.fn()
    const bike = EXIDX['2138']
    exConfigSheet(bike, { sets: 1, min: 20, speed: 8, restOff: true }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => save(host))
    expect(onSave.mock.calls[0][0].restOff).toBe(true)
  })

  it('Pick a time opens on the default rest that applies, not on 0:00, and keeps what it picks (#735)', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps' }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    act(() => restRow(host).click())
    pick(render(useUI.getState().sheets.at(-1)), 'Pick a time')
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('h3').textContent).toBe('Rest for this exercise')
    expect(wheel.querySelector('.dw-read').textContent).toBe('2:00')
    done(wheel)
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('2:00')
    act(() => save(host))
    expect(onSave.mock.calls[0][0].restSec).toBe(120)
  })

  it('shows an exercise’s own rest as a time, and the wheel opens on it', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 75 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('1:15')
    act(() => restRow(host).click())
    pick(render(useUI.getState().sheets.at(-1)), 'Pick a time')
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('.dw-read').textContent).toBe('1:15')
    done(wheel)
    act(() => save(host))
    expect(onSave.mock.calls[0][0].restSec).toBe(75)
  })

  it('the warm-ups’ wheel opens on their rest that applies: the profile’s, else the work sets’ (#735)', () => {
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupSets: 2, restSec: 75 }, vi.fn())
    let host = render(useUI.getState().sheets.at(-1))
    const warmRow = h => [...h.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Rest between warm-ups')
    act(() => warmRow(host).click())
    pick(render(useUI.getState().sheets.at(-1)), 'Pick a time')
    expect(render(useUI.getState().sheets.at(-1)).querySelector('.dw-read').textContent).toBe('1:15')

    useStore.setState(s => ({ S: { ...s.S, warmupRestSec: 40 } }))
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', warmupSets: 2, restSec: 75 }, vi.fn())
    host = render(useUI.getState().sheets.at(-1))
    act(() => warmRow(host).click())
    pick(render(useUI.getState().sheets.at(-1)), 'Pick a time')
    expect(render(useUI.getState().sheets.at(-1)).querySelector('.dw-read').textContent).toBe('40s')
    useStore.setState(s => { const { warmupRestSec, ...rest } = s.S; return { S: rest } })
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

  it('a per-side hold can turn its switch pause off on its own; a reps set never writes that (#636)', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, sec: 30, weight: 0, mode: 'time', side: true, restSec: 60 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Rest between sides').querySelector('.lrow-v').textContent).toBe('Default (10s)')
    act(() => row(host, 'Rest between sides').click())
    const menu = render(lastMenuItems())
    act(() => [...menu.querySelectorAll('.menu-item')].find(b => b.textContent.includes('No timer')).click())
    expect(row(host, 'Rest between sides').querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).toMatchObject({ mode: 'time', side: true, sideRestOff: true, restSec: 60 })
    expect('sideRestSec' in onSave.mock.calls[0][0]).toBe(false)

    const reps = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', side: true, sideRestOff: true }, reps)
    const host2 = render(useUI.getState().sheets.at(-1))
    expect(row(host2, 'Rest between sides').querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => save(host2))
    expect('sideRestOff' in reps.mock.calls[0][0]).toBe(false)
  })
})
