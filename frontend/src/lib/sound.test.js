// @vitest-environment happy-dom
// lib/sound.js keeps one AudioContext per page; each test gets a fresh module so that state
// does not leak. The fake context records what the real one would be asked to do.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restKind } from './supersetFlow.js'

class FakeCtx {
  constructor() {
    this.state = 'suspended'      // what every browser hands back outside a user gesture
    this.currentTime = 0
    this.destination = {}
    this.tones = []
    this.stops = []               // a tone called off before it played stops at 0 (hush)
    this.peaks = []               // the loudness each tone ramps up to (Settings → Sound volume)
    this.waves = []               // and the waveform it uses, which is the other half of loud
    this.resumes = 0
    this.suspends = 0
    FakeCtx.instances.push(this)
  }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve() }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve() }
  // The envelope ramps up to the peak and back down to silence; only the first ramp is the level.
  createGain() {
    const ctx = this
    let peak = null
    return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime(v) { if (peak === null) { peak = v; ctx.peaks.push(v) } } } }
  }
  createOscillator() {
    const ctx = this
    const o = {
      frequency: { value: 0 }, type: '', connect() {},
      start(at) { ctx.tones.push({ freq: o.frequency.value, at }); ctx.waves.push(o.type) },
      stop(at) { ctx.stops.push({ freq: o.frequency.value, at }) },
    }
    return o
  }
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
  // Every frequency written in this file is the note as authored. The louder levels transpose
  // (see the volume block, which sets its own level), so the pattern tests pin the level that
  // plays them as written.
  sound.setVolume('low')
})
afterEach(() => { vi.useRealTimers() })

