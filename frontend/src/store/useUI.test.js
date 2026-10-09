// @vitest-environment happy-dom
// useUI pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { beep, chime, countdown, holdSession, hush } from '../lib/sound.js'
import { api } from '../lib/api.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
// A signed-in rest books the server push; nothing here should reach a network.
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

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

  it('does not flash a rest that expires while the app is hidden, even once reopened, but keeps Ready visible', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(90)
    goHidden()
    vi.setSystemTime(Date.now() + 91_000)   // deadline passes with no ticks — the app was actually closed/suspended
    goVisible()                             // reopening re-fires visibilitychange, which is how the bug used to trigger
    expect(useUI.getState().timerFlashId).toBe(0)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
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
    expect(holdDone).toHaveBeenCalledWith(12, { abandoned: true })
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
    expect(holdDone).toHaveBeenCalledWith(18, { abandoned: true })   // the seconds held, and: abandoned
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
    expect(first).toHaveBeenCalledWith(18, { abandoned: true })
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

describe('rest readiness and optional timed-set overtime', () => {
  let originalSettings

  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: true, timedSetOvertime: false } })
    useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  })

  afterEach(() => {
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    useStore.setState({ S: originalSettings })
    vi.useRealTimers()
  })

  it('keeps Ready and its rest owner until dismissed or restarted', () => {
    useUI.getState().startRest(1, 2)
    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(5000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true, forIdx: 2 })
    useUI.getState().addRest(15)
    expect(useUI.getState().timer).toMatchObject({ left: 15, forIdx: 2 })
    expect(useUI.getState().timer.ready).toBeUndefined()
    useUI.getState().addRest(-15)
    expect(useUI.getState().timer).toBeNull()
  })

  it('keeps an opted-in hold through its deadline and logs actual overtime on Done', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    const done = vi.fn()
    useUI.getState().startWork(2, 'Hold', done)
    vi.advanceTimersByTime(2000)
    const flash = useUI.getState().timerFlashId
    vi.advanceTimersByTime(5000)
    expect(done).not.toHaveBeenCalled()
    expect(useUI.getState().work).toMatchObject({ left: -5, overtime: true, alerted: true })
    expect(useUI.getState().timerFlashId).toBe(flash)
    useUI.getState().finishWorkEarly()
    expect(done).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('caps unattended overtime at 15 minutes and logs it once at the deadline', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    const done = vi.fn()
    useUI.getState().startWork(1, 'Hold', done)
    vi.advanceTimersByTime(901000)
    expect(done).toHaveBeenCalledExactlyOnceWith(901, { chimed: false })
    expect(useUI.getState().work).toBeNull()
  })

  it('cancels an overtime hold without logging and clears its old owner callback', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    const canceled = vi.fn()
    const replacement = vi.fn()
    useUI.getState().startWork(2, 'Canceled', canceled)
    useUI.getState().stopWork()
    useUI.getState().startWork(2, 'Replacement', replacement)
    vi.advanceTimersByTime(2000)
    useUI.getState().stopWork()
    expect(canceled).not.toHaveBeenCalled()
    expect(replacement).not.toHaveBeenCalled()
  })
})

describe('addRest adjustments', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null }) })
  afterEach(() => { useUI.getState().stopRest(); vi.useRealTimers() })

  it('reduces left without shrinking total so progress bar reflects the decrement', () => {
    useUI.getState().startRest(60)
    expect(useUI.getState().timer.left).toBe(60)
    expect(useUI.getState().timer.total).toBe(60)

    useUI.getState().addRest(-15)
    expect(useUI.getState().timer.left).toBe(45)
    expect(useUI.getState().timer.total).toBe(60)
  })

  it('stops timer if subtraction reaches zero or below', () => {
    useUI.getState().startRest(15)
    useUI.getState().addRest(-15)
    expect(useUI.getState().timer).toBe(null)
  })

  it('increases left and keeps total if still within initial total', () => {
    useUI.getState().startRest(60)
    useUI.getState().addRest(-15) // left: 45, total: 60
    useUI.getState().addRest(10)  // left: 55, total: 60
    expect(useUI.getState().timer.left).toBe(55)
    expect(useUI.getState().timer.total).toBe(60)
  })

  it('expands total if time added exceeds the initial total', () => {
    useUI.getState().startRest(60)
    useUI.getState().addRest(15)
    expect(useUI.getState().timer.left).toBe(75)
    expect(useUI.getState().timer.total).toBe(75)
  })
})

