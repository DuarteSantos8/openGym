// @vitest-environment happy-dom
// An exercise's own weight unit (#657) on its settings sheet: the "Weight unit" row writes the
// stamped pin, the sheet shows and edits the slot in that unit, and saves it in the profile's.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, barWeightSheet, dumbbellInventorySheet } from './sheets.jsx'
import { withExUnit } from './lib/ex-unit.js'
import { bindUI } from './components/ui.jsx'
import { EXIDX } from './lib/exercises.js'

const BENCH = '0025'   // barbell bench press

const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const S = () => useStore.getState().S
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const stepper = (host, label) => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)
const valueOf = (host, label) => stepper(host, label)?.querySelector('input').value
const tap = (host, label, dir) => act(() => stepper(host, label).querySelectorAll('button')[dir > 0 ? 1 : 0].click())
const pickUnit = (host, label) => {
  act(() => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Weight unit').click())
  const picker = mountTopSheet()
  act(() => [...picker.querySelectorAll('button.lrow')].find(el => el.querySelector('.lrow-t')?.textContent === label).click())
}

const slot = { sets: 3, reps: 5, mode: 'reps', weight: 61.235 }

describe('the exercise’s weight unit', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('the exercise used here is what the test assumes', () => {
    expect(EXIDX[BENCH].eq).toBe('barbell')
  })

  it('a pinned slot shows and steps in lb, and saving untouched keeps the stored kg', () => {
    useStore.setState({ S: { ...S(), exUnit: withExUnit({}, BENCH, 'lb', 1) } })
    const onSave = vi.fn()
    act(() => exConfigSheet(EXIDX[BENCH], slot, onSave))
    const host = mountTopSheet()
    expect(valueOf(host, 'Weight (lb)')).toBe('135')
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0].weight).toBe(61.235)
  })

  it('a step in lb is saved as the exact kg', () => {
    useStore.setState({ S: { ...S(), exUnit: withExUnit({}, BENCH, 'lb', 1) } })
    const onSave = vi.fn()
    act(() => exConfigSheet(EXIDX[BENCH], slot, onSave))
    const host = mountTopSheet()
    // The weight stepper on this sheet steps 2.5 in the unit on screen.
    tap(host, 'Weight (lb)', 1)
    tap(host, 'Weight (lb)', 1)
    expect(valueOf(host, 'Weight (lb)')).toBe('140')
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0].weight).toBe(63.5029)
  })

  it('the row pins the exercise, stamped, and the open sheet converts what it holds', () => {
    const onSave = vi.fn()
    act(() => exConfigSheet(EXIDX[BENCH], { ...slot, weight: 20.4117 }, onSave))
    const host = mountTopSheet()
    // Stored to four places, shown clean in the profile's own unit.
    expect(valueOf(host, 'Weight (kg)')).toBe('20.41')
    pickUnit(host, 'lb')
    expect(S().exUnit[BENCH]).toEqual({ unit: 'lb', _ts: expect.any(Number) })
    expect(valueOf(host, 'Weight (lb)')).toBe('45')
    // Back to the profile and to lb again: the same number, no drift.
    pickUnit(host, 'Profile default (kg)')
    expect(S().exUnit[BENCH].unit).toBe(null)
    pickUnit(host, 'lb')
    expect(valueOf(host, 'Weight (lb)')).toBe('45')
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0].weight).toBe(20.4117)
  })

  it('the bar of a pinned barbell is the 45 lb one, and one of its own is stored in kg', () => {
    useStore.setState({ S: { ...S(), exUnit: withExUnit({}, BENCH, 'lb', 1) } })
    act(() => barWeightSheet(BENCH, { id: BENCH }))
    const host = mountTopSheet()
    expect(valueOf(host, 'Bar (lb)')).toBe('45')
    act(() => button(host, '35 lb').click())
    expect(S().barWeights[BENCH]).toBe(15.8757)
    expect(valueOf(host, 'Bar (lb)')).toBe('35')
  })

  it('the dumbbell list offers the other unit only while an exercise uses it, and edits that list', () => {
    act(() => dumbbellInventorySheet())
    let host = mountTopSheet()
    expect(host.querySelector('.seg-inline')).toBeNull()
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    useStore.setState({ S: { ...S(), exUnit: withExUnit({}, '0294', 'lb', 1) } })
    act(() => dumbbellInventorySheet())
    host = mountTopSheet()
    act(() => button(host, 'lb').click())
    act(() => button(host, 'Fill in 5 to 100 lb, every 5').click())
    expect(S().dumbbells.lb.weights[0]).toBe(5)
    expect(S().dumbbells.kg).toBeUndefined()
  })

  it('after unpinning, the field shows 20.41 and an untouched save keeps the exact 20.4117', () => {
    useStore.setState({ S: { ...S(), exUnit: withExUnit({}, BENCH, null, 2) } })
    const onSave = vi.fn()
    act(() => exConfigSheet(EXIDX[BENCH], { ...slot, weight: 20.4117 }, onSave))
    const host = mountTopSheet()
    expect(valueOf(host, 'Weight (kg)')).toBe('20.41')
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0].weight).toBe(20.4117)
  })

  it('after a CSV round trip (20.41 kg), a lb-pinned slot shows 45, keeps 20.41 untouched and steps from 45', () => {
    useStore.setState({ S: { ...S(), exUnit: withExUnit({}, BENCH, 'lb', 1) } })
    const onSave = vi.fn()
    act(() => exConfigSheet(EXIDX[BENCH], { ...slot, weight: 20.41 }, onSave))
    const host = mountTopSheet()
    expect(valueOf(host, 'Weight (lb)')).toBe('45')
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0].weight).toBe(20.41)
    act(() => exConfigSheet(EXIDX[BENCH], { ...slot, weight: 20.41 }, onSave))
    const again = mountTopSheet()
    tap(again, 'Weight (lb)', 1)
    expect(valueOf(again, 'Weight (lb)')).toBe('47.5')
  })
})
