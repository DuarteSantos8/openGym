// @vitest-environment happy-dom
/* Body measurements, used the way a person uses them: choose the fields, log a check-in, see it,
 * correct it, delete it. Until this file the screen had no test at all (3.7 % of its lines run,
 * test report 2026-10-15) while lib/measurements.js was well covered, so a broken save button or
 * a cm/in mix-up on the form would have shipped green.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.reject(new Error('offline'))), beacon: vi.fn() }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import Measurements, { measurementLogSheet } from './Measurements.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MemoryRouter>{el}</MemoryRouter>))
  return host
}
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return s ? render(s.render(() => useUI.getState().closeSheet(s.id))) : null }
const setValue = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const field = (host, label) => [...host.querySelectorAll('.measure-field')].find(l => l.textContent.startsWith(label)).querySelector('input')
const click = (host, text) => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text).click() })
const toast = () => useUI.getState().toastMsg
const entries = () => useStore.getState().S.measurements

function seed(extra = {}) {
  useStore.setState({ S: Object.assign(clone(DEF), { unit: 'kg', measurementEnabled: ['waist', 'chest', 'bodyFat'], measurements: [] }, extra), user: null })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('logging body measurements', () => {
  it('a check-in typed in cm is saved for today and shows on the screen', () => {
    seed()
    const screen = render(<Measurements />)
    expect(screen.textContent).toContain('No measurements yet')
    act(() => measurementLogSheet())
    const form = topSheet()
    setValue(field(form, 'Waist'), '84.5')
    setValue(field(form, 'Body fat'), '18')
    click(form, 'Save')
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ d: todayISO(), waist: 84.5, bodyFat: 18, chest: null })
    expect(screen.textContent).toContain('84.5')
    expect(screen.textContent).not.toContain('No measurements yet')
  })

  it('in lb a waist typed in inches is stored in cm and read back in inches', () => {
    seed({ unit: 'lb' })
    act(() => measurementLogSheet())
    const form = topSheet()
    setValue(field(form, 'Waist'), '34')
    click(form, 'Save')
    expect(entries()[0].waist).toBeCloseTo(34 * 2.54, 1)   // kept to a millimetre
    const screen = render(<Measurements />)
    expect(screen.textContent).toMatch(/34\s*in/)
  })

  it('refuses an empty check-in and a body fat over 100 %, and saves nothing', () => {
    seed()
    act(() => measurementLogSheet())
    const form = topSheet()
    click(form, 'Save')
    expect(toast()).toMatch(/at least one measurement/)
    setValue(field(form, 'Body fat'), '140')
    click(form, 'Save')
    expect(toast()).toMatch(/between 0 and 100/)
    expect(entries()).toEqual([])
  })

  it('a second check-in on the same day is refused: the day is edited instead, and stays one entry', () => {
    const day = todayISO()
    seed({ measurements: [{ d: day, t: 1, waist: 90, chest: null, bodyFat: null, other: [] }] })
    act(() => measurementLogSheet())
    let form = topSheet()
    setValue(field(form, 'Waist'), '88')
    click(form, 'Save')
    expect(entries()).toHaveLength(1)
    expect(entries()[0].waist).toBe(90)
    // Editing the day: the form opens with what was logged, and the change replaces it.
    act(() => measurementLogSheet(day))
    form = topSheet()
    expect(field(form, 'Waist').value).toBe('90')
    setValue(field(form, 'Waist'), '88')
    click(form, 'Save')
    expect(entries()).toHaveLength(1)
    expect(entries()[0].waist).toBe(88)
  })

  it('deleting a check-in asks first and then removes only that day', () => {
    seed({ measurements: [
      { d: '2026-09-01', t: 1, waist: 92, chest: null, bodyFat: null, other: [] },
      { d: '2026-09-15', t: 2, waist: 90, chest: null, bodyFat: null, other: [] },
    ] })
    const screen = render(<Measurements />)
    const del = screen.querySelectorAll('button[aria-label="Delete"]')
    expect(del).toHaveLength(2)
    act(() => del[0].click())           // newest first: 2026-09-15
    expect(entries()).toHaveLength(2)   // nothing gone before the answer
    click(topSheet(), 'Delete')
    expect(entries().map(e => e.d)).toEqual(['2026-09-01'])
  })
})