// The sound a rest ends with is the profile's (Settings → Sound) unless that kind of rest has one
// of its own (S.restSoundByKind, lib/rest-sounds.js restSoundFor). The kind travels with the
// timer, so the sound at zero is the one the set that started the rest earned.
describe('the sound a rest ends with, by its kind', () => {
  let originalSettings
  const pick = over => useStore.setState({ S: { ...useStore.getState().S, ...over } })
  beforeEach(() => {
    vi.useFakeTimers()
    chime.mockClear()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false, restSound: 'bell', classicChime: false, restSoundByKind: undefined } })
    useUI.setState({ timer: null, work: null })
  })
  afterEach(() => { useUI.getState().stopRest(); useUI.getState().stopWork(); useStore.setState({ S: originalSettings }); vi.useRealTimers() })

  it('keeps the kind on the running timer, and drops one it does not know', () => {
    useUI.getState().startRest(90, 2, { kind: 'round' })
    expect(useUI.getState().timer).toMatchObject({ forIdx: 2, kind: 'round' })
    useUI.getState().startRest(45, 1, { kind: 'set', phase: 'warmup' })
    expect(useUI.getState().timer).toMatchObject({ forIdx: 1, kind: 'set', phase: 'warmup' })
    useUI.getState().startRest(90, 2, { kind: 'nonsense' })
    expect(useUI.getState().timer.kind).toBeUndefined()
  })

  it('plays the kind\'s own sound when the rest ends', () => {
    pick({ restSoundByKind: { block: 'whistle' } })
    useUI.getState().startRest(1, 0, { kind: 'block' })
    vi.advanceTimersByTime(1000)
    expect(chime).toHaveBeenCalledTimes(1)
    expect(chime).toHaveBeenCalledWith(true, 'whistle')
  })

  it('a kind without one, and a rest with no kind, play the profile\'s sound', () => {
    pick({ restSoundByKind: { block: 'whistle' } })
    useUI.getState().startRest(1, 0, { kind: 'set' })
    vi.advanceTimersByTime(1000)
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(chime.mock.calls).toEqual([[true, 'bell'], [true, 'bell']])
  })

  it('a hold and a switch-sides pause play the profile\'s sound, whatever the kinds have', () => {
    pick({ restSoundByKind: { set: 'beep', round: 'beep', block: 'beep' } })
    useUI.getState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)
    useUI.getState().startRest(1, 0, { kind: 'switch' })
    vi.advanceTimersByTime(1000)
    expect(chime.mock.calls).toEqual([[true, 'bell'], [true, 'bell']])
  })

  it('passes the Sounds setting through, so off stays off', () => {
    pick({ sound: false, restSoundByKind: { set: 'beep' } })
    useUI.getState().startRest(1, 0, { kind: 'set' })
    vi.advanceTimersByTime(1000)
    expect(chime).toHaveBeenCalledWith(false, 'beep')
  })

  it('keeps the kind and phase when the rest is extended, started again from Ready, or followed from the Android notification', () => {
    useUI.getState().startRest(60, 1, { kind: 'set', phase: 'warmup' })
    useUI.getState().addRest(30)
    expect(useUI.getState().timer).toMatchObject({ kind: 'set', phase: 'warmup' })
    useUI.getState().startRest(1, 1, { kind: 'set', phase: 'work', forSet: 2 })
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ ready: true, kind: 'set', phase: 'work' })
    useUI.getState().addRest(15)
    expect(useUI.getState().timer).toMatchObject({ left: 15, forIdx: 1, forSet: 2, kind: 'set', phase: 'work' })
    expect(useUI.getState().timer.ready).toBeUndefined()
    useUI.getState().followNativeRest({ endsAt: Date.now() + 40_000, left: 40, total: 60, paused: false })
    expect(useUI.getState().timer).toMatchObject({ left: 40, kind: 'set', phase: 'work', forSet: 2 })
  })
})

