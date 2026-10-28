// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import Stats from '../views/Stats.jsx'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

let root, host
afterEach(() => { act(() => root?.unmount()); host?.remove(); useUI.getState().closeAll() })
it('opens the actual Goals route, toggles density, filters, and opens the selected exercise', () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const S = structuredClone(DEF)
  S.exerciseGoals = { bench: { exerciseId: '0025', type: 'e1rm', target: 100, createdAt: 2000 }, squat: { exerciseId: '0043', type: 'weight', target: 120, reps: 5, createdAt: 3000 } }
  useStore.setState({ S, user: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/stats?view=goals']}><Stats /></MemoryRouter>))
  expect(host.querySelectorAll('.exercise-goal')).toHaveLength(2)
  expect(host.querySelector('.is-compact')).not.toBeNull()
  expect(host.querySelector('.exercise-goal').getAttribute('aria-label')).toMatch(/Best since starting.*Goal.*0% of gap closed.*Waiting for first set/)
  expect(host.querySelector('.exercise-goal-waiting').textContent).toBe('Waiting for first set')
  expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuetext')).toBe('0% of gap closed')
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
  act(() => button('Normal').click())
  expect(useStore.getState().S.goalView).toBe('normal')
  expect(host.querySelector('.is-compact')).toBeNull()
  act(() => button('Sort / filter').click())
  expect(host.querySelector('#exercise-goal-filters')).not.toBeNull()
  act(() => useStore.getState().update(s => { s.goalStatus = 'all'; s.goalType = 'e1rm'; s.goalSort = 'name' }))
  act(() => root.unmount())
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/stats?view=goals']}><Stats /></MemoryRouter>))
  expect(host.querySelector('.is-compact')).toBeNull()
  expect(host.querySelector('#exercise-goal-filters')).not.toBeNull()
  expect(host.querySelectorAll('.exercise-goal')).toHaveLength(1)
  expect(host.textContent).toContain('Exercise A–Z')
  expect(useStore.getState().S.goalStatus).toBe('all')
  act(() => button('Reset filters').click())
  expect(useStore.getState().S).toMatchObject({ goalStatus: 'active', goalType: 'all', goalSort: 'added', goalView: 'normal' })
  act(() => host.querySelector('.exercise-goal').click())
  expect(useUI.getState().sheets).toHaveLength(1)
  expect(host.textContent).not.toContain('Activity — last 12 months')
})
