// @vitest-environment happy-dom
// lib/sound.js keeps one AudioContext per page; each test gets a fresh module so that state
// does not leak. The fake context records what the real one would be asked to do.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeCtx {
  constructor() {
    this.state = 'suspended'      // what every browser hands back outside a user gesture
    this.currentTime = 0
    this.destination = {}
    this.tones = []
    this.stops = []               // a tone called off before it played stops at 0 (hush)
    this.resumes = 0
    this.suspends = 0
    this.gains = []
    this.oscs = []
    this.waves = 0
    FakeCtx.instances.push(this)
  }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve() }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve() }
  // Each gain remembers what it was asked to do, so the chime's loudness can be read back.
  createGain() {
    const events = []
    this.gains.push(events)
    return { connect() {}, gain: {
      setValueAtTime(v, at) { events.push(['set', v, at]) },
      exponentialRampToValueAtTime(v, at) { events.push(['ramp', v, at]) },
    } }
  }
  createOscillator() {
    const ctx = this
    const o = {
      frequency: { value: 0, ramps: [], setValueAtTime() {}, linearRampToValueAtTime(v, at) { this.ramps.push([v, at]) } }, type: '', wave: null, connect() {},
      setPeriodicWave(w) { o.wave = w },
      start(at) { ctx.tones.push({ freq: o.frequency.value, at }); ctx.oscs.push(o); o.at = at },
      stop(at) { o.until = at; ctx.stops.push({ freq: o.frequency.value, at }) },
    }
    return o
  }
  createPeriodicWave(real, imag) { this.waves++; return { real: [...real], imag: [...imag] } }
}
FakeCtx.instances = []

let sound
let session
const ctx = () => FakeCtx.instances[0]
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const setDevice = (userAgent, maxTouchPoints = 0) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

beforeEach(async () => {
  vi.useFakeTimers()
  FakeCtx.instances = []
  window.AudioContext = FakeCtx
  session = { type: 'auto' }
  Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true, writable: true })
  setDevice(IPHONE)
  vi.resetModules()
  sound = await import('./sound.js')
})
afterEach(() => { vi.useRealTimers() })

describe('sounds off', () => {
  it('creates no audio context and leaves the audio session alone', () => {
    sound.beep(false, 880, 0.15)
    sound.unlock(false)
    expect(FakeCtx.instances).toHaveLength(0)
    expect(session.type).toBe('auto')
  })
})

describe('iOS: silent switch and interruptions (#152)', () => {
  it('the first tone gets the context running and leaves the audio session type alone', () => {
    sound.beep(true, 880, 0.15)
    expect(ctx().resumes).toBe(1)
    expect(ctx().state).toBe('running')
    expect(ctx().tones).toEqual([{ freq: 880, at: 0 }])
    expect(session.type).toBe('auto')         // the silent-switch override is the setting's job
  })

  it('resumes a context that a lock or app switch left suspended before scheduling the tone', () => {
    sound.beep(true, 880, 0.15)
    ctx().state = 'interrupted'               // what iOS does on screen lock / app switch
    sound.beep(true, 660, 0.1)
    expect(ctx().resumes).toBe(2)
    expect(ctx().state).toBe('running')
    expect(ctx().tones).toHaveLength(2)
  })

  // A real context reports 'suspended' until its resume() settles, so a burst can issue one
  // resume() per tone in a browser — harmless. What this pins is the guard itself.
  it('skips resume when the context already reports running', () => {
    sound.beep(true, 880, 0.15)
    sound.beep(true, 880, 0.15, 0.25)
    expect(ctx().resumes).toBe(1)
  })

  it('replaces a context the browser has closed', () => {
    sound.beep(true, 880, 0.15)
    ctx().state = 'closed'
    sound.beep(true, 880, 0.15)
    expect(FakeCtx.instances).toHaveLength(2)
    expect(FakeCtx.instances[1].tones).toHaveLength(1)
  })

  it('works in a browser without navigator.audioSession', () => {
    Object.defineProperty(navigator, 'audioSession', { value: undefined, configurable: true, writable: true })
    sound.beep(true, 880, 0.15)
    expect(ctx().tones).toHaveLength(1)
  })
})

