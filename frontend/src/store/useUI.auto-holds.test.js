// @vitest-environment happy-dom
// Timed holds that run themselves (lib/auto-holds.js): the clocks. Rest over, 3-2-1, the hold, its
// set logged with the planned time, the rest, round again; Pause, Restart, Stop auto, an early
// Done, a sheet in the way, and a phone that was locked through all of it (timestamps, not ticks).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
const { beep, chime, vibrate } = vi.hoisted(() => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep, chime, vibrate, alertBuzz: vi.fn() }))

import { useUI, bindAuto } from './useUI.js'
import { useStore } from './useStore.js'
import { nextAutoHold } from '../lib/auto-holds.js'

const REST = 60
const hold = (sec, extra = {}) => ({ sec, done: false, ...extra })
const sets = () => useStore.getState().S.active.entries[0].sets
const isTimed = idx => useStore.getState().S.active.entries[idx]?.target?.mode === 'time'

// The workout screen's tick, cut down to what the chain leans on (views/Workout.jsx holdDone and
// toggle): the set is logged, its rest starts (a switch pause between two sides), a rest heard of
// late is moved back to when the hold ended, and with no rest the next hold counts in at once.
const logs = []
const done = (owner, elapsed, { abandoned = false, endedAt = null } = {}) => {
  logs.push({ i: owner.i, elapsed, abandoned })
  if (abandoned) return
  const late = endedAt && Date.now() - endedAt > 1000 ? endedAt : null
  const before = useUI.getState().timer
  useStore.getState().update(s => { const st = s.active.entries[owner.idx].sets[owner.i]; st.sec = elapsed; st.done = true; st.at = late || Date.now() }, true)
  const rows = sets()
  const partner = rows[owner.i].side === 'L' && rows[owner.i + 1]?.side === 'R' && !rows[owner.i + 1].done
  const rest = useStore.getState().S.restSec
  if (rows.some(r => !r.done) && rest > 0) useUI.getState().startRest(partner ? 10 : rest, owner.idx, { forSet: owner.i, ...(partner ? { kind: 'switch' } : {}) })
  const now = useUI.getState().timer
  if (now && now !== before && !now.ready) { if (late) useUI.getState().backdateRest(late); return }
  useUI.getState().autoAfterHold(late || Date.now())
}
const hooks = {
  peek: () => { const n = nextAutoHold(useStore.getState().S, isTimed); return n && { ...n, label: 'Plank' } },
  focus: vi.fn(),
  startHold: (owner, startedAt) => useUI.getState().startWork(owner.plan, 'Plank', (e, o) => done(owner, e, o), { idx: owner.idx, i: owner.i, id: owner.id }, { startedAt, auto: true }),
  forecast: () => [],
  stop: vi.fn(() => useStore.getState().update(s => { s.active.autoHoldsOff = true }, true)),
}

