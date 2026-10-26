// @vitest-environment happy-dom
// Forward compatibility with a newer exercise catalogue. v1.4.0 brings thousands of exercise ids
// this build's dataset (lib/exercises-data.js) has never heard of, and a phone still on this
// version syncs with a server that already holds them: routines, the week, the running session,
// the history, favourites, PRs and per-exercise settings can all name one. Every view has to draw
// such an entry (exOr's "Unknown exercise" placeholder, or the bare id) instead of throwing, and
// nothing may drop or rewrite it: once the app updates, the same id is a real exercise again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore, restoredStateFor } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX, exOr } from './lib/exercises.js'
import { mergeStates } from './lib/sync-merge.js'
import { migrateProfileV1ToV2 } from '../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../api/coach/core/library.js'
import { unpackProfile } from '../../api/migration/profile-pack.js'
import { todayISO } from './lib/format.js'
import { beginWorkout, exerciseDetailSheet, exerciseHistorySheet, workoutDetailSheet, finishWorkout } from './sheets.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import History from './views/History.jsx'
import Stats from './views/Stats.jsx'
import Library from './views/Library.jsx'
import StructuralBalance from './views/StructuralBalance.jsx'

vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }))

const clone = v => JSON.parse(JSON.stringify(v))
// An id no catalogue of this build knows: v1.3.11 shipped this test with '4321', which v1.4.0 made a
// real exercise, so it has to be one past every id the pack can have.
const UNK = '99999'
const SQUAT = '0043'   // barbell full squat, one this build does know
const DAY = 86400000

const done = (w, r) => ({ w, r, done: true })
const past = (n, entries) => ({
  id: 'w' + n, d: new Date(Date.now() - n * 7 * DAY).toISOString().slice(0, 10),
  start: Date.now() - n * 7 * DAY, end: Date.now() - n * 7 * DAY + 3600000,
  name: 'Push', vol: 0, prs: n === 1 ? [UNK] : [], routineIds: ['r1'], entries,
})
const pastEntries = w => [
  { id: UNK, target: { id: UNK, mode: 'reps', sets: 2, reps: 8 }, sets: [done(w, 8), done(w, 8)] },
  { id: SQUAT, target: { id: SQUAT, mode: 'reps', sets: 2, reps: 5 }, sets: [done(100, 5), done(100, 5)] },
]
const activeEntries = () => [
  { id: UNK, target: { id: UNK, mode: 'reps', sets: 2, reps: 8, weight: 50 }, sets: [{ w: 50, r: 8, done: true }, { w: 50, r: 8, done: false }] },
  { id: SQUAT, target: { id: SQUAT, mode: 'reps', sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: false }] },
]

function seed(view = 'cards', extra = {}) {
  const S = clone(DEF)
  Object.assign(S, {
    unit: 'kg', weighIn: false,
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: UNK, mode: 'reps', sets: 3, reps: 8, weight: 50 }, { id: SQUAT, mode: 'reps', sets: 3, reps: 5, weight: 100 }] }],
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] },
    dayPlan: { [todayISO()]: 'r1' },
    workouts: [past(1, pastEntries(55)), past(2, pastEntries(50))],
    favEx: [UNK, SQUAT],
    exWeights: { [UNK]: { w: 55, d: '2026-09-01' } }, exNotes: { [UNK]: 'seat 4' }, barWeights: { [UNK]: 15 },
    active: { id: 'a1', d: todayISO(), start: Date.now(), routineIds: ['r1'], name: 'Push', bw: null, cur: 0, entries: activeEntries(), workoutView: view },
    ...extra,
  })
  delete S.engineSchemaVersion
  const { profile, activeSession } = migrateProfileV1ToV2(S, LIB_BY_ID)
  useStore.setState({ S: { ...clone(DEF), ...profile }, A: null, user: null })
  useStore.getState().setActive(activeSession)
}

// Every place the seed put the id, read back from whatever copy is handed in.
function expectKept(S, A = null) {
  expect(S).not.toHaveProperty('active')
  expect(S.routines.find(r => r.id === 'r1').ex.map(e => e.exerciseId)).toEqual([UNK, SQUAT])
  expect(S.week[1]).toEqual(['r1'])
  expect(S.favEx).toEqual([UNK, SQUAT])
  expect(S.exWeights[UNK]?.w).toBeGreaterThan(0)   // finishing a session moves it on, never away
  expect(S.exNotes[UNK]).toBe('seat 4')
  expect(S.barWeights[UNK]).toBe(15)
  for (const id of ['w1', 'w2']) expect(S.workouts.find(w => w.id === id).exposures.map(e => e.exerciseId)).toEqual([UNK, SQUAT])
  expect(S.workouts.find(w => w.id === 'w1').prs).toEqual([UNK])
  if (A) {
    expect(A.exposures.map(e => e.exerciseId)).toEqual([UNK, SQUAT])
    expect(A.entries.map(e => e.id)).toEqual([UNK, SQUAT])
  }
}