describe('the context sleeps between beeps', () => {
  it('suspends about a second after the last tone of a burst has ended', () => {
    sound.beep(true, 880, 0.25, 0); sound.beep(true, 1320, 0.5, 0.35)   // last tone ends at 0.35 + 0.5 + 0.05 = 0.9s
    vi.advanceTimersByTime(1500)
    expect(ctx().state).toBe('running')
    vi.advanceTimersByTime(500)
    expect(ctx().state).toBe('suspended')
    expect(ctx().suspends).toBe(1)
  })

  it('a later tone pushes the sleep out instead of cutting itself short', () => {
    sound.beep(true, 660, 0.1)                // 3
    vi.advanceTimersByTime(1000)
    sound.beep(true, 660, 0.1)                // 2
    vi.advanceTimersByTime(1000)
    sound.beep(true, 660, 0.1)                // 1
    vi.advanceTimersByTime(1000)
    sound.beep(true, 880, 0.15, 0); sound.beep(true, 880, 0.15, 0.25)   // 0: last tone ends at 0.25 + 0.15 + 0.05 = 0.45s
    expect(ctx().suspends).toBe(0)
    vi.advanceTimersByTime(1400)
    expect(ctx().state).toBe('running')
    vi.advanceTimersByTime(100)
    expect(ctx().state).toBe('suspended')
    expect(ctx().suspends).toBe(1)
  })

  it('a short tone scheduled during a longer one does not shorten the longer one\'s sleep', () => {
    sound.beep(true, 880, 0.5)                // ends 0.55s → sleep at 1.55s
    sound.beep(true, 660, 0.1)                // ends 0.15s → must not pull the sleep to 1.15s
    vi.advanceTimersByTime(1200)
    expect(ctx().state).toBe('running')
    vi.advanceTimersByTime(400)
    expect(ctx().state).toBe('suspended')
  })
})

describe('unlock from a tap', () => {
  it('gets the context created and running, without a tone', () => {
    sound.unlock(true)
    expect(FakeCtx.instances).toHaveLength(1)
    expect(ctx().state).toBe('running')
    expect(ctx().tones).toHaveLength(0)
  })

  it('lets the context sleep again on its own', () => {
    sound.unlock(true)
    vi.advanceTimersByTime(1000)
    expect(ctx().state).toBe('suspended')
  })

  it('a tick after the tap finds a context it can resume rather than one it must create', () => {
    sound.unlock(true)
    vi.advanceTimersByTime(1000)
    sound.beep(true, 660, 0.1)
    expect(FakeCtx.instances).toHaveLength(1)
    expect(ctx().state).toBe('running')
  })
})

describe('play on silent (Settings switch, WebKit only)', () => {
  it('is offered on an iPhone with the audio-session API', () => {
    expect(sound.playOnSilentSupported()).toBe(true)
  })

  it('is offered on an iPad, which calls itself a Mac with a touch screen', () => {
    setDevice(MAC, 5)
    expect(sound.playOnSilentSupported()).toBe(true)
  })

  it('is not offered on macOS Safari: it has the API but no ring/silent switch', () => {
    setDevice(MAC, 0)
    expect(sound.playOnSilentSupported()).toBe(false)
  })

  it('is not offered where navigator.audioSession does not exist', () => {
    Object.defineProperty(navigator, 'audioSession', { value: undefined, configurable: true, writable: true })
    expect(sound.playOnSilentSupported()).toBe(false)
  })

  it("on: the page's audio session becomes 'playback', which ignores the ring/silent switch", () => {
    sound.setPlayOnSilent(true)
    expect(session.type).toBe('playback')
  })

  it("off: hands the choice back to the browser ('auto')", () => {
    sound.setPlayOnSilent(true)
    sound.setPlayOnSilent(false)
    expect(session.type).toBe('auto')
  })

  it('is a no-op in a browser without navigator.audioSession', () => {
    Object.defineProperty(navigator, 'audioSession', { value: undefined, configurable: true, writable: true })
    expect(() => sound.setPlayOnSilent(true)).not.toThrow()
  })

  it('survives a browser that rejects the type', () => {
    Object.defineProperty(navigator, 'audioSession', { value: Object.freeze({ type: 'auto' }), configurable: true, writable: true })
    expect(() => sound.setPlayOnSilent(true)).not.toThrow()
  })
})

