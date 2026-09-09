import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { nextPrescription } from '../lib/progression.js'

const mocks = vi.hoisted(() => {
  const state = {
    S: null,
    timer: null,
    work: null,
    startRest: vi.fn(),
    stopRest: null,
    stopWork: null,
    confirmSheet: vi.fn(),
    topWeightSheet: vi.fn(),
    workoutCompleteSheet: vi.fn(),
    exercisePicker: vi.fn(),
    exConfigSheet: vi.fn(),
    toast: vi.fn(),
    scrollCalls: [],
    swapActiveWorkoutExercise: vi.fn(),
    menuSheet: vi.fn(),
    effortPickerSheet: vi.fn(),
    exerciseHistorySheet: vi.fn(),
  }
  state.stopRest = vi.fn(() => { state.timer = null })
  state.stopWork = vi.fn(() => { state.work = null })
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
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
    startWork: vi.fn(),
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
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(),
  exercisePicker: mocks.exercisePicker,
  exConfigSheet: mocks.exConfigSheet,
  exerciseDetailSheet: vi.fn(),
  topWeightSheet: mocks.topWeightSheet,
  finishWorkout: vi.fn(),
  workoutCompleteSheet: mocks.workoutCompleteSheet,
  confirmSheet: mocks.confirmSheet,
  swapActiveWorkoutExercise: mocks.swapActiveWorkoutExercise,
  menuSheet: mocks.menuSheet,
  barWeightSheet: vi.fn(),
  // Both note sheets belong here even though the tests never open one: Workout.jsx reads
  // sessionNoteSheet during render, so a missing export is a render crash, not a no-op.
  exerciseNoteSheet: vi.fn(),
  sessionNoteSheet: vi.fn(),
  effortPickerSheet: mocks.effortPickerSheet,
  exerciseHistorySheet: mocks.exerciseHistorySheet,
  addRoutineToSessionSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
// api.js reads navigator.userAgent at module scope. This file installs its own DOM inside the
// tests rather than declaring a vitest environment, so it must not depend on an ambient one.
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
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

async function pressProgression(index = 0) {
  const button = container.querySelectorAll('.progline')[index]
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
  return button
}

async function requestDiscard() {
  const button = container.querySelector('button[aria-label="Discard"]')
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
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

async function rerenderAt(cur) {
  mocks.S.active.cur = cur
  await act(async () => { root.render(React.createElement(Workout)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.timer = null
  mocks.work = null
  mocks.scrollCalls.length = 0
})

afterEach(async () => {
  await unmount()
})

describe('Workout set completion flow', () => {
  it('starts rest after a non-final ordinary set, but stops rest without restarting it on the final set', async () => {
    await mount([exercise('plain-bench', [false, false, false])])
    await toggleSet(0)

    expect(mocks.startRest).toHaveBeenCalledOnce()
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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
    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))

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

    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).not.toHaveBeenCalled()

    await rerender()
    await toggleSet(1)

    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))

    await pressNext()

    expect(mocks.S.active.cur).toBe(2)
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

    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
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

  it('leaves a completed superset selected without opening a top-weight sheet', async () => {
    const group = 'superset-1'
    await mount([
      exercise('superset-a', [true, true, true], { sg: group, asked: true }),
      exercise('superset-b', [true, true, false], { sg: group }),
      exercise('next-exercise', [false, false, false]),
    ], 1)
    await toggleSet(5)

    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
  })

  it('does not auto-select earlier unfinished work after completing an ordinary exercise', async () => {
    await mount([
      exercise('pending-earlier', [false], { asked: true }),
      exercise('current-hold', [false], { asked: true, target: { mode: 'time', sec: 30, weight: 0 } }),
    ], 1)

    await toggleSet(0)

    expect(mocks.S.active.cur).toBe(1)
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
  })

  it('leaves a completed ordinary exercise selected without declaring completion while work remains', async () => {
    await mount([
      exercise('current-loaded', [false]),
      exercise('pending', [false], { asked: true }),
    ])

    await toggleSet(0)

    expect(mocks.topWeightSheet).not.toHaveBeenCalled()
    expect(mocks.workoutCompleteSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.cur).toBe(0)
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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

describe('progression guidance', () => {
  it('labels the visible outcome with the policy that calculated it', async () => {
    await mount([exercise('plain-bench', [false, false, false], {
      plan: {
        policy: 'linear',
        kind: 'up',
        weight: 62.5,
        why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
      },
    })])

    expect(container.querySelector('.progline')?.textContent)
      .toContain('Linear progression · Every rep last time — 2.5 kg more.')
  })

  it('is a keyboard-accessible button that opens settings for the pressed grouped entry', async () => {
    const plan = {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
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
    expect(button.getAttribute('aria-label')).toBe('Open progression settings')
    expect(mocks.exConfigSheet).toHaveBeenCalledOnce()
    expect(mocks.exConfigSheet.mock.calls[0][1]).toBe(second.target)
    expect(mocks.exConfigSheet.mock.calls[0][4]).toBe(mocks.S.routines[0])

    mocks.exConfigSheet.mock.calls[0][2]({ ...second.target, prog: 'double', repsMin: 6 })
    expect(JSON.stringify(mocks.S.active.entries[0])).toBe(firstBefore)
    expect(mocks.S.active.entries[1].target.prog).toBe('double')
    expect(mocks.S.active.cur).toBe(0)
  })

  it('does not save into a different duplicate occurrence after the entry list shifts', async () => {
    const plan = {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
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
      why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
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
        why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
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
        why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
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
      .toContain('Double progression · Top of the rep range in every set — 2.5 kg more, back to 3 reps.')

    const persisted = JSON.parse(JSON.stringify(mocks.S))
    await unmount()
    mocks.S = persisted
    installDom()
    await act(async () => { root.render(React.createElement(Workout)) })
    expect(container.querySelector('.progline')?.textContent)
      .toContain('Double progression · Top of the rep range in every set — 2.5 kg more, back to 3 reps.')
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
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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

describe('workout list view', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const focusButton = unit => [...unit.querySelectorAll('button')].find(b => b.textContent.trim() === 'Set current')

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

    await rerender()
    expect(units()[0].textContent).not.toContain('Current')
    expect(units()[1].textContent).toContain('Current')
    expect(focusButton(units()[0])).toBeTruthy()
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
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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

describe('workout compact view', () => {
  const units = () => [...container.querySelectorAll('.wl-unit')]
  const withExtras = done => exercise('plain-bench', done, {
    plan: {
      policy: 'linear', kind: 'up', weight: 62.5,
      why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'],
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
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
  })
})

describe('workout view header menu', () => {
  const openMenu = async () => {
    const btn = container.querySelector('button[aria-label="Workout view"]')
    expect(btn).toBeTruthy()
    await act(async () => { btn.dispatchEvent(new dom.Event('click', { bubbles: true })) })
    return mocks.menuSheet.mock.calls.at(-1)[0]
  }
  const item = (menu, label) => menu.items.filter(Boolean).find(it => it.label === label)

  // The header ⋮ now leads with "Add routine"; the layouts moved to a nested "Layout" sheet.
  const openLayout = async menu => {
    await act(async () => { item(menu, 'Layout').onClick() })
    return mocks.menuSheet.mock.calls.at(-1)[0]
  }

  it('leads with Add routine, then a Layout sheet with the three layouts marked current', async () => {
    await mount([exercise('plain-bench', [false])], 0, { active: { workoutView: 'list', routineIds: [] } })

    const menu = await openMenu()
    expect(menu.items.filter(Boolean).map(it => it.label)).toEqual(['Add routine', 'Layout'])
    expect(item(menu, 'Layout').sub).toBe('List')

    const layout = await openLayout(menu)
    expect(layout.items.filter(Boolean).map(it => it.label)).toEqual(['Cards', 'List', 'Compact'])
    expect(item(layout, 'List').on).toBe(true)
    expect(item(layout, 'Cards').on).toBe(false)
  })

  it('writes the layout pick onto s.active without touching the global default', async () => {
    await mount([exercise('plain-bench', [false])], 0, { workoutView: 'cards', active: { workoutView: 'cards', routineIds: [] } })

    const layout = await openLayout(await openMenu())
    await act(async () => { item(layout, 'Compact').onClick() })

    expect(mocks.S.active.workoutView).toBe('compact')
    expect(mocks.S.workoutView).toBe('cards')
  })
})

describe('workout controls: the more menu and the set menu', () => {
  const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]
  const item = label => lastMenu().items.filter(Boolean).find(it => it.label === label)

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
    expect(lastMenu().items.filter(Boolean).map(it => it.label)).toEqual(expect.arrayContaining([
      'Add note', 'Details', 'Add warm-up set', 'Make superset with next', 'Swap exercise', 'Move up', 'Move down', 'Remove exercise',
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
    expect(lastMenu().items.filter(Boolean).map(it => it.label)).toEqual(['Drop set', 'Rest-pause burst', 'Remove this set'])

    await act(async () => { item('Drop set').onClick() })
    expect(mocks.S.active.entries[0].sets[1].drops?.length).toBe(1)

    await act(async () => { container.querySelector('button[aria-label="Set 2"]').dispatchEvent(new dom.Event('click', { bubbles: true })) })
    await act(async () => { item('Remove this set').onClick() })
    expect(mocks.S.active.entries[0].sets.length).toBe(1)
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
    expect(mocks.startRest).toHaveBeenCalledWith(90, expect.any(Number))
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
