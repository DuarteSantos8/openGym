// @vitest-environment happy-dom
// Home with a running programme (spec 2026-11-04 sections 7.2, 7.3, 10.2, 14): starting today's
// session asks which planned session it is when the routine has two open this week, and what to do
// about the ones it would pass in an ordered week; a newer 1RM is offered on its card and taken only
// for the contexts ticked; a logged programme session reads back what its week became.
import React, { act } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Home from './Home.jsx'
import { swapActiveWorkoutExercise, workoutDetailSheet } from '../sheets.jsx'
import { legacyProgramme, migratedFixture, ruleOccurrence } from '../lib/test-fixtures.js'
import { programmeView, startProgramme } from '../lib/programmes.js'
import { buildSessionExposures, occurrenceFor } from '../lib/session-start.js'
import { entriesForExposures } from '../lib/session-ui-adapter.js'
import { buildCompletedSession } from '../lib/finish-session.js'
import { isWarmupRow } from '../lib/workout-model.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

const at = (y, m, d, h = 10) => vi.setSystemTime(new Date(y, m - 1, d, h, 0))
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
afterAll(() => { vi.useRealTimers() })

let host, root, sheetHost, sheetRoot
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  sheetHost = document.createElement('div'); document.body.appendChild(sheetHost); sheetRoot = createRoot(sheetHost)
})
afterEach(() => {
  act(() => { root.unmount(); sheetRoot.unmount() })
  host.remove(); sheetHost.remove()
  useStore.setState({ A: null })
})

const REPEAT = { onFailure: 'repeat', onSkipped: 'repeat' }
const ADVANCE = { onFailure: 'advance', onSkipped: 'advance' }
// A v2 profile (r1 Push: bench; r2 Legs: squat; r3 Other: bench at a %1RM of its own) running
// programme P over `days`, started on `startedOn`, with `policy` per exercise.
function running({ days, weeks = [{}, {}], ordered = false, startedOn, policy = () => ADVANCE, end = 'stop', more = {} }) {
  const base = migratedFixture({ unit: 'kg', weekStart: 1, workouts: [], routines: [
    { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] },
    { id: 'r2', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 5, weight: 80 }] },
  ] })
  const S = { ...useStore.getState().S, ...base, weighIn: false, week: {}, dayPlan: {}, programmes: {}, programme: null, queue: null, rotation: null, scheduleMode: null, ...more }
  const def = legacyProgramme(S, { id: 'P', name: 'Block', at: 1, weeks, days })
  S.programmes = { P: ordered ? { ...def, schedule: { ...def.schedule, ordered: true } } : def }
  expect(startProgramme(S, 'P', { policies: Object.fromEntries(def.tracks.map(t => [t.id, policy(t)])), end, today: startedOn, now: Date.parse(startedOn + 'T08:00:00') })).toEqual({ ok: true })
  useStore.setState({ S, A: null })
}
const mount = () => act(() => root.render(<Home />))
const top = () => useUI.getState().sheets.at(-1)
const drawTop = () => { const s = top(); act(() => sheetRoot.render(s.render(() => useUI.getState().closeSheet(s.id)))) }
const sheetButton = text => [...sheetHost.querySelectorAll('button, .item')].find(b => b.textContent.trim() === text)
const tap = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const startToday = () => tap(host.querySelector('.today-row'))
const events = type => Object.values(useStore.getState().S.programmeEvents || {}).filter(e => e.type === type)

