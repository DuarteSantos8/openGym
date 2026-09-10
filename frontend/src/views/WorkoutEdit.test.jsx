// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkoutEdit from './WorkoutEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../components/Media.jsx', () => ({ default: () => null, Thumb: () => null }))
vi.mock('../sheets.jsx', () => ({
  exercisePicker: vi.fn(),
  exConfigSheet: vi.fn(),
  confirmSheet: vi.fn(opts => opts.onConfirm?.()),
  menuSheet: vi.fn(),
  effortPickerSheet: vi.fn(),
  exerciseDetailSheet: vi.fn(),
  exerciseHistorySheet: vi.fn(),
  barWeightSheet: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container

const testWorkout = {
  id: 'w-test',
  d: '2026-03-01',
  start: 1772360000000,
  end: 1772363600000,
  name: 'Leg Day',
  routineIds: ['r1'],
  routineId: 'r1',
  bw: 80,
  entries: [
    {
      id: '0001', // Barbell Squat
      target: { mode: 'reps' },
      sets: [
        { w: 100, r: 5, done: true },
        { w: 100, r: 5, done: true },
      ],
    },
  ],
  vol: 1000,
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useStore.setState({
    S: {
      ...DEF,
      workouts: [structuredClone(testWorkout)],
      exWeights: { '0001': { w: 90, d: '2026-01-01' } },
    },
    user: null,
  })
  useUI.setState({ toastMsg: '', sheets: [] })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
})

function renderEdit(id = 'w-test') {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/history/edit/${id}`]}>
        <Routes>
          <Route path="/history/edit/:id" element={<WorkoutEdit />} />
          <Route path="/history" element={<div data-testid="history-view">History View</div>} />
        </Routes>
      </MemoryRouter>
    )
  })
}

function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('WorkoutEdit view', () => {
  it('renders workout fields and exercises', () => {
    renderEdit('w-test')
    const titleInput = container.querySelector('input[placeholder="Workout name"]')
    expect(titleInput).not.toBeNull()
    expect(titleInput.value).toBe('Leg Day')

    const setRows = container.querySelectorAll('.setrow')
    expect(setRows.length).toBe(2)
  })

  it('updates title and saves changes to store', () => {
    renderEdit('w-test')
    const titleInput = container.querySelector('input[placeholder="Workout name"]')
    act(() => {
      type(titleInput, 'Heavy Leg Day')
    })

    const saveBtn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Save'))
    expect(saveBtn).not.toBeNull()
    act(() => {
      saveBtn.click()
    })

    const saved = useStore.getState().S.workouts.find(w => w.id === 'w-test')
    expect(saved.name).toBe('Heavy Leg Day')
  })

  it('updates exWeights when higher weight is saved', () => {
    renderEdit('w-test')
    const saveBtn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Save'))
    act(() => {
      saveBtn.click()
    })

    const exWeights = useStore.getState().S.exWeights
    // Original was 90, workout sets were 100
    expect(exWeights['0001'].w).toBe(100)
  })

  it('filters out unchecked sets on save', () => {
    renderEdit('w-test')
    const checkboxes = container.querySelectorAll('button[role="checkbox"]')
    expect(checkboxes.length).toBe(2)

    // Uncheck second set
    act(() => {
      checkboxes[1].click()
    })

    const saveBtn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Save'))
    act(() => {
      saveBtn.click()
    })

    const saved = useStore.getState().S.workouts.find(w => w.id === 'w-test')
    expect(saved.entries[0].sets.length).toBe(1)
  })

  it('adds a set to an exercise', () => {
    renderEdit('w-test')
    const addSetBtn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Add set'))
    expect(addSetBtn).not.toBeNull()

    act(() => {
      addSetBtn.click()
    })

    expect(container.querySelectorAll('.setrow').length).toBe(3)
  })

  it('redirects to /history when workout is not found', () => {
    renderEdit('nonexistent-id')
    expect(container.querySelector('[data-testid="history-view"]')).not.toBeNull()
  })
})
