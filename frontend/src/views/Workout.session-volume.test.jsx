// @vitest-environment happy-dom
// The volume so far, at the end of the workout header's progress bar (#774): every layout shares the
// header, so all four show it. It is there from the start whenever there is something to weigh,
// so the line does not change shape on the first tick; a session of bodyweight work has none.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

const BENCH = '0025'    // barbell bench press
const PUSHUP = '0662'   // push-up, body weight
const warm = (w, r, done) => ({ w, r, done, phase: 'warmup', warmup: true })
const work = (w, r, done) => ({ w, r, done })
const entry = (id, sets) => ({ id, target: { sets: sets.length, reps: 5, mode: 'reps' }, sets })

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
  Object.assign(S, patch)
  S.active = { id: 'vol-test', d: '2026-10-23', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0, entries, workoutView: S.workoutView }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const shown = () => container.querySelector('.whdr [data-session-volume]')?.textContent ?? null

describe('session volume in the workout header', () => {
  for (const view of ['cards', 'list', 'compact', 'focus']) {
    it(`shows the work done so far in ${view}`, () => {
      mount([entry(BENCH, [warm(40, 5, true), work(60, 5, true), work(60, 5, false)])], { workoutView: view })
      expect(shown()).toBe('300 kg')
    })
  }

  it('is there before the first set, and follows each tick', () => {
    mount([entry(BENCH, [work(60, 5, false), work(60, 5, false)])])
    expect(shown()).toBe('0 kg')
    act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }))
    expect(shown()).toBe('300 kg')
  })

  it('counts warm-ups when the profile does (#719)', () => {
    mount([entry(BENCH, [warm(40, 5, true), work(60, 5, true)])], { volumeWarmups: true })
    expect(shown()).toBe('500 kg')
  })

  it('reads in the profile unit', () => {
    mount([entry(BENCH, [work(135, 5, true)])], { unit: 'lb' })
    expect(shown()).toBe('675 lb')
  })

  it('stays out of a session with nothing to weigh', () => {
    mount([entry(PUSHUP, [work(0, 10, true)])])
    expect(shown()).toBeNull()
  })
})