const mounted = []
function render(el, path = '/') {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>))
  return host
}
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toasts: [], timer: null, work: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('exercise ids this build does not know', () => {
  it('the id really is unknown here, and exOr stands in for it', () => {
    expect(EXIDX[UNK]).toBeUndefined()
    expect(exOr(UNK)).toMatchObject({ id: UNK, missing: true })
  })

  it('Home, the plan, the routine editor and the Library draw it', () => {
    seed()
    expect(render(<Home />).textContent).toContain('Push')
    render(<Plan />)
    const edit = render(<Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes>, '/plan/r/r1')
    expect(edit.textContent).toContain('Unknown exercise')
    render(<Library />)
    render(<StructuralBalance />)
    expectKept(useStore.getState().S, useStore.getState().A)
  })

  it('Home draws it on a rotation too', () => {
    seed('cards', {
      rotation: { id: 'rot1', sequence: ['r1'], label: 'Loop' },
      queue: { ids: ['r1'], since: Date.now() - DAY, startsOn: todayISO(), label: 'Loop', rotationId: 'rot1' },
      scheduleMode: 'rotation',
    })
    render(<Home />)
    render(<Plan />)
    expectKept(useStore.getState().S, useStore.getState().A)
  })

  for (const view of ['cards', 'list', 'compact', 'focus']) {
    it(`the running workout draws it in the ${view} view`, () => {
      seed(view)
      const host = render(<Workout />)
      expect(host.textContent).toContain('Unknown exercise')
      expectKept(useStore.getState().S, useStore.getState().A)
    })
  }

  it('History, a past workout, its exercise history and detail draw it', () => {
    seed()
    render(<History />)
    workoutDetailSheet(useStore.getState().S.workouts[0])
    expect(mountTopSheet().textContent).toContain(UNK)   // a past record names it by its id
    exerciseHistorySheet(UNK)
    mountTopSheet()
    exerciseDetailSheet(exOr(UNK))
    mountTopSheet()
    expectKept(useStore.getState().S, useStore.getState().A)
  })

  it('Stats draws it, and its exercise picker leaves out the id it has no name for', () => {
    seed()
    const host = render(<Stats />)
    // Exercise progress opens on the known lift: an id with no name to show is left out of
    // the picker (Stats.jsx exHist), not charted as a bare number.
    expect(host.textContent).toContain('Barbell Full Squat · 100 kg')
    expectKept(useStore.getState().S, useStore.getState().A)
  })

  it('starting the routine and finishing the session keep it, in the new workout too', () => {
    seed('cards', { active: null })
    act(() => beginWorkout(['r1'], null))
    const A = useStore.getState().A
    expect(A.entries.map(e => e.id)).toEqual([UNK, SQUAT])
    render(<Workout />)
    act(() => useStore.getState().updateActive(A => { A.entries.forEach(e => e.sets.forEach(set => { set.done = true })) }))
    act(() => finishWorkout())
    const S = useStore.getState().S
    expect(useStore.getState().A).toBeNull()
    expect(S.workouts.find(w => w.id === A.id).exposures.map(e => e.exerciseId)).toEqual([UNK, SQUAT])
    expectKept(S)
  })

  it('a save, a sync merge and an adopted server copy carry it through untouched', () => {
    seed()
    act(() => useStore.getState().update(s => { s.restSec = 120 }))
    const saved = unpackProfile(JSON.parse(localStorage.getItem('gym_state_v1')))
    const savedActive = JSON.parse(localStorage.getItem('gym_active_v1'))
    expect(savedActive).toMatchObject({ id: 'a1' })
    expectKept(saved, savedActive)
    // The server's copy names the id; this device's older copy does not have it yet.
    const server = clone(saved)
    const local = clone(DEF)
    expectKept(mergeStates(server, local))
    expectKept(mergeStates(local, server))
    expectKept(restoredStateFor(local, server))
  })
})
