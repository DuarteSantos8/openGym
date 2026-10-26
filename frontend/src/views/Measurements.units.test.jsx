// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Measurements, { manageMeasurementsSheet, measurementLogSheet } from './Measurements.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindUI } from '../components/ui.jsx'
import { normalizeMeasurementsState } from '../lib/measurements.js'

const mounted = []
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(node))
  return host
}
function topSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const buttons = host => [...host.querySelectorAll('button')]
const button = (host, text) => buttons(host).find(el => el.textContent.trim() === text)
const unitRows = host => buttons(host).filter(el => el.querySelector('.lrow-t')?.textContent === 'Measurement unit')
const field = (host, name) => [...host.querySelectorAll('.measure-field')].find(el => el.firstElementChild.textContent === name)
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const install = patch => useStore.setState({ S: normalizeMeasurementsState({ ...structuredClone(DEF), measurementEnabled: [], ...patch }), user: null })
const custom = (id, unit, enabled = true) => ({ id, name: id, unit, enabled })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00Z') })
  bindUI(useUI)
  useUI.setState({ sheets: [], toast: vi.fn() })
  install({})
})
afterEach(() => {
  act(() => mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }))
  vi.useRealTimers()
})

describe('custom measurement units in the app (#699)', () => {
  it.each(['%', 'kg', 'lb', 'cm', 'in'])('creates a custom field with unit %s', unit => {
    manageMeasurementsSheet()
    const host = topSheet()
    act(() => unitRows(host).at(-1).click())
    const picker = topSheet()
    act(() => button(picker, unit).click())
    type(host.querySelector('input[placeholder="Custom measurement"]'), 'Muscle mass')
    act(() => button(host, 'Add').click())
    expect(useStore.getState().S.customMeasurements).toEqual([
      expect.objectContaining({ name: 'Muscle mass', unit, enabled: true })
    ])
  })

  it('logs percentages, masses and legacy lengths with the right units on a pounds profile', () => {
    install({ unit: 'lb', customMeasurements: [custom('Muscle ratio', '%'), custom('Lean mass', 'kg'), custom('Knee', undefined)] })
    measurementLogSheet()
    const host = topSheet()
    expect(field(host, 'Muscle ratio').querySelector('i').textContent).toBe('%')
    expect(field(host, 'Lean mass').querySelector('i').textContent).toBe('kg')
    expect(field(host, 'Knee').querySelector('i').textContent).toBe('in')
    type(field(host, 'Muscle ratio').querySelector('input'), '40.5')
    type(field(host, 'Lean mass').querySelector('input'), '60')
    type(field(host, 'Knee').querySelector('input'), '15')
    act(() => button(host, 'Save').click())
    expect(useStore.getState().S.measurements[0].other).toEqual([
      { id: 'Muscle ratio', name: 'Muscle ratio', value: 40.5, unit: '%' },
      { id: 'Lean mass', name: 'Lean mass', value: 60, unit: 'kg' },
      { id: 'Knee', name: 'Knee', value: 38.1 },
    ])
  })

  it('edits a disabled percent field without converting it to a circumference', () => {
    install({ unit: 'lb', customMeasurements: [custom('Muscle ratio', '%', false)],
      measurements: [{ d: '2026-10-01', other: [{ id: 'Muscle ratio', value: 40.5 }] }],
    })
    measurementLogSheet('2026-10-01')
    const host = topSheet()
    const input = field(host, 'Muscle ratio').querySelector('input')
    expect(input.value).toBe('40.5')
    type(input, '42')
    act(() => button(host, 'Save').click())
    expect(useStore.getState().S.measurements[0].other[0]).toMatchObject({ value: 42, unit: '%' })
  })

  it('shows the same percent value, delta and history after changing the profile to pounds', () => {
    install({ customMeasurements: [custom('Muscle ratio', '%')], measurements: [
      { d: '2026-10-01', other: [{ id: 'Muscle ratio', value: 40 }] },
      { d: '2026-10-02', other: [{ id: 'Muscle ratio', value: 40.5 }] },
    ] })
    const host = render(<MemoryRouter><Measurements /></MemoryRouter>)
    expect(host.querySelector('.big').textContent).toBe('40.5 %')
    expect(host.textContent).toContain('+0.5 % since previous')
    expect(host.querySelector('.measure-preview b').textContent).toBe('40.5 %')
    expect(host.querySelector('.chart svg')).toBeTruthy()
    act(() => useStore.setState(s => ({ S: { ...s.S, unit: 'lb' } })))
    expect(host.querySelector('.big').textContent).toBe('40.5 %')
    expect(host.querySelector('.measure-preview b').textContent).toBe('40.5 %')
  })

  it('rejects a percentage above 100 without writing, and accepts zero', () => {
    install({ customMeasurements: [custom('Muscle ratio', '%')] })
    measurementLogSheet()
    const host = topSheet()
    type(field(host, 'Muscle ratio').querySelector('input'), '101')
    act(() => button(host, 'Save').click())
    expect(useStore.getState().S.measurements).toEqual([])
    expect(useUI.getState().toast).toHaveBeenCalledWith('Muscle ratio must be between 0 and 100%.')
    type(field(host, 'Muscle ratio').querySelector('input'), '0')
    act(() => button(host, 'Save').click())
    expect(useStore.getState().S.measurements[0].other[0]).toMatchObject({ value: 0, unit: '%' })
  })

  it('offers only cm/in for a field with legacy length history, keeping canonical values unchanged', () => {
    install({ customMeasurements: [custom('Knee', undefined)], measurements: [
      { d: '2026-10-01', other: [{ id: 'Knee', value: 38.1 }] },
    ] })
    manageMeasurementsSheet()
    const host = topSheet()
    act(() => unitRows(host)[0].click())
    const picker = topSheet()
    expect(button(picker, '%')).toBeUndefined()
    expect(button(picker, 'kg')).toBeUndefined()
    act(() => button(picker, 'in').click())
    expect(useStore.getState().S.customMeasurements[0].unit).toBe('in')
    expect(useStore.getState().S.measurements[0].other[0].value).toBe(38.1)
  })
})
