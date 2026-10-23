import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'

// A flow block runs itself: one tap, then each hold hands over to the next movement and the
// round's own short rest carries into the round after it (lib/blocks.js, components/FlowBlock.jsx,
// Workout.jsx flowHold). What is worth testing is the chain — which hold starts next, whether a
// rest comes in between, and the two things that must stop it: a phone that was in a pocket
// while the hold ran out, and the user putting the block back into rows.
const mocks = vi.hoisted(() => {
  const state = {
    S: null, timer: null, work: null,
    startRest: vi.fn(), startWork: vi.fn(), toast: vi.fn(), menuSheet: vi.fn(),
    stopRest: null, stopWork: null, pauseWork: null, resumeWork: null,
    abandonWork: vi.fn(), shiftRestOwner: vi.fn(),
    afterScrollRestore: vi.fn(fn => { fn(); return () => {} }),
    scrollRestorePending: vi.fn(() => false),
    restHandOver: null,
  }
  state.stopRest = vi.fn(() => { state.timer = null })
  state.stopWork = vi.fn(() => { state.work = null })
  // The store's own pause/resume: the hold stays, with its seconds and its owner (store/useUI.js).
  state.pauseWork = vi.fn(() => { if (state.work) state.work = { ...state.work, paused: true } })
  state.resumeWork = vi.fn(() => { if (state.work?.paused) state.work = { ...state.work, paused: false } })
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  state.uiSnapshot = () => ({
    timer: state.timer, work: state.work,
    startRest: state.startRest, stopRest: state.stopRest, stopWork: state.stopWork,
    abandonWork: state.abandonWork, shiftRestOwner: state.shiftRestOwner,
    pauseWork: state.pauseWork, resumeWork: state.resumeWork,
    startWork: state.startWork, toast: state.toast,
    // The screen's answer to a rest that is over (useUI.bindRest), kept so a test can play it.
    bindRest: fn => { state.restHandOver = fn },
    bindWork: vi.fn(),
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
  useUI.setState = patch => {
    const next = typeof patch === 'function' ? patch(mocks.uiSnapshot()) : patch
    if ('timer' in next) mocks.timer = next.timer
    if ('work' in next) mocks.work = next.work
  }
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
  finishWorkout: vi.fn(), finishWorkoutSheet: vi.fn(), exitWorkoutEdit: vi.fn(), workoutCompleteSheet: vi.fn(), confirmSheet: vi.fn(),
  swapActiveWorkoutExercise: vi.fn(), menuSheet: mocks.menuSheet, barWeightSheet: vi.fn(),
  exerciseNoteSheet: vi.fn(), sessionNoteSheet: vi.fn(), renameWorkoutSheet: vi.fn(),
  effortPickerSheet: vi.fn(), exerciseHistorySheet: vi.fn(), addRoutineToSessionSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
vi.mock('../components/WorkoutThumb.jsx', () => ({ default: () => null, hasWorkoutMedia: () => false }))
vi.mock('../components/DurationWheel.jsx', () => ({ durationSheet: vi.fn() }))
vi.mock('../components/WorkoutSettingsSheet.jsx', () => ({ workoutSettingsSheet: vi.fn() }))
vi.mock('../components/Modals.jsx', () => ({ afterScrollRestore: mocks.afterScrollRestore, scrollRestorePending: mocks.scrollRestorePending }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))

let dom, root, container

// A menu's actions in order, whether it came as one list or in groups (menuSheet `sections`).
const menuItemsOf = menu => (menu.sections ? menu.sections.flatMap(g => g.items || []) : menu.items || []).filter(Boolean)
const lastMenu = () => mocks.menuSheet.mock.calls.at(-1)[0]

// Three movements of a warm-up, two rounds: timed, one superset, 15 s rest — the shape
// lib/blocks.js reads as a flow. The ids are real library ones so the card has names to show.
const held = (id, sg, rounds, sec = 35) => ({
  id, sg,
  target: { mode: 'time', sets: rounds, sec, restSec: 15 },
  sets: Array.from({ length: rounds }, () => ({ sec, w: 0, done: false })),
})
const lifted = (id, sg) => ({
  id, sg,
  target: { mode: 'reps', sets: 3, reps: 8, weight: 60, restSec: 60 },
  sets: Array.from({ length: 3 }, () => ({ r: 8, w: 60, done: false })),
})

const warmup = () => [
  held('1368', 'sg-warmup', 2),        // ankle circles
  held('1460', 'sg-warmup', 2),        // walking lunge
  held('1428', 'sg-warmup', 2),        // wrist circles
]

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

async function mount(entries, cur = 0, active = {}) {
  mocks.S = {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full',
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur, entries, ...active },
  }
  installDom()
  await act(async () => { root.render(React.createElement(Workout)) })
}

const byText = text => [...container.querySelectorAll('button')]
  .find(b => b.textContent.trim().toLowerCase().startsWith(text.toLowerCase()))

async function press(button) {
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

// Everything Workout.jsx hands startWork, as the store would then hold it. The card reads
// `work` to decide whether the block is running, so a test that presses Pause has to have one.
function runningHold() {
  const call = mocks.startWork.mock.calls.at(-1)
  expect(call).toBeTruthy()
  const [total, label, , owner] = call
  mocks.work = { left: total, total, endsAt: Date.now() + total * 1000, label, owner }
}

// The hold the app last started, finished the way the work timer finishes one: on screen
// onDone(elapsed, { chimed: true }), and one that ran out while the page was hidden with the moment
// it really ended (`endedAt`), which is how a hold says nobody watched it end.
async function endHold({ seenLive = true } = {}) {
  const call = mocks.startWork.mock.calls.at(-1)
  expect(call).toBeTruthy()
  const [total, , onDone] = call
  mocks.work = null
  await act(async () => { onDone(total, seenLive ? { chimed: true } : { chimed: false, endedAt: Date.now() - 1000 }) })
}

// The rest the app last started, run out the way the rest timer runs one out: on screen, the
// hand-over the screen bound (useUI.bindRest) gets the rest as it is then; a rest that ran out
// while the page was hidden hands over nothing (useUI runRest).
async function endRest({ seenLive = true } = {}) {
  const call = mocks.startRest.mock.calls.at(-1)
  expect(call).toBeTruthy()
  const [, forIdx, { kind, chain, flow, flowCur } = {}] = call
  mocks.timer = null
  if (seenLive) await act(async () => { mocks.restHandOver({ forIdx, kind, chain, flow, flowCur }) })
}

const startedAt = () => mocks.startWork.mock.calls.map(c => c[3]?.idx)

// The mocked store is a plain snapshot with nothing subscribed to it, so a change made from a
// timer callback reaches the DOM only on the next render. Tests that read the screen ask for one.
const rerender = () => act(async () => { root.render(React.createElement(Workout)) })

// A touch swipe toward the next card, held half way: the cards layout then renders the card it
// is sliding in (SwipeCards renderPreview). Returns that card; `release()` lets go of it, and
// `land()` lets go past the commit distance and returns the card that lands, once it has.
async function swipeHalfway() {
  const surface = container.querySelector('[data-testid="workout-swipe-surface"]')
  const pointer = (type, x) => {
    const event = new dom.Event(type, { bubbles: true })
    Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 20 })
    return act(async () => { surface.dispatchEvent(event) })
  }
  await pointer('pointerdown', 250)
  await pointer('pointermove', 150)
  const land = async () => {
    await pointer('pointerup', 150)
    await act(async () => { await new Promise(r => setTimeout(r, 260)) })   // SwipeCards' 200 ms slide
    await rerender()
    return container.querySelector('.workout-swipe-card')
  }
  return { preview: container.querySelector('.workout-swipe-preview'), release: () => pointer('pointercancel', 150), land }
}

beforeEach(() => {
  mocks.timer = null; mocks.work = null
  mocks.startRest.mockClear(); mocks.startWork.mockClear()
  mocks.stopRest.mockClear(); mocks.stopWork.mockClear(); mocks.menuSheet.mockClear()
  mocks.pauseWork.mockClear(); mocks.resumeWork.mockClear()
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null; container = null; dom = null
})

describe('the flow block', () => {
  it('renders a warm-up as one screen and an accessory superset as set rows', async () => {
    await mount(warmup())
    expect(container.querySelector('[data-testid="flow-block"]')).toBeTruthy()
    expect(container.querySelectorAll('[role="checkbox"]').length).toBe(0)
    expect(container.textContent).toContain('Warm-up')
    expect(container.textContent).toContain('Round 1 of 2')
    await act(async () => { root.unmount() }); root = null

    // Same superset, same number of movements — but counted, not held, and resting a minute.
    await mount([lifted('0289', 'sg-m1'), lifted('0652', 'sg-m1')])
    expect(container.querySelector('[data-testid="flow-block"]')).toBe(null)
    expect(container.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
  })

  it('runs the round on one tap: each hold hands straight to the next movement, no rest between', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    expect(startedAt()).toEqual([0])

    await endHold()
    // Straight to the second movement. A superset rests after the round, not between members,
    // so nothing times this gap and nothing should.
    expect(startedAt()).toEqual([0, 1])
    expect(mocks.startRest).not.toHaveBeenCalled()

    await endHold()
    expect(startedAt()).toEqual([0, 1, 2])
    expect(mocks.startRest).not.toHaveBeenCalled()
  })

  // With v1.3.9's timed-set overtime on, a hold counts past its target until Done is tapped. A
  // block that runs itself would then wait on every movement, so a flow ignores the setting.
  it('asks every hold it starts to end at its target, overtime or not', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold()
    await endHold()
    expect(mocks.startWork.mock.calls.length).toBe(3)
    for (const c of mocks.startWork.mock.calls) expect(c[4]).toEqual({ noOvertime: true, prep: 0 })
  })

  // Settings → Get ready before each hold: every hold the block starts, the
  // first included, asks for that many seconds of get-ready in front of it. Off is 0.
  it('asks every hold it starts for the get-ready count Settings chose', async () => {
    await mount(warmup())
    mocks.S = { ...mocks.S, flowGetReady: 5 }
    await press(byText('Start warm-up'))
    await endHold()
    await endHold()
    expect(mocks.startWork.mock.calls.length).toBe(3)
    for (const c of mocks.startWork.mock.calls) expect(c[4]).toEqual({ noOvertime: true, prep: 5 })
  })

  it('rests once at the end of the round, then starts round two at the top of the block', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold(); await endHold(); await endHold()      // the whole of round one

    expect(mocks.startRest).toHaveBeenCalledTimes(1)
    const [sec, forIdx, { kind, flow }] = mocks.startRest.mock.calls[0]
    expect(sec).toBe(15)                                    // the block's own rest, not the global 90
    expect(kind).toBe('round')
    expect(forIdx).toBe(2)
    expect(flow).toBe('sg-warmup')                          // the chain rides on the rest, as data

    await endRest()
    expect(startedAt()).toEqual([0, 1, 2, 0])               // round two, from the first movement
    expect(mocks.S.active.cur).toBe(0)
  })

  // The round's last tick puts the marker back at the top of the block, as v1.4.0 does for any
  // superset; the end of the rest moves nothing.
  it('a round\'s rest that ran out in a pocket starts no hold', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold(); await endHold(); await endHold()
    expect(mocks.S.active.cur).toBe(0)
    await endRest({ seenLive: false })
    expect(startedAt()).toEqual([0, 1, 2])
    expect(mocks.S.active.cur).toBe(0)
  })

  // After a round's rest that ran out with the phone locked, going on is one tap.
  // The bar sits on Ready (the rest is over), and the card offers Resume beside it.
  it('a round\'s rest that ran out in a pocket leaves Resume on the card, one tap from round two', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold(); await endHold(); await endHold()
    const [, forIdx, { kind }] = mocks.startRest.mock.calls[0]
    await endRest({ seenLive: false })
    mocks.timer = { left: 0, total: 15, forIdx, kind, ready: true }   // the bar on Ready
    await rerender()
    expect(container.querySelector('.flowblk-go')).toBeTruthy()
    await press(byText('Resume warm-up'))
    expect(startedAt()).toEqual([0, 1, 2, 0])
  })

  it('parks instead of running on when the hold ran out in a pocket', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold({ seenLive: false })
    // The set is logged and the screen has moved on, but nothing is being held: a hold nobody
    // watched must not start another one. What is left is the button that says so.
    expect(startedAt()).toEqual([0])
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    await rerender()
    expect(byText('Resume warm-up')).toBeTruthy()

    await press(byText('Resume warm-up'))
    expect(startedAt()).toEqual([0, 1])
  })

  // A hold that ran out while the phone was locked is only finished when the page is back, with the
  // moment it really ended (useUI runWork's endedAt). The round's rest after it has been counting
  // since then (useUI startRest's `since`), and the block still parks: that rest carries no flow.
  it('a round\'s last hold that ran out in a pocket: its rest counts from the hold\'s end, and the block stays parked', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold(); await endHold()
    const [total, , onDone] = mocks.startWork.mock.calls.at(-1)
    mocks.work = null
    await act(async () => { onDone(total, { chimed: false, endedAt: 1234 }) })
    const [sec, , opts] = mocks.startRest.mock.calls.at(-1)
    expect(sec).toBe(15)
    expect(opts).toMatchObject({ kind: 'round', since: 1234 })
    expect(opts.flow).toBeUndefined()
    await endRest()                                         // its remaining part, ending on screen
    expect(startedAt()).toEqual([0, 1, 2])
  })

  // As with a timed exercise's holds, going to another exercise while the block runs itself takes
  // it off autopilot — during the round's rest, a switch-sides pause, or a hold. The next hold
  // waits for the card's Resume, and the screen stays where you went.
  describe('going to another exercise while it runs', () => {
    it('during the round\'s rest: round two does not start, and the screen stays', async () => {
      await mount([...warmup(), lifted('0042', null)])
      await press(byText('Start warm-up'))
      await endHold(); await endHold(); await endHold()
      mocks.S.active.cur = 3
      await endRest()
      expect(startedAt()).toEqual([0, 1, 2])
      expect(mocks.S.active.cur).toBe(3)
      mocks.S.active.cur = 0                                 // back to the block: Resume picks it up
      await rerender()
      await press(byText('Resume warm-up'))
      expect(startedAt()).toEqual([0, 1, 2, 0])
    })

    it('but going to another movement of the block itself is not going away', async () => {
      await mount([...warmup(), lifted('0042', null)])
      await press(byText('Start warm-up'))
      await endHold(); await endHold(); await endHold()
      mocks.S.active.cur = 2
      await endRest()
      expect(startedAt()).toEqual([0, 1, 2, 0])
    })

    it('during a hold: the next movement does not start, and the screen is not pulled back into the block', async () => {
      await mount([...warmup(), lifted('0042', null)])
      await press(byText('Start warm-up'))
      mocks.S.active.cur = 3
      await endHold()
      expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
      expect(startedAt()).toEqual([0])
      expect(mocks.S.active.cur).toBe(3)
      mocks.S.active.cur = 0
      await rerender()
      await press(byText('Resume warm-up'))
      expect(startedAt()).toEqual([0, 1])
    })

    it('during the round\'s last hold: its rest runs, but hands over nothing and moves nothing', async () => {
      await mount([...warmup(), lifted('0042', null)])
      await press(byText('Start warm-up'))
      await endHold(); await endHold()
      mocks.S.active.cur = 3
      await endHold()
      const [, , { kind, flow }] = mocks.startRest.mock.calls.at(-1)
      expect(kind).toBe('round')
      expect(flow).toBeUndefined()
      expect(mocks.S.active.cur).toBe(3)
      await endRest()
      expect(startedAt()).toEqual([0, 1, 2])
      expect(mocks.S.active.cur).toBe(3)
    })

    it('during the block\'s very last hold: the rest after it moves nothing either', async () => {
      await mount([lifted('0042', null), held('1368', 'sg-wu', 1), held('1460', 'sg-wu', 1), lifted('0652', null)], 1)
      await press(byText('Start flow'))                      // a block in the middle of the session
      await endHold()
      mocks.S.active.cur = 0                                 // back to the first lift
      await endHold()                                        // the block is done
      const [, , { kind, flow, chain }] = mocks.startRest.mock.calls.at(-1)
      expect(kind).toBe('block')
      expect(flow).toBeUndefined()
      expect(chain).toBeUndefined()
      await endRest()
      expect(mocks.S.active.cur).toBe(0)
    })

    it('during a hold of another movement of the block itself is not going away either', async () => {
      await mount([...warmup(), lifted('0042', null)])
      await press(byText('Start warm-up'))
      mocks.S.active.cur = 2
      await endHold()
      expect(startedAt()).toEqual([0, 1])
    })

    // v1.4.0 scrolls nothing when a rest starts or ends, and a flow block's rests are no exception,
    // whether or not you went away during the hold before them.
    it('the round\'s rest scrolls nothing in the List, with or without a move away', async () => {
      const scrolls = () => dom.Element.prototype.scrollIntoView.mock.calls.length
      const restOnBar = async () => {
        const [total, forIdx, { kind, flow, flowCur }] = mocks.startRest.mock.calls.at(-1)
        mocks.timer = { left: total, total, endsAt: Date.now() + total * 1000, forIdx, kind, ...(flow ? { flow, flowCur } : {}) }
        await rerender()
      }
      await mount([...warmup(), lifted('0042', null)], 0, { workoutView: 'list' })
      await press(byText('Start warm-up'))
      await endHold(); await endHold(); await endHold()
      const before = scrolls()
      await restOnBar()
      await endRest()
      await rerender()
      expect(scrolls()).toBe(before)
      await act(async () => { root.unmount() }); root = null
      mocks.timer = null; mocks.startRest.mockClear(); mocks.startWork.mockClear()

      await mount([...warmup(), lifted('0042', null)], 0, { workoutView: 'list' })
      await press(byText('Start warm-up'))
      await endHold(); await endHold()
      mocks.S.active.cur = 3
      await endHold()
      const after = scrolls()
      await restOnBar()
      expect(scrolls()).toBe(after)
    })

    it('during a switch-sides pause: the other side does not start, and the screen stays', async () => {
      const sided = (id, sg, rounds, sec = 30) => ({ id, sg, target: { mode: 'time', sets: rounds, sec, restSec: 10, side: true },
        sets: Array.from({ length: rounds }, () => [{ sec, w: 0, side: 'L', done: false }, { sec, w: 0, side: 'R', done: false }]).flat() })
      await mount([lifted('0042', null), held('1512', 'sg-cd', 2, 35), sided('1424', 'sg-cd', 2), held('1494', 'sg-cd', 2, 35)], 1)
      await press(byText('Start cool-down'))
      await endHold(); await endHold()                       // the stretch's left side: its switch pause
      expect(mocks.startRest.mock.calls.at(-1)[2].kind).toBe('switch')
      mocks.S.active.cur = 0
      await endRest()
      expect(mocks.startWork.mock.calls.map(c => [c[3]?.idx, c[3]?.i])).toEqual([[1, 0], [2, 0]])
      expect(mocks.S.active.cur).toBe(0)
    })

    // In the List layout the block can be started from its card with the marker somewhere else.
    // That is not going away: nothing moved.
    it('a block started from its card in the List layout, the marker elsewhere and left there, runs on', async () => {
      const sided = (id, sg, rounds, sec = 30) => ({ id, sg, target: { mode: 'time', sets: rounds, sec, restSec: 10, side: true },
        sets: Array.from({ length: rounds }, () => [{ sec, w: 0, side: 'L', done: false }, { sec, w: 0, side: 'R', done: false }]).flat() })
      await mount([lifted('0042', null), sided('1424', 'sg-cd', 2), held('1494', 'sg-cd', 2, 35)], 0, { workoutView: 'list' })
      await press(byText('Start cool-down'))
      await endHold()                                        // the left side, the marker still on the lift
      expect(mocks.S.active.cur).toBe(0)
      await endRest()                                        // its switch pause
      expect(mocks.startWork.mock.calls.map(c => [c[3]?.idx, c[3]?.i])).toEqual([[1, 0], [1, 1]])
    })
  })

  // Per-side holds in a flow. A side stretch is a left row and a right row per set; the hold that
  // ends the left side hands over to the right, and the round goes on to the next movement once
  // both sides are held.
  describe('a per-side hold in the block', () => {
    const sided = (id, sg, rounds, sec = 30) => ({
      id, sg,
      target: { mode: 'time', sets: rounds, sec, restSec: 10, side: true },
      sets: Array.from({ length: rounds }, () => [{ sec, w: 0, side: 'L', done: false }, { sec, w: 0, side: 'R', done: false }]).flat(),
    })
    // The last block of the session, so the card calls it the cool-down.
    const cooldown = () => [lifted('0042', null), held('1512', 'sg-cd', 2, 35), sided('1424', 'sg-cd', 2), held('1494', 'sg-cd', 2, 35)]
    const startedRows = () => mocks.startWork.mock.calls.map(c => [c[3]?.idx, c[3]?.i])

    it('without a get-ready count, the switch pause stays and hands over to the other side', async () => {
      await mount(cooldown(), 1)
      expect(container.textContent).toContain('Round 1 of 2')     // two sets, not four rows
      await press(byText('Start cool-down'))
      await endHold()                                           // the first movement
      await endHold()                                           // the stretch's left side
      expect(mocks.startRest).toHaveBeenCalledTimes(1)
      const [sec, forIdx, { kind, flow, flowCur, chain }] = mocks.startRest.mock.calls[0]
      expect([sec, forIdx, kind]).toEqual([10, 2, 'switch'])
      expect(flow).toBe('sg-cd')
      expect(flowCur).toBe(2)                                    // and where the marker stood as it began
      expect(chain).toBeUndefined()
      await endRest()
      expect(startedRows()).toEqual([[1, 0], [2, 0], [2, 1]])   // its right side
      await endHold()
      expect(startedRows()).toEqual([[1, 0], [2, 0], [2, 1], [3, 0]])   // then the round goes on
      expect(mocks.startRest).toHaveBeenCalledTimes(1)
    })

    it('with a get-ready count, the count takes the switch pause\'s place', async () => {
      await mount(cooldown(), 1)
      mocks.S = { ...mocks.S, flowGetReady: 5 }
      await press(byText('Start cool-down'))
      await endHold()
      await endHold()                                           // the left side
      expect(mocks.startRest).not.toHaveBeenCalled()
      expect(startedRows()).toEqual([[1, 0], [2, 0], [2, 1]])
      expect(mocks.startWork.mock.calls.at(-1)[4]).toEqual({ noOvertime: true, prep: 5 })
    })

    // The count must not stand in for the pause in a block put back into rows, where nothing would
    // then start the other side — no pause, no hold.
    it('a block put back into rows keeps its switch pause, count or not', async () => {
      await mount(cooldown(), 1, { unitView: { 'sg-cd': 'rows' } })
      mocks.S = { ...mocks.S, flowGetReady: 5 }
      await rerender()
      expect(container.querySelector('[data-testid="flow-block"]')).toBe(null)
      await press(container.querySelector('[data-exidx="2"] .setrow .setgo'))   // the stretch's left side
      await endHold()
      expect(mocks.startRest).toHaveBeenCalledTimes(1)
      expect(mocks.startRest.mock.calls[0][2].kind).toBe('switch')
      expect(startedRows()).toEqual([[2, 0]])                  // nothing starts by itself in rows
    })

    // The two halves showed the same name, clock and "Hold", and Next named the movement after both,
    // so nothing on the card said which side was being held or that the right one came next.
    const cardSays = () => [container.querySelector('.flowblk-now .muted')?.textContent, container.querySelector('.flowblk-next')?.textContent]
    it('names the side being held, and the right side as Next until it starts', async () => {
      await mount(cooldown(), 1)
      await press(byText('Start cool-down'))
      await endHold()                                           // the first movement
      runningHold(); await rerender()                           // the stretch's left side
      expect(cardSays()).toEqual(['Left side', 'Next · Right side'])
      await endHold()
      const [left, forIdx, { kind, forSet }] = mocks.startRest.mock.calls[0]
      mocks.timer = { left, total: left, forIdx, kind, forSet }   // the switch pause, as the bar holds it
      await rerender()
      expect(cardSays()).toEqual(['Switch sides', 'Next · Right side'])
      await endRest()
      runningHold(); await rerender()                           // the right side
      expect(cardSays()).toEqual(['Right side', 'Next · Butterfly Yoga Pose'])
    })

    it('with a get-ready count, the count says which side it is counting to', async () => {
      await mount(cooldown(), 1)
      mocks.S = { ...mocks.S, flowGetReady: 5 }
      await press(byText('Start cool-down'))
      await endHold()
      const prepped = () => { runningHold(); mocks.work = { ...mocks.work, prep: 5, prepTotal: 5 } }
      prepped(); await rerender()                               // the count to the left side
      expect(cardSays()).toEqual(['Get ready · Left side', 'Next · Right side'])
      await endHold()
      prepped(); await rerender()                               // in the switch pause's place
      expect(cardSays()).toEqual(['Get ready · Right side', 'Next · Butterfly Yoga Pose'])
    })

    it('a left side that ran out in a pocket gets its switch pause and nothing after it', async () => {
      await mount(cooldown(), 1)
      await press(byText('Start cool-down'))
      await endHold()
      await endHold({ seenLive: false })
      const [, , { kind, flow }] = mocks.startRest.mock.calls[0]
      expect(kind).toBe('switch')
      expect(flow).toBeUndefined()
      mocks.timer = null                                        // the pause is over
      await rerender()
      await press(byText('Resume cool-down'))
      expect(startedRows()).toEqual([[1, 0], [2, 0], [2, 1]])   // the side that is left
    })
  })

  it('shows the rows when the block is put back into them, and lets go of a running chain', async () => {
    await mount(warmup(), 0, { unitView: { 'sg-warmup': 'rows' } })
    expect(container.querySelector('[data-testid="flow-block"]')).toBe(null)
    expect(container.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
    await act(async () => { root.unmount() }); root = null

    // Switched mid-block, while a hold is running: the hold finishes and logs what it held, and
    // the chain stops there rather than starting the next movement behind the user's back.
    await mount(warmup())
    await press(byText('Start warm-up'))
    expect(startedAt()).toEqual([0])
    mocks.S = structuredClone(mocks.S)
    mocks.S.active.unitView = { 'sg-warmup': 'rows' }
    await endHold()
    expect(startedAt()).toEqual([0])
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
  })

  it('hands the finished block over like any other, without starting a hold in the next one', async () => {
    await mount([...warmup(), lifted('0042', null)])
    await press(byText('Start warm-up'))
    await endHold(); await endHold(); await endHold()       // round one
    await endRest()                                         // its rest starts round two
    await endHold(); await endHold(); await endHold()       // round two

    expect(mocks.S.active.entries.slice(0, 3).every(e => e.sets.every(s => s.done))).toBe(true)
    expect(startedAt()).toEqual([0, 1, 2, 0, 1, 2])
    // The block's closing hold earns a rest like any other finished unit, and nothing starts
    // itself after it, because a hold that begins while you are still walking to the bar is a
    // hold you did not do. The end of that rest moves nothing: the card says the block is done,
    // and Next goes on, as for any finished unit on v1.4.0.
    expect(mocks.startRest.mock.calls.at(-1)[2].flow).toBeUndefined()
    await endRest()
    expect(mocks.S.active.cur).toBe(2)
    expect(startedAt()).toEqual([0, 1, 2, 0, 1, 2])
    await rerender()
    expect(container.textContent).toContain('Warm-up complete')
  })

  it('shows no controls of its own while a countdown is running — the timer bar has them', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    runningHold()
    await rerender()
    // The movement name and the clock were appearing twice, 200px apart, for one countdown. The
    // card keeps the reading (name, clock, round, what comes next); the fixed bar keeps Pause and
    // Done, because it is the one that is still on screen when the page has scrolled.
    expect(container.querySelector('.flowblk-go')).toBe(null)
    expect(container.textContent).toContain('Hold')

    // Frozen is the same: still the bar's countdown, still no button here.
    mocks.work = { ...mocks.work, paused: true, left: 12 }
    await rerender()
    expect(container.querySelector('.flowblk-go')).toBe(null)
    expect(container.textContent).toContain('Paused')
  })

  it('keeps its button for the moments there is no countdown and so no bar', async () => {
    await mount(warmup())
    expect(byText('Start warm-up')).toBeTruthy()        // nothing started yet

    await press(byText('Start warm-up'))
    await endHold({ seenLive: false })                  // ran out in a pocket: parked, no bar
    await rerender()
    expect(byText('Resume warm-up')).toBeTruthy()
    await press(byText('Resume warm-up'))
    expect(startedAt()).toEqual([0, 1])
  })

  it('never starts a second hold over the top of one the bar is holding', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    // Parked by a hold that ran out in a pocket, so the card is offering its button again — and
    // then a hold turns up anyway (the bar resumed the frozen one, a partner's round started).
    // Pressing the button must do nothing: two holds at once is the one state that logs a set
    // nobody did.
    await endHold({ seenLive: false })
    await rerender()
    const button = byText('Resume warm-up')
    expect(button).toBeTruthy()
    runningHold()
    await press(button)
    expect(startedAt()).toEqual([0])
    expect(mocks.startWork).toHaveBeenCalledTimes(1)
  })

  // The bar's own pause on this gap is the rest's pauseRest (the rest is held, not ended), so
  // this is a gap that ends some other way without its hand-over: stopRest.
  it('a gap between rounds stopped without its hand-over leaves the block waiting on the button', async () => {
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold(); await endHold(); await endHold()   // round one, then its 15 s rest
    expect(mocks.startRest).toHaveBeenCalledTimes(1)
    mocks.timer = null                                  // stopRest: the rest is gone, its hand-over with it
    await rerender()

    await press(byText('Resume warm-up'))
    expect(startedAt()).toEqual([0, 1, 2, 0])           // round two, from the top, on the tap
  })

  it('resumes at the movement the round is owed, not at the first with work left', async () => {
    // Half way through round one the first movement still has its round-two set. Picking the
    // block back up there would hold the same movement twice and never reach the third.
    await mount(warmup())
    await press(byText('Start warm-up'))
    await endHold({ seenLive: false })                  // parked after movement one
    await rerender()
    await press(byText('Resume warm-up'))
    expect(startedAt()).toEqual([0, 1])
  })

  it('puts the block and the session in one Layout menu, Flow at the top', async () => {
    await mount(warmup())
    await press(container.querySelector('button[aria-label="Workout options"]'))
    const items = menuItemsOf(lastMenu())
    // One row, not two: "Layout" is the whole question, and it reports what is on screen.
    expect(items.find(i => i.label === 'This block')).toBeUndefined()
    const layout = items.find(i => i.label === 'Layout')
    expect(layout.sub).toBe('Flow')

    await act(async () => { layout.onClick() })
    const choices = lastMenu()
    expect(choices.title).toBe('Layout')
    expect(choices.sections.map(g => g.title)).toEqual(['This block', 'Whole session'])
    expect(menuItemsOf(choices).map(i => i.label)).toEqual(['Flow', 'Rows', 'Automatic', 'Cards', 'List', 'Compact', 'Focus'])
    expect(menuItemsOf(choices).find(i => i.label === 'Automatic').on).toBe(true)

    // Choosing rows writes it against the superset's id — the one thing about the block that
    // survives an exercise being inserted above it.
    await act(async () => { menuItemsOf(choices).find(i => i.label === 'Rows').onClick() })
    expect(mocks.S.active.unitView).toEqual({ 'sg-warmup': 'rows' })
    // ... and Automatic clears it rather than storing a second opinion.
    await rerender()
    await press(container.querySelector('button[aria-label="Workout options"]'))
    const again = menuItemsOf(lastMenu()).find(i => i.label === 'Layout')
    expect(again.sub).toBe('Cards')                     // in rows now, following the session
    await act(async () => { again.onClick() })
    const back = lastMenu()
    await act(async () => { menuItemsOf(back).find(i => i.label === 'Automatic').onClick() })
    expect(mocks.S.active.unitView).toBeUndefined()
  })

  it('switching the whole session from that menu leaves the block alone', async () => {
    await mount(warmup())
    await press(container.querySelector('button[aria-label="Workout options"]'))
    await act(async () => { menuItemsOf(lastMenu()).find(i => i.label === 'Layout').onClick() })
    await act(async () => { menuItemsOf(lastMenu()).find(i => i.label === 'List').onClick() })
    expect(mocks.S.active.workoutView).toBe('list')
    expect(mocks.S.active.unitView).toBeUndefined()
    await rerender()
    expect(container.querySelector('[data-testid="flow-block"]')).toBeTruthy()
  })

  it('can be put back into a flow from the exercise it is in, whatever the marker is doing', async () => {
    // The bug this covers: the header ⋯ names "this block" as the one the MARKER is on, and the
    // marker advances by itself as you train. Once it reached a lone exercise that entry had no
    // block to name and vanished — and the flow card's own Rows button had gone with the card —
    // so a block switched to rows could not be switched back at all.
    const entries = [...warmup(), lifted('0042', null)]
    // List, where the whole session is on screen — the layout the bug is worst in, because the
    // marker has moved on while the block you want back is still sitting there in rows.
    await mount(entries, 3, { workoutView: 'list', unitView: { 'sg-warmup': 'rows' } })

    // The header's Layout offers no block group for a lone exercise, which is honest — there is
    // no block there — so it is the session's own rows and nothing else (in the List, v1.4.0's
    // Collapse switch among them).
    await press(container.querySelector('button[aria-label="Workout options"]'))
    await act(async () => { menuItemsOf(lastMenu()).find(i => i.label === 'Layout').onClick() })
    const sessionOnly = lastMenu()
    expect(sessionOnly.sections).toBeUndefined()
    expect(menuItemsOf(sessionOnly).map(i => i.label)).toEqual(['Cards', 'List', 'Compact', 'Focus', 'Collapse completed exercises'])

    // The warm-up's own exercises still carry it, and it names the block THEY are in. It sits
    // with the session's order and its supersets, the part of the menu that is about the block.
    const more = [...container.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'More')
    expect(more.length).toBeGreaterThan(0)
    await press(more[0])
    const order = lastMenu().sections.find(g => g.title === 'Order and supersets').items.filter(Boolean)
    const layout = order.find(i => i.label === 'Block layout')
    expect(layout).toBeTruthy()
    expect(layout.sub).toBe('List')                     // in rows, following the session layout

    await act(async () => { layout.onClick() })
    const choices = lastMenu()
    expect(choices.title).toBe('This block')
    await act(async () => { choices.items.find(i => i.label === 'Flow').onClick() })
    expect(mocks.S.active.unitView).toEqual({ 'sg-warmup': 'flow' })

    await rerender()
    expect(container.querySelector('[data-testid="flow-block"]')).toBeTruthy()
  })

  it("the card's Rows button shows rows — it does not open a menu", async () => {
    // It said Rows, was titled "Show rows", and opened the three-way Flow/Rows/Automatic sheet.
    // A settings decision does not belong on the screen you are standing on mid warm-up, having
    // tapped the word for the thing you wanted.
    await mount(warmup())
    expect(container.querySelector('[data-testid="flow-block"]')).toBeTruthy()
    mocks.menuSheet.mockClear()
    await press(byText('Rows'))
    expect(mocks.menuSheet).not.toHaveBeenCalled()
    expect(mocks.S.active.unitView).toEqual({ 'sg-warmup': 'rows' })
    await rerender()
    expect(container.querySelector('[data-testid="flow-block"]')).toBeNull()

    // ... and the ⋯ is the way back in, from any exercise in the block.
    const more = [...container.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'More')
    await press(more[0])
    const layout = menuItemsOf(lastMenu()).find(i => i.label === 'Block layout')
    expect(layout).toBeTruthy()
    await act(async () => { layout.onClick() })
    await act(async () => { lastMenu().items.find(i => i.label === 'Flow').onClick() })
    expect(mocks.S.active.unitView).toEqual({ 'sg-warmup': 'flow' })
    await rerender()
    expect(container.querySelector('[data-testid="flow-block"]')).toBeTruthy()
  })

  it('does not offer Flow to a block that could not run one', async () => {
    // A counted superset on a 60 s rest. If the menu offered Flow for ANY superset, taking it here
    // would render the flow card over a block nothing would drive: 0:00 on the clock, a Start that
    // hands a 10-rep set to a 45 second hold (startTimed's `|| 45`), and Cancel rather than Pause
    // on the bar, because flowUnitAt tests the shape and says no.
    await mount([lifted('0289', 'sg-acc'), lifted('0652', 'sg-acc')])
    await press(container.querySelector('button[aria-label="Workout options"]'))
    await act(async () => { menuItemsOf(lastMenu()).find(i => i.label === 'Layout').onClick() })
    const choices = lastMenu()
    expect(choices.sections).toBeUndefined()
    expect(menuItemsOf(choices).map(i => i.label)).toEqual(['Cards', 'List', 'Compact', 'Focus'])
    // The exercise's own ⋯ agrees — it is the same three rows.
    const more = [...container.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'More')
    await press(more[0])
    expect(menuItemsOf(lastMenu()).find(i => i.label === 'Block layout')).toBeUndefined()
  })

  it('a stale flow choice on a counted block renders rows, and can be cleared', async () => {
    // A Flow choice stored on a block that cannot run one (a synced or hand-edited state). The
    // screen must not honour it — but the menu must still offer the way out.
    await mount([lifted('0289', 'sg-acc'), lifted('0652', 'sg-acc')], 0, { unitView: { 'sg-acc': 'flow' } })
    expect(container.querySelector('[data-testid="flow-block"]')).toBeNull()
    await press(container.querySelector('button[aria-label="Workout options"]'))
    await act(async () => { menuItemsOf(lastMenu()).find(i => i.label === 'Layout').onClick() })
    const choices = lastMenu()
    expect(choices.sections.map(g => g.title)).toEqual(['This block', 'Whole session'])
    await act(async () => { menuItemsOf(choices).find(i => i.label === 'Automatic').onClick() })
    expect(mocks.S.active.unitView).toBeUndefined()
  })

  // The card a swipe slides in is the card that lands (Workout.jsx renderPreview). A flow block
  // slides in as the flow card, so nothing changes shape the moment it snaps into place.
  // With finished exercises skipped, the swipe lands past the neighbour, and what slides in is the
  // unit it lands on: a finished warm-up next door is not the card that slides in.
  it('slides in the unit the swipe lands on when finished exercises are skipped', async () => {
    const done = warmup().map(e => ({ ...e, sets: e.sets.map(x => ({ ...x, done: true })) }))
    await mount([lifted('0042', null), ...done, lifted('0289', null)], 0, {})
    mocks.S = { ...mocks.S, skipCompleted: true }
    await rerender()
    const { preview, release } = await swipeHalfway()
    expect(preview.querySelector('[data-testid="flow-block"]')).toBe(null)
    expect(preview.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
    await release()
  })

  it('slides a neighbouring flow block in as the flow card it lands as', async () => {
    // Part way through its first round, so the card has a movement held and one up next to show.
    const entries = [lifted('0042', null), ...warmup()]
    entries[1].sets[0].done = true
    await mount(entries)
    const { preview, land } = await swipeHalfway()
    expect(preview).toBeTruthy()
    expect(preview.querySelector('[data-testid="flow-block"]')).toBeTruthy()
    expect(preview.querySelectorAll('[role="checkbox"]').length).toBe(0)
    expect(preview.textContent).toContain('Round 1 of 2')
    const slidIn = preview.innerHTML
    const landed = await land()
    expect(mocks.S.active.cur).toBe(1)
    expect(landed.innerHTML).toBe(slidIn)                // the same card, to the markup
  })

  it('slides a flow-shaped block put back into rows in as its rows', async () => {
    await mount([lifted('0042', null), ...warmup()], 0, { unitView: { 'sg-warmup': 'rows' } })
    const { preview, release } = await swipeHalfway()
    expect(preview.querySelector('[data-testid="flow-block"]')).toBe(null)
    expect(preview.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
    await release()
  })

  it('has no block group to offer a lone exercise', async () => {
    await mount([lifted('0042', null)])
    await press(container.querySelector('button[aria-label="Workout options"]'))
    const items = menuItemsOf(lastMenu())
    expect(items.find(i => i.label === 'This block')).toBeUndefined()
    await act(async () => { items.find(i => i.label === 'Layout').onClick() })
    const choices = lastMenu()
    expect(choices.sections).toBeUndefined()
    expect(menuItemsOf(choices).map(i => i.label)).toEqual(['Cards', 'List', 'Compact', 'Focus'])
  })
})