// The last seconds of every timer are counted in out loud, queued when it starts (lib/sound.js
// countdown): the one-second tick that used to beep them is throttled to nothing in a pocket.
describe('the count-in a timer queues', () => {
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
    useUI.getState().startRest(90, 0, { kind: 'set' })
    expect(countdown).toHaveBeenCalledWith(true, 90)
  })

  it('a timed hold queues one too: every timer counts you in, not just the rest', () => {
    useUI.getState().startWork(45, 'Plank', () => {})
    expect(countdown).toHaveBeenCalledWith(true, 45)
  })

  it('so does the switch-sides pause', () => {
    useUI.getState().startRest(10, 0, { kind: 'switch' })
    expect(countdown).toHaveBeenCalledWith(true, 10)
  })

  it('passes the Sounds setting through, so off stays off', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startRest(90, 0, { kind: 'set' })
    expect(countdown).toHaveBeenCalledWith(false, 90)
  })

  it('a rest set to Off queues nothing', () => {
    useUI.getState().startRest(0, 0, { kind: 'set' })
    expect(countdown).not.toHaveBeenCalled()
  })

  it('+15 s moves the end, so the count-in is queued again for the new one', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    useUI.getState().addRest(15)
    expect(countdown).toHaveBeenLastCalledWith(true, 105)
  })

  it('the tick no longer beeps its own way through the last seconds', () => {
    useUI.getState().startRest(6, 0, { kind: 'set' })
    vi.advanceTimersByTime(4000)
    useUI.getState().startWork(6, 'Plank', () => {})
    vi.advanceTimersByTime(4000)
    expect(beep).not.toHaveBeenCalled()
  })

  it('skipping a rest calls the count-in off, so it cannot tick after you have moved on', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    hush.mockClear()
    useUI.getState().stopRest()
    expect(hush).toHaveBeenCalled()
  })

  it('a rest that runs out calls it off as it goes, and so does a switch-sides pause', () => {
    useUI.getState().startRest(1, 0, { kind: 'set' })
    hush.mockClear()
    vi.advanceTimersByTime(1000)
    expect(hush).toHaveBeenCalled()
    useUI.getState().startRest(1, 0, { kind: 'switch' })
    hush.mockClear()
    vi.advanceTimersByTime(1000)
    expect(hush).toHaveBeenCalled()
  })

  it('cancelling or finishing a hold calls it off', () => {
    useUI.getState().startWork(45, 'Plank', () => {})
    hush.mockClear()
    useUI.getState().finishWorkEarly()
    expect(hush).toHaveBeenCalled()
  })

  it('switching Sounds mid-rest queues what is left again (or calls it off)', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    vi.advanceTimersByTime(3000)
    useUI.getState().restartCountdown()
    expect(countdown).toHaveBeenLastCalledWith(true, 87)
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().restartCountdown()
    expect(countdown).toHaveBeenLastCalledWith(false, 87)
  })

  it('and mid-hold', () => {
    useUI.getState().startWork(45, 'Plank', () => {})
    vi.advanceTimersByTime(5000)
    useUI.getState().restartCountdown()
    expect(countdown).toHaveBeenLastCalledWith(true, 40)
  })

  it('with no timer running there is nothing to queue again', () => {
    useUI.getState().restartCountdown()
    expect(countdown).not.toHaveBeenCalled()
  })

  it('coming back on screen queues it again, against the time that is really left', () => {
    const hide = () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
    const show = () => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
    useUI.getState().startRest(90, 0, { kind: 'set' })
    hide()
    vi.advanceTimersByTime(60000)     // the phone was locked: the queue froze with the audio clock
    countdown.mockClear()
    show()
    expect(countdown).toHaveBeenCalledWith(true, 30)
    vi.advanceTimersByTime(1000)      // and only once: the next tick is an ordinary one
    expect(countdown).toHaveBeenCalledTimes(1)
  })

  // The two never run together, but each is stopped where the other may be running: a move up or
  // down mid-rest stops "the hold" to drop its callback before the indexes shift, and the closing
  // set of one exercise stops "the rest" while a hold runs on another. The count-in is shared, so
  // stopping the timer that was not running silenced the other's.
  it('stopping the hold mid-rest leaves the rest\'s count-in alone', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    hush.mockClear()
    useUI.getState().stopWork()
    useUI.getState().abandonWork()
    expect(hush).not.toHaveBeenCalled()
    expect(useUI.getState().timer).toMatchObject({ left: 90 })
  })

  it('and stopping the rest mid-hold leaves the hold\'s alone', () => {
    useUI.getState().startWork(45, 'Plank', () => {})
    hush.mockClear()
    useUI.getState().stopRest()
    expect(hush).not.toHaveBeenCalled()
    expect(useUI.getState().work).toMatchObject({ left: 45 })
  })

  // A held rest must not tick on; resuming queues what is left again.
  it('a pause calls it off, and a resume queues what is left again', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    vi.advanceTimersByTime(30_000)
    hush.mockClear(); countdown.mockClear()
    useUI.getState().pauseRest()
    expect(hush).toHaveBeenCalled()
    useUI.getState().restartCountdown()               // Sounds changed while paused: nothing to queue
    expect(countdown).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5 * 60_000)
    useUI.getState().resumeRest()
    expect(countdown).toHaveBeenLastCalledWith(true, 60)
  })
})

