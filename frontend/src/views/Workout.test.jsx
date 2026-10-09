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
    menuSheet: vi.fn(),
    effortPickerSheet: vi.fn(),
    exerciseHistorySheet: vi.fn(),
    renameWorkoutSheet: vi.fn(),
    durationSheet: vi.fn(),
    workoutSettingsSheet: vi.fn(),
    nav: vi.fn(),
    setNoteSheet: vi.fn(),
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

const buttonNamed = name => container.querySelector(`button[aria-label="${name}"]`)
const click = async element => {
  expect(element).toBeTruthy()
  await act(async () => { element.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

async function pressProgression(index = 0) {
  const button = container.querySelectorAll('.progline')[index]
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  return button
}

// Discard lives at the end of the header's ⋯ menu (v1.3.11); the header's ⌄ only leaves the screen.
async function requestDiscard() {
  const button = container.querySelector('button[aria-label="Workout options"]')
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  const discard = menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).find(it => it.label === 'Discard workout')
  expect(discard?.danger).toBe(true)
  await act(async () => { discard.onClick() })
}

async function rerender() {
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function addExerciseThroughSheets(ex = { id: 'added-exercise' }, cfg = { mode: 'reps', sets: 1, reps: 5, weight: 0 }) {
  const addButton = [...container.querySelectorAll('button')]
    .find(button => button.textContent.trim() === 'Add exercise')
  expect(addButton).toBeTruthy()
  await act(async () => { addButton.dispatchEvent(new dom.Event('click', { bubbles: true })) })

  const pickerCall = mocks.exercisePicker.mock.calls.at(-1)
  expect(pickerCall?.[0]).toEqual(expect.any(Function))
  await act(async () => { pickerCall[0](ex) })

  const configCall = mocks.exConfigSheet.mock.calls.at(-1)
  expect(configCall?.[2]).toEqual(expect.any(Function))
  await act(async () => { configCall[2](cfg) })
}

// The list's scroll-to-current waits for the next frame. linkedom has no requestAnimationFrame,
// and leaning on the component's 0 ms fallback made this race under a loaded full-suite run — so
// the DOM gets a frame queue the test drains itself, which is also the path a browser takes.
async function flushFrame() {
  const due = frames.splice(0)
  await act(async () => { due.forEach(cb => cb(0)) })
}

async function rerenderAt(cur) {
  mocks.S.active.cur = cur
  await act(async () => { root.render(React.createElement(Workout)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = null
  mocks.timer = null
  mocks.work = null
  mocks.scrollCalls.length = 0
  mocks.headerHeight = 0
})

it('edits a saved set without running live completion, rest or success feedback', async () => {
  await mount([exercise('plain-bench', [false], {
    plan: { policy: 'linear', kind: 'first', why: ['Nothing logged yet, so this session sets the baseline.'] },
  })], 0, {
    active: { editingWorkoutId: 'saved' },
  })
  await toggleSet(0)
  expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
  expect(mocks.startRest).not.toHaveBeenCalled()
  expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
  expect(mocks.toast).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Editing a saved workout')
  expect(container.querySelector('.progline')).toBeNull()
  const more = container.querySelector('button[aria-label="More"]')
  await act(async () => { more.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  expect(menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).map(item => item.label)).not.toContain('Progression settings')
})

afterEach(async () => {
  await unmount()
})

describe('Workout set completion flow', () => {
  it('rests the exercise\'s warm-up rest between ramp sets, and its working rest after the last ramp set', async () => {
    await mount([exercise('ramped-squat', [false, false, false, false], {
      target: { mode: 'reps', reps: 6, weight: 125, bodyweight: false, restSec: 150, warmupRestSec: 45 },
      sets: [
        { w: 60, r: 8, done: false, phase: 'warmup' },
        { w: 95, r: 5, done: false, phase: 'warmup' },
        { w: 125, r: 6, done: false, phase: 'work' },
        { w: 125, r: 6, done: false, phase: 'work' },
      ],
    })])
    await toggleSet(0)
    expect(mocks.startRest).toHaveBeenLastCalledWith(45, expect.any(Number), { kind: 'set', phase: 'warmup', forSet: expect.any(Number) })
    await toggleSet(1)
    expect(mocks.startRest).toHaveBeenLastCalledWith(150, expect.any(Number), { kind: 'set', phase: 'work', forSet: expect.any(Number) })
    await toggleSet(2)
    expect(mocks.startRest).toHaveBeenLastCalledWith(150, expect.any(Number), { kind: 'set', phase: 'work', forSet: expect.any(Number) })
    expect(mocks.startRest).toHaveBeenCalledTimes(3)
  })

  it('starts rest after a non-final ordinary set, but stops rest without restarting it on the final set', async () => {
    await mount([exercise('plain-bench', [false, false, false])])
    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
    expect(mocks.stopRest).not.toHaveBeenCalled()

    await unmount()
    vi.clearAllMocks()
    await mount([exercise('plain-treadmill', [false], {
      target: { mode: 'cardio', min: 20, speed: 8 },
    })])
    await toggleSet(0)

    expect(mocks.stopRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('auto-captures a completed weighted exercise without prompting, leaving navigation to Next', async () => {
    await mount([exercise('plain-bench', [false]), exercise('next', [false])])

    await toggleSet(0)

    expect(mocks.S.active.entries[0].topW).toBe(60)
    expect(mocks.S.exWeights['plain-bench']).toBeUndefined()   // written at the finish, not while ticking
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })

    await pressNext()

    expect(mocks.S.active.cur).toBe(1)
  })

  it('auto-captures superset members without prompting, then leaves the completed unit for Next', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [false], { sg: group }),
      exercise('superset-b', [false], { sg: group }),
      exercise('next', [false]),
    ])

    await toggleSet(0)

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).not.toHaveBeenCalled()

    await rerender()
    await toggleSet(1)

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })

    await pressNext()

    expect(mocks.S.active.cur).toBe(2)
  })

  // What a rest leads into picks the sound it ends with when a kind of rest has one of its own
  // (Settings → Sound). The kind is decided by supersetFlow.restKind; these pin what the places
  // that start a rest hand the timer.
  it('a finished superset round rests as a round; the finished superset as the move to the next exercise', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [false, false], { sg: group }),
      exercise('superset-b', [false, false], { sg: group }),
      exercise('next', [false]),
    ])

    await toggleSet(0)                       // a, round 1 → straight on to b, no rest
    expect(mocks.startRest).not.toHaveBeenCalled()
    await rerender()
    await toggleSet(2)                       // b, round 1 → round over, back to a
    expect(mocks.startRest).toHaveBeenLastCalledWith(90, expect.any(Number), { kind: 'round', phase: null, forSet: expect.any(Number) })

    await rerender()
    await toggleSet(1)                       // a, round 2
    await rerender()
    await toggleSet(3)                       // b, round 2 → superset finished, 'next' follows
    expect(mocks.startRest).toHaveBeenLastCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })

  it('a re-check that owes you a rest rests as the same kind the first check did', async () => {
    await mount([exercise('plain-bench', [false, false])])
    await toggleSet(0)
    expect(mocks.startRest).toHaveBeenLastCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
    await rerender()
    await toggleSet(0)                       // uncheck
    await rerender()
    await toggleSet(0)                       // re-check with no rest running: restOnRecheck starts it again
    expect(mocks.startRest).toHaveBeenCalledTimes(2)
    expect(mocks.startRest).toHaveBeenLastCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
  })

  it.each(['warmup', 'warm-up', 'warm_up'])(
    'does not navigate or start transition rest before an incomplete %s row in the next ordinary exercise',
    async phase => {
      await mount([
        exercise('current', [false], { asked: true }),
        exercise('next', [false, false], {
          asked: true,
          sets: [
            { w: 30, r: 5, done: false, phase },
            { w: 60, r: 5, done: false },
          ],
        }),
      ])

      await toggleSet(0)

      expect(mocks.S.active.cur).toBe(0)
      expect(mocks.startRest).not.toHaveBeenCalled()
    },
  )

  it('does not navigate or start transition rest when a completed superset meets an incomplete warm-up', async () => {
    await mount([
      exercise('superset-a', [true], { sg: 'group', asked: true }),
      exercise('superset-b', [false], { sg: 'group', asked: true }),
      exercise('next', [false, false], {
        asked: true,
        sets: [
          { w: 30, r: 5, done: false, phase: 'warmup' },
          { w: 60, r: 5, done: false },
        ],
      }),
    ], 1)

    await toggleSet(1)

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('leaves the completed ordinary exercise selected without transition rest before an incomplete warm-up', async () => {
    await mount([
      exercise('current-loaded', [false]),
      exercise('next', [false, false], {
        asked: true,
        sets: [
          { w: 30, r: 5, done: false, phase: 'warmup' },
          { w: 60, r: 5, done: false },
        ],
      }),
    ])

    await toggleSet(0)

    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('does not restart transition rest when re-checking a completed unit before an incomplete warm-up', async () => {
    await mount([
      exercise('current', [true], { asked: true }),
      exercise('next', [false, false], {
        asked: true,
        sets: [
          { w: 30, r: 5, done: false, phase: 'warmup' },
          { w: 60, r: 5, done: false },
        ],
      }),
    ])

    await toggleSet(0)
    await rerender()
    await toggleSet(0)

    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  // A rest that ran out stays on screen as Ready (#204) until it is dismissed. It is not a rest
  // counting down, so re-checking a finished set still owes the rest it always did (issue #3).
  it('starts the rest a re-check owes while the last one only shows Ready', async () => {
    await mount([exercise('current', [true, false, false])])
    mocks.timer = { left: 0, total: 90, endsAt: Date.now() - 1000, forIdx: 0, ready: true }

    await toggleSet(0)
    await rerender()
    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledWith(90, 0, { kind: 'set', phase: null, forSet: expect.any(Number) })
  })

  it('leaves a rest that is still counting down alone on a re-check', async () => {
    await mount([exercise('current', [true, false, false])])
    mocks.timer = { left: 40, total: 90, endsAt: Date.now() + 40000, forIdx: 0 }

    await toggleSet(0)
    await rerender()
    await toggleSet(0)

    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('leaves a completed superset selected without opening a top-weight sheet', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [true, true, true], { sg: group, asked: true }),
      exercise('superset-b', [true, true, false], { sg: group }),
      exercise('next-exercise', [false, false, false]),
    ], 1)
    await toggleSet(5)

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })

  it('does not auto-select an unfinished superset after completing an ordinary exercise', async () => {
    await mount([
      exercise('current-hold', [false], { asked: true, target: { mode: 'time', sec: 30, weight: 0 } }),
      exercise('already-done', [true], { asked: true }),
      exercise('pending-a', [false], { sg: 'pending-group' }),
      exercise('pending-b', [false], { sg: 'pending-group' }),
    ])

    await toggleSet(0)

    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Hold logged')
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })

  it('does not auto-select earlier unfinished work after completing an ordinary exercise', async () => {
    await mount([
      exercise('pending-earlier', [false], { asked: true }),
      exercise('current-hold', [false], { asked: true, target: { mode: 'time', sec: 30, weight: 0 } }),
    ], 1)

    await toggleSet(0)

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })

  it('leaves a completed ordinary exercise selected without declaring completion while work remains', async () => {
    await mount([
      exercise('current-loaded', [false]),
      exercise('pending', [false], { asked: true }),
    ])

    await toggleSet(0)

    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })

  it('shows workout completion only when no unfinished unit remains', async () => {
    await mount([
      exercise('already-done', [true], { asked: true }),
      exercise('final-hold', [false], { asked: true, target: { mode: 'time', sec: 30, weight: 0 } }),
    ], 1)

    await toggleSet(0)

    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).not.toHaveBeenCalled()
  })
})

describe('set ticks for screen readers', () => {
  it('names each tick by its set, not just "checkbox"', async () => {
    await mount([exercise('named-ticks', [false, false])])
    const labels = [...container.querySelectorAll('[role="checkbox"]')].map(c => c.getAttribute('aria-label'))
    expect(labels).toEqual(['Set 1 done', 'Set 2 done'])
  })
})

describe('Workout add exercise flow', () => {
  it.each([
    ['freestyle', {}],
    ['planned', {
      active: { routineId: 'routine-1' },
      routines: [{ id: 'routine-1', ex: [] }],
    }],
  ])('inserts after the current unit and leaves the inserted exercise selected after completion in a %s session', async (_label, overrides) => {
    await mount([
      exercise('current', [true], { asked: true }),
      exercise('pending', [false], { asked: true }),
    ], 0, overrides)

    await addExerciseThroughSheets(
      { id: 'inserted' },
      { mode: 'time', sets: 1, sec: 30, weight: 0 },
    )

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['current', 'inserted', 'pending'])
    expect(mocks.S.active.cur).toBe(1)

    await rerender()
    await toggleSet(0)

    expect(mocks.S.active.entries[1].sets[0].done).toBe(true)
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
  })

  it('inserts after the complete current superset without splitting the group', async () => {
    await mount([
      exercise('current-a', [true], { sg: 'current-group', asked: true }),
      exercise('current-b', [true], { sg: 'current-group', asked: true }),
      exercise('pending', [false], { asked: true }),
    ])

    await addExerciseThroughSheets({ id: 'inserted' })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual([
      'current-a', 'current-b', 'inserted', 'pending',
    ])
    expect(mocks.S.active.entries.slice(0, 2).map(entry => entry.sg)).toEqual([
      'current-group', 'current-group',
    ])
    expect(mocks.S.active.cur).toBe(2)
    // The confirm says where the exercise goes: this workout, not the routine (QA 1.3.9).
    expect(mocks.exConfigSheet.mock.calls.at(-1)[7]).toBe('Add to this workout')
  })
})

// An exercise added to the block of a routine kept out of progression (a rehab or deload
// routine) belongs to that block: its routine's own numbers, and no count toward progression.
describe('adding an exercise to a block kept out of progression', () => {
  const BENCH = '0025'
  const history = [{
    d: '2026-08-27', routineIds: ['main'],
    entries: [{ id: BENCH, rid: 'main', target: { sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: true }] }],
  }]
  const routines = [{ id: 'rehab', name: 'Rehab', excludeFromProgression: true, ex: [] }, { id: 'main', name: 'Main', ex: [] }]

  it('is kept out too, at the numbers typed for it', async () => {
    await mount([exercise('band-pull', [false], { rid: 'rehab', noProg: true })], 0, { routines, workouts: history })
    await addExerciseThroughSheets({ id: BENCH }, { mode: 'reps', sets: 1, reps: 12, weight: 40 })
    const added = mocks.S.active.entries[1]
    expect(added).toMatchObject({ id: BENCH, rid: 'rehab', noProg: true })
    expect(added.plan.kind).toBe('off')
    expect(added.sets.map(s => [s.w, s.r])).toEqual([[40, 12]])
  })

  it('still progresses when the block is a regular routine\'s', async () => {
    await mount([exercise('row', [false], { rid: 'main' })], 0, { routines, workouts: history })
    await addExerciseThroughSheets({ id: BENCH }, { mode: 'reps', sets: 1, reps: 5, weight: 40 })
    const added = mocks.S.active.entries[1]
    expect(added.noProg).toBeUndefined()
    expect(added.plan.kind).toBe('up')
    expect(added.sets.map(s => s.w)).toEqual([102.5])
  })

  // #284 review: an exercise added to a workout logged into the past is built from what came
  // before that day, like the rest of it, not from a session logged after it.
  it('builds an exercise added to a workout logged into the past from the history before its day', async () => {
    const later = [...history, {
      d: '2026-08-31', routineIds: ['main'],
      entries: [{ id: BENCH, rid: 'main', target: { sets: 1, reps: 5, weight: 102.5 }, sets: [{ w: 102.5, r: 5, done: true }] }],
    }]
    const past = { d: '2026-08-29', start: Date.parse('2026-08-29T18:00:00'), backfill: { durationMin: 60, replaceId: null } }
    await mount([exercise('row', [false], { rid: 'main' })], 0, { routines, workouts: later, active: past })
    await addExerciseThroughSheets({ id: BENCH }, { mode: 'reps', sets: 1, reps: 5, weight: 40 })
    expect(mocks.S.active.entries[1].sets.map(s => s.w)).toEqual([102.5])
  })

  it('does not pass on an exercise kept out by hand for today (its ⋯ menu)', async () => {
    await mount([exercise('row', [false], { rid: 'main', noProg: true })], 0, { routines, workouts: history })
    await addExerciseThroughSheets({ id: BENCH }, { mode: 'reps', sets: 1, reps: 5, weight: 40 })
    const added = mocks.S.active.entries[1]
    expect(added.noProg).toBeUndefined()
    expect(added.plan.kind).toBe('up')
    expect(added.sets.map(s => s.w)).toEqual([102.5])
  })
})

describe('active workout weight controls', () => {
  const press = async (label, selector) => {
    const control = container.querySelector(selector)
    const button = control?.querySelector(`button[aria-label="${label}"]`)
    expect(button).toBeTruthy()
    await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
  }

  it('uses the configured reps weight step for manual increases and decreases, with the default fallback', async () => {
    await mount([exercise('plain-bench', [false], {
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false, inc: 1 },
    })])

    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(61)
    await press('Decrease', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(60)

    await unmount()
    await mount([exercise('plain-bench', [false])])
    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
  })

  it.each(['list', 'cards', 'compact'])('keeps added weight editable at zero in %s view', async workoutView => {
    await mount([exercise('bodyweight-pull-up', [false], {
      target: { mode: 'reps', reps: 8, weight: 0, bodyweight: true, inc: 1 },
      sets: [{ w: 0, r: 8, done: false }],
    })], 0, { workoutView })

    expect(container.querySelector('.sethead').textContent).toContain('Added (kg)')
    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ w: 1, r: 8 })
    await press('Decrease', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(0)
    expect(container.querySelector('.sethead').textContent).toContain('Added (kg)')
    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ w: 1, r: 8 })
  })

  it('matches automatic progression rounding for a fractional configured step', async () => {
    const target = { mode: 'reps', sets: 1, reps: 5, weight: 60, bodyweight: false, inc: 1.25 }
    const automatic = nextPrescription({
      unit: 'kg',
      workouts: [{ d: '2026-08-30', entries: [{ id: 'plain-bench', target, sets: [{ w: 60, r: 5, done: true }] }] }],
    }, { id: 'plain-bench', ...target })

    await mount([exercise('plain-bench', [false], { target, sets: [{ w: 60, r: 5, done: false }] })])
    await press('Increase', '.setrow .stp.w')

    expect(automatic.weight).toBe(61.3)
    expect(mocks.S.active.entries[0].sets[0].w).toBe(automatic.weight)
  })

  it('uses the configured reps weight step for drop-set weight controls', async () => {
    await mount([exercise('plain-bench', [false], {
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false, inc: 1 },
      sets: [{ w: 60, r: 5, done: false, type: 'dropset', drops: [{ w: 50, r: 5 }] }],
    })])

    await press('Increase', '.subrow .stp')

    expect(mocks.S.active.entries[0].sets[0].drops[0].w).toBe(51)
  })

  it('keeps timed seconds and optional timed weight on their existing steps', async () => {
    await mount([exercise('timed-plank', [false], {
      target: { mode: 'time', sec: 30, weight: 60, bodyweight: false, inc: 1 },
      sets: [{ sec: 30, w: 60, done: false }],
    })])

    await press('Increase', '.setrow .stp.w')
    expect(mocks.S.active.entries[0].sets[0].sec).toBe(35)
    await press('Increase', '.setrow .stp.r')
    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
  })
})

