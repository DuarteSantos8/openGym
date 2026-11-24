// @vitest-environment happy-dom
// Issue #71: choosing a body part after picking an equipment type used to reset the equipment
// filter to "all equipment", even when the new muscle group still had exercises for it. The
// per-body-part chips no longer clear the equipment selection; the eqOn fallback only drops it
// for the current view when the new body part has nothing under that equipment.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'

const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

// The two chip strips render in order: body parts first, then equipment. Grab a chip by its
// visible label out of the whole picker.
const chipByText = (host, text) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const isOn = el => el.className.split(/\s+/).includes('on')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('exercise picker equipment filter', () => {
  // The exact reproduction from issue #71: "lower arms" + "dumbbell", then switch to "upper arms".
  // Both body parts have dumbbell exercises, so the filter must stay selected across the switch.
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () => {
    exercisePicker(vi.fn())
    const host = renderTop()

    // lower arms → dumbbell
    act(() => chipByText(host, 'lower arms').click())
    const eqChip = chipByText(host, 'dumbbell')
    expect(eqChip, 'dumbbell chip should be offered under lower arms').toBeTruthy()
    act(() => eqChip.click())
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    // switch to upper arms — dumbbell is still valid there, so it must remain selected
    act(() => chipByText(host, 'upper arms').click())
    expect(isOn(chipByText(host, 'upper arms'))).toBe(true)
    const eqAfter = chipByText(host, 'dumbbell')
    expect(eqAfter, 'dumbbell chip should still be present under upper arms').toBeTruthy()
    expect(isOn(eqAfter)).toBe(true)
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(false)
  })

  // Discord "Pick more than one equipment and type": cables or dumbbells, both at once.
  it('takes more than one equipment, lists any of them, and a second tap takes one off', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => chipByText(host, 'upper arms').click())
    const count = () => Number(host.querySelector('.search-count').textContent.replace(/\D/g, ''))
    act(() => chipByText(host, 'dumbbell').click())
    const dumbbells = count()
    act(() => chipByText(host, 'cable').click())
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)
    expect(isOn(chipByText(host, 'cable'))).toBe(true)
    const both = count()
    act(() => chipByText(host, 'dumbbell').click())
    const cables = count()
    act(() => chipByText(host, 'dumbbell').click())
    // any of the two: the dumbbell exercises and the cable ones together
    expect(both).toBe(dumbbells + cables)
    expect(cables).toBeGreaterThan(0)
    act(() => chipByText(host, 'cable').click())
    expect(isOn(chipByText(host, 'cable'))).toBe(false)
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)
    act(() => chipByText(host, 'Any equipment').click())
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(false)
  })
})

// #1082: the picker finds an exercise by the machine brand set for it at a gym.
describe('exercise picker: search by machine brand', () => {
  it('lists the exercise kept per gym under its brand', async () => {
    const { CATALOGUE } = await import('./lib/exercises.js')
    const ext = CATALOGUE.find(e => /^lever leg extension$/i.test(e.n))
    useStore.setState(s => ({ S: { ...s.S, exGym: { [ext.id]: { split: true, brands: { g1: 'Technogym' } } } } }))
    exercisePicker(vi.fn())
    const host = renderTop()
    const input = host.querySelector('input')
    act(() => {
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, 'technogym')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const names = [...host.querySelectorAll('.item .tt')].map(x => x.textContent.toLowerCase()).filter(n => n !== 'create your own exercise')
    expect(names[0]).toContain('lever leg extension')
  })
})
