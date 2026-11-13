// @vitest-environment happy-dom
// A cardio interval measured in calories (lib/calories.js): its first column is Calories in
// place of Duration, never both, and the count is stored on the set with no minutes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const TREADMILL = '2259'   // walking on treadmill
const BIKE = '2138'        // stationary bike, cardio
let root, container

function mount(id, sets, target = {}, more = {}) {
  if (root) unmount()
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = {
    id: 'kcal-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Cardio', bw: null, cur: 0, ...more,
    entries: [{ id, target: { sets: 1, speed: 5, ...target }, sets }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
function unmount() {
  act(() => root.unmount())
  container.remove()
  root = null
}
afterEach(() => { if (root) unmount() })

const cells = () => container.querySelector('.setrow').querySelectorAll('.stp')
const firstCell = () => container.querySelector('.setrow .stp.w')
const stored = () => useStore.getState().S.active.entries[0].sets[0]
const heads = () => [...container.querySelectorAll('.sethead span')].map(s => s.textContent).filter(Boolean)
function type(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('a calorie interval in the workout', () => {
  it('a timed one has Duration and no Calories', () => {
    mount(BIKE, [{ min: 20, speed: 25, done: false }], { min: 20 })
    expect(heads()).toEqual(['Duration (min)', 'Speed (km/h)'])
  })

  it('a calorie one has Calories where Duration was, stepped, stored on the set', () => {
    mount(BIKE, [{ kcal: 50, speed: 25, done: false }], { kcal: 50 })
    expect(cells()).toHaveLength(2)
    expect(heads()).toEqual(['Calories', 'Speed (km/h)'])
    expect(firstCell().querySelector('input').value).toBe('50')
    act(() => firstCell().querySelector('button[aria-label="Increase"]').click())
    expect(stored()).toEqual({ kcal: 55, speed: 25, done: false })
    type(firstCell().querySelector('input'), '187')
    expect(stored().kcal).toBe(187)
    expect('min' in stored()).toBe(false)
  })

  it('keeps the incline on a treadmill, three columns', () => {
    mount(TREADMILL, [{ kcal: 100, speed: 5, incline: 4, done: false }], { kcal: 100 })
    expect(heads()).toEqual(['Calories', 'Speed (km/h)', 'Incline (%)'])
  })

  it('adds a set below with the count and no minutes', () => {
    mount(BIKE, [{ kcal: 60, speed: 25, done: true }], { kcal: 50 })
    const add = [...container.querySelectorAll('button')].find(b => /Add set/.test(b.textContent))
    act(() => add.click())
    expect(useStore.getState().S.active.entries[0].sets[1]).toEqual({ kcal: 60, speed: 25, done: false })
  })

  it('has Calories in place of Duration in the focus view', () => {
    mount(BIKE, [{ kcal: 100, speed: 25, done: false }], { kcal: 100 }, { workoutView: 'focus' })
    expect(container.querySelector('button[aria-label="Increase duration"]')).toBe(null)
    act(() => container.querySelector('button[aria-label="Increase calories"]').click())
    expect(stored().kcal).toBe(105)
    mount(BIKE, [{ min: 20, speed: 25, done: false }], { min: 20 }, { workoutView: 'focus' })
    expect(container.querySelector('button[aria-label="Increase calories"]')).toBe(null)
    expect(container.querySelector('button[aria-label="Increase duration"]')).not.toBe(null)
  })
})

describe('a distance interval in the workout', () => {
  it('has Distance where Duration was, in km, stored on the set with no minutes', () => {
    mount(BIKE, [{ km: 2, speed: 25, done: false }], { km: 2 })
    expect(heads()).toEqual(['Distance (km)', 'Speed (km/h)'])
    expect(firstCell().querySelector('input').value).toBe('2')
    act(() => firstCell().querySelector('button[aria-label="Increase"]').click())
    expect(stored()).toEqual({ km: 2.5, speed: 25, done: false })
    type(firstCell().querySelector('input'), '5.25')
    expect(stored().km).toBe(5.25)
  })

  it('shows and takes miles when the profile reads mph, and stores km', () => {
    mount(BIKE, [{ km: 1.609344, speed: 25, done: false }], { km: 1.609 }, {})
    act(() => useStore.setState(st => ({ S: { ...st.S, speedUnit: 'mph' } })))
    expect(heads()[0]).toBe('Distance (mi)')
    expect(firstCell().querySelector('input').value).toBe('1')
    type(firstCell().querySelector('input'), '3')
    expect(stored().km).toBe(4.828)
  })

  it('has its own stepper in the focus view', () => {
    mount(BIKE, [{ km: 2, speed: 25, done: false }], { km: 2 }, { workoutView: 'focus' })
    act(() => container.querySelector('button[aria-label="Increase distance"]').click())
    expect(stored().km).toBe(2.5)
  })
})