// A rest that starts while a hold is running takes the hold down (useUI: the two must never run
// together), so the hold hands back what it held on the way out and its own row keeps it. It is
// explicitly not a finish: the row stays unticked and starts no rest of its own, because the rest
// that displaced it is the one counting down. And `sec` on a timed row is both the plan and the
// log, so a part-held set must not become the next hold's target.
describe('a hold a rest displaced', () => {
  const timed = (sec = 30) => exercise('timed-plank', [false, false], {
    target: { mode: 'time', sec, weight: 0, bodyweight: true },
    sets: [{ sec, w: 0, done: false }, { sec, w: 0, done: false }],
  })
  const pressStart = async (index = 0) => {
    const button = container.querySelectorAll('button.setgo')[index]
    expect(button).toBeTruthy()
    await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
  }
  // What useUI.abandonWork hands the owner: the seconds held, and "this was not a finish".
  const handBack = async (elapsed, call = 0) => {
    await act(async () => { mocks.startWork.mock.calls[call][2](elapsed, { abandoned: true }) })
    await rerender()
  }

  it('keeps its seconds, stays unticked and starts no rest', async () => {
    await mount([timed()])
    await pressStart(0)
    mocks.startRest.mockClear()

    await handBack(18)

    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ sec: 18, done: false })
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('shows what it held without becoming the next hold\'s target', async () => {
    await mount([timed(30)])
    await pressStart(0)
    expect(mocks.startWork.mock.calls[0][0]).toBe(30)

    await handBack(3)
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ sec: 3, planSec: 30, done: false })

    await pressStart(0)                                          // hold it again
    expect(mocks.startWork.mock.calls[1][0]).toBe(30)            // the plan, not the 3 s it managed
  })

  it('a plan you edited yourself survives the same way', async () => {
    await mount([timed(55)])
    await pressStart(0)
    expect(mocks.startWork.mock.calls[0][0]).toBe(55)
    await handBack(4)
    await pressStart(0)
    expect(mocks.startWork.mock.calls[1][0]).toBe(55)
  })

  it('and typing a duration is the new plan, so the plan it kept aside goes', async () => {
    await mount([timed(30)])
    await pressStart(0)
    await handBack(3)
    expect(mocks.S.active.entries[0].sets[0].planSec).toBe(30)

    // The seconds stepper on a timed row is the '.stp.w' one (the first column).
    const button = container.querySelector('.setrow .stp.w button[aria-label="Increase"]')
    expect(button).toBeTruthy()
    await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()

    expect(mocks.S.active.entries[0].sets[0].planSec).toBeUndefined()
    const typed = mocks.S.active.entries[0].sets[0].sec
    await pressStart(0)
    expect(mocks.startWork.mock.calls[1][0]).toBe(typed)         // what the field says, not the old plan
  })

  it('and once the row is ticked, the plan it kept aside goes', async () => {
    await mount([timed(30)])
    await pressStart(0)
    await handBack(3)
    expect(mocks.S.active.entries[0].sets[0].planSec).toBe(30)

    await toggleSet(0)                                           // ticked by hand
    expect(mocks.S.active.entries[0].sets[0].planSec).toBeUndefined()
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
  })

  // Ticking the held row's own Check is the same mechanism from the other side: the tick starts
  // the rest, the rest displaces the hold, and the hand-back lands on the row the tick just
  // ticked. So the row logs what was actually held rather than its target, and keeps no plan.
  it('ticking the held row by hand logs what was held, not the target', async () => {
    await mount([timed(30)])
    await pressStart(0)
    mocks.work = { left: 12, total: 30, endsAt: Date.now() + 12_000, label: 'timed-plank' }
    await rerender()

    await toggleSet(0)
    await handBack(18)               // what useUI.abandonWork hands back under that tick

    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ sec: 18, done: true })
    expect(mocks.S.active.entries[0].sets[0].planSec).toBeUndefined()
  })

  it('a hold held to the end still logs and ticks, and keeps no plan behind', async () => {
    await mount([timed(30)])
    await pressStart(0)
    await act(async () => { mocks.startWork.mock.calls[0][2](30) })   // no abandoned flag: a finish
    await rerender()

    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ sec: 30, done: true })
    expect(mocks.S.active.entries[0].sets[0].planSec).toBeUndefined()
  })
})

// A hold that ran out while the page was hidden says when it ended (useUI runWork), and the rest
// it earned, a switch-sides pause included, counts from then (useUI startRest's `since`).
describe('a hold that ran out unseen', () => {
  const hold = (id, extra = {}) => exercise(id, [], { target: { mode: 'time', sec: 30, weight: 0 }, sets: [{ sec: 30, w: 0, done: false }, { sec: 30, w: 0, done: false }, { sec: 30, w: 0, done: false }], ...extra })
  const pressStart = async row => {
    const btn = container.querySelectorAll('.setrow .setgo')[row]
    expect(btn).toBeTruthy()
    await act(async () => { btn.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  }

  it('hands its end to the rest it earned, and so does one side of a per-side hold', async () => {
    await mount([hold('plank')])
    await pressStart(0)
    await act(async () => { mocks.startWork.mock.calls[0][2](30, { chimed: false, endedAt: 1234 }) })
    expect(mocks.startRest).toHaveBeenLastCalledWith(90, 0, expect.objectContaining({ kind: 'set', since: 1234 }))

    await unmount(); vi.clearAllMocks()
    await mount([hold('side-plank', { sets: [{ sec: 30, w: 0, side: 'L', done: false }, { sec: 30, w: 0, side: 'R', done: false }] })])
    await pressStart(0)
    await act(async () => { mocks.startWork.mock.calls[0][2](30, { chimed: false, endedAt: 5678 }) })
    expect(mocks.startRest).toHaveBeenLastCalledWith(10, 0, expect.objectContaining({ kind: 'switch', since: 5678 }))
  })

  it('a hold that ended on screen starts its rest from now', async () => {
    await mount([hold('plank')])
    await pressStart(0)
    await act(async () => { mocks.startWork.mock.calls[0][2](30, { chimed: true }) })
    expect(mocks.startRest).toHaveBeenLastCalledWith(90, 0, { kind: 'set', phase: null, forSet: 0 })
  })
})

describe('Workout discard timer lifecycle', () => {
  it('preserves active timers while discard is awaiting confirmation', async () => {
    const timer = { left: 30, total: 90, endsAt: Date.now() + 30_000 }
    const work = { left: 20, total: 45, endsAt: Date.now() + 20_000, label: 'Plank' }
    mocks.timer = timer
    mocks.work = work
    await mount([exercise('timed-plank', [false])])

    await requestDiscard()

    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    expect(mocks.timer).toBe(timer)
    expect(mocks.work).toBe(work)
    expect(mocks.stopRest).not.toHaveBeenCalled()
    expect(mocks.stopWork).not.toHaveBeenCalled()
    expect(mocks.S.active).not.toBeNull()
  })

  it('clears rest and work timers only after discard is confirmed', async () => {
    mocks.timer = { left: 30, total: 90, endsAt: Date.now() + 30_000 }
    mocks.work = { left: 20, total: 45, endsAt: Date.now() + 20_000, label: 'Plank' }
    await mount([exercise('timed-plank', [false])])
    await requestDiscard()

    await act(async () => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })

    expect(mocks.S.active).toBeNull()
    expect(mocks.timer).toBeNull()
    expect(mocks.work).toBeNull()
    expect(mocks.stopRest).toHaveBeenCalledOnce()
    expect(mocks.stopWork).toHaveBeenCalledOnce()
  })
})

// The live-presence "left" signal goes through lib/api.js beacon() (upstream's: the web app's
// own origin, nothing on a phone, where the api() call beside it reaches the server).
describe('Workout live-presence heartbeat', () => {
  it('leaving the screen signed in sends the "left" signal through beacon() and the API, as navigated', async () => {
    mocks.user = { id: 'u1', name: 'Boris' }
    await mount([exercise('plain-bench', [false])])
    expect(api).toHaveBeenCalledWith('/api/activity', expect.objectContaining({ method: 'POST' }))
    await unmount()
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon).toHaveBeenCalledWith('/api/activity', { active: false, reason: 'navigated' })
    expect(api).toHaveBeenLastCalledWith('/api/activity', { method: 'POST', body: JSON.stringify({ active: false, reason: 'navigated' }) })
  })

  it('a guest has no server session, so there is no heartbeat and no signal', async () => {
    await mount([exercise('plain-bench', [false])])
    await unmount()
    expect(beacon).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalledWith('/api/activity', expect.anything())
  })
})

// A closed tab, or a home-screen app swiped away or killed by the phone, never unmounts the screen,
// so the "left" signal in the effect cleanup never went and "training now" kept the athlete until
// the server's presence expiry. The page going away sends it itself, with the reason the server
// goes by: `closed` drops the athlete at once, `hidden` gives a heartbeat 45 s to cancel it.
describe('Workout live-presence "left" signal when the page goes away', () => {
  let visibility
  const setVisibility = async state => {
    visibility = state
    await act(async () => { document.dispatchEvent(new dom.Event('visibilitychange')) })
  }
  const pagehide = async () => { await act(async () => { window.dispatchEvent(new dom.Event('pagehide')) }) }
  const pageshow = async persisted => {
    await act(async () => { window.dispatchEvent(Object.assign(new dom.Event('pageshow'), { persisted })) })
  }
  const heartbeats = () => vi.mocked(api).mock.calls.filter(([path, opts]) => path === '/api/activity' && JSON.parse(opts.body).active === true).length
  const reasons = () => vi.mocked(beacon).mock.calls.map(([, body]) => body.reason)
  const signedInMount = async () => {
    mocks.user = { id: 'u1', name: 'Boris' }
    await mount([exercise('plain-bench', [false])])
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  }
  afterEach(() => { vi.useRealTimers() })

  it('a closing tab (pagehide) sends it through beacon() as closed while the screen is still mounted', async () => {
    await signedInMount()
    await pagehide()
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon).toHaveBeenCalledWith('/api/activity', { active: false, reason: 'closed' })
  })

  it('an iOS home-screen app going hidden sends it as hidden, once, however many hidden events follow', async () => {
    await signedInMount()
    await setVisibility('hidden')
    await setVisibility('hidden')
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon).toHaveBeenCalledWith('/api/activity', { active: false, reason: 'hidden' })
  })

  it('a close whose pagehide follows the hidden visibilitychange still sends closed, once', async () => {
    await signedInMount()
    await setVisibility('hidden')
    await pagehide()
    await pagehide()
    expect(reasons()).toEqual(['hidden', 'closed'])
  })

  it('nothing follows closed: a visibilitychange to hidden after the pagehide sends nothing more', async () => {
    await signedInMount()
    await pagehide()
    await setVisibility('hidden')
    expect(reasons()).toEqual(['closed'])
  })

  it('shown again, the page heartbeats at once, and the next hide sends it again', async () => {
    await signedInMount()
    const before = heartbeats()
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(heartbeats()).toBe(before + 1)
    await setVisibility('hidden')
    expect(reasons()).toEqual(['hidden', 'hidden'])
  })

  it('a page back from the back/forward cache heartbeats at once, and its next close sends closed again', async () => {
    await signedInMount()
    const before = heartbeats()
    await pagehide()
    await pageshow(false)
    expect(heartbeats()).toBe(before)
    await pageshow(true)
    expect(heartbeats()).toBe(before + 1)
    await pagehide()
    expect(reasons()).toEqual(['closed', 'closed'])
  })

  it('a hidden page that keeps heartbeating is re-armed, for hidden and for the close that follows', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await signedInMount()
    await setVisibility('hidden')
    expect(reasons()).toEqual(['hidden'])
    const before = heartbeats()
    await act(async () => { vi.advanceTimersByTime(20000) })
    expect(heartbeats()).toBe(before + 1)
    await setVisibility('hidden')
    expect(reasons()).toEqual(['hidden', 'hidden'])
    await pagehide()
    expect(reasons()).toEqual(['hidden', 'hidden', 'closed'])
  })

  it('a guest sends nothing, and an unmounted screen stops listening', async () => {
    await mount([exercise('plain-bench', [false])])
    await pagehide()
    expect(beacon).not.toHaveBeenCalled()
    await unmount()

    await signedInMount()
    const win = window
    const doc = document
    await unmount()
    expect(reasons()).toEqual(['navigated'])                 // the cleanup's own
    const after = heartbeats()
    win.dispatchEvent(new win.Event('pagehide'))
    visibility = 'hidden'
    doc.dispatchEvent(new win.Event('visibilitychange'))
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(heartbeats()).toBe(after)
  })
})

describe('progression guidance', () => {
  it('labels the visible outcome with the policy that calculated it', async () => {
    await mount([exercise('plain-bench', [false, false, false], {
      plan: {
        policy: 'linear',
        kind: 'up',
        weight: 62.5,
        why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
      },
    })])

    expect(container.querySelector('.progline')?.textContent)
      .toContain('Linear progression · Every rep last time. 2.5 kg more.')
  })

  it('is a keyboard-accessible button that opens settings for the pressed grouped entry', async () => {
    const plan = {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
    }
    const first = exercise('plain-bench', [false], { sg: 'group', plan })
    const second = exercise('plain-bench', [false], {
      sg: 'group', plan, target: { mode: 'reps', reps: 8, weight: 80, bodyweight: false },
    })
    await mount([first, second])
    const firstBefore = JSON.stringify(mocks.S.active.entries[0])

    const button = await pressProgression(1)

    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-label')).toBe('Open exercise settings')
    expect(mocks.exConfigSheet).toHaveBeenCalledOnce()
    // An entry with no stamped plan opens at its target.
    expect(mocks.exConfigSheet.mock.calls[0][1]).toEqual(second.target)
    expect(mocks.exConfigSheet.mock.calls[0][4]).toBe(mocks.S.routines[0])

    mocks.exConfigSheet.mock.calls[0][2]({ ...second.target, prog: 'double', repsMin: 6 })
    expect(JSON.stringify(mocks.S.active.entries[0])).toBe(firstBefore)
    expect(mocks.S.active.entries[1].target.prog).toBe('double')
    expect(mocks.S.active.cur).toBe(0)
  })

  it('does not save into a different duplicate occurrence after the entry list shifts', async () => {
    const plan = {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
    }
    const first = exercise('plain-bench', [false], { plan, target: { mode: 'reps', reps: 5, weight: 60, marker: 'first' } })
    const second = exercise('plain-bench', [false], { plan, target: { mode: 'reps', reps: 8, weight: 80, marker: 'second' } })
    const third = exercise('plain-bench', [false], { plan, target: { mode: 'reps', reps: 10, weight: 100, marker: 'third' } })
    await mount([first, second, third], 1)
    await pressProgression()
    const save = mocks.exConfigSheet.mock.calls[0][2]

    mocks.S.active.entries.splice(0, 1)
    await act(async () => { save({ ...second.target, prog: 'double', repsMin: 6 }) })

    expect(mocks.S.active.entries.map(entry => entry.target.marker)).toEqual(['second', 'third'])
    expect(mocks.S.active.entries[0].target.prog).toBeUndefined()
    expect(mocks.S.active.entries[1].target.prog).toBeUndefined()
  })

  it('does not save through a sheet left open from a replaced workout', async () => {
    const plan = {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
    }
    const original = exercise('plain-bench', [false], { plan })
    await mount([original])
    await pressProgression()
    const save = mocks.exConfigSheet.mock.calls[0][2]
    const replacement = exercise('plain-bench', [false], {
      plan,
      target: { mode: 'reps', reps: 10, weight: 100, marker: 'replacement' },
    })
    mocks.S.active = { ...mocks.S.active, id: 'replacement-workout', entries: [replacement] }

    await act(async () => { save({ ...original.target, prog: 'double', repsMin: 6 }) })

    expect(mocks.S.active.entries[0].target).toEqual(replacement.target)
    expect(mocks.S.active.entries[0].target.prog).toBeUndefined()
  })

  it('leaves the active entry unchanged when progression settings are cancelled', async () => {
    const entry = exercise('plain-bench', [true, false], {
      plan: {
        policy: 'linear', kind: 'up', weight: 62.5,
        why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
      },
    })
    await mount([entry])
    const before = JSON.stringify(mocks.S.active.entries[0])

    await pressProgression()

    expect(JSON.stringify(mocks.S.active.entries[0])).toBe(before)
  })

  it('saves the active policy, preserves completed rows, and refreshes guidance immediately', async () => {
    const entry = exercise('plain-bench', [true, false], {
      plan: {
        policy: 'linear', kind: 'up', weight: 62.5,
        why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
      },
    })
    await mount([entry])
    mocks.S.workouts = [{
      d: '2026-08-27',
      entries: [{
        id: entry.id,
        target: { sets: 2, reps: 5, weight: 60 },
        sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }],
      }],
    }]
    const completed = mocks.S.active.entries[0].sets[0]
    await pressProgression()
    const save = mocks.exConfigSheet.mock.calls[0][2]

    await act(async () => {
      save({ ...entry.target, prog: 'double', repsMin: 3 })
      root.render(React.createElement(Workout))
    })

    const saved = mocks.S.active.entries[0]
    expect(saved.target.prog).toBe('double')
    expect(saved.sets[0]).toEqual(completed)
    expect(saved.sets[0]).toEqual({ w: 60, r: 5, done: true })
    expect(saved.sets[1]).toEqual({ w: 62.5, r: 3, done: false })
    expect(container.querySelector('.progline')?.textContent)
      .toContain('Double progression · Top of the rep range in every set. 2.5 kg more, back to 3 reps.')

    const persisted = JSON.parse(JSON.stringify(mocks.S))
    await unmount()
    mocks.S = persisted
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(container.querySelector('.progline')?.textContent)
      .toContain('Double progression · Top of the rep range in every set. 2.5 kg more, back to 3 reps.')
  })
})