describe('starting today from Home', () => {
  it('Home asks which session when two are open, and shows the bypass sheet with Skip B and Log as extra', () => {
    // Push planned Monday and Thursday: on Monday both are open, so it asks.
    at(2026, 10, 26)
    running({ days: { 1: ['r1'], 4: ['r1'] }, startedOn: '2026-10-26' })
    mount()
    startToday()
    expect(useStore.getState().A).toBe(null)
    drawTop()
    expect(sheetHost.textContent).toContain('Which session is this?')
    expect(sheetButton('Monday’s Push')).toBeTruthy()
    tap(sheetButton('Thursday’s Push'))
    expect(useStore.getState().A.exposures[0].programme).toMatchObject({ slot: 'p1:a1:r1:o0', role: 'work' })

    // An ordered week, Wednesday: starting Legs would pass Monday's Push.
    at(2026, 10, 28)
    running({ days: { 1: ['r1'], 3: ['r2'] }, ordered: true, startedOn: '2026-10-26' })
    useUI.setState({ sheets: [] })
    mount()
    startToday()
    drawTop()
    expect(sheetHost.textContent).toContain('This skips Push. Count this as Legs?')
    // Cancel starts nothing and records nothing.
    tap(sheetButton('Cancel'))
    expect(useStore.getState().A).toBe(null)
    expect(events('bypass')).toEqual([])
    // Log as extra: the session runs outside the programme; Monday's Push stays open.
    startToday()
    drawTop()
    tap(sheetButton('Log as extra'))
    const extra = useStore.getState().A.exposures[0]
    expect(extra.programme).toBeUndefined()
    expect(extra.excludedFromProgression).toBe(true)
    expect(events('bypass')).toEqual([])
    // Skip Push: the bypass is recorded, and Legs takes its own appointment as work.
    act(() => useStore.setState({ A: null }))
    startToday()
    drawTop()
    tap(sheetButton('Skip Push'))
    expect(events('bypass')).toEqual([expect.objectContaining({ period: 1, appts: [0] })])
    expect(useStore.getState().A.exposures[0].programme).toMatchObject({ slot: 'p1:a1:r2:o0', role: 'work' })
    expect(Object.values(programmeView(useStore.getState().S).tracks)[0].slots[0]).toMatchObject({ outcome: 'skipped', reasons: ['bypass'] })
  })
})

describe('a newer 1RM', () => {
  const orm = (id, value, capturedAt) => ({ id, exerciseId: '0025', value, unit: 'kg', source: 'estimated', capturedAt })
  it('proposal sheet shows each context s own before value and leaves unticked contexts alone', () => {
    at(2026, 10, 26)
    // The programme adopted 95 kg at its start; routine Other adopted 100 kg; 110 kg is newer than both.
    running({ days: { 1: ['r1'] }, weeks: [{ t: { '0025': { pct: 75 } } }, { t: { '0025': { pct: 80 } } }], startedOn: '2026-10-26',
      more: { oneRepMaxes: { b95: orm('b95', 95, '2026-10-01T10:00:00.000Z') } } })
    const other = { id: 'r3', name: 'Other', ex: [{ ...ruleOccurrence('0025', { occurrenceId: 'o3', routineId: 'r3', options: { load: { mode: 'percent_1rm', percent: 70 }, rounding: { mode: 'nearest', step: 2.5 } } }), ref: orm('b100', 100, '2026-10-10T10:00:00.000Z') }] }
    useStore.setState(s => ({ S: { ...s.S, routines: [...s.S.routines, other], oneRepMaxes: { ...s.S.oneRepMaxes, b110: orm('b110', 110, '2026-10-25T10:00:00.000Z') } } }))
    mount()
    const card = [...host.querySelectorAll('.card')].find(c => c.textContent.includes('New 1RM for Barbell Bench Press'))
    expect(card.textContent).toContain('Update future sessions?')
    tap(card.querySelector('.card-head-main'))
    drawTop()
    expect(sheetHost.textContent).toContain('Your 1RM for Barbell Bench Press is now 110 kg (estimated 25 Oct). Update future sessions?')
    const rows = [...sheetHost.querySelectorAll('.lrow')].map(r => r.textContent)
    expect(rows).toEqual([
      'OtherUses 100 kg · 70% becomes 77 kg (77.5 kg on your plates) · from your next session',
      'BlockUses 95 kg · 75% becomes 82.5 kg (82.5 kg on your plates) · from next training week',
    ])
    expect(sheetButton('Keep as they are')).toBeTruthy()
    // Only Other ticked: the programme keeps its 95 kg.
    tap(sheetHost.querySelector('[role="checkbox"][aria-label="Block"]'))
    tap(sheetButton('Update'))
    const S = useStore.getState().S
    expect(S.routines.find(r => r.id === 'r3').ex[0].ref).toMatchObject({ id: 'b110', value: 110 })
    expect(events('reference')).toEqual([])
    expect(Object.values(programmeView(S).tracks)[0].nextRef).toMatchObject({ id: 'b95' })
    expect(useUI.getState().toastMsg).toBe('Updated. Sessions already done keep their weights.')
  })
})

