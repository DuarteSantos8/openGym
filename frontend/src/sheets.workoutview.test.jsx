// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { beginWorkout, logPastWorkoutSheet } from './sheets.jsx'
import { todayISO } from './lib/format.js'

// beginWorkout / beginBackfill snapshot S.workoutView onto s.active so the header ⋮ can
// re-lay-out the running session without touching the saved default.

const mounted = []
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('workout view is snapshot onto the active session', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, active: null, routines: [], workouts: [], workoutView: 'cards' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('beginWorkout copies the current default onto s.active', () => {
    useStore.setState(s => ({ S: { ...s.S, workoutView: 'compact' } }))
    act(() => beginWorkout(null, null))
    expect(useStore.getState().S.active.workoutView).toBe('compact')
  })

  it('beginWorkout falls back to cards when the default is unset', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.workoutView; return { S } })
    act(() => beginWorkout(null, null))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
  })

  it('later changes to the default leave the running session alone', () => {
    act(() => beginWorkout(null, null))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
    useStore.setState(s => ({ S: { ...s.S, workoutView: 'list' } }))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
  })

  it('a backfilled session snapshots it too', () => {
    useStore.setState(s => ({ S: { ...s.S, workoutView: 'list' } }))
    logPastWorkoutSheet()
    const host = mountTopSheet()
    act(() => { type(host.querySelector('input[type=date]'), '2020-01-02') })
    act(() => { button(host, 'Continue').click() })
    expect(useStore.getState().S.active.workoutView).toBe('list')
  })
})