// Editing an exercise mid-session rebuilds its open rows the way the session start builds them:
// the same reps source and the same stamped target, so saving "2 × 10" over a session carried at
// 15 opens 10s, and the target the session is judged by says what the rows say.
describe('progression settings rebuild the rows like a session start', () => {
  const history = [{
    d: '2026-08-27',
    entries: [{ id: 'plain-bench', target: { sets: 2, reps: 15, weight: 40 }, sets: [{ w: 40, r: 15, done: true }, { w: 40, r: 15, done: true }] }],
  }]
  const plan = { policy: 'linear', kind: 'up', weight: 42.5, why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'] }
  const saveTen = async state => {
    await mount([exercise('plain-bench', [false, false], { plan, target: { mode: 'reps', sets: 2, reps: 15, weight: 40 } })], 0, state)
    await pressProgression()
    const save = mocks.exConfigSheet.mock.calls.at(-1)[2]
    await act(async () => { save({ mode: 'reps', sets: 2, reps: 10, weight: 40, prog: 'linear' }) })
    return mocks.S.active.entries[0]
  }

  it('opens the plan\'s reps and stamps the prescription into the target', async () => {
    const saved = await saveTen({ workouts: history })
    expect(saved.sets.map(s => [s.w, s.r])).toEqual([[42.5, 10], [42.5, 10]])
    expect(saved.target).toMatchObject({ id: 'plain-bench', sets: 2, reps: 10, weight: 42.5 })
    expect(saved.plan.kind).toBe('up')
    // The plan this session now follows, so the next one can tell it apart from the routine's.
    expect(saved.planned).toEqual({ sets: 2, reps: 10, weight: 40 })
  })

  it('carries last session\'s reps when the profile starts from the last session', async () => {
    const saved = await saveTen({ workouts: history, startFrom: 'last' })
    expect(saved.sets.map(s => s.r)).toEqual([15, 15])
    expect(saved.target.reps).toBe(10)
  })
})

// The settings sheet edits the plan, so it opens at the plan's sets and reps, not at today's
// prescription. Opened at today's numbers, a save that changed nothing stamped a double
// progression's raised session, or a bodyweight climb, as the plan: "Plan changed", the raise
// undone within the session, the climb started again at the next one (#275).
describe('saving progression settings unchanged', () => {
  const BENCH = '0025'    // barbell bench press
  const PUSHUP = '0662'   // push-up
  const rows = entry => entry.sets.filter(s => !isWarmupRow(s)).map(s => [s.w, s.r])
  // Start the routine for real, tick every row and log it the way finishing a workout does.
  let day = 1
  const trainOnce = st => {
    const entries = buildCombinedEntries(st, ['A']).entries.map(e => ({ ...e, sets: e.sets.map(x => ({ ...x, done: true })) }))
    const active = { id: 'w' + day, d: `2026-08-${String(day).padStart(2, '0')}`, start: day * 1000, routineIds: ['A'], name: 'A', entries }
    day++
    st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
  }
  const history = (cfg, sessions) => {
    const st = { unit: 'kg', exWeights: {}, routines: [{ id: 'A', name: 'A', ex: [cfg] }], workouts: [] }
    for (let i = 0; i < sessions; i++) trainOnce(st)
    return st
  }
  // What the sheet hands back when it is saved as it opened: its own fields, nothing else.
  const unchanged = opened => {
    const { sets, mode, reps, repsMin, weight, prog, repsMax } = opened
    return JSON.parse(JSON.stringify({ sets, mode: mode || 'reps', reps, repsMin, weight, prog, repsMax }))
  }
  const saveUnchanged = async st => {
    const built = buildCombinedEntries(st, ['A']).entries
    await mount(built, 0, { routines: st.routines, workouts: st.workouts })
    const before = structuredClone(mocks.S.active.entries[0])
    await pressProgression()
    const [, opened, save] = mocks.exConfigSheet.mock.calls.at(-1)
    await act(async () => { save(unchanged(opened)) })
    return { before, opened, after: mocks.S.active.entries[0] }
  }
  // Finish the session in front of you and build the next one from the same routine.
  const next = st => {
    const active = structuredClone(mocks.S.active)
    active.entries.forEach(e => e.sets.forEach(x => { x.done = true }))
    st.workouts.push(buildCompletedWorkout({ ...active, d: '2026-09-01', routineIds: ['A'] }, { end: Date.now() }))
    return buildCombinedEntries(st, ['A']).entries[0]
  }

  it('keeps a double-progression raise in place, and the next session builds on it', async () => {
    const st = history({ id: BENCH, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }, 1)
    const { before, opened, after } = await saveUnchanged(st)
    expect(before.plan.kind).toBe('up')
    expect(opened).toMatchObject({ sets: 3, reps: 12, repsMin: 8 })
    expect(rows(after)).toEqual([[42.5, 8], [42.5, 8], [42.5, 8]])
    expect(after.plan.kind).toBe('up')
    expect(after.planned).toEqual(before.planned)
    expect(after.target).toMatchObject({ weight: 42.5, reps: 8, repsMin: 8 })
    expect(container.querySelector('.planline')?.textContent).toBe('Plan: 3 × 8–12')
    const following = next(st)
    expect(following.plan.why[0]).not.toBe('Plan changed, so starting from your new target.')
    expect(rows(following)).toEqual([[42.5, 9], [42.5, 9], [42.5, 9]])
  })

  it('keeps a bodyweight climb, and the next session climbs on from it', async () => {
    const st = history({ id: PUSHUP, sets: 2, reps: 10, weight: 0, bodyweight: true }, 3)
    const { before, opened, after } = await saveUnchanged(st)
    expect(rows(before)).toEqual([[0, 13], [0, 13]])
    expect(opened).toMatchObject({ sets: 2, reps: 10 })
    expect(rows(after)).toEqual([[0, 13], [0, 13]])
    expect(after.planned).toEqual(before.planned)
    const following = next(st)
    expect(following.plan.kind).toBe('up')
    expect(rows(following)).toEqual([[0, 14], [0, 14]])
  })

  it('keeps a set the rep ceiling added, and the plan line still reads the plan', async () => {
    const st = history({ id: PUSHUP, sets: 2, reps: 10, repsMax: 11, weight: 0, bodyweight: true }, 2)
    const { before, opened, after } = await saveUnchanged(st)
    expect(rows(before)).toEqual([[0, 10], [0, 10], [0, 10]])
    expect(opened.sets).toBe(2)
    expect(rows(after)).toEqual([[0, 10], [0, 10], [0, 10]])
    expect(after.planned).toEqual(before.planned)
    expect(container.querySelector('.planline')?.textContent).toBe('Plan: 2 × 10 · today 3 × 10')
    expect(rows(next(st))).toEqual([[0, 11], [0, 11], [0, 11]])
  })

  it('keeps the plan\'s weight when only the reps are edited, so the restart holds what was lifted', async () => {
    const st = history({ id: BENCH, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }, 1)
    await mount(buildCombinedEntries(st, ['A']).entries, 0, { routines: st.routines, workouts: st.workouts })
    await pressProgression()
    const [, opened, save] = mocks.exConfigSheet.mock.calls.at(-1)
    expect(opened.weight).toBe(42.5)          // today's, the one on the bar
    await act(async () => { save({ ...unchanged(opened), reps: 10 }) })
    const after = mocks.S.active.entries[0]
    expect(after.planned).toEqual({ sets: 3, reps: 10, repsMin: 8, weight: 40 })
    expect(after.plan.why[0]).toBe('Plan changed, so starting from your new target.')
    expect(rows(after).map(r => r[0])).toEqual([40, 40, 40])
  })
})

describe('effort cell (colour-coded RIR/RPE quick picker)', () => {
  // A rep exercise whose sets can carry an effort rating. `rir` per set is optional — an
  // unrated set simply omits the key, which is what the empty cell has to represent.
  const effExercise = (rirs) => ({
    id: 'plain-bench',
    target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
    sets: rirs.map(rir => ({ w: 60, r: 5, done: false, ...(rir == null ? {} : { rir }) })),
  })
  // A cell is one of two shapes: an empty `.effcell` button (label, opens picker) or, once a
  // rating is logged, a `.effcell-stp` −/value/+ group. `.effcell-list` returns the outer
  // element of each (carrying the colour on the logged one); `effCells` normalises them to the
  // value-bearing, picker-opening element so the existing assertions read the same either way:
  // for the empty button that is the button itself, for the stepper it is the `.val` button.
  const effCellList = () => [...container.querySelectorAll('.effcell,.effcell-stp')]
  const effCells = () => effCellList().map(el =>
    el.classList.contains('effcell-stp') ? el.querySelector('.val') : el)

  async function mountEffort(rirs, scale = 'rir') {
    mocks.S = workout([effExercise(rirs)])
    mocks.S.effort = scale
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
  }

  it('shows the effort column only when the profile logs a scale', async () => {
    await mount([exercise('plain-bench', [false])])   // effort: 'none' from workout()
    expect(effCells()).toHaveLength(0)
    await unmount()
    await mountEffort([null])
    expect(effCells()).toHaveLength(1)
  })

  it('labels an unrated cell with the scale name, not a value or a colour', async () => {
    await mountEffort([null], 'rir')
    const cell = effCells()[0]
    expect(cell.textContent).toBe('RIR')
    expect(cell.className).toContain('is-empty')
    // no rating means no inline colour on the button
    expect(cell.getAttribute('style') || '').not.toMatch(/color/)
  })

  it('uses the profile scale for the empty label — RPE profile reads "RPE"', async () => {
    await mountEffort([null], 'rpe')
    expect(effCells()[0].textContent).toBe('RPE')
  })

  it('shows a logged rating as its number, tinted by the band it falls in', async () => {
    await mountEffort([0, 2, null])
    const cells = effCells()
    const outer = effCellList()
    expect(cells[0].textContent).toBe('0')
    expect(outer[0].className).toContain('effcell-stp')   // logged: the stepper, not the label
    // 0 RIR = to failure = purple; 2 RIR = yellow (the colours effortColor assigns) — the
    // colour rides the outer stepper (border + tinted background), not the inner value button
    expect(outer[0].getAttribute('style')).toContain('--purple')
    expect(cells[1].textContent).toBe('2')
    expect(outer[1].getAttribute('style')).toContain('--yellow')
    expect(cells[2].textContent).toBe('RIR')      // the unrated one stays a label
    expect(outer[2].className).toContain('is-empty')
  })

  it('displays a logged value on the profile scale — RIR 2 reads as RPE 8', async () => {
    // the set is stored on whatever scale the profile logs; an RPE profile stores s.rpe
    mocks.S = workout([{
      id: 'plain-bench',
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
      sets: [{ w: 60, r: 5, done: false, rpe: 8 }],
    }])
    mocks.S.effort = 'rpe'
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(effCells()[0].textContent).toBe('8')
    // RPE 8 == RIR 2 == yellow: the colour is the effort, independent of the scale shown
    expect(effCellList()[0].getAttribute('style')).toContain('--yellow')
  })

  it('opens the picker for the set on tap, passing scale, current value and a writer', async () => {
    await mountEffort([2])
    await act(async () => {
      effCells()[0].dispatchEvent(new dom.Event('click', { bubbles: true }))
    })
    expect(mocks.effortPickerSheet).toHaveBeenCalledOnce()
    const [scale, value, onPick] = mocks.effortPickerSheet.mock.calls[0]
    expect(scale).toBe('rir')
    expect(value).toBe(2)
    // the writer stores the chosen value back on the set, and null clears the key
    onPick(1)
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(1)
    onPick(null)
    expect('rir' in mocks.S.active.entries[0].sets[0]).toBe(false)
  })

  // The mock store is a plain snapshot with no subscription, so a click updates mocks.S but
  // does not re-render on its own; each step is checked from its own mount rather than chained.
  const clickStep = async label => {
    await act(async () => {
      effCellList()[0].querySelector(`button[aria-label="${label}"]`)
        .dispatchEvent(new dom.Event('click', { bubbles: true }))
    })
  }

  it('steps a logged rating up 0.5 on the scale with the + button, not through the picker', async () => {
    await mountEffort([2])
    expect(effCellList()[0].querySelectorAll('button[aria-label="Increase"],button[aria-label="Decrease"]')).toHaveLength(2)
    await clickStep('Increase')
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(2.5)
    expect(mocks.effortPickerSheet).not.toHaveBeenCalled()
  })

  it('steps a logged rating down 0.5 with the − button', async () => {
    await mountEffort([2])
    await clickStep('Decrease')
    expect(mocks.S.active.entries[0].sets[0].rir).toBe(1.5)
  })

  it('clears the rating when stepped down off the floor', async () => {
    // RIR 0 is the bottom of the scale — one more − is a mistap-undo, dropping the key rather
    // than sticking at 0 (which reads as "went to failure")
    await mountEffort([0])
    await clickStep('Decrease')
    expect('rir' in mocks.S.active.entries[0].sets[0]).toBe(false)
  })
})

describe('superset flow survives an exercise being removed mid-session', () => {
  // removeActiveExercise splices A.entries, shifting every index above the removal down.
  // The high-water marks are index-keyed, so without re-baselining the shifted exercise
  // inherits its predecessor's mark and its next completed set reads as an uncheck/re-check
  // — no advance, and no rest at the end of the round.
  it('still advances and rests for sets completed after a removal', async () => {
    // warm(2 sets, both done) ahead of a bench/row superset with nothing done yet.
    await mount([
      exercise('warm', [true, true]),
      exercise('bench', [false, false], { sg: 'g1' }),
      exercise('row', [false, false], { sg: 'g1' }),
    ], 1)

    // Drop the first exercise: bench moves 1 -> 0, row moves 2 -> 1.
    // Stale marks would be [2, 0, 0] against entries that are now [bench, row].
    await act(async () => {
      mocks.S.active.entries.splice(0, 1)
      mocks.S.active.cur = 0
      root.render(React.createElement(Workout))
    })
    mocks.startRest.mockClear()

    // First member of the group: real progress, so the flow advances to the partner.
    await toggleSet(0)
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(mocks.S.active.cur).toBe(1)

    // Partner closes the round (each still has a second set), which is what starts the rest.
    await toggleSet(2)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'round', phase: null, forSet: expect.any(Number) })
  })
})

describe('superset actionable-set centring', () => {
  it('centres the newly active exercise first incomplete set row', async () => {
    await mount([
      exercise('bench', [true, false], { sg: 'g1' }),
      exercise('row', [true, false, false], { sg: 'g1' }),
    ])
    mocks.scrollCalls.length = 0

    await rerenderAt(1)

    const rows = container.querySelector('[data-exidx="1"]').querySelectorAll('.setrow')
    expect(mocks.scrollCalls).toEqual([
      { node: rows[1], options: { behavior: 'smooth', block: 'center' } },
    ])
  })

  it('centres the last set row when the newly active exercise is complete', async () => {
    await mount([
      exercise('bench', [true, false], { sg: 'g1' }),
      exercise('row', [true, true], { sg: 'g1' }),
    ])
    mocks.scrollCalls.length = 0

    await rerenderAt(1)

    const rows = container.querySelector('[data-exidx="1"]').querySelectorAll('.setrow')
    expect(mocks.scrollCalls).toEqual([
      { node: rows[1], options: { behavior: 'smooth', block: 'center' } },
    ])
  })

  it('centres the exercise wrapper when the newly active exercise has no set row', async () => {
    await mount([
      exercise('bench', [true, false], { sg: 'g1' }),
      exercise('row', [], { sg: 'g1' }),
    ])
    mocks.scrollCalls.length = 0

    await rerenderAt(1)

    const wrapper = container.querySelector('[data-exidx="1"]')
    expect(mocks.scrollCalls).toEqual([
      { node: wrapper, options: { behavior: 'smooth', block: 'center' } },
    ])
  })

  it('does not auto-scroll set rows for ordinary exercise navigation', async () => {
    await mount([
      exercise('bench', [true, false]),
      exercise('row', [false, false]),
    ])
    mocks.scrollCalls.length = 0

    await rerenderAt(1)

    expect(mocks.scrollCalls).toEqual([])
  })
})

