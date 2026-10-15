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

  const rowNamed = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
  const sideToggle = host => rowNamed(host, 'Rest between sides')?.querySelector('[role="switch"]')
  it('only shows the side-rest toggle for per-side exercises, and reveals the duration when enabled', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, mode: 'reps' }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(sideToggle(host)).toBeUndefined()
    act(() => rowNamed(host, 'Per side').querySelector('[role="switch"]').click())
    expect(sideToggle(host).getAttribute('aria-checked')).toBe('false')
    expect(rowNamed(host, 'Between-side duration')).toBeUndefined()
    act(() => sideToggle(host).click())
    expect(rowNamed(host, 'Between-side duration').textContent).toContain('10s')
    act(() => rowNamed(host, 'Between-side duration').click())
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('h3').textContent).toBe('Rest between sides')
    // Select 30 seconds with the same keyboard interaction as the actual wheel.
    const seconds = wheel.querySelector('[role="spinbutton"][aria-label="Seconds"]')
    act(() => seconds.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    act(() => [...wheel.querySelectorAll('button')].find(b => b.textContent === 'Done').click())
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).toMatchObject({ side: true, sideRestSec: 11 })
  })

  it('preserves explicit Off on a timed exercise and hides the duration', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 2, sec: 30, mode: 'time', side: true }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(sideToggle(host).getAttribute('aria-checked')).toBe('true')
    act(() => sideToggle(host).click())
    expect(rowNamed(host, 'Between-side duration')).toBeUndefined()
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).toMatchObject({ side: true, sideRestSec: 0 })
  })

})