describe('a programme session in history', () => {
  // Routine `rid` done on local `day` as prescribed; `fail` leaves the last rep of every set out.
  const logged = (rid, day, { fail = false } = {}) => {
    vi.setSystemTime(new Date(day + 'T10:00:00'))
    useStore.getState().update(s => {
      const exposures = buildSessionExposures(s, s.routines.find(r => r.id === rid), { now: Date.now(), newId: x => x + day })
      const A = { id: 'w' + rid + day, d: day, start: Date.now(), routineIds: [rid], name: rid, exposures, entries: entriesForExposures(exposures, s.prescriptions) }
      A.entries.forEach(e => e.sets.forEach(row => { if (!isWarmupRow(row)) { row.done = true; if (fail) row.r = 1 } }))
      s.workouts = [...s.workouts, buildCompletedSession(A, s, { end: A.start + 3600000, newId: x => x + day, unit: 'kg' }).session]
    })
  }
  const lines = day => {
    useUI.setState({ sheets: [] })
    workoutDetailSheet(useStore.getState().S.workouts.find(w => w.d === day))
    drawTop()
    return sheetHost.textContent
  }

  it('history shows moved on, repeating and kept steady lines', () => {
    // Two weeks, then on until every goal is reached: bench repeats a miss, squat moves on.
    at(2026, 10, 5)
    running({ days: { 1: ['r1'], 3: ['r2'] }, startedOn: '2026-10-05', end: 'extend', policy: t => (t.exerciseId === '0025' ? REPEAT : ADVANCE) })
    logged('r1', '2026-10-05', { fail: true })   // week 1: bench misses → repeated
    logged('r2', '2026-10-07', { fail: true })   // week 1: squat misses → moves on
    logged('r2', '2026-10-14')                   // week 2: squat succeeds → its goal
    logged('r2', '2026-10-21')                   // week 3: kept steady while bench goes on
    at(2026, 10, 26)
    expect(lines('2026-10-05')).toContain('Repeating week 1')
    expect(lines('2026-10-07')).toContain('Target missed; moved on to week 2 as you chose')
    expect(lines('2026-10-14')).toContain('Goal reached')
    expect(lines('2026-10-21')).toContain('Kept steady (goal reached)')
  })
})

describe('another exercise in a programme exercise s place', () => {
  it('swapping before any work set builds the new exercise outside the programme, on its own rule', () => {
    at(2026, 10, 26)
    running({ days: { 1: ['r1'] }, weeks: [{ t: { '0025': { pct: 75 } } }, {}], startedOn: '2026-10-26',
      more: { oneRepMaxes: { b: { id: 'b', exerciseId: '0025', value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-10-01T10:00:00.000Z' } } } })
    mount()
    startToday()
    const held = useStore.getState().A.exposures[0]
    expect(held.programme).toMatchObject({ slot: 'p1:a0:r1:o0', role: 'work' })
    // A dumbbell press in the bench's place, on the bench's own occurrence (as a planned backup keeps it).
    swapActiveWorkoutExercise(0)
    const picker = top()
    act(() => picker.render(picker.close).props.onPick({ id: '0043' }))
    const config = top()
    act(() => config.render(config.close).props.onSave({ ...occurrenceFor('0043', { sets: 3, reps: 8, weight: 40 }, { id: 'r1:o0', routineId: 'r1' }) }))
    const swapped = useStore.getState().A.exposures[0]
    expect(swapped.exerciseId).toBe('0043')
    expect(swapped.programme).toBeUndefined()
    expect(swapped.excludedFromProgression).toBe(true)
    // Its own rule: 40 kg, never 75 % of the bench's 100 kg.
    expect(useStore.getState().S.prescriptions[swapped.prescriptionId].rows.map(r => r.load?.value)).toEqual([40, 40, 40])
    // The bench's appointment is open again, as not done.
    expect(Object.values(programmeView(useStore.getState().S, null, useStore.getState().A).tracks)[0].slots[0]).toMatchObject({ outcome: 'pending' })
  })
})
