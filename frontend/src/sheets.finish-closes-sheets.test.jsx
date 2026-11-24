// @vitest-environment happy-dom
// Finished on the watch while the phone showed "That's the whole workout!": the summary is the
// only sheet left, so closing it does not uncover a second Finish for a workout already saved.
import { beforeEach, expect, it } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
  st.active = { id: 'fin', d: '2026-11-16', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries: [{ id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }
  useStore.setState({ S: st, user: null })
})

it('a finish from the watch closes the sheets about the workout and shows only the summary', () => {
  useUI.getState().openSheet(() => null, { kind: 'center' }) // the phone's "That's the whole workout!"
  finishWorkoutNow({ end: Date.now() })
  expect(useStore.getState().S.active).toBe(null)
  expect(useUI.getState().sheets).toHaveLength(1)
  expect(useUI.getState().sheets[0].locked).toBe(true) // the summary
})
