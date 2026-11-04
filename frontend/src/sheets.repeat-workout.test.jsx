// @vitest-environment happy-dom
// "Repeat today" in a saved workout's sheet (#58): a new freestyle session dated today, seeded
// from this workout; the record itself is left as it is.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet } from './sheets.jsx'
import { setNav } from './lib/nav.js'
import { EXDB } from './lib/exercises.js'
import { todayISO } from './lib/format.js'
import { exposuresWithPerformance } from './lib/session-ui-adapter.js'

const mounted = []
const [A, B] = ['0025', '0027']   // loaded lifts: a bodyweight exercise has no load to carry over
const done = (...lifts) => exposuresWithPerformance(lifts.map(([id], i) => ({ exposureId: `x${i}`, exerciseId: id })),
  lifts.map(([, sets], i) => ({ exposureId: `x${i}`, target: { mode: 'reps' }, sets })), 'kg')
const workout = () => ({
  id: 'w-old', d: '2026-09-10', start: 1, end: 2, name: 'Push', prs: [], routineIds: ['r1'],
  exposures: done(
    [A, [{ w: 45, r: 8, done: true }, { w: 45, r: 7, done: true }]],
    ['deleted-custom', [{ w: 10, r: 8, done: true }]],
    [B, [{ w: 35, r: 10, done: true }]],
  ),
})

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)

describe('WorkoutDetail — repeat today', () => {
  let navigated

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    navigated = null
    setNav(to => { navigated = to })
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, workouts: [], routines: [], weighIn: false }, A: null }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('starts a freestyle session today from this workout and leaves the record alone', () => {
    const saved = workout()
    useStore.setState(s => ({ S: { ...s.S, workouts: [saved] } }))
    const host = (workoutDetailSheet(saved), renderTop())
    act(() => { button(host, 'Repeat today').click() })
    const active = useStore.getState().A
    expect(active).toMatchObject({ d: todayISO(), routineIds: [], name: 'Push', cur: 0, bw: null })
    expect(active.entries.map(e => e.id)).toEqual([A, B])
    expect(active.entries[0].sets.map(s => [s.w, s.r, s.done])).toEqual([[45, 8, false], [45, 8, false]])
    expect(active.exposures.some(x => 'routineId' in x)).toBe(false)
    expect(navigated).toBe('/workout')
    expect(useStore.getState().S.workouts[0]).toEqual(saved)
    expect(useUI.getState().toastMsg).toMatch(/1 exercise no longer exists/)
  })

  it('asks for the weigh-in first when that is on', () => {
    const saved = workout()
    useStore.setState(s => ({ S: { ...s.S, workouts: [saved], weighIn: true } }))
    const host = (workoutDetailSheet(saved), renderTop())
    act(() => { button(host, 'Repeat today').click() })
    expect(useStore.getState().A).toBeNull()
    expect(useUI.getState().sheets.length).toBe(1)
    expect(navigated).toBeNull()
  })

  it('is disabled while a workout is running', () => {
    const saved = workout()
    useStore.setState(s => ({ S: { ...s.S, workouts: [saved] }, A: { id: 'x', d: todayISO(), start: 1, entries: [] } }))
    const host = (workoutDetailSheet(saved), renderTop())
    expect(button(host, 'Repeat today').disabled).toBe(true)
  })
})
