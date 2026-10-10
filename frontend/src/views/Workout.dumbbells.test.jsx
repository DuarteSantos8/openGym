// @vitest-environment happy-dom
// Dumbbells on the workout screen: the weight column says what the number means when the exercise
// said (issue #474), and stays "Weight" for one-arm work and for everything as entered. With the
// dumbbells you own listed (#376), + and − walk from bell to bell.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { buildSessionExposures } from '../lib/session-start.js'
import { defaultPlanRule } from '../lib/prescription/index.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

const BENCH = '0289'   // dumbbell bench press
const ROW = '0292'     // dumbbell one arm bent-over row

const work = w => ({ w, r: 8, done: false })
const entry = (id, sets, target = {}) => ({ id, target: { sets: sets.length, reps: 8, mode: 'reps', ...target }, sets })

let root, container
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }) })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = container = null
})

function mount(entries, patch = {}) {
  const S = clone(DEF)
  S.unit = 'kg'
  S.workoutView = 'list'
  Object.assign(S, patch)
  const routine = { id: 'db-routine', ex: entries.map((entry, i) => ({ occurrenceId: 'db-occ-' + i, exerciseId: entry.id,
    rule: defaultPlanRule('linear', { id: 'db-rule-' + i, exerciseId: entry.id, unit: 'kg', load: { mode: 'absolute', value: entry.sets[0].w, unit: 'kg' }, step: { type: 'absolute', value: entry.target.inc || 2.5, unit: 'kg' }, rounding: { mode: 'nearest', step: entry.target.inc || 2.5 } }) })) }
  const exposures = buildSessionExposures(S, routine, { now: Date.now(), newId: s => s })
  entries = entries.map((entry, i) => ({ ...entry, exposureId: exposures[i].exposureId }))
  const A = { exposures, id: 'db-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Dumbbells', bw: null, cur: 0, entries, workoutView: S.workoutView }
  useStore.setState({ S, A, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const heads = () => [...container.querySelectorAll('.sethead .w-sp')].map(el => el.textContent)

describe('dumbbell weight column', () => {
  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[BENCH].eq).toBe('dumbbell')
    expect(EXIDX[ROW].n).toMatch(/one arm/)
  })

  it('names the meaning the session logs in', () => {
    mount([entry(BENCH, [work(20)], { dbLoad: 'each' }), entry(BENCH, [work(40)], { dbLoad: 'total' })])
    expect(heads()).toEqual(['Each (kg)', 'Both (kg)'])
  })

  it('stays Weight as entered and for one-arm work', () => {
    mount([entry(BENCH, [work(20)]), entry(ROW, [work(30)], { dbLoad: 'each' })])
    expect(heads()).toEqual(['Weight (kg)', 'Weight (kg)'])
  })
})

describe('stepper over owned dumbbells', () => {
  const RACK = [3, 6, 8, 9, 11, 13, 15, 17, 18, 19, 21, 24]
  const weightOf = () => container.querySelector('.stp input').value
  const tap = label => act(() => container.querySelector('.stp [aria-label="' + label + '"]').click())

  it('walks the bells you own', () => {
    mount([entry('0294', [work(9)], { inc: 2 })], { dumbbells: { kg: { weights: RACK, _ts: 1 } } })
    tap('Increase')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(11)
    tap('Increase')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(13)
    tap('Decrease')
    tap('Decrease')
    tap('Decrease')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(8)
    expect(weightOf()).toBe('8')
  })

  it('keeps the increment without a list', () => {
    mount([entry('0294', [work(9)], { inc: 2 })], {})
    tap('Increase')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(11)
    tap('Increase')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(13)
    tap('Decrease')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(11)
    // From an even weight the grid takes over again: 10 + 2 = 12, which no rack above holds.
    act(() => useStore.setState(st => { const A = clone(st.A); A.entries[0].sets[0].w = 10; return { A } }))
    tap('Increase')
    expect(useStore.getState().A.entries[0].sets[0].w).toBe(12)
  })
})