describe('active workout whole-unit move controls', () => {
  // These exercise-level buttons are opt-in now (Settings → Workout controls); the menu path is covered below.
  const mountLegacy = (entries, cur) => mount(entries, cur, { wc: { exerciseButtons: true } })
  const action = label => container.querySelector(`button[aria-label="${label}"]`)

  it('shows labelled controls and moves the selected standalone exercise one unit', async () => {
    const selected = exercise('duplicate', [false], {
      occurrenceId: 'duplicate#2',
      target: { mode: 'reps', reps: 7, weight: 82.5, notes: 'Keep this target' },
      sets: [{ w: 77.5, r: 6, done: true, rir: 2 }],
    })
    await mountLegacy([
      exercise('duplicate', [false], { occurrenceId: 'duplicate#1' }),
      exercise('middle', [false]),
      selected,
    ], 2)

    expect(action('Move up')?.textContent.trim()).toBe('Move up')
    expect(action('Move down')?.textContent.trim()).toBe('Move down')
    await act(async () => { action('Move up').dispatchEvent(new dom.Event('click', { bubbles: true })) })

    expect(mocks.S.active.entries.map(entry => entry.occurrenceId || entry.id)).toEqual(['duplicate#1', 'duplicate#2', 'middle'])
    expect(mocks.S.active.entries[1]).toEqual(selected)
    expect(mocks.S.active.entries[1].target).toEqual({ mode: 'reps', reps: 7, weight: 82.5, notes: 'Keep this target' })
    expect(mocks.S.active.entries[1].sets).toEqual([{ w: 77.5, r: 6, done: true, rir: 2 }])
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.stopWork).toHaveBeenCalledOnce()
    expect(mocks.stopRest).not.toHaveBeenCalled()
  })

  it('moves the selected contiguous group as one unit without changing its metadata', async () => {
    const first = exercise('group-a', [false], { sg: 'pair', occurrenceId: 'group-a#1' })
    const selected = exercise('group-b', [true], { sg: 'pair', occurrenceId: 'group-b#1' })
    const groupMeta = { pair: { kind: 'complex', label: 'Carry pair', cues: 'Stay braced.' } }
    await mountLegacy([
      exercise('before', [false]),
      first,
      selected,
      exercise('after', [false]),
    ], 2)
    mocks.S.active.groupMeta = groupMeta

    await act(async () => { action('Move up').dispatchEvent(new dom.Event('click', { bubbles: true })) })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['group-a', 'group-b', 'before', 'after'])
    expect(mocks.S.active.entries.slice(0, 2)).toEqual([first, selected])
    expect(mocks.S.active.entries.slice(0, 2).map(entry => entry.sg)).toEqual(['pair', 'pair'])
    expect(mocks.S.active.groupMeta).toEqual(groupMeta)
    expect(mocks.S.active.entries[mocks.S.active.cur]).toEqual(selected)
  })

  it('disables both moves while a work timer can still write by index', async () => {
    mocks.work = { left: 5, total: 5, endsAt: Date.now() + 5000 }
    await mountLegacy([exercise('first', [false]), exercise('second', [false])], 1)

    expect(action('Move up')?.disabled).toBe(true)
    expect(action('Move down')?.disabled).toBe(true)
  })
})

describe('active exercise swap control', () => {
  const mountLegacy = (entries, cur) => mount(entries, cur, { wc: { exerciseButtons: true } })
  it('opens the swap flow for the selected duplicate occurrence', async () => {
    await mountLegacy([exercise('bench', [false]), exercise('bench', [false]), exercise('row', [false])], 1)

    const swap = container.querySelector('button[aria-label="Swap exercise"]')
    expect(swap).toBeTruthy()
    await act(async () => { swap.dispatchEvent(new dom.Event('click', { bubbles: true })) })

    expect(mocks.swapActiveWorkoutExercise).toHaveBeenCalledOnce()
    expect(mocks.swapActiveWorkoutExercise).toHaveBeenCalledWith(1)
  })
})

