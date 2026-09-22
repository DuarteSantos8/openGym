// @vitest-environment happy-dom
// The effort picker's "Exact" field used to write through on every change, and onPick concludes
// the set (issue #64): it ticks the set, beeps and starts the rest. So typing the `1` of `10`,
// or one tap of `+` (stepEffort returns the band minimum from null), logged a rating under the
// sheet you were still typing into — and on the last set of the last exercise, stacked the
// workout-complete dialog on top of it. Every earlier test mocked the sheet away and called
// onPick directly, so nothing rendered the real component. This does.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from './store/useUI.js'
import { effortPickerSheet } from './sheets.jsx'

const mounted = []

// Renders the real EffortPicker the way Modals does, and hands back the ways it can go away.
const openPicker = (kind, value, onPick) => {
  effortPickerSheet(kind, value, onPick)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  let closedByComponent = false
  act(() => root.render(sheet.render(() => { closedByComponent = true })))
  return {
    host,
    closed: () => closedByComponent,
    // Backdrop, swipe and Escape all end the same way: the sheet unmounts.
    dismiss: () => act(() => root.unmount()),
  }
}
const presetRows = host => [...host.querySelectorAll('.menu-item')].filter(r => !r.classList.contains('effpick-free'))
const buttonSaying = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const field = host => host.querySelector('input')
const tap = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
// React tracks the input's value through the prototype setter, so a bare el.value never reaches
// onChange. Same helper the weight-input and custom-target sheet tests use.
const type = (host, value) => act(() => {
  const el = field(host)
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })

afterEach(() => {
  mounted.forEach(r => { try { act(() => r.unmount()) } catch { /* already unmounted */ } })
  mounted.length = 0
  document.body.innerHTML = ''
  useUI.setState({ sheets: [] })
})

describe('the effort picker commits once', () => {
  it('a preset row still logs on the tap, and closes', () => {
    const onPick = vi.fn()
    const p = openPicker('rir', null, onPick)
    const rows = presetRows(p.host)
    expect(rows.length).toBeGreaterThan(1)
    tap(rows[1])
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(p.closed()).toBe(true)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)      // the unmount must not log a second time
  })

  it('typing an exact value logs nothing until the sheet goes away', () => {
    const onPick = vi.fn()
    const p = openPicker('rpe', null, onPick)
    type(p.host, '1')
    expect(onPick).not.toHaveBeenCalled()        // this is the bug: `1` used to be a rating
    type(p.host, '10')
    expect(onPick).not.toHaveBeenCalled()
    expect(p.closed()).toBe(false)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(10)
  })

  it('one tap of + logs nothing', () => {
    const onPick = vi.fn()
    const p = openPicker('rir', null, onPick)
    tap(p.host.querySelector('[aria-label="Increase"]'))
    expect(onPick).not.toHaveBeenCalled()
    expect(field(p.host).value).not.toBe('')     // the number moved on screen, though
  })

  it('Done logs the typed value once, and the unmount after it does not repeat', () => {
    const onPick = vi.fn()
    const p = openPicker('rir', null, onPick)
    type(p.host, '3')
    tap(buttonSaying(p.host, 'Done'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(3)
    expect(p.closed()).toBe(true)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('opening and dismissing without touching anything logs nothing', () => {
    const onPick = vi.fn()
    openPicker('rir', null, onPick).dismiss()
    expect(onPick).not.toHaveBeenCalled()
    // Same for a set that already carries a rating: reopening it must not re-log and re-tick.
    const again = vi.fn()
    openPicker('rir', 2, again).dismiss()
    expect(again).not.toHaveBeenCalled()
  })

  it('Clear rating logs null once', () => {
    const onPick = vi.fn()
    const p = openPicker('rir', 2, onPick)
    tap(buttonSaying(p.host, 'Clear rating'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(null)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('typing a value then clearing it back to empty logs nothing', () => {
    const onPick = vi.fn()
    const p = openPicker('rir', null, onPick)
    type(p.host, '4')
    type(p.host, '')
    p.dismiss()
    expect(onPick).not.toHaveBeenCalled()
  })
})
