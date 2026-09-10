// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS
const BENCH = '0025'   // barbell bench press in the library
const benchName = () => exerciseNameFor(exOr(BENCH))
const mount = () => act(() => root.render(<RestTimer />))
const label = () => host.querySelector('#timer .lbl')?.textContent

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = { id: 'a', name: 'Test', start: Date.now(), cur: 0, entries: [
    { id: BENCH, target: { sets: 3, reps: 5 }, sets: [] },
    { id: 'no-such-exercise', target: { sets: 3, reps: 5 }, sets: [{ w: 0, r: 5, done: false }] },
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

// The bar says what it is timing: the kind of rest in the words of the sound that will end it,
// and the exercise the rest belongs to.
describe('rest timer bar: what it is timing', () => {
  it('names the kind of rest and the exercise', () => {
    act(() => { useUI.getState().startRest(90, 0, 'set') })
    mount()
    expect(label()).toBe('Next set · ' + benchName())
    expect(host.querySelector('#timer .t').textContent).toBe('1:30')
  })

  it('a superset round names the top of the superset', () => {
    act(() => { useUI.getState().startRest(90, 0, 'round') })
    mount()
    expect(label()).toBe('Next round · ' + benchName())
  })

  it('a finished exercise names the exercise you go to next, not the one you finished', () => {
    act(() => { useUI.getState().startRest(90, 0, 'block') })
    mount()
    expect(label()).toBe('Next exercise · Unknown exercise')
  })

  it('an exercise the library does not know still gets a name, not a blank', () => {
    act(() => { useUI.getState().startRest(60, 1, 'set') })
    mount()
    expect(label()).toBe('Next set · Unknown exercise')
  })

  it('a rest without a kind or an exercise just says Rest', () => {
    act(() => { useUI.getState().startRest(60) })
    mount()
    expect(label()).toBe('Rest')
  })

  it('the work timer says Hold and the exercise', () => {
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn()) })
    mount()
    expect(host.querySelector('#timer').className).toBe('working')
    expect(label()).toBe('Hold · Plank')
  })

  it('renders nothing and drops the resting class when no timer runs', () => {
    act(() => { useUI.getState().startRest(60, 0, 'set') })
    mount()
    expect(document.body.classList.contains('resting')).toBe(true)
    act(() => { useUI.getState().stopRest() })
    mount()
    expect(host.querySelector('#timer')).toBeNull()
    expect(document.body.classList.contains('resting')).toBe(false)
  })
})