describe('workout focus view', () => {
  it('shows only the first incomplete set with its prescription and tactile controls', async () => {
    await mount([exercise('plain-bench', [true, false, false], {
      target: { mode: 'reps', reps: 5, repsMin: 3, weight: 60, restSec: 120 },
    })], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    expect(container.querySelector('[data-testid="focus-view"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="focus-set"]').length).toBe(1)
    expect(container.textContent).toContain('2/3')
    expect(container.textContent).toContain('3–5 Reps')
    expect(container.textContent).toContain('@ 60 kg')
    expect(container.textContent).toContain('Rest 120s')
    expect(buttonNamed('Previous set').disabled).toBe(false)
    expect(buttonNamed('Next set').disabled).toBe(false)
  })

  it('moves with chevrons, dots, and Skip without completing a set', async () => {
    await mount([exercise('plain-bench', [false, false, false])], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Next set'))
    expect(container.textContent).toContain('2/3')
    await click(container.querySelector('button[aria-label="Set 3"]'))
    expect(container.textContent).toContain('3/3')
    await click(buttonNamed('Previous set'))
    expect(container.textContent).toContain('2/3')
    await click(buttonNamed('Skip set'))
    expect(container.textContent).toContain('3/3')
    expect(mocks.S.active.entries[0].sets.every(set => !set.done)).toBe(true)
  })

  it('locks later Focus sets while keeping them inspectable', async () => {
    await mount([exercise('plain-bench', [false, false])], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    await click(buttonNamed('Next set'))

    expect(container.querySelector('[data-testid="focus-set"]').classList.contains('locked')).toBe(true)
    expect(container.textContent).toContain('Complete set 1 to edit this one.')
    expect(buttonNamed('Increase load').disabled).toBe(true)
    expect(buttonNamed('Increase reps').disabled).toBe(true)
    expect(buttonNamed('RPE').disabled).toBe(true)
  })

  it('pairs adjacent exercises from Focus and can unpair them', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('More'))
    const pair = mocks.menuSheet.mock.calls.at(-1)[0].items.find(item => item?.label === 'Make superset with next')
    expect(pair).toBeTruthy()
    await act(async () => { pair.onClick() })
    await rerender()
    expect(container.querySelector('.focus-superset')).toBeNull()
    expect(container.querySelector('.focus-card .focus-superset-inline')).toBeTruthy()

    await click(buttonNamed('Unpair'))
    await rerender()
    expect(container.querySelector('.focus-superset')).toBeNull()
  })

  it('uses the shared effort picker for the selected RPE scale', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    await click(buttonNamed('Increase load'))
    await click(buttonNamed('Increase reps'))
    await click(buttonNamed('RPE'))
    const [, value, onPick] = mocks.effortPickerSheet.mock.calls.at(-1)
    expect(mocks.effortPickerSheet.mock.calls.at(-1)[0]).toBe('rpe')
    expect(value).toBeNull()
    await act(async () => { onPick(6.5) })

    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
    expect(mocks.S.active.entries[0].sets[0].r).toBe(6)
    expect(mocks.S.active.entries[0].sets[0].rpe).toBe(6.5)
  })

  it('hides effort in Focus when Settings selects none and stores the selected RIR scale', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'none' })
    expect(buttonNamed('RPE')).toBeNull()
    expect(buttonNamed('RIR')).toBeNull()

    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'rir' })
    await click(buttonNamed('RIR'))
    const [, , onPick] = mocks.effortPickerSheet.mock.calls.at(-1)
    await act(async () => { onPick(2) })
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ rir: 2 })
  })

  it('locks completed set inputs and mutes their values', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus' }, effort: 'rpe' })

    await click(buttonNamed('Complete set'))
    await rerender()

    expect(container.querySelector('[data-testid="focus-set"]').classList.contains('complete')).toBe(true)
    expect(buttonNamed('Increase load').disabled).toBe(true)
    expect(buttonNamed('Increase reps').disabled).toBe(true)
    expect(container.querySelectorAll('[data-testid="focus-set"] .stp input:disabled')).toHaveLength(2)
    expect(buttonNamed('RPE').disabled).toBe(true)
  })

  it('renders and updates independent unilateral sides', async () => {
    await mount([exercise('split-squat', [false], {
      target: { mode: 'reps', reps: 10, weight: 20, side: true },
      sets: [{
        w: 20, r: 10, done: false,
        sides: {
          L: { w: 20, r: 5, done: false },
          R: { w: 20, r: 5, done: false },
        },
      }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.querySelectorAll('[data-focus-side]').length).toBe(2)
    await click(container.querySelector('[data-focus-side="L"] button[aria-label="Increase reps"]'))
    expect(mocks.S.active.entries[0].sets[0].sides.L.r).toBe(6)
    expect(mocks.S.active.entries[0].sets[0].sides.R.r).toBe(5)
    await click(container.querySelector('[data-focus-side="L"] button[aria-label="Complete left side"]'))
    expect(mocks.S.active.entries[0].sets[0].sides.L.done).toBe(true)
    expect(mocks.S.active.entries[0].sets[0].done).toBe(false)
  })

  it('completes both unilateral sides through the side mutator before advancing Focus', async () => {
    await mount([
      exercise('split-squat', [false], {
        target: { mode: 'reps', reps: 10, weight: 20, side: true },
        sets: [{ w: 20, r: 10, done: false, sides: {
          L: { w: 20, r: 5, done: false }, R: { w: 20, r: 5, done: false },
        } }],
      }),
      exercise('plain-row', [false]),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Complete set'))

    const set = mocks.S.active.entries[0].sets[0]
    expect(set.sides.L.done).toBe(true)
    expect(set.sides.R.done).toBe(true)
    expect(set.done).toBe(true)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('advances Focus when the second individual side is completed', async () => {
    await mount([
      exercise('split-squat', [false], {
        target: { mode: 'reps', reps: 10, weight: 20, side: true },
        sets: [{ w: 20, r: 10, done: false, sides: {
          L: { w: 20, r: 5, done: false }, R: { w: 20, r: 5, done: false },
        } }],
      }),
      exercise('plain-row', [false]),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Complete left side'))
    await rerender()
    await click(buttonNamed('Complete right side'))

    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('renders and edits unilateral extras added through the set menu', async () => {
    await mount([exercise('split-squat', [false], {
      target: { mode: 'reps', reps: 10, weight: 20, side: true },
      sets: [{
        w: 20, r: 10, done: false,
        sides: {
          L: { w: 20, r: 5, done: false },
          R: { w: 20, r: 5, done: false },
        },
      }],
    })], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Set menu'))
    await act(async () => { mocks.menuSheet.mock.calls.at(-1)[0].items[1].onClick() })
    await rerender()
    const left = container.querySelector('[data-focus-side="L"]')
    expect(left.textContent).toContain('Drop 1')
    await click(left.querySelectorAll('button[aria-label="Increase load"]')[1])
    expect(mocks.S.active.entries[0].sets[0].sides.L.drops[0].w).toBe(18.5)
    expect(mocks.S.active.entries[0].sets[0].sides.R.drops[0].w).toBe(16)

    await click(buttonNamed('Set menu'))
    await act(async () => { mocks.menuSheet.mock.calls.at(-1)[0].items[2].onClick() })
    await rerender()
    const burstLeft = container.querySelector('[data-focus-side="L"]')
    expect(burstLeft.textContent).toContain('Drop 1')
    expect(burstLeft.textContent).toContain('Burst 1')
    const burst = [...burstLeft.querySelectorAll('.focus-extra')].find(row => row.textContent.includes('Burst 1'))
    await click(burst.querySelector('button[aria-label="Increase reps"]'))
    expect(mocks.S.active.entries[0].sets[0].sides.L.clusters[0].r).toBe(4)
    expect(mocks.S.active.entries[0].sets[0].sides.R.clusters[0].r).toBe(3)
  })

  it('shows the existing timer action instead of reps for timed sets', async () => {
    await mount([exercise('plank', [false], {
      target: { mode: 'time', sec: 45, weight: 0 },
      sets: [{ sec: 45, w: 0, done: false }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('45s hold')
    expect(buttonNamed('Start set')).toBeTruthy()
    expect(buttonNamed('Increase reps')).toBeNull()
    await click(buttonNamed('Start set'))
    expect(mocks.uiSnapshot().startWork).toHaveBeenCalled()
  })

  it('advances Focus when a timed set finishes through the shared timer', async () => {
    await mount([
      exercise('plank', [false], {
        target: { mode: 'time', sec: 45, weight: 0 },
        sets: [{ sec: 45, w: 0, done: false }],
      }),
      exercise('plain-row', [false]),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Start set'))
    await act(async () => { mocks.uiSnapshot().startWork.mock.calls.at(-1)[2](45) })

    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('does not advance Focus when rechecking a completed final set', async () => {
    await mount([
      exercise('plain-bench', [true]),
      exercise('plain-row', [false]),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Complete set'))
    await rerender()
    await click(buttonNamed('Complete set'))

    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.S.active.cur).toBe(0)
  })

  it('uses the established duration and speed fields for cardio', async () => {
    await mount([exercise('plain-treadmill', [false], {
      target: { mode: 'cardio', min: 20, speed: 8 },
      sets: [{ min: 20, speed: 8, done: false }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('Duration (min)')
    expect(container.textContent).toContain('Speed (km/h)')
    expect(container.querySelectorAll('button[aria-label="Increase reps"]').length).toBe(0)
    await click(container.querySelector('button[aria-label="Increase duration"]'))
    await click(container.querySelector('button[aria-label="Increase speed"]'))
    expect(mocks.S.active.entries[0].sets[0]).toMatchObject({ min: 21, speed: 8.5 })
  })

  it('keeps drop and burst rows editable and opens every set action', async () => {
    await mount([exercise('plain-bench', [false], {
      sets: [{
        w: 60, r: 8, done: false,
        drops: [{ w: 45, r: 8 }],
        clusters: [{ r: 3, restSec: 15 }],
      }],
    })], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('Drop 1')
    expect(container.textContent).toContain('Burst 1')
    await click(container.querySelectorAll('button[aria-label="Increase load"]')[1])
    await click(container.querySelectorAll('button[aria-label="Increase reps"]')[2])
    expect(mocks.S.active.entries[0].sets[0].drops[0].w).toBe(47.5)
    expect(mocks.S.active.entries[0].sets[0].clusters[0].r).toBe(4)
    expect(mocks.S.active.entries[0].sets[0].r).toBe(9)
    await click(buttonNamed('Set menu'))
    const labels = mocks.menuSheet.mock.calls.at(-1)[0].items.filter(Boolean).map(item => item.label)
    expect(labels).toEqual(['Mark as warm-up', 'Add drop set', 'Add burst', 'Taken to failure', 'Delete set'])
    // Taken to failure toggles the mark, and the focus card shows its F.
    await act(async () => { mocks.menuSheet.mock.calls.at(-1)[0].items.filter(Boolean).find(item => item.label === 'Taken to failure').onClick() })
    expect(mocks.S.active.entries[0].sets[0].failure).toBe(true)
    await rerender()
    expect(container.querySelector('.focus-failure').textContent).toBe('F')
  })

  it('does not expose a Focus-only set note action', async () => {
    await mount([exercise('plain-bench', [false, false])], 0, { active: { workoutView: 'focus' } })
    await click(buttonNamed('Next set'))
    expect(buttonNamed('Set note')).toBeNull()
  })

  it('completes, starts rest, advances sets, then advances to the next unfinished exercise', async () => {
    await mount([
      exercise('plain-bench', [false, false]),
      exercise('plain-row', [false]),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
    expect(container.textContent).toContain('2/2')

    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.entries[0].sets[1].done).toBe(true)
    expect(mocks.S.active.cur).toBe(1)
  })

  it('shows one superset member and follows round-major completion order', async () => {
    await mount([
      exercise('0968', [false, false], { sg: 'arms' }),
      exercise('1254', [false, false], { sg: 'arms' }),
      exercise('squat', [false]),
    ], 0, { active: { workoutView: 'focus' } })

    expect(container.textContent).toContain('band alternating biceps curl + band bench press')
    expect(container.textContent).toContain('Round 1')
    expect(container.textContent).toContain('Exercise 1 of 2')

    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.cur).toBe(1)
    await rerender()
    expect(container.textContent).toContain('Exercise 2 of 2')

    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'round', phase: null, forSet: expect.any(Number) })
    await rerender()
    expect(container.textContent).toContain('Round 2')

    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.cur).toBe(1)
    await rerender()
    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.cur).toBe(2)
  })

  it('uses the superset chevrons and dots for inspection without completing work', async () => {
    await mount([
      exercise('0968', [false, false], { sg: 'arms' }),
      exercise('1254', [false, false], { sg: 'arms' }),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Next superset set'))
    expect(mocks.S.active.cur).toBe(1)
    await rerender()
    expect(container.textContent).toContain('Exercise 2 of 2')
    expect(mocks.S.active.entries.flatMap(entry => entry.sets).every(set => !set.done)).toBe(true)
  })

  it('clears inspected set pointers when superset completion auto-advances', async () => {
    await mount([
      exercise('0968', [false, false], { sg: 'arms' }),
      exercise('1254', [false, false], { sg: 'arms' }),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Next superset set'))
    await rerender()
    await click(buttonNamed('Previous superset set'))
    await rerender()
    await click(buttonNamed('Complete set'))
    await rerender()
    await click(buttonNamed('Complete set'))
    await rerender()

    expect(container.textContent).toContain('Round 2')
    expect(container.textContent).toContain('2/2')
  })

  it('clears a manually selected set when an uneven superset auto-selects the same entry', async () => {
    await mount([
      exercise('0968', [false, false], { sg: 'arms' }),
      exercise('1254', [true], { sg: 'arms' }),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Set 1'))
    await click(buttonNamed('Complete set'))
    expect(mocks.S.active.cur).toBe(0)
    await rerender()

    expect(container.textContent).toContain('Round 2')
    expect(container.textContent).toContain('2/2')
  })

  it('omits missing member sets from the superset sequence', async () => {
    await mount([
      exercise('0968', [false, false], { sg: 'arms' }),
      exercise('1254', [false], { sg: 'arms' }),
    ], 0, { active: { workoutView: 'focus' } })

    await click(buttonNamed('Next superset set'))
    await rerender()
    await click(buttonNamed('Next superset set'))
    await rerender()

    expect(container.textContent).toContain('Round 2')
    expect(container.textContent).toContain('Exercise 1 of 2')
    expect(buttonNamed('Next superset set').disabled).toBe(true)
  })

  it('clears set pointers after an exercise move changes entry indexes', async () => {
    await mount([
      exercise('plain-bench', [false, false, false]),
      exercise('plain-row', [false, false, false]),
    ], 0, { active: { workoutView: 'focus' }, wc: { exerciseButtons: true } })

    await click(container.querySelector('button[aria-label="Set 3"]'))
    await rerenderAt(1)
    await click(container.querySelector('button[aria-label="Move up"]'))
    await rerender()

    expect(container.textContent).toContain('1/3')
  })

  it('clears an inspected set pointer before Focus swaps the exercise', async () => {
    await mount([exercise('plain-bench', [false, false, false])], 0, { active: { workoutView: 'focus' } })

    await click(container.querySelector('button[aria-label="Set 3"]'))
    await click(buttonNamed('More'))
    await act(async () => {
      mocks.menuSheet.mock.calls.at(-1)[0].items.find(item => item?.label === 'Swap exercise').onClick()
      mocks.S.active.entries[0] = exercise('plain-row', [true, false, false])
    })
    await rerender()

    expect(mocks.swapActiveWorkoutExercise).toHaveBeenCalledWith(0)
    expect(container.textContent).toContain('2/3')
  })

  it('clears an inspected set pointer before the Focus bottom swap button', async () => {
    await mount([exercise('plain-bench', [false, false, false])], 0, {
      active: { workoutView: 'focus' }, wc: { exerciseButtons: true },
    })

    await click(container.querySelector('button[aria-label="Set 3"]'))
    await click(container.querySelector('button[aria-label="Swap exercise"]'))
    mocks.S.active.entries[0] = exercise('plain-row', [true, false, false])
    await rerender()

    expect(mocks.swapActiveWorkoutExercise).toHaveBeenCalledWith(0)
    expect(container.textContent).toContain('2/3')
  })
})

describe('workout list view', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const focusButton = unit => [...unit.querySelectorAll('button')].find(b => b.textContent.trim() === 'Set current')

  it('opens at the current exercise instead of the top of the session (#224)', async () => {
    await mount([exercise('plain-bench', [true]), exercise('plain-row', [true]), exercise('plain-curl', [false])], 2, { workoutView: 'list' })
    // Not in the mount's own effect pass: App restores the route's scroll position in a frame
    // of its own, so the list scrolls in the frame after it, or the restore would win.
    expect(mocks.scrollCalls.length).toBe(0)
    await flushFrame()
    expect(mocks.scrollCalls.length).toBe(1)
    expect(mocks.scrollCalls[0].node).toBe(units()[2])
    expect(mocks.scrollCalls[0].node.classList.contains('cur')).toBe(true)
  })

  it('clears the sticky header at its measured height, not a one-line guess (QA C27)', async () => {
    mocks.headerHeight = 143   // a routine name that wraps to three lines at 368 px
    await mount([exercise('plain-bench', [true]), exercise('plain-row', [true]), exercise('plain-curl', [false])], 2, { workoutView: 'list' })
    await flushFrame()
    expect(mocks.scrollCalls.length).toBe(1)
    expect(container.querySelector('.workout-list').style.getPropertyValue('--whdr-h')).toBe('143px')
  })

  it('re-anchors on the current exercise when the layout changes between list and compact (QA C1)', async () => {
    await mount([exercise('plain-bench', [true]), exercise('plain-row', [true]), exercise('plain-curl', [false])], 2, { workoutView: 'list' })
    await flushFrame()
    mocks.scrollCalls.length = 0
    mocks.S.active.workoutView = 'compact'
    await rerender()
    await flushFrame()
    expect(mocks.scrollCalls.length).toBe(1)
    expect(mocks.scrollCalls[0].node.classList.contains('cur')).toBe(true)
    // ...but not when "current" merely moves inside the open list (that was #224's rule).
    mocks.scrollCalls.length = 0
    await rerenderAt(1)
    await flushFrame()
    expect(mocks.scrollCalls.length).toBe(0)
  })

  it('stacks every exercise, labels each unit, and hides card navigation', async () => {
    await mount([exercise('plain-bench', [false, false]), exercise('plain-row', [false])], 0, { workoutView: 'list' })

    expect(container.querySelector('[data-testid="workout-list"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="workout-swipe-surface"]')).toBeNull()
    expect(units().length).toBe(2)
    // Every set in the session is visible at once: 2 + 1 checkboxes, not just the current one.
    expect(container.querySelectorAll('[role="checkbox"]').length).toBe(3)
    expect(units().map(u => u.querySelector('.wl-hd .muted')?.textContent)).toEqual([
      'Exercise 1 / 2', 'Exercise 2 / 2',
    ])
    expect(units()[0].textContent).toContain('Current')
    expect(focusButton(units()[1])).toBeTruthy()
    const navButtons = [...container.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Prev' || b.textContent.trim() === 'Next')
    expect(navButtons.length).toBe(0)
  })

  it('marks the current unit and moves the mark with Set current', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 0, { workoutView: 'list' })

    await act(async () => { focusButton(units()[1]).dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.active.cur).toBe(1)

    // The list is the saved default here, so the tap only moves the mark and the list stays.
    await rerender()
    expect(mocks.S.active.workoutView).toBeUndefined()
    expect(units()[0].textContent).not.toContain('Current')
    expect(units()[1].textContent).toContain('Current')
    expect(focusButton(units()[0])).toBeTruthy()
  })

  it('goes back to cards on Set current when the list was only opened for this session (#260)', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 0, {
      workoutView: 'cards', active: { workoutView: 'list' },
    })

    await act(async () => { focusButton(units()[1]).dispatchEvent(new dom.Event('click', { bubbles: true })) })
    // Picking the exercise to look at next is all the tap is for, and cards are where one
    // exercise is front and centre, so it does not take a second trip through the ⋮ menu.
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.S.active.workoutView).toBe('cards')
  })

  it('stays in the list on Set current when the exercise buttons act on the current exercise', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 0, {
      workoutView: 'cards', wc: { exerciseButtons: true }, active: { workoutView: 'list' },
    })

    await act(async () => { focusButton(units()[1]).dispatchEvent(new dom.Event('click', { bubbles: true })) })
    // Move/Swap/Remove below the list act on the exercise marked Current, so the tap picks their
    // target and jumping away to cards would take the buttons out from under the athlete.
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.S.active.workoutView).toBe('list')
  })

  // Since !92 finishing an exercise no longer moves the current marker on its own (cards use
  // Next, the list uses "Set current"); completion still starts the rest like cards do.
  it('completing a set in list mode starts the rest and leaves the current marker in place, like cards do', async () => {
    await mount([
      exercise('plain-bench', [false], { asked: true }),
      exercise('plain-row', [false], { asked: true }),
    ], 0, { workoutView: 'list' })

    await toggleSet(0)

    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })

  it('does not declare the workout complete after a set of a non-current exercise while sets remain', async () => {
    // The marker stays on the finished bench (!92); ticking the first of three row sets must
    // not open the completion sheet — the row's own unit still has two sets to go.
    await mount([
      exercise('plain-bench', [true], { asked: true }),
      exercise('plain-row', [false, false, false], { asked: true }),
    ], 0, { workoutView: 'list' })

    await toggleSet(1)

    expect(mocks.S.active.entries[1].sets[0].done).toBe(true)
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
  })

  it('renders a superset as one grouped unit with its own unpair control', async () => {
    await mount([
      exercise('bench', [false], { sg: 'g1', asked: true }),
      exercise('row', [false], { sg: 'g1', asked: true }),
      exercise('squat', [false], { asked: true }),
    ], 0, { workoutView: 'list' })

    expect(units().length).toBe(2)
    expect(units()[0].querySelector('.ss-card')).toBeTruthy()
    expect(units()[1].querySelector('.ss-card')).toBeNull()
    expect(units().map(u => u.querySelector('.wl-hd .muted')?.textContent)).toEqual([
      'Superset 1 / 2', 'Exercise 2 / 2',
    ])
  })

  it('defaults to cards when the setting is absent (pre-existing profiles)', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])])

    expect(container.querySelector('[data-testid="workout-list"]')).toBeNull()
    expect(container.querySelector('[data-testid="workout-swipe-surface"]')).toBeTruthy()
    // Only the current exercise's sets are on screen.
    expect(container.querySelectorAll('[role="checkbox"]').length).toBe(1)
  })

  it('reads the layout from s.active first, then the global default', async () => {
    // Global says list, the session was started as cards — the session wins.
    await mount([exercise('plain-bench', [false])], 0, {
      workoutView: 'list', active: { workoutView: 'cards' },
    })
    expect(container.querySelector('[data-testid="workout-swipe-surface"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="workout-list"]')).toBeNull()
  })
})

// The card slid in during a swipe is the card that lands (renderPreview). Rendered without the
// progression line, it grew by that line the moment it snapped into place.
it('shows the progression line on the card a swipe slides in, as the card itself will', async () => {
  const planned = id => exercise(id, [false], {
    plan: { policy: 'linear', kind: 'up', weight: 62.5, why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'] },
  })
  await mount([planned('plain-bench'), planned('plain-row')])
  const surface = container.querySelector('[data-testid="workout-swipe-surface"]')
  const pointer = (type, x) => {
    const event = new dom.Event(type, { bubbles: true })
    Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 20 })
    return act(async () => { surface.dispatchEvent(event) })
  }
  await pointer('pointerdown', 250)
  await pointer('pointermove', 150)
  const preview = container.querySelector('.workout-swipe-preview')
  expect(preview).toBeTruthy()
  expect(preview.querySelector('.progline')).toBeTruthy()
  await pointer('pointercancel', 150)
})

// A swipe to the next card, held half way and then let go past the commit distance: the card it
// slid in, and the card that landed. Compared as markup, but for the ids React makes up per
// element (useId): the landed card is mounted anew, so each exercise's set-menu hint id is
// numbered afresh. Renumbered in order of first appearance, so which button points at which hint
// is still compared.
async function swipeToNext() {
  const surface = container.querySelector('[data-testid="workout-swipe-surface"]')
  const pointer = (type, x) => {
    const event = new dom.Event(type, { bubbles: true })
    Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 20 })
    return act(async () => { surface.dispatchEvent(event) })
  }
  const markup = el => {
    const ids = new Map()
    return el.innerHTML.replace(/_r_[0-9a-z]+_/g, m => { if (!ids.has(m)) ids.set(m, 'id' + ids.size); return ids.get(m) })
  }
  await pointer('pointerdown', 250)
  await pointer('pointermove', 150)
  const preview = container.querySelector('.workout-swipe-preview')
  const slidIn = markup(preview)
  await pointer('pointerup', 150)
  await act(async () => { await new Promise(r => setTimeout(r, 260)) })   // SwipeCards' 200 ms slide
  await act(async () => { root.render(React.createElement(Workout)) })
  return { preview, slidIn, landed: markup(container.querySelector('.workout-swipe-card')) }
}

// The same for a superset: its card slid in without the header's Unpair button, and the header's
// words moved over as the card landed and the button appeared.
it('slides a superset in exactly as it lands, Unpair and all', async () => {
  await mount([exercise('plain-bench', [false]), exercise('plain-row', [false, false], { sg: 'g' }), exercise('plain-press', [false, false], { sg: 'g' })])
  const { preview, slidIn, landed } = await swipeToNext()
  expect(preview.querySelector('.ss-card')).toBeTruthy()
  expect(preview.querySelector('.ss-hd button')?.textContent).toBe('Unpair')
  expect(mocks.S.active.cur).toBe(1)
  expect(landed).toBe(slidIn)
})

// And for a lone exercise with Settings' "Make superset" buttons on: it slid in without them, and
// they appeared, pushing the card down, as it landed.
it('slides a lone exercise in with its Make superset buttons, as it lands', async () => {
  await mount([exercise('plain-bench', [false]), exercise('plain-row', [false]), exercise('plain-press', [false])], 0, { wc: { pairButtons: true } })
  const { preview, slidIn, landed } = await swipeToNext()
  expect([...preview.querySelectorAll('button')].map(b => b.textContent).filter(x => x.startsWith('Make superset')))
    .toEqual(['Make superset with previous', 'Make superset with next'])
  expect(mocks.S.active.cur).toBe(1)
  expect(landed).toBe(slidIn)
})

describe('workout compact view', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const withExtras = done => exercise('plain-bench', done, {
    plan: {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time. {0} {1} more.', 2.5, 'kg'],
    },
  })

  it('stacks every exercise like list mode does', async () => {
    await mount([withExtras([false, false]), exercise('plain-row', [false])], 0, { workoutView: 'compact' })

    expect(container.querySelector('[data-testid="workout-list"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="workout-swipe-surface"]')).toBeNull()
    expect(units().length).toBe(2)
    expect(container.querySelectorAll('[role="checkbox"]').length).toBe(3)
    // The unit header and its "Set current" chip are part of list mode, kept in compact.
    expect(units()[0].textContent).toContain('Current')
  })

  it('strips the progression line, tags and last-time recap that list mode shows', async () => {
    const state = {
      workoutView: 'compact',
      exWeights: { 'plain-bench': { w: 80 } },
      workouts: [{ d: '2026-08-27', entries: [{ id: 'plain-bench', target: { reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }],
    }
    await mount([withExtras([false])], 0, state)

    expect(container.querySelector('.progline')).toBeNull()
    expect(container.textContent).not.toContain('Best:')
    expect(container.textContent).not.toContain('Last time')
    // The sets card and the ⋯ menu button survive — nothing is truly unreachable.
    expect(container.querySelector('.setrow')).toBeTruthy()
    expect(container.querySelector('button[aria-label="More"]')).toBeTruthy()
  })

  it('keeps those same elements in list mode (the strip is compact-only)', async () => {
    const state = {
      workoutView: 'list',
      exWeights: { 'plain-bench': { w: 80 } },
      workouts: [{ d: '2026-08-27', entries: [{ id: 'plain-bench', target: { reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }],
    }
    await mount([withExtras([false])], 0, state)

    expect(container.querySelector('.progline')).toBeTruthy()
    expect(container.textContent).toContain('Best:')
    expect(container.textContent).toContain('Last time')
  })

  it('completing a set still starts the rest, like list and cards', async () => {
    await mount([
      exercise('plain-bench', [false], { asked: true }),
      exercise('plain-row', [false], { asked: true }),
    ], 0, { workoutView: 'compact' })

    await toggleSet(0)

    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'block', phase: null, forSet: expect.any(Number) })
  })
})

// Issue #275: the card says what the routine planned, in every view, and when the rows opened
// somewhere else — progression moved them, or they carry last session's reps.
describe('the plan line', () => {
  const planned = (extra = {}) => exercise('plain-bench', [false, false], {
    planned: { sets: 2, reps: 10, weight: 60 },
    target: { mode: 'reps', sets: 2, reps: 10, weight: 62.5, bodyweight: false },
    ...extra,
  })
  const line = () => container.querySelector('.planline')?.textContent

  it('shows the plan quietly when the rows are the plan', async () => {
    await mount([planned()])
    expect(line()).toBe('Plan: 2 × 10')
  })

  it('says when progression moved the sets or reps', async () => {
    await mount([planned({ target: { mode: 'reps', sets: 3, reps: 10, weight: 0, bodyweight: true } })])
    expect(line()).toBe('Plan: 2 × 10 · today 3 × 10')
  })

  it('says when the reps were carried over from the last session', async () => {
    await mount([planned({ carried: true, sets: [{ w: 62.5, r: 15, done: false }, { w: 62.5, r: 15, done: false }] })])
    expect(line()).toBe('Plan: 2 × 10 · reps from your last session')
  })

  it('reads a double-progression aim inside the range as the plan', async () => {
    await mount([planned({ planned: { sets: 3, reps: 12, repsMin: 8, weight: 40 }, target: { mode: 'reps', sets: 3, reps: 11, repsMin: 8, weight: 40 } })])
    expect(line()).toBe('Plan: 3 × 8–12')
  })

  it('stays in compact view, where the last-time recap and progression line go', async () => {
    await mount([planned()], 0, { workoutView: 'compact' })
    expect(line()).toBe('Plan: 2 × 10')
    expect(container.textContent).not.toContain('Last time')
  })

  it('sits next to a "Last time" that reads this routine\'s own last session (#216)', async () => {
    const session = (d, rid, w, r) => ({ d, routineIds: [rid], entries: [{ id: 'plain-bench', rid, target: { reps: r, weight: w }, sets: [{ w, r, done: true }] }] })
    await mount([planned({ rid: 'A' })], 0, { workouts: [session('2026-08-24', 'A', 60, 10), session('2026-08-26', 'B', 40, 15)] })
    expect(container.textContent).toContain('60×10')
    expect(container.textContent).not.toContain('40×15')
  })

  it('reads a pyramid as its targets, like the routine row (#367)', async () => {
    await mount([planned({ planned: { sets: 5, reps: 12 }, target: { mode: 'reps', sets: 5, reps: 12, pyramid: [12, 8, 6, 'max', 12] } })])
    expect(line()).toBe('Plan: 12 · 8 · 6 · Max · 12')
  })

  it('is not there for an entry with no plan (freestyle, or started before plans were kept)', async () => {
    await mount([exercise('plain-bench', [false])])
    expect(container.querySelector('.planline')).toBeNull()
  })
})

describe('workout view header menu', () => {
  const openMenu = async () => {
    const btn = container.querySelector('button[aria-label="Workout options"]')
    expect(btn).toBeTruthy()
    await act(async () => { btn.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    return mocks.menuSheet.mock.calls.at(-1)[0]
  }
  const item = (menu, label) => menuItemsOf(menu).find(it => it.label === label)

  // The header ⋮ now leads with "Add routine"; the layouts moved to a nested "Layout" sheet.
  const openLayout = async menu => {
    await act(async () => { item(menu, 'Layout').onClick() })
    return mocks.menuSheet.mock.calls.at(-1)[0]
  }

  it('groups Workout settings, Add, This workout and Discard, then a Layout sheet with the four layouts marked current', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'list', routineIds: [] } })

    const menu = await openMenu()
    expect(menu.sections.map(g => g.title)).toEqual([undefined, 'Add', 'This workout', undefined])
    expect(menuItemsOf(menu).map(it => it.label)).toEqual([
      'Workout settings', 'Add exercise', 'Add routine', 'Rename workout', 'Layout', 'Add session note', 'Don’t count for progression', 'Discard workout',
    ])
    expect(item(menu, 'Workout settings').sub).toBe('1:30 rest · Silent')
    expect(item(menu, 'Discard workout').danger).toBe(true)
    expect(item(menu, 'Don’t count for progression')).toMatchObject({ sub: 'Every exercise in this workout', on: false })
    expect(item(menu, 'Layout').sub).toBe('List')

    await act(async () => { item(menu, 'Rename workout').onClick() })
    expect(mocks.renameWorkoutSheet).toHaveBeenCalled()

    const layout = await openLayout(menu)
    expect(menuItemsOf(layout).map(it => it.label)).toEqual(['Cards', 'List', 'Compact', 'Focus', 'Collapse completed exercises'])
    expect(item(layout, 'List').on).toBe(true)
    expect(item(layout, 'Cards').on).toBe(false)
  })

  it('marks Focus current in the Layout sheet when the session is in the focus view', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'focus', routineIds: [] } })

    const menu = await openMenu()
    expect(item(menu, 'Layout').sub).toBe('Focus')

    const layout = await openLayout(menu)
    expect(menuItemsOf(layout).map(it => it.label)).toEqual(['Cards', 'List', 'Compact', 'Focus'])
    expect(item(layout, 'Focus').on).toBe(true)
    expect(item(layout, 'Cards').on).toBe(false)
  })

  it('writes the layout pick onto s.active without touching the global default', async () => {
    await mount([exercise('plain-bench', [false])], 0, { workoutView: 'cards', active: { workoutView: 'cards', routineIds: [] } })

    const layout = await openLayout(await openMenu())
    await act(async () => { item(layout, 'Compact').onClick() })

    expect(mocks.S.active.workoutView).toBe('compact')
    expect(mocks.S.workoutView).toBe('cards')
  })

  it('toggles completed exercises for the running list session and can show them again', async () => {
    await mount([exercise('bench', [true]), exercise('row', [false])], 1, { active: { workoutView: 'list' } })
    let layout = await openLayout(await openMenu())
    expect(item(layout, 'Collapse completed exercises').on).toBe(false)
    await act(async () => { item(layout, 'Collapse completed exercises').onClick() })
    await rerender()
    expect(container.querySelectorAll('.wl-summary').length).toBe(1)
    expect(mocks.S.collapseCompleted).toBeUndefined()
    layout = await openLayout(await openMenu())
    expect(item(layout, 'Collapse completed exercises').on).toBe(true)
    await act(async () => { item(layout, 'Collapse completed exercises').onClick() })
    await rerender()
    expect(container.querySelector('.wl-summary')).toBeNull()
    expect(container.querySelectorAll('[role="checkbox"]').length).toBe(2)
  })

  it('only offers collapsing in layouts that show more than the current exercise', async () => {
    await mount([exercise('bench', [true])], 0, { active: { workoutView: 'cards' } })
    expect(item(await openLayout(await openMenu()), 'Collapse completed exercises')).toBeUndefined()
  })
})

describe('collapsing completed workout exercises', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const setCurrent = async index => {
    const button = [...units()[index].querySelectorAll('button')].find(b => b.textContent.trim() === 'Set current')
    await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
  }

  it.each(['list', 'compact'])('folds the current exercise in %s the moment its last set is ticked, and opens it again on a tap', async workoutView => {
    await mount([exercise('bench', [true, false]), exercise('row', [false])], 0,
      { workoutView, active: { workoutView, collapseCompleted: true } })
    const loggedBefore = structuredClone(mocks.S.active.entries[0].sets)
    await toggleSet(1)
    await rerender()
    // the marker moved on to what is left, so the finished one folded
    expect(mocks.S.active.cur).toBe(1)
    expect(units()[0].querySelector('.wl-summary')).toBeTruthy()
    expect(units()[0].querySelector('.setrow')).toBeNull()
    expect(units()[0].querySelector('.exmedia')).toBeNull()
    expect(units()[1].classList.contains('cur')).toBe(true)
    expect(units()[1].querySelector('.setrow')).toBeTruthy()
    expect(mocks.S.active.entries[0].sets).toEqual([...loggedBefore.slice(0, 1), { ...loggedBefore[1], done: true, at: expect.any(Number) }])
    // a tap on the line opens the sets again, without making it current
    const summary = units()[0].querySelector('button.wl-summary')
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    await click(summary)
    expect(units()[0].querySelectorAll('.setrow').length).toBe(2)
    expect(mocks.S.active.cur).toBe(1)
    const fold = [...units()[0].querySelectorAll('button')].find(b => b.textContent.trim() === 'Fold away')
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    await click(fold)
    expect(units()[0].querySelector('.wl-summary')).toBeTruthy()
    // Set current still brings it back as the one you are on
    await setCurrent(0)
    expect(units()[0].querySelectorAll('.setrow').length).toBe(2)
    // unticking and ticking again is not new progress: the marker stays
    await toggleSet(1)
    await toggleSet(1)
    await rerender()
    expect(mocks.S.active.cur).toBe(0)
  })

  it('keeps the marker where it is when collapsing is off', async () => {
    await mount([exercise('bench', [true, false]), exercise('row', [false])], 0, { active: { workoutView: 'list' } })
    await toggleSet(1)
    await rerender()
    expect(mocks.S.active.cur).toBe(0)
    expect(container.querySelector('.wl-summary')).toBeNull()
  })

  it('leaves the marker alone when the exercise finished last is not the current one', async () => {
    await mount([exercise('bench', [false]), exercise('row', [false]), exercise('squat', [false])], 2,
      { active: { workoutView: 'list', collapseCompleted: true } })
    await toggleSet(0)
    await rerender()
    expect(mocks.S.active.cur).toBe(2)
    expect(units()[0].querySelector('.wl-summary')).toBeTruthy()
  })

  it('stays on the last exercise when nothing is left, and offers the finish', async () => {
    await mount([exercise('bench', [true]), exercise('row', [false])], 1,
      { active: { workoutView: 'list', collapseCompleted: true } })
    await toggleSet(0)   // the bench is folded already, so the row's set is the only tick on screen
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledOnce()
    expect(units()[1].querySelector('.wl-summary')).toBeNull()
  })

  it('leaves completed exercises expanded unless the option is enabled', async () => {
    await mount([exercise('bench', [true]), exercise('row', [false])], 1, { workoutView: 'list' })
    expect(container.querySelector('.wl-summary')).toBeNull()
  })

  it('keeps an unfinished warm-up, one unfinished side and an empty exercise expanded', async () => {
    await mount([
      exercise('warmup', [false, true], { sets: [{ w: 20, r: 5, phase: 'warmup', done: false }, { w: 60, r: 5, done: true }] }),
      exercise('side', [false], { target: { mode: 'reps', side: true }, sets: [{ done: false, sides: { L: { done: true }, R: { done: false } } }] }),
      exercise('empty', []), exercise('current', [false]),
    ], 3, { active: { workoutView: 'list', collapseCompleted: true } })
    expect(container.querySelector('.wl-summary')).toBeNull()
  })

  it('collapses a superset only after all members are done and the group is no longer current', async () => {
    await mount([exercise('bench', [true], { sg: 'pair' }), exercise('row', [false], { sg: 'pair' }), exercise('squat', [false])], 2,
      { workoutView: 'list', active: { workoutView: 'list', collapseCompleted: true } })
    expect(units()[0].querySelector('.wl-summary')).toBeNull()
    await toggleSet(1)
    await rerender()
    expect(units()[0].querySelectorAll('.wl-summary .tag').length).toBe(2)
    await setCurrent(0)
    expect(units()[0].querySelectorAll('[role="checkbox"]').length).toBe(2)
  })

  it('treats duplicate exercise occurrences separately when restoring a running session', async () => {
    await mount([exercise('bench', [true]), exercise('bench', [false]), exercise('row', [false])], 2,
      { active: { workoutView: 'compact', collapseCompleted: true } })
    expect(units()[0].querySelector('.wl-summary')).toBeTruthy()
    expect(units()[1].querySelector('.wl-summary')).toBeNull()
  })
})

// Discord: "I use the list layout... I want to minimize/collapse completed exercises so I view
// only what I have yet to do. Not the same as hiding the exercise image."
describe('list layout: only what is left to do (Discord request, #241)', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const ticks = () => [...container.querySelectorAll('[role="checkbox"]')]
  const session = () => [
    exercise('bench', [false, false]),
    exercise('fly', [false], { sg: 'pair' }), exercise('row', [false], { sg: 'pair' }),
    exercise('squat', [false]),
  ]
  // linkedom has no layout: the header ends at 120 px, the unit with `key` starts at `top`, and
  // every other unit sits above the screen.
  let realRect = null
  afterEach(() => {
    // linkedom's element classes are shared between windows: put the real one back
    if (realRect) parseHTML('<p></p>').window.Element.prototype.getBoundingClientRect = realRect
    realRect = null
  })
  const layout = (key, top) => {
    realRect ||= dom.Element.prototype.getBoundingClientRect
    dom.innerHeight = 800
    dom.scrollY = 0
    dom.scrollTo = vi.fn()
    dom.Element.prototype.getBoundingClientRect = function () {
      if (this.classList?.contains('whdr')) return { top: 0, bottom: 120 }
      if (this.classList?.contains('wl-unit') && this.dataset.unitKey === key) return { top, bottom: top + 400 }
      return { top: -400, bottom: -100 }
    }
  }

  it('folds every finished exercise to one line as the session goes, superset included, and keeps it after a reload', async () => {
    // switched on once in Settings: the session itself never chose
    await mount(session(), 0, { workoutView: 'list', collapseCompleted: true, active: { workoutView: 'list' } })
    expect(mocks.S.active.collapseCompleted).toBeUndefined()
    await toggleSet(0)
    await toggleSet(1)
    await rerender()
    expect(units()[0].querySelector('.wl-summary')).toBeTruthy()
    expect(units()[1].classList.contains('cur')).toBe(true)
    // the superset: its first member moves the marker to its partner, the second finishes the round
    await toggleSet(0)
    await rerender()
    expect(units()[1].querySelector('.wl-summary')).toBeNull()
    await toggleSet(1)
    await rerender()
    expect(units()[1].querySelectorAll('.wl-summary .tag').length).toBe(2)
    expect(units()[2].classList.contains('cur')).toBe(true)
    // what is left is all that is open
    expect(ticks()).toHaveLength(1)
    expect(container.querySelectorAll('.wl-summary').length).toBe(2)
    // a reload (or Resume) brings the same picture back from the saved session
    const saved = structuredClone(mocks.S)
    await unmount()
    mocks.S = saved
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(container.querySelectorAll('.wl-summary').length).toBe(2)
    expect(ticks()).toHaveLength(1)
  })

  it('brings the next exercise up when it is left low on the screen, and leaves the page alone when it is in reach', async () => {
    await mount(session(), 0, { active: { workoutView: 'list', collapseCompleted: true } })
    await flushFrame()   // the list's own open-at-current scroll
    layout('1-2', 700)
    mocks.scrollCalls.length = 0
    await toggleSet(0)
    await toggleSet(1)
    await rerender()   // the mocked store does not render by itself
    expect(mocks.scrollCalls).toHaveLength(1)
    expect(mocks.scrollCalls[0].node.dataset.unitKey).toBe('1-2')
    expect(mocks.scrollCalls[0].options).toEqual({ block: 'start', behavior: 'smooth' })

    await unmount()
    await mount(session(), 0, { active: { workoutView: 'list', collapseCompleted: true } })
    await flushFrame()
    layout('1-2', 300)
    mocks.scrollCalls.length = 0
    await toggleSet(0)
    await toggleSet(1)
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.scrollCalls).toEqual([])
  })

  it('is one switch in Settings for every session, and the Layout menu still flips it for this one', async () => {
    await mount([exercise('bench', [true]), exercise('row', [false])], 1, { collapseCompleted: true, active: { workoutView: 'list' } })
    expect(container.querySelectorAll('.wl-summary').length).toBe(1)
    await click(container.querySelector('button[aria-label="Workout options"]'))
    await act(async () => { menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).find(it => it.label === 'Layout').onClick() })
    const toggleItem = menuItemsOf(mocks.menuSheet.mock.calls.at(-1)[0]).find(it => it.label === 'Collapse completed exercises')
    expect(toggleItem.on).toBe(true)
    await act(async () => { toggleItem.onClick() })
    await rerender()
    expect(mocks.S.active.collapseCompleted).toBe(false)
    expect(mocks.S.collapseCompleted).toBe(true)
    expect(container.querySelector('.wl-summary')).toBeNull()
  })

  it('opens a folded exercise when its chip at the top is tapped, and scrolls to it', async () => {
    await mount([exercise('bench', [true]), exercise('row', [false])], 1, { active: { workoutView: 'list', collapseCompleted: true } })
    await flushFrame()
    mocks.scrollCalls.length = 0
    await click(container.querySelectorAll('.wchip')[0])
    expect(units()[0].querySelector('.wl-summary')).toBeNull()
    await flushFrame()
    expect(mocks.scrollCalls.at(-1).node.dataset.unitKey).toBe('0')
    expect(mocks.S.active.cur).toBe(1)
  })
})

describe('exercise chips at the top of the workout (#323)', () => {
  const chips = () => [...container.querySelectorAll('.wchip')]
  const chip = n => chips()[n - 1]
  const session = () => [exercise('bench', [true, true]), exercise('fly', [true, false], { sg: 'pair' }), exercise('row', [false], { sg: 'pair' }), exercise('squat', [false])]

  it('shows one chip per unit with its state in Cards, a superset as one, in place of "Exercise N / M"', async () => {
    await mount(session(), 3)
    expect(chips().map(c => c.className)).toEqual(['wchip done', 'wchip partial', 'wchip todo cur'])
    expect(chip(3).getAttribute('aria-current')).toBe('step')
    expect(chip(1).getAttribute('aria-current')).toBeNull()
    // test ids are not in the catalogue, so each name reads as the unknown-exercise fallback
    expect(chip(1).getAttribute('aria-label')).toMatch(/^Exercise 1: .+ \(Finished\)$/)
    expect(chip(2).getAttribute('aria-label')).toMatch(/^Superset 2: .+ \+ .+ \(Started\)$/)
    expect(chip(3).getAttribute('aria-label')).toMatch(/^Exercise 3: .+ \(Not started yet\)$/)
    expect(chip(2).querySelector('[data-icon="link"]')).toBeTruthy()
    expect(container.querySelector('nav.wchips').getAttribute('aria-label')).toBe('Exercises in this workout')
    expect(container.textContent).not.toContain('Exercise 3 / 3')
  })

  it('jumps to the tapped exercise in Cards, and only on a tap', async () => {
    await mount(session(), 3)
    await click(chip(2))
    expect(mocks.S.active.cur).toBe(1)
    await rerender()
    expect(chip(2).getAttribute('aria-current')).toBe('step')
    expect(container.querySelectorAll('.ss-card').length).toBe(1)
    // the current chip is a no-op, not a write
    const before = mocks.S
    await click(chip(2))
    expect(mocks.S).toBe(before)
  })

  it('follows the ticks: waiting, then started, then finished', async () => {
    await mount([exercise('bench', [false, false]), exercise('row', [false])], 0)
    expect(chip(1).className).toBe('wchip todo cur')
    await toggleSet(0)
    await rerender()
    expect(chip(1).className).toBe('wchip partial cur')
    await toggleSet(1)
    await rerender()
    expect(chip(1).className).toBe('wchip done cur')
    // ticking never moved the marker, so the chip did not either
    expect(mocks.S.active.cur).toBe(0)
  })

  it('switches the exercise in Focus', async () => {
    await mount(session(), 3, { active: { workoutView: 'focus' } })
    await click(chip(1))
    expect(mocks.S.active.cur).toBe(0)
    await rerender()
    expect(chip(1).getAttribute('aria-current')).toBe('step')
  })

  it.each(['list', 'compact'])('rides in the pinned header in %s and scrolls to the unit without moving Current', async workoutView => {
    await mount(session(), 0, { active: { workoutView } })
    expect(container.querySelector('.whdr .wchips')).toBeTruthy()
    await flushFrame()   // the list's own open-at-current scroll
    mocks.scrollCalls.length = 0
    mocks.headerHeight = 150
    await click(chip(3))
    expect(mocks.scrollCalls).toEqual([])   // waits for the frame, like opening the list
    await flushFrame()
    expect(mocks.scrollCalls).toHaveLength(1)
    expect(mocks.scrollCalls[0].node.dataset.unitKey).toBe('3')
    expect(mocks.scrollCalls[0].options).toEqual({ block: 'start', behavior: 'smooth' })
    expect(container.querySelector('.workout-list').style.getPropertyValue('--whdr-h')).toBe('150px')
    expect(mocks.S.active.cur).toBe(0)
  })

  it('jumps without the glide when the system asks for less motion', async () => {
    await mount(session(), 0, { active: { workoutView: 'list' } })
    dom.matchMedia = q => ({ matches: q.includes('reduce') })
    await flushFrame()
    mocks.scrollCalls.length = 0
    await click(chip(2))
    await flushFrame()
    expect(mocks.scrollCalls[0].options).toEqual({ block: 'start' })
  })

  it('goes away with its switch, and the old line comes back', async () => {
    await mount(session(), 3, { wc: { exerciseChips: false } })
    expect(container.querySelector('.wchips')).toBeNull()
    expect(container.textContent).toContain('Exercise 3 / 3')
    await unmount()
    await mount(session(), 0, { wc: { exerciseChips: false }, active: { workoutView: 'list' } })
    expect(container.querySelector('.wchips')).toBeNull()
  })

  it('has nothing to show in an empty freestyle session', async () => {
    await mount([], 0)
    expect(container.querySelector('.wchips')).toBeNull()
  })
})

describe('workout controls: the more menu and the set menu', () => {
  const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]
  const item = label => menuItemsOf(lastMenu()).find(it => it.label === label)

  it('shows one More button per exercise and no legacy button rows by default', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])])
    expect(container.querySelector('button[aria-label="More"]')).toBeTruthy()
    for (const label of ['Move up', 'Swap exercise']) expect(container.querySelector(`button[aria-label="${label}"]`)).toBeNull()
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === 'Remove exercise')).toBe(false)
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === '+ Drop')).toBe(false)
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add set')).toBe(true)
  })

  it('routes swap, move, remove, warm-up and details through the More menu of that exercise', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 0)
    await act(async () => { container.querySelector('button[aria-label="More"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.menuSheet).toHaveBeenCalledOnce()
    expect(menuItemsOf(lastMenu()).map(it => it.label)).toEqual(expect.arrayContaining([
      'Add note', 'How to do it', 'Add warm-up set', 'Make superset with next', 'Swap exercise', 'Move up', 'Move down', 'Remove exercise',
    ]))
    expect(item('Move up').disabled).toBe(true)
    expect(item('Move down').disabled).toBe(false)
    expect(item('Remove exercise').danger).toBe(true)

    item('Swap exercise').onClick()
    expect(mocks.swapActiveWorkoutExercise).toHaveBeenCalledWith(0)

    await act(async () => { item('Add warm-up set').onClick() })
    expect(mocks.S.active.entries[0].sets.some(s => s.phase === 'warmup' || s.warmup)).toBe(true)

    await act(async () => { item('Remove exercise').onClick() })
    expect(mocks.confirmSheet).toHaveBeenCalled()
  })

  it('adds an in-session warm-up at the bar, never under it', async () => {
    const bench = exercise('0025', [false], { target: { mode: 'reps', reps: 10, weight: 55 }, sets: [{ w: 55, r: 10, done: false }] })
    await mount([bench], 0, { unit: 'lb' })
    await act(async () => { container.querySelector('button[aria-label="More"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await act(async () => { item('Add warm-up set').onClick() })
    expect(mocks.S.active.entries[0].sets.map(s => s.w)).toEqual([45, 55])
  })

  // Move down on a superset member's More menu moved the whole superset and left the member next
  // to the same partner (#377 reports it in the routine editor). It now swaps inside the superset.
  it('moves a superset member inside its superset from that member\'s More menu', async () => {
    await mount([
      exercise('bench', [true]),
      exercise('pull-up', [false], { sg: 'm' }),
      exercise('leg-raise', [false], { sg: 'm' }),
      exercise('plank', [false], { sg: 'm' }),
    ], 1)
    const more = container.querySelector('.ss-ex[data-exidx="2"] button[aria-label="More"]')
    expect(more).toBeTruthy()
    await act(async () => { more.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(item('Move up').disabled).toBe(false)
    expect(item('Move down').disabled).toBe(false)
    await act(async () => { item('Move down').onClick() })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['bench', 'pull-up', 'plank', 'leg-raise'])
    expect(mocks.S.active.entries.slice(1).map(entry => entry.sg)).toEqual(['m', 'm', 'm'])
    expect(mocks.S.active.entries[mocks.S.active.cur].id).toBe('pull-up')
  })

  // A move reorders the entries, and two things the screen keeps by index have to follow their
  // exercise: the running rest (timer.forIdx) and how many sets of each exercise have already
  // counted as progress (the mark a tick is compared against to tell new work from a re-check).
  const openMore = async exIdx => {
    const more = container.querySelector(`.ss-ex[data-exidx="${exIdx}"] button[aria-label="More"]`)
      || container.querySelector('button[aria-label="More"]')
    await act(async () => { more.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  }
  const restFor = forIdx => ({ left: 60, total: 60, endsAt: Date.now() + 60_000, forIdx, kind: 'set' })

  it('a member swap during a rest hands the rest to the moved exercise\'s new place', async () => {
    await mount([
      exercise('bench', [true]),
      exercise('pull-up', [true, false], { sg: 'm' }),
      exercise('leg-raise', [true, false], { sg: 'm' }),
      exercise('plank', [false, false], { sg: 'm' }),
    ], 1)
    mocks.timer = restFor(2)
    await openMore(2)
    await act(async () => { item('Move down').onClick() })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['bench', 'pull-up', 'plank', 'leg-raise'])
    expect(mocks.timer.forIdx).toBe(3)
    expect(mocks.S.active.entries[mocks.timer.forIdx].id).toBe('leg-raise')
    expect(mocks.timer.endsAt).toBeGreaterThan(Date.now())
    expect(mocks.stopRest).not.toHaveBeenCalled()
  })

  it('a whole-superset move during a rest hands the rest to the resting exercise\'s new place', async () => {
    await mount([
      exercise('bench', [true, false]),
      exercise('pull-up', [false], { sg: 'm' }),
      exercise('leg-raise', [false], { sg: 'm' }),
    ], 1)
    mocks.timer = restFor(0)
    await openMore(1)
    await act(async () => { item('Move up').onClick() })

    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['pull-up', 'leg-raise', 'bench'])
    expect(mocks.timer.forIdx).toBe(2)
    expect(mocks.S.active.entries[mocks.timer.forIdx].id).toBe('bench')
  })

  it('a member swap keeps each exercise\'s counted sets with it, so its next tick still counts', async () => {
    // pull-up has two sets counted, leg-raise none. After the swap, the leg raise's first tick
    // is new work and moves on through the superset; read against the pull-up's two it would be
    // taken for a re-check and go nowhere.
    await mount([
      exercise('bench', [true]),
      exercise('pull-up', [true, true, false], { sg: 'm' }),
      exercise('leg-raise', [false, false, false], { sg: 'm' }),
      exercise('plank', [false, false, false], { sg: 'm' }),
    ], 1)
    await openMore(1)
    await act(async () => { item('Move down').onClick() })
    expect(mocks.S.active.entries.map(entry => entry.id)).toEqual(['bench', 'leg-raise', 'pull-up', 'plank'])
    expect(mocks.S.active.cur).toBe(1)

    const tick = container.querySelector('.ss-ex[data-exidx="1"] [role="checkbox"]')
    await act(async () => { tick.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.active.entries[1].sets.filter(set => set.done)).toHaveLength(1)
    expect(mocks.S.active.cur).toBe(2)
  })

  it('opens the exercise history sheet from the More menu, for the tapped exercise', async () => {
    // the screen shows one exercise at a time, so "the tapped exercise" is the current one
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 1)
    await act(async () => { container.querySelector('button[aria-label="More"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    const history = item('History')
    expect(history.icon).toBe('history')
    history.onClick()
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledWith('plain-row')
  })

  it('opens a per-set menu from the set number with drop, burst and remove', async () => {
    await mount([exercise('plain-bench', [false, false])])
    await act(async () => { container.querySelector('button[aria-label="Set 2"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(menuItemsOf(lastMenu()).map(it => it.label)).toEqual(['Make it a warm-up set', 'Taken to failure', 'Drop set', 'Rest-pause burst', 'Copy this set', 'Remove this set'])
    expect(item('Make it a warm-up set').icon).toBe('sunrise')

    await act(async () => { item('Drop set').onClick() })
    expect(mocks.S.active.entries[0].sets[1].drops?.length).toBe(1)

    await act(async () => { container.querySelector('button[aria-label="Set 2"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await act(async () => { item('Remove this set').onClick() })
    expect(mocks.S.active.entries[0].sets.length).toBe(1)
  })

  it('marks a set as taken to failure from its menu, with an F on its number, and back', async () => {
    await mount([exercise('plain-bench', [false, false])])
    const openSet = async label => { await act(async () => { container.querySelector(`button[aria-label="${label}"]`).dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
    await openSet('Set 2')
    expect(item('Taken to failure').on).toBe(false)
    await act(async () => { item('Taken to failure').onClick() })
    expect(mocks.S.active.entries[0].sets[1].failure).toBe(true)
    expect(mocks.S.active.entries[0].sets[0].failure).toBeUndefined()
    await rerender()
    const n = container.querySelector('button[aria-label="Set 2, Taken to failure"]')
    expect(n.querySelector('.failmark').textContent).toBe('F')
    await openSet('Set 2, Taken to failure')
    expect(item('Taken to failure').on).toBe(true)
    await act(async () => { item('Taken to failure').onClick() })
    expect('failure' in mocks.S.active.entries[0].sets[1]).toBe(false)
  })

  it('makes a work set a warm-up and back, and keeps one work set', async () => {
    await mount([exercise('plain-bench', [true, false])])
    // a warm-up's number button is "Set 1" too, so rows are picked by position
    const openSet = async k => { await act(async () => { container.querySelectorAll('button.n')[k].dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
    await openSet(1)
    await act(async () => { item('Make it a warm-up set').onClick() })
    const sets = () => mocks.S.active.entries[0].sets
    // moved in front of the work sets, in the shape Add warm-up set gives one
    expect(sets()[0]).toEqual({ w: 60, r: 5, done: false, phase: 'warmup', warmup: true })
    expect(isWarmupRow(sets()[1])).toBe(false)
    // the last work set cannot become one too
    await rerender()
    await openSet(1)
    expect(item('Make it a warm-up set')).toBeUndefined()
    // and a warm-up counts as a working set again
    await openSet(0)
    expect(lastMenu().title).toBe('Warm-up')
    await act(async () => { item('Count it as a working set').onClick() })
    expect(sets().every(x => !isWarmupRow(x))).toBe(true)
    expect(sets()[0]).toEqual({ w: 60, r: 5, done: false })
  })

  it('brings the legacy button rows back per switch', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])], 0, {
      wc: { setShortcuts: true, pairButtons: true, exerciseButtons: true },
    })
    const labels = [...container.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(labels).toEqual(expect.arrayContaining(['+ Drop', 'Add warm-up set', 'Remove set', 'Make superset with next', 'Move up', 'Swap exercise', 'Remove exercise']))
  })

  it('drops the +/- buttons when steppers are off and keeps the number field', async () => {
    await mount([exercise('plain-bench', [false])], 0, { wc: { steppers: false } })
    expect(container.querySelector('.setrow .stp button[aria-label="Increase"]')).toBeNull()
    expect(container.querySelector('.setrow .stp.plain .num')).toBeTruthy()
  })
})

// Rating a set's effort concludes it (issue #64): picking an RIR/RPE value ticks the set and
// starts the rest timer, so you don't confirm a finished set twice.
describe('effort rating auto-ends the set', () => {
  // Open the effort picker for set `index` and return the onPick callback the cell handed it.
  async function openEffortPicker(index = 0) {
    const cell = container.querySelectorAll('.setrow .effcell.is-empty, .setrow .effcell-stp .val')[index]
    expect(cell).toBeTruthy()
    await act(async () => { cell.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    const call = mocks.effortPickerSheet.mock.calls.at(-1)
    expect(call?.[2]).toEqual(expect.any(Function))
    return call[2]
  }

  it('ticks the set and starts the rest timer when a rating is picked', async () => {
    await mount([exercise('plain-bench', [false, false])], 0, { effort: 'rir' })
    const onPick = await openEffortPicker(0)

    await act(async () => { onPick(2) })

    expect(mocks.S.active.entries[0].sets[0].rir).toBe(2)
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
  })

  it('does not re-toggle a set that is already done — a rating change leaves it done', async () => {
    await mount([exercise('plain-bench', [true, false])], 0, { effort: 'rir' })
    const onPick = await openEffortPicker(0)

    await act(async () => { onPick(1) })

    expect(mocks.S.active.entries[0].sets[0].rir).toBe(1)
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)   // stays done, not toggled off
    // No rest timer for a re-rate of already-finished work (would have been the "recheck" path).
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  it('clearing a rating never un-ticks the set — ending a set stays a manual undo', async () => {
    await mount([exercise('plain-bench', [false]), exercise('next', [false])], 0, { effort: 'rir' })
    const onPick = await openEffortPicker(0)

    await act(async () => { onPick(3) })          // rate → done
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)

    await act(async () => { onPick(null) })        // clear the number
    expect(mocks.S.active.entries[0].sets[0].rir).toBeUndefined()
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)   // still done
  })
})

describe('per-side effort completion', () => {
  it.each(['rir', 'rpe'])('completes only the rated side for %s and keeps undo explicit', async scale => {
    const side = () => ({ w: 20, r: 8, done: false })
    await mount([exercise('plain-bench', [false], {
      target: { mode: 'reps', side: true, reps: 16, weight: 20, bodyweight: false },
      sets: [
        { w: 20, r: 16, done: false, sides: { L: side(), R: side() } },
        { w: 20, r: 16, done: false, sides: { L: side(), R: side() } },
      ],
    })], 0, { effort: scale })
    const cells = container.querySelectorAll('.side-rows .effcell.is-empty')
    await act(async () => { cells[0].dispatchEvent(new dom.Event('click', { bubbles: true })) })
    const leftPick = mocks.effortPickerSheet.mock.calls.at(-1)[2]
    await act(async () => { leftPick(scale === 'rir' ? 2 : 8) })
    let set = mocks.S.active.entries[0].sets[0]
    expect(set.sides.L.done).toBe(true)
    expect(set.sides.R.done).toBe(false)
    expect(set.done).toBe(false)
    expect(mocks.startRest).not.toHaveBeenCalled()
    await act(async () => { leftPick(3); leftPick(null) })
    expect(mocks.S.active.entries[0].sets[0].sides.L.done).toBe(true)
    expect(mocks.S.active.entries[0].sets[0].sides.L[scale]).toBeUndefined()
    await act(async () => { cells[1].dispatchEvent(new dom.Event('click', { bubbles: true })) })
    const rightPick = mocks.effortPickerSheet.mock.calls.at(-1)[2]
    await act(async () => { rightPick(scale === 'rir' ? 0 : 10) })
    set = mocks.S.active.entries[0].sets[0]
    expect(set.done).toBe(true)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number), { kind: 'set', phase: null, forSet: expect.any(Number) })
    const calls = mocks.startRest.mock.calls.length
    await act(async () => { rightPick(1) })
    expect(set.sides.R.done).toBe(true)
    expect(mocks.startRest).toHaveBeenCalledTimes(calls)
  })
})

// QA C9: custom exercises store their target as a muscle-map id ("gluteal"); the tag under the
// exercise name has to show the same label the detail sheet does (Glutes), not the raw id.
describe('Workout exercise tags', () => {
  it('names a custom exercise\'s target muscle by its display name', async () => {
    const { registerCustom } = await import('../lib/exercises.js')
    registerCustom([{ id: 'cqa1', n: 'QA Custom Thrust', bp: 'upper legs', eq: 'barbell', custom: true, tg: 'gluteal', sm: [], primaries: ['gluteal'], secondaries: [], muscleGroups: ['gluteal'] }])
    try {
      await mount([exercise('cqa1', [false])])
      const tags = [...container.querySelectorAll('.tag')].map(tag => tag.textContent.trim())
      expect(tags).toContain('Glutes')
      expect(tags).not.toContain('gluteal')
    } finally { registerCustom([]) }
  })

  // The cardio target "cardiovascular system" is a translated key of its own; mapping it through
  // MUSCLE_NAME must not turn "Herz-Kreislauf" back into English for every built-in cardio exercise.
  it('keeps the cardio target translated (burpee, de)', async () => {
    const { _setLangState } = await import('../lib/i18n-core.js')
    const { default: de } = await import('../locales/de.js')
    _setLangState('de', de, null, null)
    try {
      await mount([exercise('1160', [false])])
      const tags = [...container.querySelectorAll('.tag')].map(tag => tag.textContent.trim())
      expect(tags).toContain('Herz-Kreislauf')
      expect(tags).not.toContain('Cardiovascular system')
    } finally { _setLangState('en', null, null, null) }
  })
})

describe('set-row column header', () => {
  // The L/R rows carry a badge in front of the weight cell that a straight row does not have, so
  // the shared header needs to know it is sitting over per-side rows to offset its columns (QA C5).
  it('marks the header of a per-side exercise so the CSS can offset it by the L/R badge', async () => {
    const side = () => ({ w: 20, r: 8, done: false })
    await mount([
      exercise('plain-bench', [false]),
      exercise('side-curl', [false], {
        target: { mode: 'reps', side: true, reps: 16, weight: 20, bodyweight: false },
        sets: [{ w: 20, r: 16, done: false, sides: { L: side(), R: side() } }],
      }),
    ], 0, { active: { workoutView: 'list' } })
    const heads = container.querySelectorAll('.sethead')
    expect(heads.length).toBe(2)
    expect(heads[0].classList.contains('per-side')).toBe(false)
    expect(heads[1].classList.contains('per-side')).toBe(true)
    expect(container.querySelector('.setrow-side .sidetag')).toBeTruthy()
  })

  // A unilateral warm-up is a side set too (issue #60), so it renders as the L/R stack like the
  // work set below it — not the old single scalar row where 12 reps meant 6 per side on one line
  // with one shared RIR. The render guard dropped its `!warm` exclusion for exactly this.
  it('renders a per-side warm-up as its own L/R stack, not a single scalar row', async () => {
    const side = (r) => ({ w: 20, r, done: false })
    await mount([
      exercise('side-curl', [], {
        target: { mode: 'reps', side: true, reps: 16, weight: 20, bodyweight: false },
        sets: [
          // a per-side warm-up (half the reps on each side) ...
          { w: 10, r: 16, phase: 'warmup', warmup: true, done: false, sides: { L: side(8), R: side(8) } },
          // ... and a per-side work set
          { w: 20, r: 16, done: false, sides: { L: side(8), R: side(8) } },
        ],
      }),
    ])
    // both the warm-up and the work set render as L/R stacks: two side rows, four L/R badges
    expect(container.querySelectorAll('.setrow-side').length).toBe(2)
    expect(container.querySelectorAll('.setrow-side .sidetag').length).toBe(4)
    // the warm-up phase label is present, and no warm-up fell through to a scalar .setrow
    expect(container.querySelector('.setph')).toBeTruthy()
  })

  // A weighted hold's row has the play button in front of the tick, so its cells get less room than
  // a straight row's and the CSS sizes them (and the header over them) by the `timed` marker.
  it('marks a timed hold\'s rows and header, and neither on a rep set', async () => {
    await mount([
      exercise('timed-plank', [false], {
        target: { mode: 'time', sec: 30, weight: 60, bodyweight: false },
        sets: [{ sec: 30, w: 60, done: false }],
      }),
      exercise('plain-bench', [false]),
    ], 0, { active: { workoutView: 'list' } })
    const heads = container.querySelectorAll('.sethead')
    expect(heads[0].classList.contains('timed')).toBe(true)
    expect(container.querySelector('.setrow.timed .setgo')).toBeTruthy()
    expect(heads[1].classList.contains('timed')).toBe(false)
    expect(container.querySelectorAll('.setrow.timed').length).toBe(1)
  })

  // With the +/- buttons switched off the cells' floors are the bare numbers; the header must
  // freeze its columns the same way or the labels drift, so it carries the cells' `plain`.
  it('carries `plain` on the header when the steppers are off', async () => {
    await mount([exercise('plain-bench', [false])], 0, { wc: { steppers: false } })
    expect(container.querySelector('.sethead').classList.contains('plain')).toBe(true)
    expect(container.querySelector('.setrow .stp.w').classList.contains('plain')).toBe(true)
  })
})

// #173: the line under an exercise holds the rows against the last time in this routine, or
// against the best set of the exercise; tapping the line switches, for every exercise.
describe('the reference line: last time or best set', () => {
  const session = (d, rid, w, r) => ({ d, start: Date.parse(d + 'T18:00:00'), routineIds: [rid], entries: [{ id: 'plain-bench', rid, target: { reps: r, weight: w }, sets: [{ w, r, done: true }] }] })
  const history = [session('2026-08-10', 'B', 80, 5), session('2026-08-24', 'A', 60, 10), session('2026-08-26', 'A', 55, 8)]
  const line = () => container.querySelector('.refline')

  it('reads last time in this routine by default, and the best set once switched', async () => {
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history })
    expect(line().textContent).toMatch(/^Last time \(.+\): 55×8$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.logRef).toBe('best')
    await rerender()
    // the heaviest set of the exercise from any routine, not just this one
    expect(line().textContent).toMatch(/^Best set \(.+\): 80×5$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.logRef).toBe('last')
  })

  // #363: how long ago, counted from the session's own day; the date stays in the title and name.
  it('says how long ago, counted from the day the session is logged on', async () => {
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history, active: { d: '2026-08-29' } })
    expect(line().textContent).toBe('Last time (3 days ago): 55×8')
    const time = line().querySelector('time')
    expect(time.outerHTML).toMatch(/datetime="2026-08-26"/i)
    expect(time.getAttribute('title')).toMatch(/2026/)
    expect(line().getAttribute('aria-label')).toMatch(/^Last time \(3 days ago, .+2026\): 55×8\. Show your best set instead$/)
    await unmount()
    // back-filled into the past: last time is counted from that day, not from today
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history.slice(0, 2), active: { d: '2026-08-25' } })
    expect(line().textContent).toBe('Last time (yesterday): 60×10')
  })

  it('is not there before the exercise was ever logged', async () => {
    await mount([exercise('plain-bench', [false])], 0, { logRef: 'best' })
    expect(line()).toBeNull()
  })

  // Logged before only as a hold, today as reps: there is a last time but no best set in this
  // mode. The line used to vanish, and the switch back to "Last time" with it.
  it('stays on the card when there is no best set in this mode yet, and still switches back', async () => {
    const hold = { d: '2026-08-26', start: Date.parse('2026-08-26T18:00:00'), routineIds: ['A'],
      entries: [{ id: 'plain-bench', rid: 'A', target: { mode: 'time', sec: 30 }, sets: [{ sec: 30, w: 0, done: true }] }] }
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: [hold], logRef: 'best' })
    expect(line().textContent).toBe('Best set: nothing logged this way yet')
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    expect(mocks.S.logRef).toBe('last')
    await rerender()
    expect(line().textContent).toMatch(/^Last time \(.+\): 0:30$/)
  })

  // #284 review: a workout logged into the past is held against what came before its day, the
  // history its rows were built from, not against a session logged after it.
  it('reads the history before the day of a workout logged into the past', async () => {
    const later = [...history, session('2026-08-28', 'A', 90, 3)]
    const past = { d: '2026-08-25', start: Date.parse('2026-08-25T18:00:00'), backfill: { durationMin: 60, replaceId: null } }
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: later, active: past })
    expect(line().textContent).toMatch(/^Last time \(.+\): 60×10$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
    expect(line().textContent).toMatch(/^Best set \(.+\): 80×5$/)
    expect(container.textContent).toContain('Best: 80 kg')
  })

  // Arabic: a set right after the label took the label's direction and read 8×60, while the
  // sets after a Latin "RIR" read 60×8. Each set is its own left-to-right island.
  it('isolates every set from the text around it', async () => {
    const two = [{ d: '2026-08-26', start: Date.parse('2026-08-26T18:00:00'), routineIds: ['A'],
      entries: [{ id: 'plain-bench', rid: 'A', target: { reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, rir: 3, done: true }, { w: 60, r: 8, rir: 2, done: true }] }] }]
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: two })
    const sets = [...line().querySelectorAll('bdi')]
    expect(sets.map(b => [b.getAttribute('dir'), b.textContent])).toEqual([['ltr', '60×8 (RIR 3)'], ['ltr', '60×8 (RIR 2)']])
    expect(line().textContent).toMatch(/^Last time \(.+\): 60×8 \(RIR 3\), 60×8 \(RIR 2\)$/)
  })

  // A per-side set in Arabic carries its side words ("يسار 15×8 · يمين 15×7"). Forced left to
  // right, each word stood on the wrong side of its numbers and the numbers after it turned
  // round; isolated in its own direction it reads as before, next to sets that are forced.
  it('leaves a set with right-to-left words in its own direction', async () => {
    const { _setLangState } = await import('../lib/i18n-core.js')
    const { default: ar } = await import('../locales/ar.js')
    const side = r => ({ w: 15, r, done: true })
    const sided = [{ d: '2026-08-26', start: Date.parse('2026-08-26T18:00:00'), routineIds: ['A'],
      entries: [{ id: 'plain-bench', rid: 'A', target: { mode: 'reps', side: true, reps: 16, weight: 15, bodyweight: false },
        sets: [{ w: 15, r: 15, done: true, sides: { L: side(8), R: side(7) } }] }] }]
    _setLangState('ar', ar, null, null)
    try {
      await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: sided })
      const sets = [...line().querySelectorAll('bdi')]
      expect(sets.map(b => [b.getAttribute('dir'), b.textContent])).toEqual([['auto', `${ar.L} 15×8 · ${ar.R} 15×7`]])
    } finally { _setLangState('en', null, null, null) }
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: sided })
    expect([...line().querySelectorAll('bdi')].map(b => [b.getAttribute('dir'), b.textContent])).toEqual([['ltr', 'L 15×8 · R 15×7']])
  })

  // The text is the reference; the name also says what a tap does, after the text it shows.
  it('names the switch a tap makes', async () => {
    await mount([exercise('plain-bench', [false], { rid: 'A' })], 0, { workouts: history })
    expect(line().getAttribute('aria-label')).toMatch(/^Last time \(.+\): 55×8\. Show your best set instead$/)
    await act(async () => { line().dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await rerender()
    expect(line().getAttribute('aria-label')).toMatch(/^Best set \(.+\): 80×5\. Show last time instead$/)
  })
})

