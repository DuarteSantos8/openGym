// @vitest-environment happy-dom
// The get-ready count before each flow hold (Settings → Get ready before each hold), on the real
// Workout screen with real stores and timers: a warm-up of three timed movements twice over, 35 s
// holds, a 15 s round rest, a 5 s count.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Only the sounds are silenced: the rest of lib/sound.js is the real thing.
vi.mock('../lib/sound.js', async importOriginal => ({
  ...(await importOriginal()),
  beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), countOver: vi.fn(),
  countdown: vi.fn(), countdownTo: vi.fn(), hush: vi.fn(), holdSession: vi.fn(),
}))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))

import Workout from './Workout.jsx'
import RestTimer from '../components/RestTimer.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const held = (id, rounds, sec = 35) => ({ id, sg: 'sg-w', target: { mode: 'time', sets: rounds, sec, restSec: 15 }, sets: Array.from({ length: rounds }, () => ({ sec, w: 0, done: false })) })
const lifted = id => ({ id, target: { sets: 2, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }] })
const warmup = () => [held('1368', 2), held('1460', 2), held('1428', 2), lifted('1001')]

let root, container, starts, REAL
const setHidden = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
function render(entries, extraS = {}) {
  const S = clone(DEF)
  Object.assign(S, { sound: true, flowGetReady: 5, restSec: 90 }, extraS)
  S.active = { id: 'p', d: '2026-09-29', start: Date.now(), routineId: null, name: 'W', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /><RestTimer /></MemoryRouter>))
}
const btn = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase().startsWith(text.toLowerCase()))
const click = el => { expect(el).toBeTruthy(); act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const tick = ms => act(() => { vi.advanceTimersByTime(ms) })
const space = () => { const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }); act(() => { document.body.dispatchEvent(ev) }); return ev }
const w = () => useUI.getState().work
const sets = () => useStore.getState().S.active.entries.slice(0, 3).map(e => e.sets.map(s => (s.done ? 'x' : '.') + s.sec).join(','))

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  REAL = REAL || useUI.getState().startWork
  const real = REAL
  starts = []
  useUI.setState({ startWork: (...a) => { starts.push({ t: Date.now(), forIdx: a[3]?.idx, i: a[3]?.i, opts: a[4] }); return real(...a) } })
})
afterEach(() => {
  if (root) act(() => root.unmount()); container?.remove()
  setHidden(false)
  useUI.getState().stopRest(); useUI.getState().stopWork(); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks()
})

