// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS
const mount = () => act(() => root.render(<RestTimer />))
const label = () => host.querySelector('#timer .lbl')?.textContent

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  const S = JSON.parse(JSON.stringify(DEF))
  S.active = { id: 'a', name: 'Test', start: Date.now(), cur: 0, entries: [
    { id: '0025', target: { sets: 3, reps: 5 }, sets: [{ w: 60, r: 5, done: false }] },
  ] }
  useStore.setState({ S })
  useUI.setState({ timer: null, work: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useStore.setState({ S: originalS })
  vi.useRealTimers()
})

// The label under the clock says what the rest leads into, and names no exercise: it is only as
// wide as the clock.
describe('rest timer bar: what it is timing', () => {
  it('says what the rest leads into instead of Rest', () => {
    act(() => { useUI.getState().startRest(90, 0, { kind: 'set' }) })
    mount()
    expect(label()).toBe('Set')
    expect(host.querySelector('#timer .t').textContent).toBe('1:30')
    act(() => { useUI.getState().startRest(90, 0, { kind: 'round' }) })
    expect(label()).toBe('Round')
    act(() => { useUI.getState().startRest(90, 0, { kind: 'block' }) })
    expect(label()).toBe('Exercise')
  })

  it('says Warm-up for a rest before a warm-up set, decided where the rest started', () => {
    act(() => { useUI.getState().startRest(45, 0, { kind: 'set', phase: 'warmup' }) })   // after ramp set 1
    mount()
    expect(label()).toBe('Warm-up')
    act(() => { useUI.getState().startRest(150, 0, { kind: 'set', phase: 'work' }) })    // after the last ramp set
    expect(label()).toBe('Set')
    act(() => { useUI.getState().startRest(90, 0, { kind: 'round', phase: 'warmup' }) })  // rounds do not say it
    expect(label()).toBe('Round')
  })

  // The column under the clock takes the width of the widest word a rest can say, laid out in a
  // hidden line (index.css #timer .lbl-alts): every one of them is there, whatever the rest is.
  it('keeps every word a rest can say in the hidden line that sizes the label', () => {
    act(() => { useUI.getState().startRest(90, 0, { kind: 'set' }) })
    mount()
    const alts = host.querySelector('#timer .lbl-alts')
    expect(alts.getAttribute('aria-hidden')).toBe('true')
    expect([...alts.children].map(s => s.textContent)).toEqual(['Set', 'Round', 'Exercise', 'Warm-up', 'Rest', 'Paused'])
  })

  it('a rest without a kind just says Rest', () => {
    act(() => { useUI.getState().startRest(60) })
    mount()
    expect(label()).toBe('Rest')
  })

  it('Paused and Switch sides still win', () => {
    act(() => { useUI.getState().startRest(90, 0, { kind: 'block' }) })
    mount()
    act(() => { useUI.getState().pauseRest() })
    expect(label()).toBe('Paused')
    act(() => { useUI.getState().startRest(10, 0, { kind: 'switch' }) })
    expect(label()).toBe('Switch sides')
  })

  it('keeps saying it on Ready', () => {
    act(() => { useUI.getState().startRest(1, 0, { kind: 'round' }) })
    mount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(label()).toBe('Round')
  })

  it('a hold says which hold of the exercise it is, warm-up holds apart, a per-side pair as one set', () => {
    const S = useStore.getState().S
    useStore.setState({ S: { ...S, active: { ...S.active, entries: [
      { id: 'plank', target: { mode: 'time', sec: 45 }, sets: [{ sec: 20, phase: 'warmup' }, { sec: 45 }, { sec: 45 }, { sec: 45 }] },
      { id: 'side-plank', target: { mode: 'time', sec: 30 }, sets: [{ sec: 30, side: 'L' }, { sec: 30, side: 'R' }, { sec: 30, side: 'L' }, { sec: 30, side: 'R' }] },
    ] } } })
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn(), { idx: 0, i: 2, id: 'plank' }) })
    mount()
    expect(host.querySelector('#timer').className).toBe('working')
    expect(label()).toBe('Hold 2 of 3')
    act(() => { useUI.getState().startWork(20, 'Plank', vi.fn(), { idx: 0, i: 0, id: 'plank' }) })
    expect(label()).toBe('Warm-up hold 1 of 1')
    act(() => { useUI.getState().startWork(30, 'Side plank', vi.fn(), { idx: 1, i: 3, id: 'side-plank' }) })
    expect(label()).toBe('Hold 2 of 2')
  })

  it('a hold with no row of its own, or one whose row is gone, just says Hold', () => {
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn()) })
    mount()
    expect(label()).toBe('Hold')
    act(() => { useUI.getState().startWork(45, 'Plank', vi.fn(), { idx: 0, i: 0, id: 'not-this-exercise' }) })
    expect(label()).toBe('Hold')
  })

  it('Skip ends the rest early and hands over, like the rest running out on screen', () => {
    const done = vi.fn()
    useUI.getState().bindRest(done)
    act(() => { useUI.getState().startRest(90, 0, { kind: 'set', chain: { id: '0025', i: 0, n: 1, cur: 0 } }) })
    mount()
    act(() => { host.querySelector('#timer .acts .skip').click() })
    expect(useUI.getState().timer).toBe(null)
    expect(done).toHaveBeenCalledTimes(1)
    useUI.getState().bindRest(null)
  })

  it('renders nothing and drops the resting class when no timer runs', () => {
    act(() => { useUI.getState().startRest(60, 0, { kind: 'set' }) })
    mount()
    expect(document.body.classList.contains('resting')).toBe(true)
    act(() => { useUI.getState().stopRest() })
    mount()
    expect(host.querySelector('#timer')).toBeNull()
    expect(document.body.classList.contains('resting')).toBe(false)
  })
})

