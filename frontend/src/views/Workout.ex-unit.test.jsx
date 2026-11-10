// @vitest-environment happy-dom
// An exercise in a weight unit of its own on the workout screen (#657): the rows, the steppers,
// the plates and the warm-up speak its unit, and every change is stored in the profile's.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { withExUnit, shownWeight } from '../lib/ex-unit.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

const BENCH = '0025'   // barbell bench press
const SQUAT = '0043'   // barbell squat
const CURL = '0294'    // dumbbell curl

const work = w => ({ w, r: 5, done: false })
const entry = (id, sets, target = {}) => ({ id, target: { sets: sets.length, reps: 5, mode: 'reps', ...target }, sets })

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
  S.active = { id: 'u-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Units', bw: null, cur: 0, entries, workoutView: S.workoutView }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const heads = () => [...container.querySelectorAll('.sethead .w-sp')].map(el => el.textContent)
const weights = () => [...container.querySelectorAll('.wl-unit')].map(u => [...u.querySelectorAll('.stp input')].filter((_, i) => i % 2 === 0).map(el => el.value))
const stored = (e = 0, i = 0) => useStore.getState().S.active.entries[e].sets[i].w
const tapIn = (unit, label) => act(() => container.querySelectorAll('.wl-unit')[unit].querySelector('.stp [aria-label="' + label + '"]').click())
const LB = { exUnit: withExUnit({}, BENCH, 'lb', 1) }

describe('a pinned exercise in a running session', () => {
  it('labels and shows its own unit, next to an exercise in the profile’s', () => {
    mount([entry(BENCH, [work(61.235)]), entry(SQUAT, [work(100)])], LB)
    expect(heads()).toEqual(['Weight (lb)', 'Weight (kg)'])
    expect(weights()).toEqual([['135'], ['100']])
  })

  it('steps by 5 lb and stores the exact kg', () => {
    mount([entry(BENCH, [work(61.235)])], LB)
    tapIn(0, 'Increase')
    expect(stored()).toBe(63.5029)
    expect(weights()).toEqual([['140']])
    for (let i = 0; i < 20; i++) tapIn(0, 'Increase')
    for (let i = 0; i < 20; i++) tapIn(0, 'Decrease')
    expect(weights()).toEqual([['140']])
    expect(stored()).toBe(63.5029)
  })

  it('a weight typed in lb is stored in kg and cascades to the rows after it', () => {
    mount([entry(BENCH, [work(61.235), work(61.235), work(61.235)])], LB)
    const input = container.querySelector('.stp input')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, '225')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const S = useStore.getState().S
    expect(S.active.entries[0].sets.map(s => s.w)).toEqual([102.0583, 102.0583, 102.0583])
    expect(S.active.entries[0].sets.map(s => shownWeight(S, BENCH, s.w))).toEqual([225, 225, 225])
  })

  it('loads lb plates on the 45 lb bar', () => {
    mount([entry(BENCH, [work(61.235)])], LB)
    const line = container.querySelector('.plateline')
    expect(line.textContent).toContain('45 per side')
  })

  it('walks the lb dumbbell rack on a kg profile', () => {
    mount([entry(CURL, [work(storedOf(25))])], { exUnit: withExUnit({}, CURL, 'lb', 1), dumbbells: { lb: { weights: [20, 25, 30, 35], _ts: 1 }, kg: { weights: [10, 12], _ts: 1 } } })
    tapIn(0, 'Increase')
    expect(weights()).toEqual([['30']])
    tapIn(0, 'Decrease')
    tapIn(0, 'Decrease')
    expect(weights()).toEqual([['20']])
  })

  it('an untouched weight keeps its stored value to the last place', () => {
    // 61.3 kg is 135.143 lb on screen, which would come back as 61.3001: a change of the reps
    // must not move it.
    mount([entry(BENCH, [work(61.3), work(61.3)])], LB)
    const reps = container.querySelectorAll('.stp input')[1]
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(reps, '7')
      reps.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const sets = useStore.getState().S.active.entries[0].sets
    expect(sets[0].r).toBe(7)
    expect(sets.map(s => s.w)).toEqual([61.3, 61.3])
  })

  it('a CSV round trip (20.41 kg) shows 45 lb, keeps 20.41 untouched, and + goes to 50', () => {
    mount([entry(BENCH, [work(20.41)])], LB)
    expect(weights()).toEqual([['45']])
    expect(stored()).toBe(20.41)
    tapIn(0, 'Increase')
    expect(weights()).toEqual([['50']])
  })

  it('after unpinning, a lb-typed weight shows 20.41 kg and stays exact', () => {
    mount([entry(BENCH, [work(20.4117)])], { exUnit: withExUnit({}, BENCH, null, 2) })
    expect(weights()).toEqual([['20.41']])
    expect(stored()).toBe(20.4117)
    // Off the 2.5 grid, a tap adds the step as it always did (#175): 20.41 + 2.5.
    tapIn(0, 'Increase')
    expect(weights()).toEqual([['22.9']])
  })
})

function storedOf(lb) { return Math.round(lb * 0.45359237 * 1e4) / 1e4 }
