// @vitest-environment happy-dom
// The session note shipped with a hole in it: buildCompletedWorkout read `active.note` and
// nothing in the app ever wrote it, so the only way to get one was after the fact — and that
// path threw the text away unless you happened to tab out of the field first.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { sessionNoteSheet, workoutDetailSheet } from '../sheets.jsx'
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

const workout = () => ({
  id: 'w1', d: '2026-08-25', start: 1, end: 2, name: 'Push', vol: 100,
  entries: [{ id: 'bench', sets: [{ w: 100, r: 5, done: true }] }], prs: [],
})

describe('session note', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(unmountAll)

  it('can be written during the workout and survives finishing', () => {
    useStore.setState(s => ({
      S: { ...s.S, active: { id: 'w1', d: '2026-08-25', start: 1, name: 'Push', entries: [{ id: 'bench', sets: [] }] } },
    }))
    const host = render(() => sessionNoteSheet())
    act(() => { type(host.querySelector('textarea'), 'slept badly, still hit it') })
    act(() => { [...host.querySelectorAll('button')].find(b => /save/i.test(b.textContent)).click() })

    const A = useStore.getState().S.active
    expect(A.note).toBe('slept badly, still hit it')
    // The path buildCompletedWorkout already had a test for is now actually reachable.
    expect(buildCompletedWorkout(A, { end: 2 }).note).toBe('slept badly, still hit it')
  })

  it('is kept when the history sheet is dismissed without blurring the field', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout()] } }))
    const host = render(() => workoutDetailSheet(useStore.getState().S.workouts[0]))
    act(() => { type(host.querySelector('textarea'), 'good session') })
    // Escape / Android back / swipe all unmount without a blur.
    unmountAll()
    expect(useStore.getState().S.workouts[0].note).toBe('good session')
  })

  it('clearing it removes the note rather than storing an empty string', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [{ ...workout(), note: 'old' }] } }))
    const host = render(() => workoutDetailSheet(useStore.getState().S.workouts[0]))
    act(() => { type(host.querySelector('textarea'), '   ') })
    unmountAll()
    expect(useStore.getState().S.workouts[0].note).toBeUndefined()
  })
})