// A flow block (lib/blocks.js: timed movements in one superset on a rest of 20 s or less) runs
// itself from one tap, so this bar — the only control fixed on screen while it does — is where
// stopping it lives. The block's own card deliberately shows no controls while a countdown runs.
describe('the bar for a block that runs itself', () => {
  const BENCH = '0025'
  const flowSession = () => {
    const held = (id, sg) => ({ id, sg, target: { mode: 'time', sets: 2, sec: 35, restSec: 15 }, sets: [{ sec: 35, done: false }, { sec: 35, done: false }] })
    const S = JSON.parse(JSON.stringify(useStore.getState().S))
    S.active.entries = [held('1368', 'sg-warmup'), held('1460', 'sg-warmup'), { id: BENCH, target: { sets: 3, reps: 5, restSec: 90 }, sets: [{ w: 60, r: 5, done: false }] }]
    useStore.setState({ S })
  }
  // The docked bar's buttons by what they are: the rest's pause is an icon, Skip carries hidden
  // copies of both its labels, so their text says nothing. In a flow, Done carries hidden copies
  // too: it is read by the one showing.
  const acts = () => [...host.querySelectorAll('#timer .acts > *')].map(b =>
    b.classList.contains('pause') ? 'pause' : b.classList.contains('pause-slot') ? 'slot' : b.classList.contains('skip') ? 'skip'
      : b.classList.contains('adj') ? 'adj' : (b.querySelector('.on') || b).textContent.trim())
  const pauseBtn = () => host.querySelector('#timer .acts .pause')

  it('offers the pause instead of Cancel while a flow hold runs, and Resume once it is frozen', () => {
    flowSession()
    act(() => { useUI.getState().startWork(45, 'Jog', vi.fn(), { idx: 0, i: 0, id: '1368' }) })
    mount()
    expect(acts()).toEqual(['pause', 'Done'])
    expect(pauseBtn().getAttribute('aria-label')).toBe('Pause')

    act(() => { pauseBtn().click() })
    expect(useUI.getState().work.paused).toBe(true)
    expect(acts()).toEqual(['pause', 'Done'])
    expect(pauseBtn().getAttribute('aria-label')).toBe('Resume')
    expect(pauseBtn().getAttribute('aria-pressed')).toBe('true')
    expect(label()).toBe('Paused')
    expect(host.querySelector('#timer').classList.contains('paused')).toBe(true)
    // The seconds are kept, so Done still logs what was really held rather than the full plan.
    act(() => { pauseBtn().click() })
    expect(useUI.getState().work.paused).toBe(false)
  })

  // The card's Rows button stays live during a pause, and the bar must not then trade the frozen
  // hold's Resume for Cancel, which would leave Done or Cancel as the only ways out.
  it('keeps Resume for a frozen hold whose block was put back into rows meanwhile', () => {
    flowSession()
    act(() => { useUI.getState().startWork(45, 'Jog', vi.fn(), { idx: 0, i: 0, id: '1368' }) })
    mount()
    act(() => { pauseBtn().click() })
    const S = JSON.parse(JSON.stringify(useStore.getState().S))
    S.active.unitView = { 'sg-warmup': 'rows' }
    act(() => { useStore.setState({ S }) })
    expect(acts()).toEqual(['pause', 'Done'])
    expect(pauseBtn().getAttribute('aria-label')).toBe('Resume')
    act(() => { pauseBtn().click() })
    expect(useUI.getState().work.paused).toBe(false)
    // Running again outside a flow, it is an ordinary hold with its Cancel.
    expect(acts()).toEqual(['Cancel', 'Done'])
  })

  it('leaves an ordinary hold its Cancel — nothing carries on by itself there', () => {
    flowSession()
    act(() => { useUI.getState().startWork(45, 'Bench', vi.fn(), { idx: 2, i: 0, id: BENCH }) })   // the lone barbell lift
    mount()
    expect(acts()).toEqual(['Cancel', 'Done'])
  })

  it('drops ±15 s on a flow block\'s gap between rounds, and keeps the pause and Skip', () => {
    flowSession()
    act(() => { useUI.getState().startRest(15, 1, { kind: 'round' }) })
    mount()
    // On a 10-15 s gap, -15 s is a skip and +15 s is a doubling; neither is an adjustment. The
    // pause is the one every rest has, in the same place as the hold's.
    expect(acts()).toEqual(['pause', 'skip'])
    act(() => { pauseBtn().click() })
    expect(useUI.getState().timer.paused).toBe(true)   // the gap is held, not ended
  })

  it('keeps ±15 s on an ordinary rest', () => {
    flowSession()
    act(() => { useUI.getState().startRest(90, 2, { kind: 'set' }) })
    mount()
    expect(acts()).toEqual(['adj', 'adj', 'pause', 'skip'])
  })

  it('does not call a rest a flow when the user has put that block back into rows', () => {
    flowSession()
    const S = JSON.parse(JSON.stringify(useStore.getState().S))
    S.active.unitView = { 'sg-warmup': 'rows' }
    useStore.setState({ S })
    act(() => { useUI.getState().startWork(45, 'Jog', vi.fn(), { idx: 0, i: 0, id: '1368' }) })
    mount()
    expect(acts()).toEqual(['Cancel', 'Done'])
  })

  // A past workout being logged shows its warm-up as rows, and a hold timed from one of them is an
  // ordinary hold.
  it('does not call a hold a flow in a past workout being logged', () => {
    flowSession()
    const S = JSON.parse(JSON.stringify(useStore.getState().S))
    S.active.backfill = { durationMin: 60, replaceId: null }
    useStore.setState({ S })
    act(() => { useUI.getState().startWork(45, 'Jog', vi.fn(), { idx: 0, i: 0, id: '1368' }) })
    mount()
    expect(acts()).toEqual(['Cancel', 'Done'])
  })

  // The get-ready count in front of a flow hold: the bar says so, counts it, and its button starts
  // the hold now rather than logging one (there is nothing held yet).
  it('in a get-ready count, says Get ready, counts it, and offers Start instead of Done', () => {
    flowSession()
    useUI.setState({ work: { owner: { idx: 0, i: 0, id: '1368' }, left: 30, total: 30, prep: 3, prepTotal: 5, paused: false, label: 'Pigeon' } })
    mount()
    expect(label()).toBe('Get ready')
    expect(host.querySelector('#timer .t')?.textContent).toBe('0:03')
    const go = host.querySelector('#timer .go')
    expect((go?.querySelector('.on') || go)?.textContent).toBe('Start')
  })

  // The pause stays put through a flow. The row is right-aligned, and the word beside the pause
  // changed width from state to state: in WebKit the pause moved 11 px in English between a hold
  // and the gap, and up to 47 px on a 320 px phone. The button beside it now carries the same four
  // words in every state, the one in use showing (* below), and both buttons are sized alike
  // (index.css, #timer .acts .flow-words and .go.flow), so it is one width throughout.
  it('gives the button beside the pause the same four words in a get-ready count, a hold and the gap', () => {
    flowSession()
    const words = btn => [...host.querySelectorAll(`#timer .acts .${btn} > .flow-words > span`)]
      .map(s => (s.classList.contains('on') ? '*' : '') + s.textContent)
    useUI.setState({ work: { owner: { idx: 0, i: 0, id: '1368' }, left: 30, total: 30, prep: 3, prepTotal: 5, paused: false, label: 'Pigeon' } })
    mount()
    expect(words('go')).toEqual(['*Start', 'Done', 'Skip', 'Dismiss'])
    expect(host.querySelector('#timer .go').classList.contains('flow')).toBe(true)
    act(() => { useUI.setState({ work: { ...useUI.getState().work, prep: 0 } }) })
    expect(acts()).toEqual(['pause', 'Done'])
    expect(words('go')).toEqual(['Start', '*Done', 'Skip', 'Dismiss'])
    act(() => { useUI.setState({ work: null }); useUI.getState().startRest(15, 1, { kind: 'round' }) })
    expect(acts()).toEqual(['pause', 'skip'])
    expect(words('skip')).toEqual(['Start', 'Done', '*Skip', 'Dismiss'])
    expect(host.querySelector('#timer .skip').classList.contains('flow')).toBe(true)
    act(() => { vi.advanceTimersByTime(15000) })
    expect(words('skip')).toEqual(['Start', 'Done', 'Skip', '*Dismiss'])
    // Only the word in use is read out.
    expect([...host.querySelectorAll('#timer .skip > .flow-words > .off')].every(s => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('keeps the ordinary hold\'s Done and rest\'s Skip as they were', () => {
    flowSession()
    act(() => { useUI.getState().startWork(45, 'Bench', vi.fn(), { idx: 2, i: 0, id: BENCH }) })
    mount()
    expect(host.querySelector('#timer .go .flow-words')).toBeNull()
    expect(host.querySelector('#timer .go').classList.contains('flow')).toBe(false)
    act(() => { useUI.getState().stopWork(); useUI.getState().startRest(90, 2, { kind: 'set' }) })
    expect(host.querySelector('#timer .skip .flow-words')).toBeNull()
    expect(host.querySelector('#timer .skip').classList.contains('flow')).toBe(false)
  })
})
