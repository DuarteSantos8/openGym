// @vitest-environment happy-dom
// #887: a cardio exercise logged by distance. The heading switches Speed and Distance, the row
// takes km (or miles), and the speed is worked out from the distance and the minutes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BIKE = '2138'
let root, container

function mount(settings = {}) {
  const S = { ...JSON.parse(JSON.stringify(DEF)), ...settings }
  S.active = { id: 'd', d: '2026-11-03', start: Date.now(), name: 'Cardio', bw: null, cur: 0,
    entries: [{ id: BIKE, target: { sets: 1, min: 30, speed: 8 }, sets: [{ min: 30, speed: 8, done: false }] }] }
  useStore.setState({ S, user: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
afterEach(() => { act(() => root.unmount()); container.remove() })
const cellAt = n => container.querySelector('.setrow').querySelectorAll('.stp')[n]
const type = (n, value) => {
  const input = cellAt(n).querySelector('input')
  act(() => {
    Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const row = () => useStore.getState().S.active.entries[0].sets[0]

describe('cardio by distance (#887)', () => {
  it('switches the heading, shows speed × time, and works the speed out from a typed distance', () => {
    mount()
    const swap = () => container.querySelector('.sethead .hd-swap')
    expect(swap().textContent).toBe('Speed (km/h)')
    act(() => swap().click())
    expect(useStore.getState().S.cardioBy).toEqual({ [BIKE]: 'distance' })
    expect(swap().textContent).toBe('Distance (km)')
    expect(cellAt(1).querySelector('input').value).toBe('4')    // 8 km/h for 30 min
    type(1, '5')
    expect(row()).toMatchObject({ km: 5, speed: 10 })
    type(0, '25')
    expect(row()).toMatchObject({ min: 25, km: 5, speed: 12 })
    act(() => swap().click())
    expect(useStore.getState().S.cardioBy).toEqual({})
    expect(cellAt(1).querySelector('input').value).toBe('12')
  })
  it('in miles for an mph profile, stored in km', () => {
    mount({ unit: 'lb', cardioBy: { [BIKE]: 'distance' } })
    expect(container.querySelector('.sethead .hd-swap').textContent).toBe('Distance (mi)')
    type(1, '3.1')
    expect(row().km).toBeCloseTo(4.989, 3)
  })
})