// The audio session is held for the length of a timer (lib/sound.js holdSession), so the phone's
// volume buttons reach the channel the timer plays on instead of the ringer. Only while Sounds is
// on: with nothing to play it would only keep the phone's music paused.
describe('the audio session a timer holds', () => {
  let originalSettings
  beforeEach(() => {
    vi.useFakeTimers()
    holdSession.mockClear(); hush.mockClear(); countdown.mockClear()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false } })
    useUI.setState({ timer: null, work: null })
  })
  afterEach(() => {
    useUI.getState().stopRest(); useUI.getState().stopWork()
    useStore.setState({ S: originalSettings }); vi.useRealTimers()
  })

  it('is held for the length of a rest or a hold, and let go when it ends', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    expect(holdSession).toHaveBeenLastCalledWith(true)
    useUI.getState().stopRest()
    expect(holdSession).toHaveBeenLastCalledWith(false)
    holdSession.mockClear()
    useUI.getState().startWork(45, 'Plank', () => {})
    expect(holdSession).toHaveBeenLastCalledWith(true)
    useUI.getState().stopWork()
    expect(holdSession).toHaveBeenLastCalledWith(false)
  })

  it('is not taken with Sounds off', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startRest(90, 0, { kind: 'set' })
    useUI.getState().pauseRest()
    useUI.getState().resumeRest()
    useUI.getState().addRest(15)
    useUI.getState().stopRest()
    useUI.getState().startWork(45, 'Plank', () => {})
    expect(holdSession).not.toHaveBeenCalledWith(true)
  })

  it('switching Sounds mid-timer takes it or lets it go with the count-in', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().restartCountdown()
    expect(holdSession).toHaveBeenLastCalledWith(false)
    useStore.setState({ S: { ...useStore.getState().S, sound: true } })
    useUI.getState().restartCountdown()
    expect(holdSession).toHaveBeenLastCalledWith(true)
  })

  it('stopping the hold mid-rest leaves the rest\'s session alone, and stopping the rest mid-hold the hold\'s', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    holdSession.mockClear()
    useUI.getState().stopWork()
    useUI.getState().abandonWork()
    expect(holdSession).not.toHaveBeenCalled()
    useUI.getState().stopRest()
    useUI.getState().startWork(45, 'Plank', () => {})
    holdSession.mockClear()
    useUI.getState().stopRest()
    expect(holdSession).not.toHaveBeenCalled()
  })

  it('a pause lets it go and a resume takes it again', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    holdSession.mockClear()
    useUI.getState().pauseRest()
    expect(holdSession).toHaveBeenLastCalledWith(false)
    useUI.getState().resumeRest()
    expect(holdSession).toHaveBeenLastCalledWith(true)
  })

  // A hold counting on past its target (Settings → timed-set overtime) has sounded its end, and
  // nothing more will sound: the session goes at the target, on screen as it does when hidden.
  it('a hold counting on past its target lets it go at the target, and Sounds switched off there keeps it let go', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    useUI.getState().startWork(2, 'Plank', vi.fn())
    holdSession.mockClear()
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().work).toMatchObject({ overtime: true, left: 0 })
    expect(holdSession.mock.calls).toEqual([[false]])
    vi.advanceTimersByTime(3000)
    expect(holdSession.mock.calls).toEqual([[false]])           // once, not every second
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().restartCountdown()
    expect(holdSession).toHaveBeenLastCalledWith(false)
    useStore.setState({ S: { ...useStore.getState().S, sound: true } })
    useUI.getState().restartCountdown()
    expect(holdSession).toHaveBeenLastCalledWith(false)         // nothing left to count past the end
  })

  it('a rest that runs out to Ready lets it go, and so does a switch-sides pause at its end', () => {
    useUI.getState().startRest(1, 0, { kind: 'set' })
    holdSession.mockClear()
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ ready: true })
    expect(holdSession).toHaveBeenLastCalledWith(false)
    useUI.getState().startRest(1, 0, { kind: 'switch' })
    holdSession.mockClear()
    vi.advanceTimersByTime(1000)
    expect(holdSession).toHaveBeenLastCalledWith(false)
  })
})

