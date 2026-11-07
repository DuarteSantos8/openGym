// @vitest-environment happy-dom
// On the iPhone an exercise's detail and a past workout are pages (G6 groundwork): the openers
// navigate to /library/:id and /history/:id, the pages show the sheet's own content, and every
// other platform keeps the sheet.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { setNav } from './lib/nav.js'
import { openExerciseDetail, openWorkoutDetail, workoutPath } from './sheets.jsx'
import { ExercisePage, WorkoutPage } from './views/DetailPages.jsx'
import { EXDB } from './lib/exercises-data.js'

const ex = EXDB[0]
const clone = v => JSON.parse(JSON.stringify(v))
const workout = (extra = {}) => ({ id: 'w 1', d: '2026-09-15', start: 1, end: 2, name: 'Push', vol: 0, prs: [], routineIds: [], entries: [], ...extra })
let calls, roots
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls = []; roots = []
  setNav(to => calls.push(to))
  useUI.setState({ sheets: [] })
  useStore.setState({ S: { ...clone(DEF), workouts: [workout()] }, user: null })
  delete document.documentElement.dataset.platform
  document.body.innerHTML = ''
})
afterEach(() => { act(() => roots.splice(0).forEach(r => r.unmount())) })

const mountAt = path => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/library/:id" element={<ExercisePage />} />
    <Route path="/history/:id" element={<WorkoutPage />} /></Routes></MemoryRouter>))
  return host
}

describe('detail openers', () => {
  it('open a sheet off the iPhone', () => {
    openExerciseDetail(ex); openWorkoutDetail(workout())
    expect(calls).toEqual([])
    expect(useUI.getState().sheets).toHaveLength(2)
  })
  it('navigate to the page on the iPhone, ids encoded', () => {
    document.documentElement.dataset.platform = 'ios'
    openExerciseDetail(ex); openWorkoutDetail(workout())
    expect(calls).toEqual(['/library/' + encodeURIComponent(ex.id), '/history/w%201'])
    expect(useUI.getState().sheets).toHaveLength(0)
  })
  it('a workout from before ids is addressed by its sync key', () => {
    const old = workout({ id: undefined })
    expect(workoutPath(old)).toBe('/history/' + encodeURIComponent(old.d + '|' + old.start))
  })
})

describe('detail pages', () => {
  it('the exercise page shows the sheet content under a back button', () => {
    const host = mountAt('/library/' + encodeURIComponent(ex.id))
    expect(host.querySelector('[data-back]')).toBeTruthy()
    expect(host.textContent).toContain('Add to my plan')
  })
  it('the workout page finds the record by id and offers its actions', () => {
    const host = mountAt('/history/' + encodeURIComponent('w 1'))
    expect(host.textContent).toContain('Edit workout')
    expect(host.textContent).toContain('Repeat today')
  })
})