// Discord, "Rest Timer Sound Notification too Quiet": the end of a rest has to carry over music.
describe('the chime at the end of a rest or a hold', () => {
  const peakOf = events => Math.max(...events.map(([, v]) => v))

  it('makes no sound and no context with sounds off', () => {
    sound.chime(false)
    expect(FakeCtx.instances).toHaveLength(0)
  })

  it('is high, low, high: none of the pitches of the countdown, a set tick or the finish fanfare', () => {
    sound.chime(true)
    const freqs = ctx().tones.map(tn => tn.freq)
    expect(freqs).toHaveLength(3)
    expect(freqs[0]).toBeGreaterThan(freqs[1])
    expect(freqs[2]).toBe(freqs[0])
    for (const other of [660, 1040, 880, 1100, 1320]) expect(freqs).not.toContain(other)
  })

  it('peaks well above a beep and below the point where the output clips', () => {
    sound.beep(true, 660, 0.1)
    const beepPeak = peakOf(ctx().gains[0])
    sound.chime(true)
    const chimePeaks = ctx().gains.slice(1).map(peakOf)
    expect(beepPeak).toBe(0.35)
    for (const p of chimePeaks) {
      expect(p).toBe(sound.CHIME_PEAK)
      expect(p).toBeGreaterThan(beepPeak * 2)
      expect(p).toBeLessThanOrEqual(1)
    }
  })

  it('never has two notes sounding at once, so they cannot add up past the peak', () => {
    sound.chime(true)
    const notes = ctx().oscs
    for (let i = 1; i < notes.length; i++) expect(notes[i].at).toBeGreaterThanOrEqual(notes[i - 1].until)
  })

  it('holds its peak for most of each note instead of fading from the start', () => {
    sound.chime(true)
    const first = ctx().gains[0]
    const held = first.find(([kind, v, at]) => kind === 'set' && v === sound.CHIME_PEAK && at > 0.05)
    expect(held).toBeTruthy()
  })

  it('uses one brighter periodic wave for all its notes', () => {
    sound.chime(true)
    expect(ctx().waves).toBe(1)
    expect(ctx().oscs.every(o => o.wave && o.wave.imag.filter(Boolean).length > 1)).toBe(true)
  })

  it('falls back to a triangle wave without createPeriodicWave', async () => {
    class NoWaveCtx extends FakeCtx {}
    NoWaveCtx.prototype.createPeriodicWave = undefined
    window.AudioContext = NoWaveCtx
    vi.resetModules()
    sound = await import('./sound.js')
    sound.chime(true)
    expect(ctx().oscs.map(o => o.type)).toEqual(['triangle', 'triangle', 'triangle'])
  })

  it('leaves the plain beeps a sine at their old level', () => {
    sound.beep(true, 1040, 0.12)
    expect(ctx().oscs[0].type).toBe('sine')
    expect(ctx().oscs[0].wave).toBeNull()
  })

  it('lets the context sleep once its last note is over', () => {
    sound.chime(true)          // the last note ends at 0.44 + 0.5 + 0.05 = 0.99s
    vi.advanceTimersByTime(1900)
    expect(ctx().state).toBe('running')
    vi.advanceTimersByTime(200)
    expect(ctx().state).toBe('suspended')
  })
})

