import { expect, it } from 'vitest'
import { buildDemoState, localizeDemoRoutineNames } from './demoSeed.js'

it('updates untouched demo routine and linked workout names in Persian and back to English', () => {
  const state = buildDemoState()
  state.active = { routineIds: [state.routines[0].id], name: 'Push Day', entries: [] }
  const before = structuredClone(state)
  expect(localizeDemoRoutineNames(state, 'fa')).toBe(true)
  expect(state.routines.map(r => r.name)).toEqual(['روز پوش (فشاری)', 'روز پول (کششی)', 'روز پا'])
  expect(state.active.name).toBe('روز پوش (فشاری)')
  for (const w of state.workouts) expect(w.name).toBe(state.routines.find(r => r.id === w.routineId).name)
  expect(localizeDemoRoutineNames(state, 'fa')).toBe(false)
  expect(localizeDemoRoutineNames(state, 'en')).toBe(true)
  expect(state).toEqual(before)
})

it('preserves custom names, edited prescriptions and custom workout titles in the demo', () => {
  const state = buildDemoState()
  state.routines[0].name = 'تمرین خودم'
  state.routines[1].ex[0].sets += 1
  const custom = state.workouts.find(w => w.routineId === state.routines[2].id)
  custom.name = 'My personal session'
  localizeDemoRoutineNames(state, 'fa')
  expect(state.routines.map(r => r.name)).toEqual(['تمرین خودم', 'Pull Day', 'روز پا'])
  expect(custom.name).toBe('My personal session')
})
