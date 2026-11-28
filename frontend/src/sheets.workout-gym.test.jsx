// @vitest-environment happy-dom
// #1097: with two gyms or more, a workout in History says where it was done, and so do its details.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { WorkoutRow, workoutDetailSheet } from './sheets.jsx'

const mounted = []
const render = el => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(el))
  return host
}
const w = { id: 'w1', d: '2026-11-01', start: 1, end: 3600001, name: 'Push', entries: [], prs: [], gym: { id: 'g2', name: 'City gym' } }
const setGyms = gyms => useStore.setState(s => ({ S: { ...s.S, workouts: [w], routines: [], active: null, equipProfiles: gyms } }))

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; useUI.setState({ sheets: [] }); document.body.innerHTML = '' })
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('History names the gym', () => {
  it('on the row and in the details, with two gyms', () => {
    setGyms([{ id: 'g1', name: 'Home' }, { id: 'g2', name: 'City gym' }])
    expect(render(<WorkoutRow w={w} onClick={() => {}} />).querySelector('.wrow-gym').textContent).toBe('City gym')
    workoutDetailSheet(w)
    const sheet = useUI.getState().sheets.at(-1)
    expect(render(sheet.render(() => {})).querySelector('.muted.small').textContent).toContain('City gym')
  })
  it('not with one gym', () => {
    setGyms([{ id: 'g2', name: 'City gym' }])
    expect(render(<WorkoutRow w={w} onClick={() => {}} />).querySelector('.wrow-gym')).toBeNull()
  })
})