describe('sounds off', () => {
  it('creates no audio context and leaves the audio session alone', () => {
    sound.beep(false, 880, 0.15)
    sound.restOver(false, 'set')
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
    sound.restOver(true, 'block')            // last tone ends at 0.35 + 0.5 + 0.05 = 0.9s
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
    sound.restOver(true, 'set')               // 0: last tone ends at 0.25 + 0.15 + 0.05 = 0.45s
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

// A suspended context is not "playing media", and iOS then points the hardware volume buttons at
// the ringer rather than at the media channel the timer uses. Holding the context open for the
// length of a rest is what lets someone in a gym simply turn the phone up.
describe('the context is held open while a timer runs', () => {
  it('does not sleep between the beeps of a held burst', () => {
    sound.beep(true, 880, 0.15)
    sound.holdSession(true)
    vi.advanceTimersByTime(60000)
    expect(ctx().state).toBe('running')
    expect(ctx().suspends).toBe(0)
  })

  it('sleeps once the timer lets go', () => {
    sound.beep(true, 880, 0.15)
    sound.holdSession(true)
    vi.advanceTimersByTime(60000)
    sound.holdSession(false)
    vi.advanceTimersByTime(1100)
    expect(ctx().state).toBe('suspended')
  })

  it('holding gets the context running even when nothing has played yet', () => {
    sound.holdSession(true)
    expect(ctx().state).toBe('running')
    expect(ctx().tones).toHaveLength(0)
  })

  it('letting go without a context, or twice over, is harmless', () => {
    expect(() => { sound.holdSession(false); sound.holdSession(false) }).not.toThrow()
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

describe('one rest-over sound per kind of rest', () => {
  // The module keeps one context; read the tones this call added rather than resetting it.
  const seq = kind => { const before = ctx()?.tones.length || 0; sound.restOver(true, kind); return ctx().tones.slice(before).map(x => `${x.freq}@${x.at}`).join(' ') }

  it('set, round and block are three different sequences', () => {
    const set = seq('set'), round = seq('round'), block = seq('block')
    expect(new Set([set, round, block]).size).toBe(3)
  })

  it('has a sound of its own for every kind restKind can hand the timer', () => {
    const fallback = seq('no-such-kind')
    const kinds = new Set([
      restKind({ unitDone: false, superset: false }),
      restKind({ unitDone: false, superset: true }),
      restKind({ unitDone: true, superset: false }),
      restKind({ unitDone: true, superset: true }),
    ])
    expect(kinds).toEqual(new Set(['set', 'round', 'block']))
    for (const kind of kinds) if (kind !== 'set') expect(seq(kind)).not.toBe(fallback)
  })

  it('set: two mid beeps', () => {
    expect(seq('set')).toBe('880@0 880@0.25')
  })

  it('round: three quick high beeps', () => {
    expect(seq('round')).toBe('1100@0 1100@0.15 1100@0.3')
  })

  it('none of them opens on the countdown tick (660 Hz)', () => {
    for (const kind of ['set', 'round', 'block']) expect(seq(kind).startsWith('660@')).toBe(false)
  })

  it('block: a long two-note chime', () => {
    expect(seq('block')).toBe('880@0 1320@0.35')
  })

  it('an unknown or missing kind falls back to the set sound', () => {
    expect(seq(undefined)).toBe(seq('set'))
    expect(seq('whatever')).toBe(seq('set'))
  })
})

// A timer counts you back in out loud. The whole burst is queued when the timer starts, because
// the thing that used to beep it — a one-second interval — is throttled to nothing in a
// backgrounded tab, which is where a phone spends a rest.
describe('the countdown into the end of a timer', () => {
  const cancelled = () => ctx().stops.filter(s => s.at === 0)

  it('queues five ticks a second apart, the last one a second before the timer ends', () => {
    sound.countdown(true, 90)
    expect(ctx().tones).toEqual([85, 86, 87, 88, 89].map(at => ({ freq: 660, at })))
  })

  it('a timer shorter than the countdown counts down from what it has', () => {
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

  it('re-queuing (+15 s) calls off the ticks the old ending had', () => {
    sound.countdown(true, 20)
    sound.countdown(true, 35)
    expect(cancelled()).toHaveLength(5)
    expect(ctx().tones.slice(5)).toEqual([30, 31, 32, 33, 34].map(at => ({ freq: 660, at })))
  })

  it('leaves the rest-over sound alone: hush only calls off ticks it queued', () => {
    sound.restOver(true, 'block')
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

describe('how loud all of it is (Settings → Sound volume)', () => {
  const peak = () => ctx().peaks[ctx().peaks.length - 1]
  const wave = () => ctx().waves[ctx().waves.length - 1]

  it('is loud out of the box, including for settings saved before the choice existed', async () => {
    vi.resetModules()
    const fresh = await import('./sound.js')      // nothing has chosen a level on this one
    fresh.beep(true, 880, 0.15)
    expect(peak()).toBe(fresh.VOLUMES.loud.gain)
    expect(wave()).toBe(fresh.VOLUMES.loud.type)
  })

  it('an unset level is the loud one too, not silence', () => {
    sound.setVolume(undefined)
    sound.beep(true, 880, 0.15)
    expect(peak()).toBe(sound.VOLUMES.loud.gain)
  })

  it('three levels, all different, and loud is the loudest', () => {
    const gains = Object.values(sound.VOLUMES).map(v => v.gain)
    expect(new Set(gains).size).toBe(3)
    expect(Math.max(...gains)).toBe(sound.VOLUMES.loud.gain)
  })

  it('low is the one level every build before the setting shipped with: a pure tone at 0.35', () => {
    expect(sound.VOLUMES.low).toEqual({ gain: 0.35, type: 'sine', pitch: 1, tick: 0.1 })
  })

  // The part a phone actually hears. Gain is the knob the speaker's limiter eats — measured
  // twice: 0.35 -> 1.0 on a sine was inaudible, then square at 0.5 and square at 1.0 came out
  // the same as each other. What gets through is where the energy sits, so each level is a
  // different spectrum. The note never moves, so the patterns are still the patterns.
  // Gain is the knob the phone's limiter eats — measured twice on the device: 0.35 -> 1.0 on a
  // sine was inaudible, then square at 0.5 and square at 1.0 came out the same as each other.
  // A limiter can erase any difference that is only a multiplier, so no two levels are allowed
  // to differ by gain alone; each also moves the energy, which is what actually gets out of a
  // speaker that small.
  it('no two levels differ by gain alone — each moves where the energy is', () => {
    const shape = level => { sound.setVolume(level); sound.beep(true, 660, 0.1); return `${wave()}@${ctx().tones[ctx().tones.length - 1].freq}` }
    const shapes = ['low', 'medium', 'loud'].map(shape)
    expect(shapes).toEqual(['sine@660', 'square@660', 'square@1320'])
    expect(new Set(shapes).size).toBe(3)
  })

  it('loud is an octave up, where the driver is efficient and the ear is sensitive', () => {
    sound.setVolume('loud')
    sound.countdown(true, 1)          // the tick, written at 660
    sound.restOver(true, 'set')       // the rest-over, written at 880
    sound.beep(true, 1040, 0.12)      // a set check
    const played = ctx().tones.map(x => x.freq)
    expect(played).toEqual([1320, 1760, 1760, 2080])
    for (const f of played) expect(f).toBeGreaterThan(1200)
  })

  // The ear integrates loudness over about 200 ms, so a longer tick is heard as a louder one
  // for free. Only the countdown gets it: its ticks are a second apart, while the rest-over
  // patterns are 0.15 s apart and would run together and stop being countable.
  it('a louder level also holds each countdown tick longer, which the ear reads as louder', () => {
    // tone() stops an oscillator 0.05 s after its length, so the gap between start and stop is
    // the length the tick was actually given.
    const held = level => {
      sound.setVolume(level)
      sound.hush()                            // clear the previous level's tick, whose stop() would
      const t0 = ctx()?.tones.length || 0     // otherwise land in the middle of this measurement
      const s0 = ctx()?.stops.length || 0
      sound.countdown(true, 1)
      return +(ctx().stops[s0].at - ctx().tones[t0].at - 0.05).toFixed(3)
    }
    expect([held('low'), held('medium'), held('loud')]).toEqual([0.1, 0.15, 0.2])
    expect(sound.VOLUMES.loud.tick).toBeLessThanOrEqual(0.2)   // past ~200 ms the ear stops paying
  })

  it('the rest-over patterns keep their written lengths, so their beeps stay countable', () => {
    sound.setVolume('loud')
    sound.restOver(true, 'round')          // three ticks 0.15 s apart: the tightest pattern there is
    const starts = ctx().tones.map(x => x.at)
    expect(starts).toEqual([0, 0.15, 0.3])
    // each tone is 0.1 s as written — a loud countdown tick is 0.2 s and would smear these into one
    expect(sound.VOLUMES.loud.tick).toBeGreaterThan(0.15)
  })

  it('an octave, so every pattern survives transposing: same shape, same intervals', () => {
    const at = level => { sound.setVolume(level); const before = ctx()?.tones.length || 0; sound.restOver(true, 'block'); return ctx().tones.slice(before) }
    const written = at('medium'), up = at('loud')
    expect(up.map(x => x.at)).toEqual(written.map(x => x.at))            // same rhythm
    expect(up.map(x => x.freq)).toEqual(written.map(x => x.freq * 2))    // same interval
  })

  it('applies to every tone: set checks, the countdown and the rest-over sound', () => {
    sound.setVolume('low')
    sound.beep(true, 1040, 0.12)
    sound.countdown(true, 2)
    sound.restOver(true, 'block')
    expect(ctx().peaks).toHaveLength(5)
    expect(ctx().peaks.every(p => p === sound.VOLUMES.low.gain)).toBe(true)
    expect(ctx().waves.every(w => w === 'sine')).toBe(true)
  })

  it('an unknown level falls back to loud rather than to silence', () => {
    sound.setVolume('deafening')
    sound.beep(true, 880, 0.15)
    expect(peak()).toBe(sound.VOLUMES.loud.gain)
    expect(wave()).toBe(sound.VOLUMES.loud.type)
  })
})