// v1.4.0's Focus view shows one exercise at a time and steps on as its sets are ticked (its own
// onProgress). A warm-up there is its rows, as v1.4.0 shows it, and nothing runs by itself: a
// chained hold would start a movement the view is not showing, and the view would step on top of
// the chain.
describe('the Focus view', () => {
  it('shows a warm-up as its rows, with no flow card and no block choice in the Layout menu', async () => {
    await mount(warmup(), 0, { workoutView: 'focus' })
    expect(container.querySelector('[data-testid="flow-block"]')).toBe(null)
    expect(byText('Start warm-up')).toBeUndefined()
    expect(container.querySelector('button[aria-label="Start set"]')).toBeTruthy()
    await press(container.querySelector('button[aria-label="Workout options"]'))
    const layout = menuItemsOf(lastMenu()).find(i => i.label === 'Layout')
    expect(layout.sub).toBe('Focus')
    await act(async () => { layout.onClick() })
    expect(lastMenu().sections).toBeUndefined()
    expect(menuItemsOf(lastMenu()).map(i => i.label)).toEqual(['Cards', 'List', 'Compact', 'Focus'])
  })

  it('a hold that ends starts no next movement, and a round\'s rest hands over nothing', async () => {
    await mount(warmup(), 0, { workoutView: 'focus' })
    await press(container.querySelector('button[aria-label="Start set"]'))
    expect(startedAt()).toEqual([0])
    await endHold()
    expect(startedAt()).toEqual([0])
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    // The round's rest a flow block would ride carries nothing here, and playing a flow rest's end
    // anyway (a rest armed in Cards before the switch to Focus) starts nothing either.
    await act(async () => { mocks.restHandOver({ forIdx: 2, kind: 'round', flow: 'sg-warmup' }) })
    expect(startedAt()).toEqual([0])
  })
})

