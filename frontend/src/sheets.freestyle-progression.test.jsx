// @vitest-environment happy-dom
// Freestyle repeats the last target without applying an unchosen progression rule (#910).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { bindUI } from './components/ui.jsx'
import { buildSessionExposures, occurrenceFor } from './lib/session-start.js'
import { entriesForExposures } from './lib/session-ui-adapter.js'
import { buildCompletedSession } from './lib/finish-session.js'
import { freestyleConfig, pickedExerciseConfig } from './lib/history.js'
import { ruleOccurrence } from './lib/test-fixtures.js'
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
  exConfigSheet(ex, cfg, vi.fn(), null, null, null, null, 'Add to this workout', opts)
  return render(useUI.getState().sheets.at(-1))
}

describe('the exercise sheet in a freestyle workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState({ S: structuredClone(DEF), A: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('adding one says freestyle repeats last time and offers no unapplied rule', () => {
    const host = open({ sets: 2, reps: 8, weight: 60 }, { freestyle: 'add' })
    expect(host.textContent).not.toMatch(/Follow the routine/)
    expect(host.textContent).toMatch(/Freestyle repeats what you did last time/)
    expect(host.querySelector('[aria-label="Progression"]')).toBeNull()
  })

  it('mid-workout defaults to manual, while a chosen rule remains editable', () => {
    const host = open(null, { freestyle: 'edit' })
    expect(host.textContent).not.toMatch(/Follow the routine/)
    expect(host.textContent).toMatch(/Freestyle keeps the numbers you set/)
    const picked = open(ruleOccurrence(BENCH, { preset: 'double' }), { freestyle: 'edit' })
    expect(picked.textContent).toMatch(/Double/)
    expect(picked.querySelector('[data-field="Reps"]')).toBeTruthy()
  })

  it('keeps a routine’s own warm-up block editable and saves its source', () => {
    const warmupRows = [{ wp: 50, r: 8 }, { wp: 75, r: 5 }]
    const slot = { ...ruleOccurrence(BENCH), warmup: 'own', warmupRows }
    const onSave = vi.fn()
    exConfigSheet(ex, slot, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(host.textContent).toContain('My own')
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
    expect(save.disabled).toBe(false)
    act(() => save.click())
    expect(onSave.mock.calls[0][0]).toMatchObject({ warmup: 'own', warmupRows })
  })

  it('keeps the rule picker in a routine', () => {
    const host = open(ruleOccurrence(BENCH), {})
    expect(host.textContent).toMatch(/Linear/)
  })
})

describe('a freestyle exercise edited mid-session', () => {
  const work = e => e.sets.filter(s => !isWarmupRow(s))
  const state = () => ({ ...structuredClone(DEF), unit: 'kg', routines: [], workouts: [] })
  let next = 0
  const build = (st, cfg) => {
    const occurrence = occurrenceFor(BENCH, cfg, { id: 'free-' + next++, unit: st.unit })
    const exposures = buildSessionExposures(st, { id: 'freestyle', ex: [occurrence] }, { now: 1000 + next, newId: id => id })
    exposures.forEach(e => { delete e.routineId })
    return { exposures, entries: entriesForExposures(exposures, st.prescriptions) }
  }

  it('rebuilds at the saved numbers, without adding a linear step', () => {
    const st = state()
    const first = build(st, { sets: 2, reps: 8, weight: 60 })
    first.entries.forEach(e => e.sets.forEach(s => { s.done = true }))
    st.workouts.push(buildCompletedSession({ id: 'f', d: '2026-09-01', start: 1000, routineIds: [], name: 'Freestyle', ...first }, st, { end: 1001, newId: id => id, unit: st.unit }).session)
    const cfg = freestyleConfig(st, { id: BENCH, ...pickedExerciseConfig(BENCH) })
    const today = build(st, cfg).entries[0]
    expect(work(today).map(s => s.w)).toEqual([60, 60])
    const rebuilt = build(st, today.target).entries[0]
    expect(work(rebuilt).map(s => [s.w, s.r])).toEqual([[60, 8], [60, 8]])
  })
})
