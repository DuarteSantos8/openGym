// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS
const mount = () => act(() => root.render(<RestTimer />))
const label = () => host.querySelector('#timer .lbl')?.textContent

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = { id: 'a', name: 'Test', start: Date.now(), cur: 0, entries: [
    { id: '0025', target: { sets: 3, reps: 5 }, sets: [{ w: 60, r: 5, done: false }] },
  ] }
  useStore.setState({ S })
  useUI.setState({ timer: null, work: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useStore.setState({ S: originalS })
  vi.useRealTimers()
})

// The label under the clock says what the rest leads into, and names no exercise: it is only as
// wide as the clock.
describe('rest timer bar: what it is timing', () => {
  it('says what the rest leads into instead of Rest', () => {
    act(() => { useUI.getState().startRest(90, 0, { kind: 'set' }) })
    mount()
    expect(label()).toBe('Set')
    expect(host.querySelector('#timer .t').textContent).toBe('1:30')
    act(() => { useUI.getState().startRest(90, 0, { kind: 'round' }) })
    expect(label()).toBe('Round')
    act(() => { useUI.getState().startRest(90, 0, { kind: 'block' }) })
    expect(label()).toBe('Exercise')
  })

  it('says Warm-up for a rest before a warm-up set, decided where the rest started', () => {
    act(() => { useUI.getState().startRest(45, 0, { kind: 'set', phase: 'warmup' }) })   // after ramp set 1
    mount()
    expect(label()).toBe('Warm-up')
    act(() => { useUI.getState().startRest(150, 0, { kind: 'set', phase: 'work' }) })    // after the last ramp set
    expect(label()).toBe('Set')
    act(() => { useUI.getState().startRest(90, 0, { kind: 'round', phase: 'warmup' }) })  // rounds do not say it
    expect(label()).toBe('Round')
  })

  it('a rest without a kind just says Rest', () => {
    act(() => { useUI.getState().startRest(60) })
    mount()
    expect(label()).toBe('Rest')
  })

  it('Paused and Switch sides still win', () => {
    act(() => { useUI.getState().startRest(90, 0, { kind: 'block' }) })
    mount()
    act(() => { useUI.getState().pauseRest() })
    expect(label()).toBe('Paused')
    act(() => { useUI.getState().startRest(10, 0, { kind: 'switch' }) })
    expect(label()).toBe('Switch sides')
  })

  it('keeps saying it on Ready', () => {
    act(() => { useUI.getState().startRest(1, 0, { kind: 'round' }) })
    mount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(label()).toBe('Round')
  })

  it('a hold says which hold of the exercise it is, warm-up holds apart, a per-side pair as one set', () => {
    const S = useStore.getState().S
    useStore.setState({ S: { ...S, active: { ...S.active, entries: [
      { id: 'plank', target: { mode: 'time', sec: 45 }, sets: [{ sec: 20, phase: 'warmup' }, { sec: 45 }, { sec: 45 }, { sec: 45 }] },
      { id: 'side-plank', target: { mode: 'time', sec: 30 }, sets: [{ sec: 30, side: 'L' }, { sec: 30, side: 'R' }, { sec: 30, side: 'L' }, { sec: 30, side: 'R' }] },
    ] } } })
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn(), { idx: 0, i: 2, id: 'plank' }) })
    mount()
    expect(host.querySelector('#timer').className).toBe('working')
    expect(label()).toBe('Hold 2 of 3')
    act(() => { useUI.getState().startWork(20, 'Plank', vi.fn(), { idx: 0, i: 0, id: 'plank' }) })
    expect(label()).toBe('Warm-up hold 1 of 1')
    act(() => { useUI.getState().startWork(30, 'Side plank', vi.fn(), { idx: 1, i: 3, id: 'side-plank' }) })
    expect(label()).toBe('Hold 2 of 2')
  })

  it('a hold with no row of its own, or one whose row is gone, just says Hold', () => {
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn()) })
    mount()
    expect(label()).toBe('Hold')
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn(), { idx: 0, i: 0, id: 'not-this-exercise' }) })
    expect(label()).toBe('Hold')
  })

  it('renders nothing and drops the resting class when no timer runs', () => {
    act(() => { useUI.getState().startRest(60, 0, { kind: 'set' }) })
    mount()
    expect(document.body.classList.contains('resting')).toBe(true)
    act(() => { useUI.getState().stopRest() })
    mount()
    expect(host.querySelector('#timer')).toBeNull()
    expect(document.body.classList.contains('resting')).toBe(false)
  })
})
