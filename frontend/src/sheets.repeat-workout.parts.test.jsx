// @vitest-environment happy-dom
// "Repeat today" with Body's weight part off (Settings → Modules, #1087): no weigh-in sheet, the
// session starts straight away, as starting a routine does.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { repeatWorkout } from './sheets.jsx'
import { setNav } from './lib/nav.js'
import { EXDB } from './lib/exercises.js'

const A = EXDB.find(e => e.bp !== 'cardio').id
const saved = { id: 'w-old', d: '2026-09-10', start: 1, end: 2, name: 'Push', prs: [], routineIds: [],
  entries: [{ id: A, target: { mode: 'reps', reps: 8, weight: 40 }, sets: [{ w: 45, r: 8, done: true }] }] }

beforeEach(() => {
  setNav(() => {})
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState(s => ({ S: { ...s.S, workouts: [saved], routines: [], active: null, weighIn: true, modules: {} } }))
})
afterEach(() => { useUI.setState({ sheets: [] }) })

it('asks for the weigh-in while Body weight is on', () => {
  repeatWorkout(saved)
  expect(useStore.getState().S.active).toBeNull()
  expect(useUI.getState().sheets).toHaveLength(1)
})

it('starts without the weigh-in while Body weight or Body is off', () => {
  for (const modules of [{ 'body.weight': false }, { body: false }]) {
    useStore.setState(s => ({ S: { ...s.S, active: null, modules } }))
    useUI.setState({ sheets: [] })
    repeatWorkout(saved)
    expect(useStore.getState().S.active?.name, JSON.stringify(modules)).toBe('Push')
    expect(useUI.getState().sheets).toHaveLength(0)
  }
})
