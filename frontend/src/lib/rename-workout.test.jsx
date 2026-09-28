// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { renameWorkoutSheet, addRoutineToSessionSheet } from '../sheets.jsx'
import { buildCompletedWorkout } from './finish-workout.js'

const mounted = []
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
    useStore.setState(s => ({
      S: {
        ...s.S,
        active: { id: 'w1', d: '2026-08-25', start: 1, name: 'Leg Day', entries: [] },
      },
    }))

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

    const active = useStore.getState().S.active
    expect(active.name).toBe('Heavy Squats & Core')
    expect(active.customName).toBe(true)

    // Survives completion
    const completed = buildCompletedWorkout(active, { end: 2 })
    expect(completed.name).toBe('Heavy Squats & Core')
  })

  it('submits on Enter key press', () => {
    useStore.setState(s => ({
      S: {
        ...s.S,
        active: { id: 'w1', d: '2026-08-25', start: 1, name: 'Upper A', entries: [] },
      },
    }))

    const host = render(() => renameWorkoutSheet())
    const input = host.querySelector('input')

    act(() => { type(input, 'Upper Power') })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const active = useStore.getState().S.active
    expect(active.name).toBe('Upper Power')
    expect(active.customName).toBe(true)
  })

  it('preserves custom renamed title when another routine is added to the session', () => {
    useStore.setState(s => ({
      S: {
        ...s.S,
        routines: [
          { id: 'r1', name: 'Routine 1', ex: [{ id: 'bench_press' }] },
          { id: 'r2', name: 'Routine 2', ex: [{ id: 'squat' }] },
        ],
        active: {
          id: 'w1',
          d: '2026-08-25',
          start: 1,
          name: 'My Special Workout',
          customName: true,
          routineIds: ['r1'],
          entries: [{ id: 'bench_press', sets: [] }],
        },
      },
    }))

    const host = render(() => addRoutineToSessionSheet())
    // Click on Routine 2
    const items = [...host.querySelectorAll('.item')].filter(el => !el.classList.contains('disabled'))
    expect(items.length).toBeGreaterThan(0)
    act(() => { items[0].click() })

    const active = useStore.getState().S.active
    // The name should remain 'My Special Workout' instead of being overwritten with 'Routine 1 + Routine 2'
    expect(active.name).toBe('My Special Workout')
    expect(active.routineIds).toContain('r2')
  })
})
