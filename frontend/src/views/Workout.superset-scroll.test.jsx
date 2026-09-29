import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { effortPickerSheet } from '../sheets.jsx'

// In the Cards layout a superset is one card, and a tick that moves the marker to the partner
// centres the partner's next set row. Rating the set instead (RIR or RPE, one picker) closes the
// picker and ticks the set in the same tap, and the sheet's un-pin puts the page back where it
// stood, now and a frame later (components/Modals.jsx): a scroll asked for in that same commit
// was undone a few ms later, every time, and the partner's row stayed below the fold. So the
// card's scroll waits for the restore (afterScrollRestore), and reads the row when the wait is
// over: the store clones the whole state on every write and the row refs are keyed by entry.
const mocks = vi.hoisted(() => {
  const state = {
    S: null, timer: null, work: null,
    startRest: vi.fn(), startWork: vi.fn(), toast: vi.fn(), menuSheet: vi.fn(),
    stopRest: null, stopWork: null,
    afterScrollRestore: vi.fn(fn => { fn(); return () => {} }),
    scrollRestorePending: vi.fn(() => false),
  }
  state.stopRest = vi.fn(() => { state.timer = null })
  state.stopWork = vi.fn(() => { state.work = null })
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  state.uiSnapshot = () => ({
    timer: state.timer, work: state.work,
    startRest: state.startRest, stopRest: state.stopRest, stopWork: state.stopWork,
    shiftRestOwner: vi.fn(), startWork: state.startWork, toast: state.toast,
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
  startFlow: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
  finishWorkout: vi.fn(), exitWorkoutEdit: vi.fn(), workoutCompleteSheet: vi.fn(), confirmSheet: vi.fn(),
  swapActiveWorkoutExercise: vi.fn(), menuSheet: mocks.menuSheet, barWeightSheet: vi.fn(),
  exerciseNoteSheet: vi.fn(), sessionNoteSheet: vi.fn(), renameWorkoutSheet: vi.fn(),
  effortPickerSheet: vi.fn(), exerciseHistorySheet: vi.fn(), addRoutineToSessionSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
vi.mock('../components/Modals.jsx', () => ({ afterScrollRestore: mocks.afterScrollRestore, scrollRestorePending: mocks.scrollRestorePending }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))

let dom, root, container

// The ids are real library ones so the card has names to show.
const lifted = (id, sg) => ({
  id, sg,
  target: { mode: 'reps', sets: 3, reps: 8, weight: 60, restSec: 60 },
  sets: Array.from({ length: 3 }, () => ({ r: 8, w: 60, done: false })),
})

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  dom.Element.prototype.scrollIntoView = vi.fn()
  dom.requestAnimationFrame = () => 0
  dom.cancelAnimationFrame = () => {}
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(entries, cur = 0, active = {}, prep = null) {
  mocks.S = {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full',
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur, entries, ...active },
  }
  installDom()
  prep?.()   // anything the first render must already find on the DOM: the screen's geometry
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function press(button) {
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

// The mocked store is a plain snapshot with nothing subscribed to it, so a change reaches the
// DOM only on the next render. Tests that read the screen ask for one.
const rerender = () => act(async () => { root.render(React.createElement(Workout)) })

beforeEach(() => {
  mocks.timer = null; mocks.work = null
  // The default runs a queued scroll at once; a test that defers one must not leak that into the next.
  mocks.afterScrollRestore.mockReset(); mocks.afterScrollRestore.mockImplementation(fn => { fn(); return () => {} })
  mocks.scrollRestorePending.mockReset(); mocks.scrollRestorePending.mockImplementation(() => false)
  mocks.startRest.mockClear(); mocks.startWork.mockClear()
  mocks.stopRest.mockClear(); mocks.stopWork.mockClear(); mocks.menuSheet.mockClear()
  effortPickerSheet.mockClear()
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null; container = null; dom = null
})

describe('the superset card after a rating', () => {
  const superset = () => [lifted('0025', 'g'), lifted('0043', 'g'), lifted('0001', 'h')]
  const partnerFirstRow = () => container.querySelectorAll('.setrow')[3]
  // scrollIntoView's `this` is the row it was asked to bring in.
  const watchScrolls = () => { const seen = []; dom.Element.prototype.scrollIntoView = vi.fn(function () { seen.push(this) }); return seen }
  // Where every row stands on a 659 px screen (linkedom lays nothing out): 400 is in view, 889 is
  // below the fold.
  const rowsAt = top => { dom.innerHeight = 659; dom.Element.prototype.getBoundingClientRect = () => ({ top, bottom: top + 44, left: 0, right: 390, width: 390, height: 44 }) }
  // The height the bars at the top (--sat, --conn) measure at. linkedom lays nothing out, so the
  // element Workout.jsx sizes by them reports what the test says.
  const topBars = px => {
    Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', {
      configurable: true, get() { return this.style?.height === 'calc(var(--sat) + var(--conn))' ? px : 0 },
    })
  }

  it.each(['rir', 'rpe'])('%s: the scroll waits for the sheet to hand the page back, then lands on the partner row', async kind => {
    await mount(superset(), 0)
    mocks.S = { ...mocks.S, effort: kind }; await rerender()
    const seen = watchScrolls()
    await press(container.querySelector('.setrow:not(.done) .effcell.is-empty'))
    const [pickedKind, , pick] = effortPickerSheet.mock.calls.at(-1)
    expect(pickedKind).toBe(kind)
    // The picker closes in this same commit: Modals.jsx hands the page back later.
    const queued = []
    mocks.afterScrollRestore.mockImplementationOnce(fn => { queued.push(fn); return () => {} })
    const rating = kind === 'rpe' ? 8 : 2
    await act(async () => { pick(rating) })
    await rerender()
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(mocks.S.active.entries[0].sets[0][kind]).toBe(rating)
    expect(mocks.S.active.cur).toBe(1)
    expect(queued).toHaveLength(1)
    expect(seen).toHaveLength(0)
    // Another write lands before the wait is over. Every write clones the whole state, so the
    // entry the asking render had is under no row ref any more.
    mocks.storeSnapshot().update(s => { s.active.entries[2].sets[0].w = 62.5 }); await rerender()
    await act(async () => { queued[0]() })
    expect(seen).toEqual([partnerFirstRow()])
  })

  it('a plain tick scrolls at once, as it did', async () => {
    await mount(superset(), 0)
    const seen = watchScrolls()
    await press(container.querySelector('[role="checkbox"]'))
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(seen).toEqual([partnerFirstRow()])
  })

  it('unpairing during the wait cancels the queued scroll', async () => {
    await mount(superset(), 0)
    mocks.S = { ...mocks.S, effort: 'rir' }; await rerender()
    const seen = watchScrolls()
    await press(container.querySelector('.setrow:not(.done) .effcell.is-empty'))
    const [, , pick] = effortPickerSheet.mock.calls.at(-1)
    const cancel = vi.fn(); const queued = []
    mocks.afterScrollRestore.mockImplementationOnce(fn => { queued.push(fn); return cancel })
    await act(async () => { pick(2) })
    await rerender()
    expect(queued).toHaveLength(1)
    // The queued callback never re-checks the pairing: the effect's cleanup is what stops it.
    mocks.storeSnapshot().update(s => { delete s.active.entries[0].sg; delete s.active.entries[1].sg }); await rerender()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([])
  })

  // The effect also runs on mount, on pairing and on a layout switch. Each used to ask for the
  // same scroll, undone by the sheet those pass through (weigh-in, exercise ⋯, Layout). With the
  // wait in place they would land, and a session would open with its header off screen.
  it('does not scroll on mount when the row is on screen', async () => {
    await mount(superset(), 0, {}, () => rowsAt(400))
    expect(dom.Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
  // Coming back to the session, or a fresh open, with the row below the fold.
  it('brings a row below the fold back on mount, as it always did', async () => {
    await mount(superset(), 1, {}, () => rowsAt(889))
    const scroll = dom.Element.prototype.scrollIntoView
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(partnerFirstRow())
  })
  it('does not scroll when two exercises are paired', async () => {
    await mount([lifted('0025'), lifted('0043'), lifted('0001')], 0)
    rowsAt(400); const seen = watchScrolls()
    mocks.storeSnapshot().update(s => { s.active.entries[0].sg = 'g'; s.active.entries[1].sg = 'g' }); await rerender()
    expect(container.querySelectorAll('.setrow')).toHaveLength(6)
    expect(seen).toEqual([])
  })
  it('does not scroll on List → Cards', async () => {
    await mount(superset(), 0, { workoutView: 'list' })
    rowsAt(400); const seen = watchScrolls()
    mocks.storeSnapshot().update(s => { s.active.workoutView = 'cards' }); await rerender()
    expect(seen).toEqual([])
    // …and a marker move after the switch still does, on-screen row or not.
    await press(container.querySelector('[role="checkbox"]'))
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(seen).toEqual([partnerFirstRow()])
  })
  // The marker moved while the List was up, where this scroll never runs; the switch back to
  // Cards is not that move. The marker's position is remembered on every run, early return or not.
  it('a marker moved in the List does not scroll once Cards comes back', async () => {
    await mount(superset(), 0, {}, () => rowsAt(400))
    const seen = watchScrolls()
    mocks.storeSnapshot().update(s => { s.active.workoutView = 'list' }); await rerender()
    await press(container.querySelector('[role="checkbox"]'))
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    mocks.storeSnapshot().update(s => { s.active.workoutView = 'cards' }); await rerender()
    expect(seen).toEqual([])
  })
  // A session started through the weigh-in sheet, its first block tall enough to push the first
  // row partly under the tab bar: off screen by the rule above, but the sheet's restore is still
  // running, and a scroll the marker did not cause never fought that, so it is not asked for.
  it('does not scroll on mount while a sheet\'s restore is pending, off-screen row or not', async () => {
    mocks.scrollRestorePending.mockImplementation(() => true)
    await mount(superset(), 0, {}, () => rowsAt(630))
    expect(dom.Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(mocks.afterScrollRestore).not.toHaveBeenCalled()
    // …while the marker moving inside that same window still asks, through the wait.
    const seen = watchScrolls()
    await press(container.querySelector('[role="checkbox"]'))
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(seen).toEqual([partnerFirstRow()])
  })
  // Exercise ⋯ → Move up: the unit changes place and the marker's index follows it. Not a move,
  // so an on-screen row stays where it is.
  it('moving the marker\'s unit up or down does not scroll', async () => {
    await mount([lifted('0001'), lifted('0025', 'g'), lifted('0043', 'g')], 1, {}, () => rowsAt(400))
    const seen = watchScrolls()
    // Through the exercise's own ⋯ menu, as a thumb does it: the move records the marker's new
    // index itself, which is what tells it apart from a real move.
    await press(container.querySelector('button[aria-label="More"]'))
    const items = mocks.menuSheet.mock.calls.at(-1)[0].items.filter(Boolean)
    await act(async () => { items.find(i => i.label === 'Move up').onClick() })
    await rerender()
    expect(mocks.S.active.entries[0].id).toBe('0025')
    expect(mocks.S.active.cur).toBe(0)
    expect(seen).toEqual([])
    // …while the tick that moves the marker to the partner still centres its row.
    await press(container.querySelector('[role="checkbox"]'))
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(seen).toEqual([container.querySelectorAll('.setrow')[3]])
  })
  // Two rows of the same exercise in one superset: the tick from one to the other is a move all
  // the same (judged by index), so rating the first still centres the second, through the wait,
  // with the picker's restore pending.
  it('rating a set in a same-exercise superset still centres the partner row', async () => {
    await mount([lifted('0025', 'g'), lifted('0025', 'g'), lifted('0001')], 0, {}, () => rowsAt(400))
    mocks.S = { ...mocks.S, effort: 'rir' }; await rerender()
    const seen = watchScrolls()
    await press(container.querySelector('.setrow:not(.done) .effcell.is-empty'))
    const [, , pick] = effortPickerSheet.mock.calls.at(-1)
    mocks.scrollRestorePending.mockImplementation(() => true)
    const queued = []
    mocks.afterScrollRestore.mockImplementationOnce(fn => { queued.push(fn); return () => {} })
    await act(async () => { pick(2) })
    await rerender()
    expect(mocks.S.active.cur).toBe(1)
    expect(queued).toHaveLength(1)
    await act(async () => { queued[0]() })
    expect(seen).toEqual([partnerFirstRow()])
  })
  // The installed app runs under the translucent status bar, and the connection bar sits below it
  // while there is no server: a row up there is not on screen.
  it('a row under the bars at the top counts as off screen', async () => {
    await mount(superset(), 1, {}, () => { rowsAt(30); topBars(59) })
    const scroll = dom.Element.prototype.scrollIntoView
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(partnerFirstRow())
    // The element it measured with is gone again.
    expect([...document.body.children].some(el => el.style?.height === 'calc(var(--sat) + var(--conn))')).toBe(false)
  })
  it('the same row is on screen where nothing covers the top', async () => {
    await mount(superset(), 1, {}, () => { rowsAt(30); topBars(0) })
    expect(dom.Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
  // The rest and tab bars are fixed over the page: a row under either is not on screen.
  it('a row under the rest bar counts as off screen', async () => {
    await mount(superset(), 0, { workoutView: 'list' })
    rowsAt(400); const seen = watchScrolls()
    const bar = document.createElement('div'); bar.id = 'timer'; document.body.appendChild(bar)
    dom.Element.prototype.getBoundingClientRect = function () { return this.id === 'timer' ? { top: 380, bottom: 659 } : { top: 400, bottom: 444 } }
    mocks.storeSnapshot().update(s => { s.active.workoutView = 'cards' }); await rerender()
    expect(seen).toEqual([container.querySelectorAll('.setrow')[0]])
  })
})
