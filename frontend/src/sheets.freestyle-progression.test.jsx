// @vitest-environment happy-dom
// Freestyle progression (#910): an exercise added to a freestyle workout opens at what you did
// last time (#50), so its settings sheet must not promise "Follow the routine (Linear
// progression)" or offer rules that are never applied, and a mid-session edit of it must not
// apply a linear step nobody picked.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { bindUI } from './components/ui.jsx'
import { buildSessionEntry, buildPlannedEntry } from './lib/session-start.js'
import { buildCompletedWorkout } from './lib/finish-workout.js'
import { freestyleConfig, pickedExerciseConfig } from './lib/history.js'
import { isWarmupRow } from './lib/workout-model.js'

const BENCH = '0025'
const ex = EXDB.find(e => e.id === BENCH)
const mounted = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const open = (cfg, opts) => {
  exConfigSheet(ex, { sets: 2, reps: 8, weight: 60, mode: 'reps', ...cfg }, vi.fn(), null, null, null, null, 'Add to this workout', opts)
  return render(useUI.getState().sheets.at(-1))
}

describe('the exercise sheet in a freestyle workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('says freestyle repeats last time instead of following a routine it does not have', () => {
    const host = open({ prog: 'double', repsMin: 6 }, { freestyle: true })
    expect(host.textContent).not.toMatch(/Follow the routine/)
    expect(host.textContent).toMatch(/Freestyle repeats what you did last time/)
    expect(host.textContent).not.toMatch(/Double progression/)
  })

  it('keeps the rule picker everywhere else', () => {
    const host = open({}, {})
    expect(host.textContent).toMatch(/Follow the routine \(Linear progression\)/)
  })
})

describe('a freestyle exercise edited mid-session', () => {
  const work = e => e.sets.filter(s => !isWarmupRow(s))
  const state = () => ({ unit: 'kg', exWeights: {}, routines: [], workouts: [], week: {}, dayPlan: {} })
  const add = (st, edit = {}) => {
    const seed = freestyleConfig(st, { id: BENCH, ...pickedExerciseConfig(BENCH) })
    return { id: BENCH, ...buildSessionEntry(st, BENCH, { ...seed, ...edit }, null, null) }
  }
  const train = (st, entry, r, w) => {
    const sets = entry.sets.map(s => (isWarmupRow(s) ? { ...s, done: true } : { ...s, r, w, done: true }))
    st.workouts.push(buildCompletedWorkout({ id: 'f', d: '2026-09-01', start: 1000, routineIds: [], name: 'Freestyle', entries: [{ ...entry, sets }] }, { end: 1001 }))
  }

  it('is rebuilt at the numbers saved, not a linear step up (the call Workout.jsx makes without a routine)', () => {
    const st = state()
    train(st, add(st, { sets: 2, reps: 8, weight: 60 }), 8, 60)
    const today = add(st)
    expect(work(today).map(s => s.w)).toEqual([60, 60])
    const rebuilt = buildPlannedEntry(st, { ...today.target, id: BENCH }, undefined, { noProg: true })
    expect(rebuilt.plan.policy).toBe('off')
    expect(work(rebuilt).map(s => [s.w, s.r])).toEqual([[60, 8], [60, 8]])
  })
})
