// @vitest-environment happy-dom
// #907: a saved workout's detail marks each set against the same set last time, as the log stood
// before that workout; Settings can switch the arrows off.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { workoutDetailSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const lift = EXDB.find(e => e.bp !== 'cardio' && e.eq === 'barbell').id
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const done = (w, r, more = {}) => ({ w, r, done: true, ...more })
const workout = (id, d, sets) => ({
  id, d, start: new Date(d + 'T17:00:00').getTime(), end: new Date(d + 'T18:00:00').getTime(), name: 'Push',
  prs: [], routineIds: [], entries: [{ id: lift, target: { mode: 'reps' }, sets }],
})
const older = workout('w0', '2026-09-10', [done(77.5, 8), done(80, 7), done(60, 8), done(75, 6)])
const today = workout('w1', '2026-09-15', [done(40, 5, { phase: 'warmup' }), done(80, 8), done(80, 7), done(70, 6), done(75, 5)])
const later = workout('w2', '2026-09-20', [done(100, 8), done(100, 8), done(100, 8), done(100, 8)])

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toast: vi.fn() })
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', routines: [], workouts: [older, today, later], active: null })
  useStore.setState({ S, user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('set vs last time in a saved workout (#907)', () => {
  it('marks each work set against the workout before it, never a later one', () => {
    workoutDetailSheet(today)
    const host = mountTopSheet()
    const marks = [...host.querySelectorAll('.wd-ex .settrend')]
    expect(marks.map(m => m.textContent)).toEqual(['↑', '=', '↑', '↓'])
    expect(marks.map(m => m.getAttribute('aria-label'))).toEqual([
      '2.5 kg more than last time', 'Same as last time', 'Better estimated 1RM than last time', '1 rep fewer than last time',
    ])
  })
  it('the first workout of an exercise has nothing to compare', () => {
    workoutDetailSheet(older)
    expect(mountTopSheet().querySelectorAll('.settrend')).toHaveLength(0)
  })
  it('switched off in Settings, no arrows', () => {
    useStore.setState(s => ({ S: { ...s.S, setTrend: false } }))
    workoutDetailSheet(today)
    expect(mountTopSheet().querySelectorAll('.settrend')).toHaveLength(0)
  })
})

describe('set notes in a saved workout', () => {
  it('marks the set and lists the note under the sets', () => {
    const noted = { ...today, entries: [{ ...today.entries[0], sets: today.entries[0].sets.map((s, i) => (i === 2 ? { ...s, note: 'grip slipped' } : s)) }] }
    workoutDetailSheet(noted)
    const host = mountTopSheet()
    expect(host.querySelector('.setnote-mark').getAttribute('aria-label')).toBe('Note: grip slipped')
    expect(host.querySelector('.setnote-hist').textContent).toBe('Set 2: grip slipped')
  })
})