// Settings → "Classic timer sound": the exact three beeps this replaced, picked back with a
// second argument rather than reviving the old inline beep() calls at the call sites.
describe('chime(enabled, classic) — the original three beeps', () => {
  it('makes no sound with sounds off, classic or not', () => {
    sound.chime(false, true)
    expect(FakeCtx.instances).toHaveLength(0)
  })

  it('is the same three tones and timing as the original beep() calls: 880, 880, 1320 Hz', () => {
    sound.chime(true, true)
    const tones = ctx().tones
    expect(tones.map(tn => tn.freq)).toEqual([880, 880, 1320])
    expect(tones.map(tn => tn.at)).toEqual([0, 0.25, 0.5])
  })

  it('peaks at a plain beep\'s level, not the louder chime\'s', () => {
    sound.chime(true, true)
    const peakOf = events => Math.max(...events.map(([, v]) => v))
    for (const gain of ctx().gains) expect(peakOf(gain)).toBe(0.35)
  })

  it('fades from the start instead of holding its peak', () => {
    sound.chime(true, true)
    const first = ctx().gains[0]
    const held = first.find(([kind, v, at]) => kind === 'set' && v === 0.35 && at > 0.05)
    expect(held).toBeFalsy()
  })

  it('is a plain sine, not the brighter periodic wave', () => {
    sound.chime(true, true)
    expect(ctx().waves).toBe(0)
    expect(ctx().oscs.every(o => o.type === 'sine' && o.wave === null)).toBe(true)
  })
})

// #306: a few more end-of-rest sounds to pick from, each its own shape, none of them clipping.
describe('the end-of-rest sounds (Settings → Sound)', () => {
  const peakOf = events => Math.max(...events.map(([, v]) => v))
  // The module keeps its context between sounds: start each one's record over.
  const fresh = () => { const c = ctx(); if (c) { c.tones = []; c.gains = []; c.oscs = [] } }
  // The loudest the notes of a sound can add up to, sampling each one's gain curve as Web Audio
  // would run it: up from 0.001 in 20 ms, held, then down to 0.001 by the note's end.
  const loudest = name => {
    const { notes, peak = 0.35, hold = 0 } = sound.REST_SOUNDS[name]
    const gain = (t, dur) => {
      const end = Math.max(0.02, dur * hold)
      if (t < 0 || t > dur) return 0
      if (t < 0.02) return 0.001 * Math.pow(peak / 0.001, t / 0.02)
      if (t < end) return peak
      return peak * Math.pow(0.001 / peak, (t - end) / (dur - end))
    }
    let max = 0
    for (let t = 0; t < 3; t += 0.001) max = Math.max(max, notes.reduce((a, [, dur, when]) => a + gain(t - when, dur), 0))
    return max
  }

  it('offers the chime, the classic beeps and four more, each sounding different', () => {
    expect(sound.REST_SOUND_IDS).toEqual(['chime', 'classic', 'bell', 'beep', 'whistle', 'soft'])
    const shapes = new Set()
    for (const id of sound.REST_SOUND_IDS) {
      fresh()
      sound.chime(true, id)
      shapes.add(JSON.stringify(ctx().tones))
    }
    expect(shapes.size).toBe(sound.REST_SOUND_IDS.length)
  })

  it('never adds up past the point where the output clips', () => {
    for (const id of sound.REST_SOUND_IDS) expect(loudest(id), id).toBeLessThanOrEqual(1)
  })

  it('plays each note at its own peak, in its own timbre', () => {
    sound.chime(true, 'bell')
    expect(ctx().gains.map(peakOf)).toEqual([0.55, 0.55])
    expect(ctx().oscs.every(o => o.wave && o.wave.imag[3] === 0.5)).toBe(true)   // the bell's strong 3rd
    fresh()
    sound.chime(true, 'soft')
    expect(ctx().oscs.every(o => o.type === 'sine')).toBe(true)
    expect(Math.max(...ctx().gains.map(peakOf))).toBeLessThan(sound.CHIME_PEAK / 2)
  })

  it('glides the whistle upwards, and nothing else', () => {
    sound.chime(true, 'whistle')
    expect(ctx().oscs.map(o => o.frequency.ramps.map(([v]) => v))).toEqual([[2100], [2500]])
    fresh()
    sound.chime(true, 'bell')
    expect(ctx().oscs.every(o => !o.frequency.ramps.length)).toBe(true)
  })

  it('falls back to the chime for a name it does not know, and true still means classic', () => {
    sound.chime(true, 'kazoo')
    expect(ctx().tones.map(tn => tn.freq)).toEqual([1319, 988, 1319])
    fresh()
    sound.chime(true, true)
    expect(ctx().tones.map(tn => tn.freq)).toEqual([880, 880, 1320])
  })

  it('reads the profile\'s pick, with the old classic switch and an older app\'s later choice', () => {
    expect(sound.restSoundOf({})).toBe('chime')
    expect(sound.restSoundOf(undefined)).toBe('chime')
    expect(sound.restSoundOf({ restSound: 'bell' })).toBe('bell')
    expect(sound.restSoundOf({ restSound: 'kazoo' })).toBe('chime')
    expect(sound.restSoundOf({ classicChime: true })).toBe('classic')
    // an older app switched to Classic after this one picked the bell: classic it is
    expect(sound.restSoundOf({ restSound: 'bell', classicChime: true })).toBe('classic')
    // an older app switched Classic off again: back to the chime, not classic
    expect(sound.restSoundOf({ restSound: 'classic', classicChime: false })).toBe('chime')
  })
})