// The List layout's "Collapse completed exercises" (v1.4.0): a finished flow block folds away like
// any finished unit, and a tap on its line opens it again.
describe('a finished flow block in the List with collapse on', () => {
  it('folds away to its summary line once the marker has moved on', async () => {
    const done = warmup().map(e => ({ ...e, sets: e.sets.map(x => ({ ...x, done: true })) }))
    await mount([...done, lifted('0042', null)], 3, { workoutView: 'list', collapseCompleted: true })
    expect(container.querySelector('[data-testid="flow-block"]')).toBe(null)
    const summary = container.querySelector('section[data-exidx="0"] .wl-summary')
    expect(summary).toBeTruthy()
    await press(summary)
    expect(container.querySelector('section[data-exidx="0"] [data-testid="flow-block"]')).toBeTruthy()
  })
})

// Editing a saved workout and logging a past one: the sets were done on another day, so a warm-up
// shows its set rows like any other block. Shown in either, the flow card's Start would do nothing
// in the editor, and in a past workout it would run live holds, chained and counted in, for a
// session that was over.
describe('a workout that is not happening now', () => {
  const EDITING = { editingWorkoutId: 'w-saved', d: '2026-10-01' }
  const PAST = { backfill: { durationMin: 60, replaceId: null }, d: '2026-10-01' }

  for (const [what, flags] of [['editing a saved workout', EDITING], ['logging a past workout', PAST]]) {
    it(`shows a warm-up as plain set rows while ${what}`, async () => {
      await mount(warmup(), 0, flags)
      expect(container.querySelector('[data-testid="flow-block"]')).toBe(null)
      expect(container.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
      expect(byText('Start warm-up')).toBeUndefined()
    })

    // ... and a swipe slides it in as those rows, the way it lands.
    it(`slides a neighbouring warm-up in as set rows while ${what}`, async () => {
      await mount([lifted('0042', null), ...warmup()], 0, flags)
      const { preview, release } = await swipeHalfway()
      expect(preview.querySelector('[data-testid="flow-block"]')).toBe(null)
      expect(preview.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0)
      await release()
    })

    // There is no flow to choose, so neither menu offers the choice: the same as a block that
    // could not run one (blockLayoutItems).
    it(`offers no block layout while ${what}`, async () => {
      await mount(warmup(), 0, flags)
      await press(container.querySelector('button[aria-label="Workout options"]'))
      const layout = menuItemsOf(lastMenu()).find(i => i.label === 'Layout')
      expect(layout.sub).toBe('Cards')
      await act(async () => { layout.onClick() })
      expect(lastMenu().sections).toBeUndefined()
      expect(menuItemsOf(lastMenu()).map(i => i.label)).toEqual(['Cards', 'List', 'Compact', 'Focus'])
      const more = [...container.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === 'More')
      expect(more.length).toBeGreaterThan(0)
      await press(more[0])
      expect(menuItemsOf(lastMenu()).find(i => i.label === 'Block layout')).toBeUndefined()
    })
  }

  // A past workout keeps the hold button every timed row has there (counting a hold is one way to
  // enter its duration). In a warm-up it is an ordinary hold: no get-ready count, overtime as
  // Settings has it, and nothing starts the next movement when it ends.
  it('times a hold in a past workout on its own: no get-ready count, no next hold', async () => {
    await mount(warmup(), 0, PAST)
    mocks.S = { ...mocks.S, flowGetReady: 5 }
    await rerender()
    await press(container.querySelector('[data-exidx="0"] .setrow .setgo'))
    expect(startedAt()).toEqual([0])
    expect(mocks.startWork.mock.calls[0][4]).toEqual({ noOvertime: false, prep: 0 })
    await endHold()
    expect(mocks.S.active.entries[0].sets[0].done).toBe(true)
    expect(startedAt()).toEqual([0])
  })
})
