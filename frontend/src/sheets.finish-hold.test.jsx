// @vitest-environment happy-dom
// Finishing a workout while a timed hold counts down. Discard has stopped the hold since GL!59;
// Finish stopped only the rest timer, so the hold bar (app-wide, App.jsx) went on counting over
// the summary and Home, chimed at zero, and its callback then wrote into a workout that was gone.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

// Mounted before the click's own act(): a render nested inside it lands only once it is over.
function tapInTopSheet(text) {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const target = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  expect(target, text).toBeTruthy()
  act(() => { target.click() })
}

function install(sets) {
  const st = clone(DEF)
  st.active = {
    id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineId: null, name: 'Core', bw: null, cur: 0,
    entries: [{ id: EXDB[0].id, target: { mode: 'reps', sets: sets.length, reps: 5, weight: 40 }, sets }]
  }
  useStore.setState({ S: st, user: null })
}

// Shaped like the row's own callback in views/Workout.jsx: it writes what was held into the set.
const holdInto = set => vi.fn(elapsed => useStore.getState().update(s => { s.active.entries[0].sets[set].sec = elapsed }))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
  useUI.getState().stopWork()
  vi.useRealTimers()
})

describe('finishing while a timed hold runs', () => {
  it('stops the hold, which then never calls back into the finished workout', () => {
    install([{ w: 40, r: 5, done: true }])
    const held = holdInto(0)
    useUI.getState().startWork(45, 'Plank', held)

    act(() => finishWorkout())

    expect(S().active).toBeNull()
    expect(S().workouts).toHaveLength(1)
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(held).not.toHaveBeenCalled()
  })

  it('stops it too when the hold is the set left unchecked and Finish early is confirmed', () => {
    install([{ w: 40, r: 5, done: true }, { w: 40, r: 5 }])
    const held = holdInto(1)
    useUI.getState().startWork(45, 'Plank', held)

    act(() => finishWorkout())
    tapInTopSheet('Finish workout')

    expect(S().active).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(held).not.toHaveBeenCalled()
  })
})