describe('timed holds that run themselves', () => {
  let original, unbind
  const start = (rows, extra = {}) => {
    useStore.setState({ S: { ...original.S, sound: true, autoHolds: true, restSec: REST, active: { id: 'w', cur: 0, entries: [{ id: 'plank', target: { mode: 'time' }, sets: rows }] }, ...extra } })
  }
  beforeEach(() => {
    vi.useFakeTimers()
    original = { S: useStore.getState().S }
    useUI.setState({ timer: null, work: null, countIn: null, autoSay: '', sheets: [], toastMsg: '' })
    logs.length = 0
    beep.mockClear(); vibrate.mockClear(); hooks.stop.mockClear(); hooks.focus.mockClear()
    unbind = bindAuto(hooks)
  })
  afterEach(() => {
    unbind()
    useUI.getState().stopCountIn()
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    useStore.setState(original)
    vi.useRealTimers()
  })

  it('counts in when the rest ends, holds, logs the planned time, rests, and goes round again', () => {
    start([hold(30, { done: true }), hold(30), hold(30)])
    useUI.getState().startRest(REST, 0, { forSet: 0 })
    expect(useUI.getState().timer.autoNext).toBe('Plank')
    vi.advanceTimersByTime(REST * 1000)
    // No Ready: the count-in is next, and it says 3 with a beep and a buzz.
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().countIn).toMatchObject({ left: 3, owner: { idx: 0, i: 1 } })
    expect(beep).toHaveBeenLastCalledWith(true, 660, 0.12)
    expect(vibrate).toHaveBeenCalled()
    expect(useUI.getState().autoSay).toBe('3')
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().countIn.left).toBe(2)
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().countIn).toBeNull()
    expect(useUI.getState().autoSay).toBe('Go!')
    expect(useUI.getState().work).toMatchObject({ total: 30, auto: true, owner: { idx: 0, i: 1 } })
    vi.advanceTimersByTime(30_000)
    expect(useUI.getState().work).toBeNull()
    expect(sets()[1]).toMatchObject({ done: true, sec: 30 })
    expect(useUI.getState().timer).toMatchObject({ total: REST, autoNext: 'Plank' })
    vi.advanceTimersByTime(REST * 1000)
    expect(useUI.getState().countIn).toMatchObject({ owner: { i: 2 } })
  })

  it('pauses and resumes the count-in, the hold and the rest, and paused time is not held time', () => {
    start([hold(30, { done: true }), hold(30), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime(REST * 1000 + 1000)
    useUI.getState().pauseAuto()
    expect(useUI.getState().countIn).toMatchObject({ paused: true, left: 2 })
    vi.advanceTimersByTime(60_000)
    expect(useUI.getState().work).toBeNull()
    useUI.getState().resumeAuto()
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().work).toMatchObject({ total: 30 })
    vi.advanceTimersByTime(10_000)
    useUI.getState().pauseAuto()
    expect(useUI.getState().work).toMatchObject({ paused: true, left: 20 })
    vi.advanceTimersByTime(5 * 60_000)
    expect(useUI.getState().work).not.toBeNull()
    useUI.getState().resumeAuto()
    vi.advanceTimersByTime(20_000)
    expect(sets()[1]).toMatchObject({ done: true, sec: 30 })
    useUI.getState().pauseAuto()
    expect(useUI.getState().timer).toMatchObject({ paused: true })
    useUI.getState().resumeAuto()
    expect(useUI.getState().timer.paused).toBeFalsy()
  })

  it('restarts a hold from its count-in, logging nothing for the try it drops', () => {
    start([hold(30, { done: true }), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime((REST + 3) * 1000)
    vi.advanceTimersByTime(12_000)
    useUI.getState().restartHold()
    expect(useUI.getState().work).toBeNull()
    expect(useUI.getState().countIn).toMatchObject({ owner: { i: 1 } })
    expect(logs).toEqual([])
    expect(sets()[1]).toMatchObject({ done: false, sec: 30 })
    vi.advanceTimersByTime(3000)
    expect(useUI.getState().work).toMatchObject({ left: 30, total: 30 })
  })

  it('logs what was actually held when the hold is ended early', () => {
    start([hold(30, { done: true }), hold(30), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime((REST + 3) * 1000 + 12_000)
    useUI.getState().finishWorkEarly()
    expect(sets()[1]).toMatchObject({ done: true, sec: 12 })
    expect(useUI.getState().timer).toMatchObject({ total: REST })
  })

  it('Stop auto ends the chain: the rest after it ends with Ready, and no hold starts by itself', () => {
    start([hold(30, { done: true }), hold(30), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime(REST * 1000)
    useUI.getState().stopAuto()
    expect(hooks.stop).toHaveBeenCalled()
    expect(useUI.getState().countIn).toBeNull()
    expect(useUI.getState().toastMsg).toBe('Auto holds off for this workout')
    vi.advanceTimersByTime(10_000)
    expect(useUI.getState().work).toBeNull()
    useUI.getState().startRest(REST, 0)
    expect(useUI.getState().timer.autoNext).toBeUndefined()
    vi.advanceTimersByTime(REST * 1000)
    expect(useUI.getState().timer).toMatchObject({ ready: true })
    expect(useUI.getState().countIn).toBeNull()
  })

  it('Stop auto during a hold lets it finish like one started by hand', () => {
    start([hold(30, { done: true }), hold(30), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime((REST + 3 + 5) * 1000)
    useUI.getState().stopAuto()
    expect(useUI.getState().work).toMatchObject({ auto: false })
    vi.advanceTimersByTime(25_000)
    expect(sets()[1]).toMatchObject({ done: true, sec: 30 })
    vi.advanceTimersByTime(REST * 1000)
    expect(useUI.getState().countIn).toBeNull()
  })

  it('Skip rest counts in at once', () => {
    start([hold(30, { done: true }), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime(5000)
    useUI.getState().skipRest()
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().countIn).toMatchObject({ left: 3 })
  })

  it('goes straight to the next count-in when the rest timer is off', () => {
    start([hold(30), hold(30)], { restSec: 0 })
    hooks.startHold({ idx: 0, i: 0, id: 'plank', plan: 30 }, Date.now())
    vi.advanceTimersByTime(30_000)
    expect(sets()[0]).toMatchObject({ done: true })
    expect(useUI.getState().countIn).toMatchObject({ owner: { i: 1 } })
  })

  it('switches sides with the short pause, then counts in the other side', () => {
    start([hold(30, { side: 'L' }), hold(30, { side: 'R' })])
    hooks.startHold({ idx: 0, i: 0, id: 'plank', plan: 30 }, Date.now())
    vi.advanceTimersByTime(30_000)
    expect(useUI.getState().timer).toMatchObject({ kind: 'switch', total: 10 })
    vi.advanceTimersByTime(10_000)
    expect(useUI.getState().countIn).toMatchObject({ owner: { i: 1 } })
    vi.advanceTimersByTime(33_000)
    expect(sets()[1]).toMatchObject({ done: true, sec: 30 })
  })

  it('waits under an open sheet, held at 3, and goes on once it is closed', () => {
    start([hold(30, { done: true }), hold(30)])
    useUI.getState().startRest(REST, 0)
    useUI.getState().openSheet(() => null)
    vi.advanceTimersByTime(REST * 1000)
    expect(useUI.getState().countIn).toMatchObject({ waiting: true, paused: true, left: 3 })
    vi.advanceTimersByTime(30_000)
    expect(useUI.getState().work).toBeNull()
    useUI.getState().closeAll()
    vi.advanceTimersByTime(0)
    expect(useUI.getState().countIn).toMatchObject({ left: 3 })
    expect(useUI.getState().countIn.paused).toBeFalsy()
    vi.advanceTimersByTime(3000)
    expect(useUI.getState().work).not.toBeNull()
  })

  it('catches up from the clock after the phone was locked: the hold logged at its end, the rest as far along as it would be', () => {
    start([hold(30, { done: true }), hold(30), hold(30)])
    const t0 = Date.now()
    useUI.getState().startRest(REST, 0)
    beep.mockClear()
    chime.mockClear()
    // Locked: no tick runs; the clock moves on past the rest (60), the count-in (3), the hold (30), and 20 s of the next rest.
    vi.setSystemTime(t0 + (REST + 3 + 30 + 20) * 1000)
    document.dispatchEvent(new Event('visibilitychange'))
    const heldEnd = t0 + (REST + 3 + 30) * 1000
    expect(sets()[1]).toMatchObject({ done: true, sec: 30, at: heldEnd })
    expect(useUI.getState().work).toBeNull()
    expect(useUI.getState().timer).toMatchObject({ total: REST, endsAt: heldEnd + REST * 1000 })
    expect(useUI.getState().timer.left).toBe(40)
    // Caught up quietly: the numbers were not on screen to be heard.
    expect(beep).not.toHaveBeenCalledWith(true, 660, 0.12)
    expect(chime).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40_000)
    expect(useUI.getState().countIn).toMatchObject({ owner: { i: 2 } })
  })

  it('catches up through more than one hold, each logged with its own end', () => {
    start([hold(30, { done: true }), hold(30), hold(20)])
    const t0 = Date.now()
    useUI.getState().startRest(REST, 0)
    vi.setSystemTime(t0 + 1000 * (REST + 3 + 30 + REST + 3 + 20 + 5))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sets()[1]).toMatchObject({ done: true, sec: 30, at: t0 + 1000 * (REST + 33) })
    expect(sets()[2]).toMatchObject({ done: true, sec: 20, at: t0 + 1000 * (REST + 33 + REST + 23) })
    expect(useUI.getState().work).toBeNull()
    expect(useUI.getState().countIn).toBeNull()
  })

  it('starts nothing without the workout screen, or with the setting off', () => {
    start([hold(30, { done: true }), hold(30)], { autoHolds: false })
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime(REST * 1000)
    expect(useUI.getState().timer).toMatchObject({ ready: true })
    expect(useUI.getState().countIn).toBeNull()
    useUI.getState().stopRest()
    unbind()
    start([hold(30, { done: true }), hold(30)])
    useUI.getState().startRest(REST, 0)
    vi.advanceTimersByTime(REST * 1000)
    expect(useUI.getState().countIn).toBeNull()
  })
})