// Holding the audio session keeps a page running behind a locked iPhone, where it used to be
// frozen. A hidden page still changes nothing on screen: the end of a rest or a hold happens on
// the first tick back, and only the alert (and letting go of the session) happens while hidden.
describe('a timer that runs while the page is hidden', () => {
  let originalSettings, originalUser, shown
  const goHidden = () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  const goVisible = () => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    originalUser = useStore.getState().user
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: false } })
    useUI.setState({ timer: null, work: null, toastMsg: '' })
    shown = vi.fn()
    // A granted permission and a service worker to show through: the local notification's path,
    // and a push subscription, since the local alert follows the Push switch (issue #239).
    globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ showNotification: shown, pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/x' }) } }) } })
  })
  afterEach(() => {
    goVisible(); useUI.getState().stopRest(); useUI.getState().stopWork()
    useStore.setState({ S: originalSettings, user: originalUser })
    delete globalThis.Notification
    delete navigator.serviceWorker
    vi.useRealTimers()
  })

  it('a hidden rest neither ticks nor finishes; it all happens on the first tick back', () => {
    useUI.getState().startRest(3, 0, { kind: 'block' })
    goHidden()
    vi.advanceTimersByTime(10_000)
    const tm = useUI.getState().timer
    expect(tm).not.toBe(null)
    expect(tm.left).toBe(3)                          // not a single re-render while hidden
    expect(useUI.getState().toastMsg).toBe('')
    goVisible()
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
    expect(useUI.getState().toastMsg).toBe('Rest’s over. Next set!')
  })

  it('signed in, a hidden rest leaves the alert to the server push: no local notification', async () => {
    useStore.setState({ user: { id: 'u1' } })
    useUI.getState().startRest(2, 0, { kind: 'set' })
    await flush()                                    // the server took the push
    goHidden()
    vi.advanceTimersByTime(6000)
    await flush()
    expect(shown).not.toHaveBeenCalled()
    goVisible()
    await flush()
    expect(shown).not.toHaveBeenCalled()             // back on screen there is nothing to notify
  })

  // Offline in the gym, or the server down: no push is coming, so the local notification stands
  // in, as it does for a guest. Only the latest booking counts: +15 s books the end again.
  it('signed in, a hidden rest whose push the server never took still notifies, once', async () => {
    useStore.setState({ user: { id: 'u1' } })
    useUI.getState().startRest(2, 0, { kind: 'set' })
    await flush()                                    // this one was taken...
    api.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('Failed to fetch'), { status: undefined })))
    useUI.getState().addRest(15)                     // ...but the end it booked is gone, and the new one failed
    await flush()
    expect(api).toHaveBeenLastCalledWith('/api/push/rest-timer', expect.objectContaining({ method: 'POST' }))
    goHidden()
    vi.advanceTimersByTime(20_000)
    await flush()
    expect(shown).toHaveBeenCalledTimes(1)
    expect(shown).toHaveBeenCalledWith('Rest’s over. Next set!', expect.objectContaining({ tag: 'rest-timer' }))
  })

  it('a hidden rest that runs out notifies once, not once per tick', async () => {
    useStore.setState({ user: null })
    useUI.getState().startRest(2, 0, { kind: 'set' })
    useUI.getState().addRest(15); useUI.getState().addRest(-15)   // ±15 s moves endsAt; still one rest
    goHidden()
    vi.advanceTimersByTime(6000)                     // four ticks past zero
    await flush()
    expect(shown).toHaveBeenCalledTimes(1)
    expect(shown).toHaveBeenCalledWith('Rest’s over. Next set!', expect.objectContaining({ tag: 'rest-timer' }))   // the push's tag: one tray entry
    expect(useUI.getState().timer).not.toBe(null)    // the rest itself still waits for the screen
  })

  // Nothing on screen changes, but the audio session is no screen: held past the end it keeps the
  // volume buttons on a timer with nothing left to count and, under 'playback', the phone's music
  // paused, for as long as the phone stays in the pocket. It goes at the end, once.
  it('a hidden rest that runs out lets go of the audio session then, not when the page is back', () => {
    useUI.getState().startRest(2, 0, { kind: 'set' })
    goHidden()
    holdSession.mockClear()
    vi.advanceTimersByTime(1000)
    expect(holdSession).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(holdSession.mock.calls).toEqual([[false]])
    vi.advanceTimersByTime(10_000)                    // and once: each call pushes the sleep out again
    expect(holdSession.mock.calls).toEqual([[false]])
    expect(useUI.getState().timer).toMatchObject({ left: 2 })   // the rest itself still waits for the screen
    goVisible()
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
  })

  // Letting go leaves the ticking alone: a page back on screen without a visibilitychange to say
  // so still has its rest finished by the next tick.
  it('and the rest keeps ticking, so a page back without a visibilitychange still finishes it', () => {
    useUI.getState().startRest(2, 0, { kind: 'set' })
    goHidden()
    vi.advanceTimersByTime(3000)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })   // back, no event
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
  })

  it('so does a switch-sides pause', () => {
    useUI.getState().startRest(2, 0, { kind: 'switch' })
    goHidden()
    holdSession.mockClear()
    vi.advanceTimersByTime(5000)
    expect(holdSession.mock.calls).toEqual([[false]])
  })

  // The same goes for a hold: nothing is left to count once it has run out (its end only sounds
  // on screen), so the session goes then, once, and the hold still finishes on return.
  it('a hidden hold that runs out lets go of the audio session then, not when the page is back', () => {
    const done = vi.fn()
    useUI.getState().startWork(2, 'Plank', done)
    goHidden()
    holdSession.mockClear(); hush.mockClear()
    vi.advanceTimersByTime(1000)
    expect(holdSession).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(holdSession.mock.calls).toEqual([[false]])
    expect(hush).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(holdSession.mock.calls).toEqual([[false]])
    expect(done).not.toHaveBeenCalled()
    goVisible()
    expect(useUI.getState().work).toBe(null)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('and so does the next hold that runs out hidden: once per hold, not once ever', () => {
    useUI.getState().startWork(2, 'Plank', vi.fn())
    goHidden()
    vi.advanceTimersByTime(3000)
    goVisible()
    useUI.getState().startWork(2, 'Plank', vi.fn())
    goHidden()
    holdSession.mockClear()
    vi.advanceTimersByTime(3000)
    expect(holdSession.mock.calls).toEqual([[false]])
  })

  it('and one counting on past its target (overtime) lets go there too: nothing more sounds while hidden', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    useUI.getState().startWork(2, 'Plank', vi.fn())
    goHidden()
    holdSession.mockClear()
    vi.advanceTimersByTime(5000)
    expect(holdSession.mock.calls).toEqual([[false]])
    goVisible()
    expect(useUI.getState().work).toMatchObject({ overtime: true, left: -3 })
  })

  // It still finishes on the first tick back, at its full length, and says when it ended: the rest
  // it earned has been counting since then (Workout.jsx passes it to startRest as `since`,
  // store/useUI.hidden-hold.test.js). A hold that ends on screen says nothing of the kind.
  it('a hidden hold finishes on the first tick back, at its full length, saying when it really ended', () => {
    const done = vi.fn()
    const endsAt = Date.now() + 2000
    useUI.getState().startWork(2, 'Plank', done)
    goHidden()
    vi.advanceTimersByTime(10_000)
    expect(useUI.getState().work).not.toBe(null)
    expect(done).not.toHaveBeenCalled()
    goVisible()
    expect(useUI.getState().work).toBe(null)
    expect(done).toHaveBeenCalledWith(2, { chimed: false, endedAt: endsAt })
    const seen = vi.fn()
    useUI.getState().startWork(2, 'Plank', seen)
    vi.advanceTimersByTime(2000)
    expect(seen).toHaveBeenCalledWith(2, { chimed: true })
  })
})

