// @vitest-environment happy-dom
// useUI pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

// "Off" has to hold at the timer itself, not at the four places that start one — the same
// reason the rest-after-a-set rule is a shared condition rather than four copies.
describe('rest timer set to Off', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null }) })
  afterEach(() => { useUI.getState().stopRest(); vi.useRealTimers() })

  it('starts nothing', () => {
    useUI.getState().startRest(0)
    expect(useUI.getState().timer).toBe(null)
  })

  it('stops a rest that is already running', () => {
    useUI.getState().startRest(90)
    expect(useUI.getState().timer).not.toBe(null)
    useUI.getState().startRest(0)
    expect(useUI.getState().timer).toBe(null)
  })

  it('still runs for a real duration', () => {
    useUI.getState().startRest(90)
    expect(useUI.getState().timer.total).toBe(90)
  })

  // A rest that does not start has nothing to run alongside a hold, so it leaves it alone: with
  // the timer Off, ticking a set somewhere must not throw away a plank in progress.
  it('leaves a running hold alone — there is no rest for it to clash with', () => {
    useUI.getState().startWork(45, 'Plank', vi.fn())
    useUI.getState().startRest(0, 1)
    expect(useUI.getState().work).not.toBe(null)
    expect(useUI.getState().work.total).toBe(45)
    useUI.getState().stopWork()
  })
})

describe('opt-in timer screen flash', () => {
  let originalSettings

  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: false } })
    useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  })

  afterEach(() => {
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    useStore.setState({ S: originalSettings })
    vi.useRealTimers()
  })

  it('stays off unless enabled in Settings', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(0)
  })

  it('flashes when the rest timer finishes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })

  it('flashes when a timed exercise finishes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })

  const goHidden = () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  const goVisible = () => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  afterEach(() => goVisible())   // leave document.hidden the way every other test expects it

  it('does not flash a rest that expires while the app is hidden, even once reopened', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(90)
    goHidden()
    vi.setSystemTime(Date.now() + 91_000)   // deadline passes with no ticks — the app was actually closed/suspended
    goVisible()                             // reopening re-fires visibilitychange, which is how the bug used to trigger
    expect(useUI.getState().timerFlashId).toBe(0)
    expect(useUI.getState().timer).toBe(null)
  })

  it('does not flash a timed exercise that finishes while the app is hidden', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startWork(90, 'Plank', vi.fn())
    goHidden()
    vi.setSystemTime(Date.now() + 91_000)
    goVisible()
    expect(useUI.getState().timerFlashId).toBe(0)
    expect(useUI.getState().work).toBe(null)
  })

  it('still flashes a rest that expires normally while the app stays visible', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })

  // Nothing clears the "the app went away" mark but a tick, so an app switch with no timer
  // running left it set for good and the next timer read it as a catch-up on its very first tick.
  // Only a timer short enough to finish on that first tick can hit it, which is why it went
  // unnoticed: a one-second rest, started on screen and over on screen, ran out in silence.
  it('a hide and a show BEFORE the rest starts is no catch-up: it still flashes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    goHidden(); goVisible()                 // switched apps and came back, with no timer running
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })

  it('a hide and a show BEFORE the hold starts is no catch-up: it still flashes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    goHidden(); goVisible()                 // switched apps and came back, with no timer running
    useUI.getState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })
})

// The rest and the hold mean opposite things and the store has always said so, but only
// startWork enforced it. Ticking a timed set's own checkbox by hand starts a rest
// (Workout.toggle) while the hold is still running, which left both going.
describe('a rest and a hold never run together', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null, work: null }) })
  afterEach(() => {
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    vi.useRealTimers()
  })

  it('a rest starting ends the hold, the way a hold starting ends the rest', () => {
    useUI.getState().startWork(45, 'Plank', vi.fn())
    useUI.getState().startRest(90, 0)
    expect(useUI.getState().work).toBe(null)
    expect(useUI.getState().timer).not.toBe(null)
  })

  it('so a left-over hold cannot reach zero under a running rest and log a set nobody held', () => {
    const holdDone = vi.fn()
    useUI.getState().startWork(30, 'Plank', holdDone)
    vi.advanceTimersByTime(12_000)                    // 12 s of the plank held
    useUI.getState().startRest(90, 1)
    vi.advanceTimersByTime(30_000)                    // past where the hold would have run out
    expect(useUI.getState().timer.left).toBe(60)      // the rest is still counting, untouched
    expect(useUI.getState().work).toBe(null)
    // Once, on the way out, and never again — and with the 12 s it actually held, marked as no
    // finish. The count alone would not say which: a hold left running reaches its own zero and
    // calls back too, with the full 30 s target for a set that stopped being held at 12.
    expect(holdDone).toHaveBeenCalledTimes(1)
    expect(holdDone).toHaveBeenCalledWith(12, true)
  })

  // The hold cannot survive the rest, but the time it held is real: it is handed back on the way
  // out so its own row keeps it. Before this a plank in progress vanished without a trace every
  // time a set was ticked somewhere else — one tap away in the List layout.
  it('the displaced hold hands back what it held, marked as no finish', () => {
    const holdDone = vi.fn()
    useUI.getState().startWork(45, 'Plank', holdDone)
    vi.advanceTimersByTime(18_000)
    useUI.getState().startRest(90, 1)
    expect(useUI.getState().work).toBe(null)
    expect(holdDone).toHaveBeenCalledTimes(1)
    expect(holdDone).toHaveBeenCalledWith(18, true)   // the seconds held, and: abandoned
  })

  it('under two seconds there is nothing to hand back — that was a play button by accident', () => {
    const holdDone = vi.fn()
    useUI.getState().startWork(45, 'Plank', holdDone)
    vi.advanceTimersByTime(1000)
    useUI.getState().startRest(90, 1)
    expect(useUI.getState().work).toBe(null)
    expect(holdDone).not.toHaveBeenCalled()
  })

  it('a hold displaced by another hold hands back what it held too', () => {
    const first = vi.fn()
    useUI.getState().startWork(45, 'Plank', first)
    vi.advanceTimersByTime(18_000)
    useUI.getState().startWork(60, 'Side plank', vi.fn())
    expect(first).toHaveBeenCalledWith(18, true)
    expect(useUI.getState().work.total).toBe(60)
  })

  it('and a rest that never starts hands back nothing, because the hold is still going', () => {
    const holdDone = vi.fn()
    useUI.getState().startWork(45, 'Plank', holdDone)
    vi.advanceTimersByTime(18_000)
    useUI.getState().startRest(0, 1)
    expect(useUI.getState().work).not.toBe(null)
    expect(holdDone).not.toHaveBeenCalled()
  })
})
