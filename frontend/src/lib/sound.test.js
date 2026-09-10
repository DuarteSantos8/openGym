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
    this.resumes = 0
    this.suspends = 0
    FakeCtx.instances.push(this)
  }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve() }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve() }
  createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } } }
  createOscillator() {
    const ctx = this
    const o = { frequency: { value: 0 }, type: '', connect() {}, start(at) { ctx.tones.push({ freq: o.frequency.value, at }) }, stop() {} }
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

  it('does not call resume on a context that is already running', () => {
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