// #284: logging a past workout that went as planned takes one tap, not one per set.
describe('mark all sets done while logging a past workout', () => {
  const openMenu = async () => {
    const btn = container.querySelector('button[aria-label="Workout options"]')
    await act(async () => { btn.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    return mocks.menuSheet.mock.calls.at(-1)[0]
  }
  const labels = menu => menuItemsOf(menu).map(it => it.label)

  it('ticks every set, stamps the top weight and offers the finish', async () => {
    await mount([
      exercise('plain-bench', [false, true]),
      exercise('plain-row', [false], { sets: [{ w: 40, r: 8, done: false, phase: 'warmup' }, { w: 70, r: 8, done: false }] }),
    ], 0, { active: { backfill: { durationMin: 60, replaceId: null }, routineIds: [] } })
    const menu = await openMenu()
    expect(menu.sections[2].items.filter(Boolean)[0].label).toBe('Mark all sets done')
    await act(async () => { menu.sections[2].items.filter(Boolean)[0].onClick() })
    expect(mocks.S.active.entries.every(e => e.sets.every(s => s.done))).toBe(true)
    expect(mocks.S.active.entries.map(e => e.topW)).toEqual([60, 70])
    expect(mocks.workoutCompleteSheet).toHaveBeenCalledTimes(1)
  })

  it('is only there for a past workout', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { routineIds: [] } })
    expect(labels(await openMenu())).not.toContain('Mark all sets done')
  })
})

