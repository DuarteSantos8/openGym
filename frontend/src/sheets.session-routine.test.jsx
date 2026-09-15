// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet } from './sheets.jsx'
import { setNav } from './lib/nav.js'

const mounted = []
const workout = () => ({
  id: 'w-routine', d: '2026-09-10', start: 1, end: 2, name: 'Push', prs: [],
  entries: [
    { id: 'bench', target: { mode: 'reps', reps: 5, weight: 40, side: true, sg: 'source' }, sets: [{ phase: 'warmup', w: 20, r: 5 }, { w: 45, r: 8, done: true }] },
    { id: 'row', target: { mode: 'reps', reps: 8, weight: 30, sg: 'source' }, sets: [{ w: 35, r: 9, done: true }] },
  ],
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

describe('WorkoutDetail — save as routine', () => {
  let navigated

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    navigated = null
    setNav(to => { navigated = to })
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, workouts: [], routines: [], active: null } }))
    document.body.innerHTML = ''
  })

  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('requires an explicit confirmation, then creates a flat routine and keeps history unchanged', () => {
    const saved = workout()
    useStore.setState(s => ({ S: { ...s.S, workouts: [saved] } }))
    const host = (workoutDetailSheet(saved), renderTop())
    expect(button(host, 'Save as routine')).toBeTruthy()

    act(() => { button(host, 'Save as routine').click() })
    const confirm = renderTop()
    expect(confirm.textContent).toContain('Create an independent routine')
    expect(useStore.getState().S.routines).toHaveLength(0)

    act(() => { button(confirm, 'Save').click() })
    const routine = useStore.getState().S.routines[0]
    expect(routine).toMatchObject({ name: 'Push' })
    expect(routine.ex.map(e => e.id)).toEqual(['bench', 'row'])
    expect(routine.ex[0].side).toBe(true)
    expect(routine.ex[0].warmupSets).toBe(1)
    expect(useStore.getState().S.workouts[0]).toEqual(saved)
    expect(navigated).toBe('/plan/r/' + routine.id)
  })
})
