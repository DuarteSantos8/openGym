// LIFTIQ-FORK: gating and write-back of the set menu item (harness copied from Workout.test.jsx).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { api, beacon } from '../lib/api.js'
import { nextPrescription } from '../lib/progression.js'
import { buildCombinedEntries } from '../lib/session-merge.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { discardedFor } from '../lib/watch-sync.js'
import { finishWorkout, finishWorkoutSheet } from '../sheets.jsx'

// A menu's actions in order, whether it came as one list or in groups (menuSheet `sections`).
const menuItemsOf = menu => (menu.sections ? menu.sections.flatMap(g => g.items || []) : menu.items || []).filter(Boolean)

const mocks = vi.hoisted(() => {
  const state = {
    S: null,
    user: null,
    timer: null,
    work: null,
    startWork: vi.fn(),
    startRest: vi.fn(),
    startWork: vi.fn(),
    stopRest: null,
    stopWork: null,
    confirmSheet: vi.fn(),
    workoutCompleteSheet: vi.fn(),
    exercisePicker: vi.fn(),
    exConfigSheet: vi.fn(),
    toast: vi.fn(),
    scrollCalls: [],
    headerHeight: 0,
    swapActiveWorkoutExercise: vi.fn(),
    swapActiveWorkoutToBackup: vi.fn(),
    menuSheet: vi.fn(),
    effortPickerSheet: vi.fn(),
    exerciseHistorySheet: vi.fn(),
    renameWorkoutSheet: vi.fn(),
    durationSheet: vi.fn(),
    workoutSettingsSheet: vi.fn(),
    nav: vi.fn(),
    setNoteSheet: vi.fn(),
    addRest: vi.fn(),
    live: null,
  }
  state.stopRest = vi.fn(() => { state.timer = null })
  state.stopWork = vi.fn(() => { state.work = null })
  state.storeSnapshot = () => ({
    S: state.S,
    user: state.user,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  state.uiSnapshot = () => ({
    timer: state.timer,
    work: state.work,
    startRest: state.startRest,
    stopRest: state.stopRest,
    stopWork: state.stopWork,
    shiftRestOwner: vi.fn(),
    addRest: state.addRest,
    startWork: state.startWork,
    toast: state.toast,
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  // A move hands the running rest to its exercise's new index (Workout.jsx moveUnitAt).
  useUI.setState = patch => {
    const next = typeof patch === 'function' ? patch(mocks.uiSnapshot()) : patch
    if ('timer' in next) mocks.timer = next.timer
    if ('work' in next) mocks.work = next.work
  }
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
// The Live Activity's Done (lib/live-activity.js): the handler the workout screen binds.
vi.mock('../lib/live-activity.js', () => ({ bindLiveActions: h => { mocks.live = h; return () => { if (mocks.live === h) mocks.live = null } } }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(),
  exercisePicker: mocks.exercisePicker,
  exConfigSheet: mocks.exConfigSheet,
  exerciseDetailSheet: vi.fn(),
  finishWorkout: vi.fn(),
  finishWorkoutSheet: vi.fn(),
  exitWorkoutEdit: vi.fn(),
  workoutCompleteSheet: mocks.workoutCompleteSheet,
  confirmSheet: mocks.confirmSheet,
  swapActiveWorkoutExercise: mocks.swapActiveWorkoutExercise,
  swapActiveWorkoutToBackup: mocks.swapActiveWorkoutToBackup,
  menuSheet: mocks.menuSheet,
  barWeightSheet: vi.fn(),
  // Both note sheets belong here even though the tests never open one: Workout.jsx reads
  // sessionNoteSheet during render, so a missing export is a render crash, not a no-op.
  exerciseNoteSheet: vi.fn(),
  setNoteSheet: mocks.setNoteSheet,
  sessionNoteSheet: vi.fn(),
  renameWorkoutSheet: mocks.renameWorkoutSheet,
  effortPickerSheet: mocks.effortPickerSheet,
  exerciseHistorySheet: mocks.exerciseHistorySheet,
  addRoutineToSessionSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
vi.mock('../components/WorkoutThumb.jsx', () => ({
  default: ({ onExpand }) => React.createElement('button', { className: 'wthumb', 'aria-label': 'Expand', onClick: onExpand }),
  hasWorkoutMedia: () => true,
}))
vi.mock('../components/DurationWheel.jsx', () => ({ durationSheet: mocks.durationSheet }))
vi.mock('../components/WorkoutSettingsSheet.jsx', () => ({ workoutSettingsSheet: mocks.workoutSettingsSheet }))
// api.js reads navigator.userAgent at module scope. This file installs its own DOM inside the
// tests rather than declaring a vitest environment, so it must not depend on an ambient one.
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  beacon: vi.fn(),
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))

// LIFTIQ-FORK: the feature switch and the sheet are test doubles; the real handlers of the workout screen
// (onField, the done-toggle) are what the sheet's context gets.
const liftiq = vi.hoisted(() => ({ on: false, opened: [] }))
vi.mock('../liftiq/feature.js', () => ({ liftiqEnabled: () => liftiq.on }))
vi.mock('../liftiq/RecordSheet.jsx', () => ({ openRecordSheet: ctx => { liftiq.opened.push(ctx) } }))

let dom
let root
let container

function exercise(id, sets, extra = {}) {
  return {
    id,
    target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
    sets: sets.map(done => ({ w: 60, r: 5, done })),
    ...extra,
  }
}

function workout(entries, cur = 0, overrides = {}) {
  const { active: activeOverrides = {}, ...stateOverrides } = overrides
  return {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full',
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur, entries, ...activeOverrides },
    ...stateOverrides,
  }
}

const frames = []

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  dom.Element.prototype.scrollIntoView = vi.fn(function (options) {
    mocks.scrollCalls.push({ node: this, options })
  })
  frames.length = 0
  dom.requestAnimationFrame = cb => frames.push(cb)
  dom.cancelAnimationFrame = id => { const i = frames.indexOf(id); if (i >= 0) frames.splice(i, 1) }
  // linkedom has no layout; the sticky workout header reports the height a test gives it.
  Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', {
    configurable: true, get() { return this.classList.contains('whdr') ? mocks.headerHeight : 0 },
  })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(entries, cur = 0, overrides = {}) {
  mocks.S = workout(entries, cur, overrides)
  installDom()
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function unmount() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
  dom = null
}

async function toggleSet(index) {
  const checkbox = container.querySelectorAll('[role="checkbox"]')[index]
  expect(checkbox).toBeTruthy()
  await act(async () => { checkbox.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

async function pressNext() {
  const button = [...container.querySelectorAll('button')]
    .find(button => button.textContent.trim() === 'Next')
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

const click = async element => {
  expect(element).toBeTruthy()
  await act(async () => { element.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}
const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]
const itemNamed = label => menuItemsOf(lastMenu()).find(it => it.label === label)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = null
  mocks.timer = null
  mocks.work = null
  mocks.scrollCalls.length = 0
  mocks.headerHeight = 0
  liftiq.on = false
  liftiq.opened.length = 0
})

afterEach(async () => {
  await unmount()
})

describe('LIFTIQ-FORK: Record with sensor in the set menu', () => {
  const openMenu = async n => click(container.querySelector(`button[aria-label="Set ${n}"]`))

  it('is not in the menu when the integration is off (the menu is the original)', async () => {
    await mount([exercise('plain-bench', [false, false])])
    await openMenu(1)
    expect(itemNamed('Record with sensor')).toBeUndefined()
    expect(menuItemsOf(lastMenu()).map(it => it.label)).toEqual(['Make it a warm-up set', 'Taken to failure', 'Rest after this set', 'Drop set', 'Rest-pause burst', 'Copy this set', 'Remove this set'])
  })

  it('is the first item when the integration is on', async () => {
    liftiq.on = true
    await mount([exercise('plain-bench', [false, false])])
    await openMenu(1)
    expect(menuItemsOf(lastMenu())[0].label).toBe('Record with sensor')
    expect(menuItemsOf(lastMenu()).length).toBe(8)
  })

  it('is not offered while editing a saved workout', async () => {
    liftiq.on = true
    await mount([exercise('plain-bench', [false])], 0, { active: { editingWorkoutId: 'saved' } })
    await openMenu(1)
    expect(itemNamed('Record with sensor')).toBeUndefined()
  })

  it('is not offered for a timed exercise', async () => {
    liftiq.on = true
    await mount([{ id: 'plain-plank', target: { mode: 'time', sec: 45, weight: 0 }, sets: [{ w: 0, sec: 45, done: false }] }])
    await openMenu(1)
    expect(itemNamed('Record with sensor')).toBeUndefined()
  })

  it('opens the sheet with the set and the workout screen own handlers; writing back ticks the set like a tap', async () => {
    liftiq.on = true
    await mount([exercise('plain-bench', [false, false])])
    await openMenu(2)
    await act(async () => { itemNamed('Record with sensor').onClick(); await new Promise(r => setTimeout(r, 0)) })
    expect(liftiq.opened).toHaveLength(1)
    const ctx = liftiq.opened[0]
    expect(ctx).toMatchObject({ i: 1, unit: 'kg' })
    expect(ctx.set).toMatchObject({ w: 60, r: 5, done: false })

    const vbt = { v: 1, src: 'liftiq', pv: [0.8, 0.7], repsNoSetup: 2, repsWithSetup: 3 }
    const { writeBack } = await import('../liftiq/review.js')
    await act(async () => { writeBack({ i: ctx.i, set: ctx.set, reps: 8, weight: 62.5, vbt, onField: ctx.onField, onToggle: ctx.onToggle }) })
    const set = mocks.S.active.entries[0].sets[1]
    expect(set).toMatchObject({ r: 8, w: 62.5, done: true, vbt })
    expect(typeof set.at).toBe('number')
    expect(mocks.S.active.entries[0].sets[0].done).toBe(false)
    expect(mocks.startRest).toHaveBeenCalledTimes(1) // the rest timer starts as for a ticked set
  })
})