// Discord (asierlama): vibration on or off on its own, the way sound is.
describe('vibrate switch', () => {
  let calls
  beforeEach(() => {
    calls = []
    Object.defineProperty(navigator, 'vibrate', { value: p => { calls.push(p); return true }, configurable: true, writable: true })
  })
  afterEach(() => { delete navigator.vibrate })

  it('buzzes by default', () => {
    sound.vibrate([200, 100, 200])
    expect(calls).toEqual([[200, 100, 200]])
  })

  it('stays still once switched off, and buzzes again once switched back on', () => {
    sound.setVibrate(false)
    sound.vibrate(30)
    expect(calls).toEqual([])
    sound.setVibrate(true)
    sound.vibrate(30)
    expect(calls).toEqual([30])
  })

  it('reads a profile that never chose as on', () => {
    sound.setVibrate(false)
    sound.setVibrate(undefined)
    sound.vibrate(30)
    expect(calls).toEqual([30])
  })

  it('is offered only where the browser can vibrate', () => {
    expect(sound.vibrateSupported()).toBe(true)
    delete navigator.vibrate
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true })
    expect(sound.vibrateSupported()).toBe(false)
    expect(() => sound.vibrate(30)).not.toThrow()
  })
})

// #375: the end of a rest or a hold, with "Vibrate when the phone is on silent" on in the Android
// app, buzzes through the native alarm buzz App.jsx hands in; anything else is an ordinary buzz.
describe('alertBuzz', () => {
  let calls
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  beforeEach(() => {
    calls = []
    Object.defineProperty(navigator, 'vibrate', { value: p => { calls.push(p); return true }, configurable: true, writable: true })
  })
  afterEach(() => { delete navigator.vibrate; sound.setAlarmBuzzer(null) })

  it('without a native buzzer it is the ordinary buzz', () => {
    sound.alertBuzz([200, 100, 200])
    expect(calls).toEqual([[200, 100, 200]])
  })

  it('with one it goes there, and not also the ordinary way', async () => {
    const native = vi.fn(async () => true)
    sound.setAlarmBuzzer(native)
    sound.alertBuzz([200, 100, 200])
    await flush()
    expect(native).toHaveBeenCalledWith([200, 100, 200])
    expect(calls).toEqual([])
  })

  it('falls back to the ordinary buzz when the native one could not, or threw', async () => {
    sound.setAlarmBuzzer(async () => false)
    sound.alertBuzz([200])
    await flush()
    sound.setAlarmBuzzer(() => { throw new Error('bridge gone') })
    sound.alertBuzz([300])
    await flush()
    sound.setAlarmBuzzer(() => Promise.reject(new Error('no plugin')))
    sound.alertBuzz([400])
    await flush()
    expect(calls).toEqual([[200], [300], [400]])
  })

  it('Vibrate off is off for it too', async () => {
    const native = vi.fn(async () => true)
    sound.setAlarmBuzzer(native)
    sound.setVibrate(false)
    sound.alertBuzz([200, 100, 200])
    await flush()
    expect(native).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})

// A timer counts you back in out loud. The whole burst is queued when the timer starts, because
// the thing that used to beep it, a one-second interval, is throttled to nothing in a
// backgrounded tab, which is where a phone spends a rest.
describe('the count-in to the end of a timer', () => {
  const cancelled = () => ctx().stops.filter(st => st.at === 0)

  it('queues five ticks a second apart, the last one a second before the timer ends', () => {
    sound.countdown(true, 90)
    expect(ctx().tones).toEqual([85, 86, 87, 88, 89].map(at => ({ freq: 660, at })))
  })

  it('each tick is the one the tick-by-tick count-in beeped: 660 Hz for 0.1 s, at a beep\'s level', () => {
    sound.countdown(true, 1)
    expect(ctx().oscs[0].type).toBe('sine')
    expect(+(ctx().stops[0].at - ctx().tones[0].at - 0.05).toFixed(3)).toBe(0.1)   // tone() stops 0.05 s after its length
    expect(Math.max(...ctx().gains[0].map(([, v]) => v))).toBe(0.35)
  })

  // The time left comes in fractions (the rest's end against the clock now): the ticks are placed
  // against it, so the last one is still a second before the end and never on the end's sound.
  it('counts against the time really left, fractions included', () => {
    sound.countdown(true, 94.25)
    expect(ctx().tones.map(tn => tn.at)).toEqual([89.25, 90.25, 91.25, 92.25, 93.25])
  })

  it('a timer shorter than the count-in counts down from what it has', () => {
    sound.countdown(true, 3)
    expect(ctx().tones).toEqual([0, 1, 2].map(at => ({ freq: 660, at })))
  })

  it('queues nothing with sounds off, and nothing for a timer with no time left', () => {
    sound.countdown(false, 90)
    sound.countdown(true, 0)
    expect(FakeCtx.instances).toHaveLength(0)
  })

  it('is called off by hush, so a rest you skip does not tick on without you', () => {
    sound.countdown(true, 90)
    const queued = ctx().tones.length
    sound.hush()
    expect(cancelled()).toHaveLength(queued)
  })

  it('queuing it again (+15 s) calls off the ticks the old end had', () => {
    sound.countdown(true, 20)
    sound.countdown(true, 35)
    expect(cancelled()).toHaveLength(5)
    expect(ctx().tones.slice(5)).toEqual([30, 31, 32, 33, 34].map(at => ({ freq: 660, at })))
  })

  it('leaves the rest-end sound alone: hush only calls off the ticks it queued', () => {
    sound.chime(true, 'bell')
    sound.hush()
    expect(cancelled()).toHaveLength(0)
  })

  it('keeps the context awake until the last tick, not just the first', () => {
    sound.countdown(true, 90)                 // last tick ends at 89 + 0.1 + 0.05
    vi.advanceTimersByTime(90000)
    expect(ctx().state).toBe('running')
    vi.advanceTimersByTime(200)
    expect(ctx().state).toBe('suspended')
  })
})

