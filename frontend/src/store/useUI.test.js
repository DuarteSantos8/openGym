// @vitest-environment happy-dom
// useUI pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { beep, countdown, holdSession, hush, restOver } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), unlock: vi.fn(), restOver: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))

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
})

// One rest-over sound per kind of rest (set / round / block). The kind travels with the
// timer so the sound at zero is the one the set that started the rest earned, not whatever
// the screen happens to show by then.
describe('rest-over sound per kind of rest', () => {
  let originalSettings
  beforeEach(() => {
    vi.useFakeTimers()
    restOver.mockClear()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false } })
    useUI.setState({ timer: null })
  })
  afterEach(() => { useUI.getState().stopRest(); useStore.setState({ S: originalSettings }); vi.useRealTimers() })

  it('keeps the kind and the set phase on the running timer', () => {
    useUI.getState().startRest(90, 2, 'round')
    expect(useUI.getState().timer).toMatchObject({ forIdx: 2, kind: 'round' })
    useUI.getState().startRest(45, 1, 'set', 'warmup')
    expect(useUI.getState().timer).toMatchObject({ forIdx: 1, kind: 'set', phase: 'warmup' })
  })

  it('plays the sound for that kind when the rest ends', () => {
    useUI.getState().startRest(1, 0, 'block')
    vi.advanceTimersByTime(1000)
    expect(restOver).toHaveBeenCalledTimes(1)
    expect(restOver).toHaveBeenCalledWith(true, 'block')
  })

  it('passes the Sounds setting through, so off stays off', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startRest(1, 0, 'set')
    vi.advanceTimersByTime(1000)
    expect(restOver).toHaveBeenCalledWith(false, 'set')
  })

  it('a rest started without a kind still ends with a sound', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(restOver).toHaveBeenCalledWith(true, undefined)
  })

  it('keeps the kind when the rest is extended', () => {
    useUI.getState().startRest(60, 1, 'round')
    useUI.getState().addRest(30)
    expect(useUI.getState().timer.kind).toBe('round')
  })
})

// The last seconds of a timer are queued with the timer, not beeped one tick at a time: a tab
// in a pocket has its interval throttled to nothing, and that is exactly where a rest is spent
// (lib/sound.js countdown). Everything that ends a timer early has to call the queue off again.
describe('the countdown a timer queues', () => {
  let originalSettings
  beforeEach(() => {
    vi.useFakeTimers()
    countdown.mockClear(); hush.mockClear(); beep.mockClear()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false } })
    useUI.setState({ timer: null, work: null })
  })
  afterEach(() => {
    useUI.getState().stopRest(); useUI.getState().stopWork()
    useStore.setState({ S: originalSettings }); vi.useRealTimers()
  })

  it('a rest queues one for its whole length', () => {
    useUI.getState().startRest(90, 0, 'set')
    expect(countdown).toHaveBeenCalledWith(true, 90)
  })

  it('a timed hold queues one too — every timer counts you in, not just the rest', () => {
    useUI.getState().startWork(45, 'Plank', () => {}, null, 0)
    expect(countdown).toHaveBeenCalledWith(true, 45)
  })

  it('passes the Sounds setting through, so off stays off', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startRest(90, 0, 'set')
    expect(countdown).toHaveBeenCalledWith(false, 90)
  })

  it('a rest set to Off queues nothing', () => {
    useUI.getState().startRest(0, 0, 'set')
    expect(countdown).not.toHaveBeenCalled()
  })

  it('+15 s moves the ending, so the countdown is queued again for the new one', () => {
    useUI.getState().startRest(90, 0, 'set')
    useUI.getState().addRest(15)
    expect(countdown).toHaveBeenLastCalledWith(true, 105)
  })

  it('the tick no longer beeps its own way through the last seconds', () => {
    useUI.getState().startRest(6, 0, 'set')
    vi.advanceTimersByTime(4000)
    expect(beep).not.toHaveBeenCalled()
  })

  it('skipping a rest calls the queue off, so it cannot tick after you have moved on', () => {
    useUI.getState().startRest(90, 0, 'set')
    hush.mockClear()
    useUI.getState().skipRest()
    expect(hush).toHaveBeenCalled()
  })

  it('a rest that runs out calls the queue off as it goes', () => {
    useUI.getState().startRest(1, 0, 'set')
    hush.mockClear()
    vi.advanceTimersByTime(1000)
    expect(hush).toHaveBeenCalled()
  })

  it('cancelling or finishing a hold calls the queue off', () => {
    useUI.getState().startWork(45, 'Plank', () => {}, null, 0)
    hush.mockClear()
    useUI.getState().finishWorkEarly()
    expect(hush).toHaveBeenCalled()
  })

  it('turning the volume up mid-rest re-queues what is left at the new level', () => {
    useUI.getState().startRest(90, 0, 'set')
    vi.advanceTimersByTime(3000)
    useUI.getState().restartCountdown()
    expect(countdown).toHaveBeenLastCalledWith(true, 87)
  })

  it('and mid-hold', () => {
    useUI.getState().startWork(45, 'Plank', () => {}, null, 0)
    vi.advanceTimersByTime(5000)
    useUI.getState().restartCountdown()
    expect(countdown).toHaveBeenLastCalledWith(true, 40)
  })

  it('coming back on screen queues it again, against the time that is really left', () => {
    const hide = () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
    const show = () => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
    useUI.getState().startRest(90, 0, 'set')
    hide()
    vi.advanceTimersByTime(60000)     // the phone was locked: the queue froze with the audio clock
    countdown.mockClear()
    show()
    expect(countdown).toHaveBeenCalledWith(true, 30)
    vi.advanceTimersByTime(1000)      // and only once — the next tick is an ordinary one
    expect(countdown).toHaveBeenCalledTimes(1)
    show()
  })

  it('holds the audio session for the length of a timer, and lets go when it ends', () => {
    holdSession.mockClear()
    useUI.getState().startRest(90, 0, 'set')
    expect(holdSession).toHaveBeenLastCalledWith(true)
    useUI.getState().skipRest()
    expect(holdSession).toHaveBeenLastCalledWith(false)
    holdSession.mockClear()
    useUI.getState().startWork(45, 'Plank', () => {}, null, 0)
    expect(holdSession).toHaveBeenLastCalledWith(true)
    useUI.getState().stopWork()
    expect(holdSession).toHaveBeenLastCalledWith(false)
  })

  it('with no timer running there is nothing to re-queue', () => {
    useUI.getState().restartCountdown()
    expect(countdown).not.toHaveBeenCalled()
  })
})

