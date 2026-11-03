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
import { importFromApp } from '../sheets.jsx'

// #718 follow-up: a custom measurement can have no unit at all (a scale's visceral fat rating,
// a metabolic age), and our own body CSV brings measurements back in.
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
const visc = { id: 'visc', name: 'Visceral fat', unit: 'none', enabled: true }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  bindUI(useUI)
  useUI.setState({ sheets: [], toast: vi.fn() })
  install({})
})
afterEach(() => {
  act(() => mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }))
})

describe('a custom measurement without a unit', () => {
  it('can be created as "No unit"', () => {
    manageMeasurementsSheet()
    const host = topSheet()
    act(() => unitRows(host).at(-1).click())
    const picker = topSheet()
    act(() => button(picker, 'No unit').click())
    type(host.querySelector('input[placeholder="Custom measurement"]'), 'Visceral fat')
    act(() => button(host, 'Add').click())
    expect(useStore.getState().S.customMeasurements).toEqual([expect.objectContaining({ name: 'Visceral fat', unit: 'none' })])
  })

  it('logs a plain number, zero included, with nothing after it', () => {
    install({ unit: 'lb', customMeasurements: [visc] })
    measurementLogSheet()
    const host = topSheet()
    expect(field(host, 'Visceral fat').querySelector('i').textContent).toBe('')
    type(field(host, 'Visceral fat').querySelector('input'), '0')
    act(() => button(host, 'Save').click())
    expect(useStore.getState().S.measurements[0].other[0]).toMatchObject({ value: 0, unit: 'none' })
  })

  it('shows the number on its own on the page', () => {
    install({ customMeasurements: [visc], measurements: [
      { d: '2026-10-01', other: [{ id: 'visc', value: 9, unit: 'none' }] },
      { d: '2026-10-02', other: [{ id: 'visc', value: 8, unit: 'none' }] },
    ] })
    const host = render(<MemoryRouter><Measurements /></MemoryRouter>)
    expect(host.querySelector('.big').textContent.trim()).toBe('8')
    expect(host.textContent).toContain('-1 since previous')
    expect(host.querySelector('.measure-preview b').textContent.trim()).toBe('8')
  })
})

describe('importing our own body CSV', () => {
  it('counts the measurement check-ins it brings, even without a single weigh-in', async () => {
    install({ unit: 'kg', bodyweight: [] })
    const file = new File(['date,weight_kg,waist_cm,Visceral fat\n2026-10-01,,84,9\n2026-10-02,,83.5,8\n'], 'body.csv', { type: 'text/csv' })
    importFromApp(file)
    for (let i = 0; i < 50 && !useUI.getState().sheets.length; i++) await new Promise(r => setTimeout(r, 5))
    const host = topSheet()
    const tiles = [...host.querySelectorAll('.tile')].map(t => t.textContent)
    expect(tiles).toContain('Body measurements2')
    act(() => button(host, 'Import').click())
    expect(useStore.getState().S.measurements.map(e => e.d)).toEqual(['2026-10-01', '2026-10-02'])
    expect(useStore.getState().S.customMeasurements).toEqual([expect.objectContaining({ name: 'Visceral fat', unit: 'none' })])
    expect(useUI.getState().toast).toHaveBeenCalledWith('2 measurement check-ins imported')
  })
})
