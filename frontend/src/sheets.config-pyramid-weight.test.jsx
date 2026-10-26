// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { migratedFixture } from './lib/test-fixtures.js'
import { planOptions } from './lib/prescription/index.js'

// #445: with Pyramid sets on, the exercise settings had no weight field at all. Each set now has
// its own, next to its reps and rest.
const ex = EXDB.find(e => e.id === '0009')   // a weighted machine exercise
const mounted = []

function renderConfig(cfg, exercise = ex) {
  const onSave = vi.fn()
  exConfigSheet(exercise, migratedFixture({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: exercise.id, sets: 3, reps: 10, weight: 0, mode: 'reps', pyramid: [12, 10, 8], ...cfg }] }] }).routines[0].ex[0], onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return { host, onSave }
}
const weightFields = host => [...host.querySelectorAll('.stp-w')]
  .filter(w => w.querySelector('.stp-l')?.textContent === 'Weight (kg)')
  .map(w => w.querySelector('input.num'))
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const leave = el => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()

describe('exercise settings: weight per pyramid set (#445)', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('shows one weight field per set and saves what was typed', () => {
    const { host, onSave } = renderConfig()
    const fields = weightFields(host)
    expect(fields).toHaveLength(3)
    act(() => { type(fields[0], '40'); leave(fields[0]) })
    act(() => { type(fields[2], '60'); leave(fields[2]) })
    act(() => save(host))
    expect(planOptions(onSave.mock.calls[0][0].rule).setReps).toEqual([12, 10, 8])
    expect(planOptions(onSave.mock.calls[0][0].rule).setWeights).toEqual([40, 0, 60])
  })

  it('opens on the saved weights and writes no field when every set is left at 0', () => {
    const { host, onSave } = renderConfig({ pyramidWeight: [40, 50, 60] })
    expect(weightFields(host).map(f => f.value)).toEqual(['40', '50', '60'])
    const blank = renderConfig()
    act(() => save(blank.host))
    expect(planOptions(blank.onSave.mock.calls[0][0].rule).setWeights?.some(v => v > 0) || false).toBe(false)
    act(() => save(host))
    expect(planOptions(onSave.mock.calls[0][0].rule).setWeights).toEqual([40, 50, 60])
  })

  it('keeps bodyweight work on its one Added load', () => {
    const { host, onSave } = renderConfig({ bodyweight: true, pyramidWeight: [40, 50, 60] })
    expect(weightFields(host)).toHaveLength(0)
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('pyramidWeight')
  })
})