// A rest hands over when it runs out or is skipped, never on a plain stop. It also says whether
// the countdown actually ran out on screen: one that expired while the app was hidden still fires
// (the screen can move on to the next exercise) but must not start a hold nobody watched — that
// half is the caller's to gate, and Workout.jsx does.
describe('what a rest hands over to', () => {
  let originalSettings
  const goHidden = () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  const goVisible = () => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: false } })
    useUI.setState({ timer: null, work: null })
  })
  afterEach(() => { goVisible(); useUI.getState().stopRest(); useStore.setState({ S: originalSettings }); vi.useRealTimers() })

  it('fires once when the rest runs out on screen, after the timer is gone', () => {
    const done = vi.fn(() => expect(useUI.getState().timer).toBe(null))
    useUI.getState().startRest(1, 0, 'set', null, done)
    vi.advanceTimersByTime(1000)
    expect(done).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledWith(0, true)      // the rest's owner index, and: seen live
    vi.advanceTimersByTime(3000)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('hands over the owner as it is now, not as it was when the rest started', () => {
    const done = vi.fn()
    useUI.getState().startRest(1, 2, 'set', null, done)
    useUI.getState().shiftRestOwner(0, 1)             // an exercise inserted above
    vi.advanceTimersByTime(1000)
    expect(done).toHaveBeenCalledWith(3, true)
  })

  it('rest set to Off: no rest, no hand-over — the next hold waits for a tap', () => {
    const done = vi.fn()
    useUI.getState().startRest(0, 0, 'set', null, done)
    vi.advanceTimersByTime(5000)
    useUI.getState().skipRest()
    expect(done).not.toHaveBeenCalled()
  })

  it('fires on Skip', () => {
    const done = vi.fn()
    useUI.getState().startRest(90, 0, 'set', null, done)
    useUI.getState().skipRest()
    expect(done).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledWith(0, true)
    expect(useUI.getState().timer).toBe(null)
  })

  it('fires when −15 s takes the rest past zero', () => {
    const done = vi.fn()
    useUI.getState().startRest(10, 0, 'set', null, done)
    useUI.getState().addRest(-15)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('does not fire on a plain stop, and a stopped rest cannot fire later', () => {
    const done = vi.fn()
    useUI.getState().startRest(1, 0, 'set', null, done)
    useUI.getState().stopRest()
    vi.advanceTimersByTime(2000)
    expect(done).not.toHaveBeenCalled()
  })

  it('fires, but says it was not seen live, when the rest ran out while the app was hidden', () => {
    const done = vi.fn()
    useUI.getState().startRest(90, 0, 'set', null, done)
    goHidden()
    vi.setSystemTime(Date.now() + 91_000)
    goVisible()
    expect(useUI.getState().timer).toBe(null)
    expect(done).toHaveBeenCalledWith(0, false)
  })

  it('a new rest replaces the hand-over, a rest without one clears it', () => {
    const first = vi.fn(), second = vi.fn()
    useUI.getState().startRest(90, 0, 'set', null, first)
    useUI.getState().startRest(90, 0, 'set', null, second)
    useUI.getState().skipRest()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    useUI.getState().startRest(90, 0, 'set', null, first)
    useUI.getState().startRest(90, 0, 'block', null)
    useUI.getState().skipRest()
    expect(first).not.toHaveBeenCalled()
  })

  it('a hold starting ends the rest without firing it', () => {
    const done = vi.fn()
    useUI.getState().startRest(90, 0, 'set', null, done)
    useUI.getState().startWork(30, 'Plank', vi.fn())
    expect(useUI.getState().timer).toBe(null)
    expect(done).not.toHaveBeenCalled()
    useUI.getState().stopWork()
  })
})

// A hold has an owner too, moved with the rest's when an exercise is added above it, and handed
// to onDone so the write lands on the moved row.
describe('the hold\'s owner', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null, work: null }) })
  afterEach(() => { useUI.getState().stopWork(); vi.useRealTimers() })

  it('is handed to onDone when the countdown ends, as it is then', () => {
    const done = vi.fn()
    useUI.getState().startWork(1, 'Plank', done, { phase: 'work', n: 1, of: 2 }, 2)
    useUI.getState().shiftRestOwner(0, 1)
    vi.advanceTimersByTime(1000)
    expect(done).toHaveBeenCalledWith(1, 3)
  })

  it('is handed to onDone on an early finish too', () => {
    const done = vi.fn()
    useUI.getState().startWork(45, 'Plank', done, null, 0)
    vi.advanceTimersByTime(7000)
    useUI.getState().finishWorkEarly()
    expect(done).toHaveBeenCalledWith(7, 0)
  })

  it('is left alone by a shift that starts below it', () => {
    useUI.getState().startWork(45, 'Plank', vi.fn(), null, 0)
    useUI.getState().shiftRestOwner(1, 1)
    expect(useUI.getState().work.forIdx).toBe(0)
  })
})