// The whole warm-up is 260 seconds of the real Workout screen ticking, a few seconds of work on a
// slow machine, so this has more time than the default 5 s.
describe('a flow block with a get-ready count', { timeout: 20000 }, () => {
  it('runs the whole warm-up: one hold per movement, a count before each, 35 s logged each', () => {
    render(warmup())
    const t0 = Date.now()
    click(btn('Start warm-up'))
    expect(w()).toMatchObject({ prep: 5, owner: { idx: 0 } })
    expect(container.querySelector('#timer .lbl')?.textContent).toBe('Get ready')
    for (let s = 0; s < 260; s++) tick(1000)
    // 5 s count + 35 s hold per movement; the round's 15 s rest, then a count again
    expect(starts.map(x => [(x.t - t0) / 1000, x.forIdx, x.opts.prep])).toEqual([[0, 0, 5], [40, 1, 5], [80, 2, 5], [135, 0, 5], [175, 1, 5], [215, 2, 5]])
    expect(sets()).toEqual(['x35,x35', 'x35,x35', 'x35,x35'])
  })

  it('ticking the held row during the count logs the plan, not a one-second hold', () => {
    render(warmup())
    click(btn('Start warm-up'))
    tick(1000)
    click(btn('Rows'))
    tick(1000)
    click(container.querySelector('.setrow .chk'))
    expect(sets()[0]).toBe('x35,.35')
    expect(w()).toBe(null)
  })

  it('Space during the count starts the hold, running or paused, as the bar\'s Start does', () => {
    render(warmup())
    click(btn('Start warm-up'))
    tick(2000)
    expect(space().defaultPrevented).toBe(true)
    expect(w().prep).toBeUndefined()
    expect(w().left).toBe(35)
    // the next movement's count, paused, then the key
    tick(35000)
    expect(w()).toMatchObject({ owner: { idx: 1 }, prep: 5 })
    click(container.querySelector('#timer .pause'))
    tick(1000)
    space()
    expect(w()).toMatchObject({ owner: { idx: 1 }, paused: false, left: 35 })
    expect(w().prep).toBeUndefined()
  })

  it('a count and hold that both ran out in a pocket park the block', () => {
    render(warmup())
    click(btn('Start warm-up'))
    tick(40000)
    expect(w()).toMatchObject({ owner: { idx: 1 }, prep: 5 })
    setHidden(true)
    tick(60000)
    setHidden(false)
    tick(3000)
    expect(w()).toBe(null)
    expect(sets()).toEqual(['x35,.35', 'x35,.35', '.35,.35'])
    expect(btn('Resume warm-up')).toBeTruthy()
  })

  // Per-side holds in a flow: a side stretch is a left row and a right row per set. With a count
  // set, the count is the turn-over between the two sides; with it Off, the 10 s switch-sides
  // pause stays and hands over to the other side when it ends.
  const sided = (id, rounds, sec = 30) => ({ id, sg: 'sg-w', target: { mode: 'time', sets: rounds, sec, restSec: 15, side: true },
    sets: Array.from({ length: rounds }, () => [{ sec, w: 0, side: 'L', done: false }, { sec, w: 0, side: 'R', done: false }]).flat() })
  const withSides = () => [held('1368', 2), sided('1460', 2), held('1428', 2), lifted('1001')]
  const timeline = t0 => starts.map(x => [(x.t - t0) / 1000, x.forIdx, x.i])

  it('a side stretch with the count on: the count stands in for the switch pause', () => {
    render(withSides())
    const t0 = Date.now()
    click(btn('Start warm-up'))
    expect(container.textContent).toContain('Round 1 of 2')
    for (let s = 0; s < 120; s++) tick(1000)
    // 5 + 35, then the left side 5 + 30, the right side 5 + 30 with no pause between, then on
    expect(timeline(t0)).toEqual([[0, 0, 0], [40, 1, 0], [75, 1, 1], [110, 2, 0]])
    expect(useUI.getState().timer).toBe(null)
  })

  it('a side stretch with the count off: the switch pause stays and hands over', () => {
    render(withSides(), { flowGetReady: 0 })
    const t0 = Date.now()
    click(btn('Start warm-up'))
    for (let s = 0; s < 36; s++) tick(1000)
    for (let s = 0; s < 30; s++) tick(1000)
    expect(useUI.getState().timer).toMatchObject({ kind: 'switch', forIdx: 1 })
    expect(container.querySelector('.flowblk-now .muted')?.textContent).toBe('Switch sides')
    for (let s = 0; s < 80; s++) tick(1000)
    expect(timeline(t0)).toEqual([[0, 0, 0], [35, 1, 0], [75, 1, 1], [105, 2, 0]])
    expect(sets()).toEqual(['x35,.35', 'x30,x30,.30,.30', 'x35,.35'])
  })

  it('Off asks for no count', () => {
    render(warmup(), { flowGetReady: 0 })
    click(btn('Start warm-up'))
    expect(w().prep).toBeUndefined()
    expect(starts[0].opts.prep).toBe(0)
  })

  it('a stored value Settings does not offer reads as Off, as Settings shows it', () => {
    render(warmup(), { flowGetReady: 7 })
    click(btn('Start warm-up'))
    expect(starts[0].opts.prep).toBe(0)
  })
})