describe('Update routine, from the More menu of an exercise', () => {
  const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]
  const item = label => menuItemsOf(lastMenu()).find(it => it.label === label)
  const openMore = async () => {
    await act(async () => { container.querySelector('button[aria-label="More"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
  }
  const routine = (slot = {}) => ({ id: 'A', name: 'Push', ex: [{ id: 'plain-bench', sets: 1, mode: 'reps', reps: 5, weight: 60, ...slot }] })
  const ownEntry = (extra = {}) => exercise('plain-bench', [false], { rid: 'A', ...extra })

  it('is not offered while the routine already says what the session does', async () => {
    await mount([ownEntry()], 0, { routines: [routine()] })
    await openMore()
    expect(item('Update routine')).toBeUndefined()
  })

  it('is offered once a warm-up is added, and saves it into the routine after confirming', async () => {
    await mount([ownEntry()], 0, { routines: [routine()] })
    await openMore()
    await act(async () => { item('Add warm-up set').onClick() })
    await rerender()
    await openMore()

    const update = item('Update routine')
    expect(update).toBeTruthy()
    expect(update.sub).toBe('Warm-up sets 0 → 1')

    // Nothing is written until the confirmation is accepted.
    update.onClick()
    expect(mocks.confirmSheet).toHaveBeenCalledOnce()
    expect(mocks.S.routines[0].ex[0].warmupSets).toBeUndefined()

    mocks.confirmSheet.mock.calls[0][0].onConfirm()
    expect(mocks.S.routines[0].ex[0].warmupSets).toBe(1)
    // The rest of the slot is exactly what it was.
    expect(mocks.S.routines[0].ex[0]).toEqual({ id: 'plain-bench', sets: 1, mode: 'reps', reps: 5, weight: 60, warmupSets: 1 })
    expect(mocks.toast).toHaveBeenCalledWith('Routine updated')
  })

  it('names the rest and note edited on the settings sheet mid-session', async () => {
    await mount([ownEntry({ target: { mode: 'reps', reps: 5, weight: 60, restSec: 150, note: 'pause on the chest' } })], 0, { routines: [routine({ restSec: 90 })] })
    await openMore()
    expect(item('Update routine').sub).toBe('Rest 1:30 → 2:30 · Note')
    item('Update routine').onClick()
    mocks.confirmSheet.mock.calls[0][0].onConfirm()
    expect(mocks.S.routines[0].ex[0]).toMatchObject({ restSec: 150, note: 'pause on the chest' })
  })

  it('names a slot with no rest of its own as the default, as the wheel does', async () => {
    await mount([ownEntry({ target: { mode: 'reps', reps: 5, weight: 60, restSec: 180 } })], 0, { routines: [routine()] })
    await openMore()
    expect(item('Update routine').sub).toBe('Rest Default (1:30) → 3:00')
  })

  it('leaves the note added for today with the workout, and says so before confirming', async () => {
    // "Add note" in the ⋯ menu is today's note (entry.note, kept with the finished workout and
    // optionally pinned for next time); the routine's own note is the one on Progression settings.
    await mount([ownEntry({ note: 'Elbows tucked' })], 0, { routines: [routine()] })
    await openMore()
    expect(item('Update routine')).toBeUndefined()
    await act(async () => { item('Add warm-up set').onClick() })
    await rerender()
    await openMore()
    expect(item('Update routine').sub).toBe('Warm-up sets 0 → 1')
    item('Update routine').onClick()
    const { message } = mocks.confirmSheet.mock.calls[0][0]
    expect(message).toMatch(/Exercise settings/)
    expect(message).toMatch(/note added for today stays with this workout/)
    mocks.confirmSheet.mock.calls[0][0].onConfirm()
    expect(mocks.S.routines[0].ex[0].note).toBeUndefined()
  })

  it('does not write into a workout that changed while the confirmation was open', async () => {
    await mount([ownEntry({ target: { mode: 'reps', reps: 5, weight: 60, restSec: 150 } })], 0, { routines: [routine()] })
    await openMore()
    item('Update routine').onClick()
    mocks.S.active = { ...mocks.S.active, id: 'another-workout' }
    mocks.confirmSheet.mock.calls[0][0].onConfirm()
    expect(mocks.S.routines[0].ex[0].restSec).toBeUndefined()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('is not offered for a freestyle exercise, one the routine never had, or a saved workout being edited', async () => {
    await mount([exercise('plain-bench', [false], { target: { mode: 'reps', reps: 5, weight: 60, restSec: 150 } })], 0, { routines: [routine()] })
    await openMore()
    expect(item('Update routine')).toBeUndefined()
    await unmount()

    await mount([ownEntry({ id: 'plain-row', target: { mode: 'reps', reps: 5, weight: 60, restSec: 150 } })], 0, { routines: [routine()] })
    await openMore()
    expect(item('Update routine')).toBeUndefined()
    await unmount()

    await mount([ownEntry({ target: { mode: 'reps', reps: 5, weight: 60, restSec: 150 } })], 0, { routines: [routine()], active: { editingWorkoutId: 'saved' } })
    await openMore()
    expect(item('Update routine')).toBeUndefined()
  })
})

describe('the workout screen chrome (v1.3.11)', () => {
  const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]
  const item = label => menuItemsOf(lastMenu()).find(it => it.label === label)
  const click = async el => { await act(async () => { el.dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
  const openMore = () => click(container.querySelector('button[aria-label="More"]'))

  it('has a labelled Finish pill and a ⌄ that leaves the screen with the session still running', async () => {
    await mount([exercise('plain-bench', [false])])
    const pill = container.querySelector('.whdr-finish')
    expect(pill.textContent).toBe('Finish')
    expect(container.querySelector('button[aria-label="Discard"]')).toBeNull()
    // the pill opens the Finish sheet, whose Discard is the screen's own (with its confirm)
    finishWorkoutSheet.mockClear()
    await click(pill)
    expect(finishWorkoutSheet).toHaveBeenCalledOnce()
    finishWorkoutSheet.mock.calls[0][0].onDiscard()
    expect(mocks.confirmSheet.mock.calls.at(-1)[0].title).toBe('Discard workout?')
    await click(container.querySelector('button[aria-label="Minimize"]'))
    expect(mocks.nav).toHaveBeenCalledWith('/home')
    expect(mocks.S.active).not.toBeNull()
  })

  it('says Save in the editor of a saved workout, and keeps its close button', async () => {
    await mount([exercise('plain-bench', [true])], 0, { active: { editingWorkoutId: 'saved' } })
    const pill = container.querySelector('.whdr-finish')
    expect(pill.textContent).toBe('Save')
    expect(pill.getAttribute('aria-label')).toBe('Save changes')
    finishWorkoutSheet.mockClear(); finishWorkout.mockClear()
    await click(pill)
    expect(finishWorkout).toHaveBeenCalledOnce()           // the editor saves at once
    expect(finishWorkoutSheet).not.toHaveBeenCalled()
    expect(container.querySelector('button[aria-label="Close editor"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Minimize"]')).toBeNull()
  })

  it('leads the workout menu with Workout settings, which opens its sheet', async () => {
    await mount([exercise('plain-bench', [false])], 0, { restSec: 0, sound: true })
    await click(container.querySelector('button[aria-label="Workout options"]'))
    const ws = menuItemsOf(lastMenu())[0]
    expect(ws).toMatchObject({ label: 'Workout settings', sub: 'No rest timer · Sound', accent: true })
    ws.onClick()
    expect(mocks.workoutSettingsSheet).toHaveBeenCalledOnce()
  })

  it('adds an exercise from the workout menu the same way as the button under the session', async () => {
    await mount([exercise('plain-bench', [false])])
    await click(container.querySelector('button[aria-label="Workout options"]'))
    item('Add exercise').onClick()
    expect(mocks.exercisePicker).toHaveBeenCalledOnce()
  })

  it('groups the exercise menu: today, look it up, settings, order, and Remove on its own', async () => {
    await mount([exercise('plain-bench', [false]), exercise('plain-row', [false])])
    await openMore()
    const groups = lastMenu().sections.map(g => [g.title, g.items.filter(Boolean).map(it => it.label)])
    expect(groups).toEqual([
      ['Today', ['Swap exercise', 'Add warm-up set', 'Add note', 'Don’t count for progression']],
      ['Look it up', ['History', 'How to do it']],
      ['Settings', ['Exercise settings', 'Rest timer', 'Plate loading']],
      ['Order and supersets', ['Make superset with next', 'Move up', 'Move down']],
      [undefined, ['Remove exercise']],
    ])
  })

  it('sets an exercise’s own rest on the wheel, 0:00 meaning the default', async () => {
    await mount([exercise('plain-bench', [false])])
    await openMore()
    expect(item('Rest timer').sub).toBe('Default (1:30)')
    item('Rest timer').onClick()
    const opts = mocks.durationSheet.mock.calls.at(-1)[0]
    expect(opts).toMatchObject({ title: 'Rest for this exercise', value: 0, max: 900, off: 'Default (1:30)' })
    await act(async () => { opts.onDone(135) })
    expect(mocks.S.active.entries[0].target.restSec).toBe(135)
    await rerender()
    await openMore()
    expect(item('Rest timer').sub).toBe('2:15')
    item('Rest timer').onClick()
    expect(mocks.durationSheet.mock.calls.at(-1)[0].value).toBe(135)
    await act(async () => { mocks.durationSheet.mock.calls.at(-1)[0].onDone(0) })
    expect(mocks.S.active.entries[0].target.restSec).toBe(0)
  })

  it('has no rest item in the editor of a saved workout', async () => {
    await mount([exercise('plain-bench', [true])], 0, { active: { editingWorkoutId: 'saved' } })
    await openMore()
    expect(item('Rest timer')).toBeUndefined()
  })

  it('groups the set menu: the warm-up switch, then Add to this set, with Remove on its own', async () => {
    await mount([exercise('plain-bench', [false, false])])
    await click(container.querySelector('button[aria-label="Set 1"]'))
    expect(lastMenu().sections.map(g => g.title)).toEqual([undefined, 'Add to this set', undefined])
  })

  it('shows a thumbnail instead of the animation when animations are Small, and a tap brings it back', async () => {
    await mount([exercise('plain-bench', [false])], 0, { gifSize: 'mini' })
    const thumb = container.querySelector('.wthumb')
    expect(thumb).toBeTruthy()
    await click(thumb)
    expect(mocks.S.gifSize).toBe('full')
  })

  it('has no thumbnail with full animations, or in the compact layout', async () => {
    await mount([exercise('plain-bench', [false])], 0, { gifSize: 'full' })
    expect(container.querySelector('.wthumb')).toBeNull()
    await unmount()
    await mount([exercise('plain-bench', [false])], 0, { gifSize: 'mini', active: { workoutView: 'compact' } })
    expect(container.querySelector('.wthumb')).toBeNull()
  })
})
