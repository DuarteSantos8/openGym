// @vitest-environment happy-dom
// Plan → Routine from a past workout (#1010): an imported history, or training without routines,
// turns into a routine from the list of what you did.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXDB } from '../lib/exercises.js'
import { routineFromWorkoutSheet } from './RoutineFromWorkout.jsx'

const mounted = []
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const workout = (id, name, d) => ({ id, name, d, entries: [{ id: EXDB[0].id, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }] })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), routines: [], workouts: [workout('a', 'Push day', '2026-10-01'), workout('b', 'Push day', '2026-10-08'), workout('c', 'Legs', '2026-10-03')] }, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); document.body.innerHTML = '' })

describe('routine from a past workout', () => {
  it('lists each workout name once and saves the picked one as a routine', () => {
    const onSaved = vi.fn()
    routineFromWorkoutSheet(onSaved)
    const host = renderTop()
    const rows = [...host.querySelectorAll('.rfw-list .item')]
    expect(rows.map(r => r.querySelector('.tt').textContent)).toEqual(['Push day', 'Legs'])
    expect(rows[0].querySelector('.ss').textContent).toContain('1 exercise')
    act(() => rows[0].click())
    const S = useStore.getState().S
    expect(S.routines).toHaveLength(1)
    expect(S.routines[0]).toMatchObject({ name: 'Push day' })
    expect(S.routines[0].ex.map(e => e.id)).toEqual([EXDB[0].id])
    expect(S.workouts).toHaveLength(3)
    expect(onSaved).toHaveBeenCalledWith(S.routines[0].id)
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe('Saved as a routine. Your workout stays as it was.')
  })

  it('says so when there is nothing to start from', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [] } }))
    routineFromWorkoutSheet()
    expect(renderTop().textContent).toContain('Nothing logged yet.')
  })
})
