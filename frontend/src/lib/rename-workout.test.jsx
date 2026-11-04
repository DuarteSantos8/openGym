// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { renameWorkoutSheet, addRoutineToSessionSheet } from '../sheets.jsx'
import { ruleOccurrence } from './test-fixtures.js'

const mounted = []
const fiveAt60 = r => ({ ...r, parameters: { ...r.parameters, sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 60, unit: 'kg' } } })
const routine = (id, name, exerciseId) => ({ id, name, ex: [ruleOccurrence(exerciseId, { occurrenceId: id + '-1', routineId: id, patch: fiveAt60 })] })
function render(open) {
  open()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const unmountAll = () => act(() => { mounted.splice(0).forEach(r => r.unmount()) })

describe('rename workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(unmountAll)

  it('renames an active workout and disables save on empty input', () => {
    useStore.setState({
      A: { id: 'w1', d: '2026-08-25', start: 1, name: 'Leg Day', entries: [] },
    })

    const host = render(() => renameWorkoutSheet())
    const input = host.querySelector('input')
    const saveBtn = [...host.querySelectorAll('button')].find(b => /save/i.test(b.textContent))

    expect(input.value).toBe('Leg Day')
    expect(saveBtn.disabled).toBe(false)

    // Type blank whitespace
    act(() => { type(input, '   ') })
    expect(saveBtn.disabled).toBe(true)

    // Type a new title and save
    act(() => { type(input, 'Heavy Squats & Core') })
    expect(saveBtn.disabled).toBe(false)
    act(() => { saveBtn.click() })

    const active = useStore.getState().A
    expect(active.name).toBe('Heavy Squats & Core')
    expect(active.customName).toBe(true)

    expect(active.name).toBe('Heavy Squats & Core')
  })

  it('submits on Enter key press', () => {
    useStore.setState({
      A: { id: 'w1', d: '2026-08-25', start: 1, name: 'Upper A', entries: [] },
    })

    const host = render(() => renameWorkoutSheet())
    const input = host.querySelector('input')

    act(() => { type(input, 'Upper Power') })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const active = useStore.getState().A
    expect(active.name).toBe('Upper Power')
    expect(active.customName).toBe(true)
  })

  it('preserves custom renamed title when another routine is added to the session', () => {
    useStore.setState(s => ({
      S: {
        ...s.S,
        routines: [
          routine('r1', 'Routine 1', 'bench_press'),
          routine('r2', 'Routine 2', 'squat'),
        ],
      },
      A: {
        id: 'w1',
        d: '2026-08-25',
        start: 1,
        name: 'My Special Workout',
        customName: true,
        routineIds: ['r1'],
        exposures: [{ routineId: 'r1' }],
        entries: [],
      },
    }))

    const host = render(() => addRoutineToSessionSheet())
    // Click on Routine 2
    const items = [...host.querySelectorAll('.item')].filter(el => !el.classList.contains('disabled'))
    expect(items.length).toBeGreaterThan(0)
    act(() => { items[0].click() })

    const active = useStore.getState().A
    // The name should remain 'My Special Workout' instead of being overwritten with 'Routine 1 + Routine 2'
    expect(active.name).toBe('My Special Workout')
    expect(active.routineIds).toContain('r2')
  })
})
