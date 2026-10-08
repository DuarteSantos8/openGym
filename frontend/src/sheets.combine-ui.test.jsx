// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { addRoutineToSessionSheet, workoutDetailSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { ruleOccurrence } from './lib/test-fixtures.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter(e => e.bp !== 'cardio').slice(0, 4).map(e => e.id)
const mounted = []
const fiveAt60 = r => ({ ...r, parameters: { ...r.parameters, sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 60, unit: 'kg' } } })
const routine = (id, name, exercises, over = {}) => ({ id, name, ex: exercises.map((exerciseId, i) => ruleOccurrence(exerciseId, { occurrenceId: id + '-' + i, routineId: id, patch: fiveAt60 })), ...over })

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const rowFor = (host, name) => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('Add routine mid-session sheet', () => {
  const setup = () => {
    const S = clone(useStore.getState().S)
    S.routines = [
      routine('strength', 'Strength', [ids[0]]),
      routine('core', 'Core', [ids[1], ids[2]]),
      routine('empty', 'Empty', []),
    ]
    S.workouts = []
    const A = {
      id: 'a', d: '2026-09-06', start: 1, routineIds: ['strength'], name: 'Strength', cur: 0,
      exposures: [{ routineId: 'strength' }], entries: [],
      workoutView: 'cards',
    }
    useStore.setState({ S, A, user: null })
  }

  it('appends the picked routine’s exposures, updates routineIds + name, toasts', () => {
    setup()
    addRoutineToSessionSheet()
    const host = renderTop()
    act(() => { rowFor(host, 'Core').click() })

    const a = useStore.getState().A
    expect(a.routineIds).toEqual(['strength', 'core'])
    expect(a.name).toBe('Strength + Core')
    expect(a.exposures.map(x => x.routineId)).toEqual(['strength', 'core', 'core'])
    expect(a.cur).toBe(0)                    // current unit is left where it was
    expect(useUI.getState().toastMsg).toContain('Core added')
  })

  it('disables a routine already in the session and one with no exercises', () => {
    setup()
    addRoutineToSessionSheet()
    const host = renderTop()
    expect(rowFor(host, 'Strength').className).toContain('disabled')
    expect(rowFor(host, 'Strength').textContent).toContain('already added')
    expect(rowFor(host, 'Empty').className).toContain('disabled')
    expect(rowFor(host, 'Empty').textContent).toContain('no exercises')
  })
})

describe('WorkoutDetail — per-routine grouping', () => {
  const combined = {
    id: 'w', d: '2026-09-06', start: 1, end: 2, name: 'Strength + Core', vol: 500,
    routineIds: ['strength', 'core'], prs: [],
    exposures: [
      { exerciseId: ids[0], routineId: 'strength', performance: { sets: [{ status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 60 }, segments: [] }, { status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 60 }, segments: [] }] } },
      { exerciseId: ids[1], routineId: 'core', performance: { sets: [{ status: 'completed', observations: [{ metric: 'repetitions', value: 12 }], resistance: { kind: 'bodyweight' }, segments: [] }] } },
    ],
  }
  const legacy = {
    id: 'w2', d: '2026-09-06', start: 1, end: 2, name: 'Push', vol: 100, routineIds: ['strength'], prs: [],
    exposures: [{ exerciseId: ids[0], performance: { sets: [{ status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 100 }, segments: [] }] } }],
  }

  beforeEach(() => {
    const S = clone(useStore.getState().S)
    S.routines = [
      { id: 'strength', name: 'Strength', emoji: '🏋️', ex: [] },
      { id: 'core', name: 'Core', emoji: '🧘', ex: [] },
    ]
    useStore.setState({ S, user: null })
  })

  it('groups a combined workout into per-routine sections with a sets/volume subheader', () => {
    const host = (workoutDetailSheet(combined), renderTop())
    expect(host.textContent).toContain('Strength')
    expect(host.textContent).toContain('Core')
    expect(host.textContent).toMatch(/2 sets/)
    expect(host.textContent).toMatch(/1 sets|1 set/)
  })

  it('renders a legacy single-routine workout flat — no routine subheader', () => {
    const host = (workoutDetailSheet(legacy), renderTop())
    // the only routine name that could appear is the header <h3> (w.name = "Push"); there is
    // no "Strength" subheader row
    expect(host.querySelectorAll('.row.between').length).toBe(0)
  })
})
