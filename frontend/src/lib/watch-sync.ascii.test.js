// @vitest-environment happy-dom
// The iPhone's snapshot travels as ASCII: WatchConnectivity stores a string with any other character
// as UTF-16, which doubled the snapshot (one "×" was enough) and took heavy workouts over its limit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let platform = 'ios'
vi.mock('./mobile.js', async orig => ({ ...(await orig()), nativePlatform: async () => platform }))
vi.mock('./health-sync.js', () => ({ loadHealth: async () => ({ on: false }), onHealthChange: () => () => {} }))

import { asciiJson, startWatchSync, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'

const ascii = s => [...s].every(c => c.charCodeAt(0) <= 0x7f)

describe('asciiJson', () => {
  it('reads back as the same object, with nothing beyond ASCII', () => {
    const obj = { line: '60 kg × 8', name: 'Día de pierna 💪', q: 'a "quote" \\ and \n', n: [1, 2.5] }
    const out = asciiJson(JSON.stringify(obj))
    expect(ascii(out)).toBe(true)
    expect(JSON.parse(out)).toEqual(obj)
  })

  it('keeps text mostly beyond ASCII as it is, where escaping would cost more than UTF-16', () => {
    const json = JSON.stringify({ name: 'Жим штанги лёжа на скамье' })
    expect(asciiJson(json)).toBe(json)
  })
})

describe('the snapshot the phone sends', () => {
  const store = initial => {
    let st = initial
    const subs = new Set()
    return {
      getState: () => st,
      setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) },
      subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
    }
  }
  const bridge = () => ({
    status: vi.fn(async () => ({ paired: true, installed: true })),
    sendSnapshot: vi.fn(async () => ({ sent: true })),
    sendClips: vi.fn(async () => ({})),
    dropClips: vi.fn(async () => ({})),
    drain: vi.fn(async () => ({ events: [] })),
    ack: vi.fn(async () => ({})),
    addListener: vi.fn(async () => ({ remove: () => {} })),
  })
  const S = { unit: 'kg', restSec: 90, workouts: [], routines: [], active: { id: 'w-1', name: 'Día × 2', start: 1, cur: 0, entries: [{ id: '0025', sets: [{ w: 60, r: 8 }] }] } }
  const sentJson = async () => {
    const b = bridge()
    const st = store({ S })
    _setWatchPluginForTest(b, () => st.getState())
    const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
    st.setState({ S: { ...S } })
    await vi.runAllTimersAsync()
    stop()
    return b.sendSnapshot.mock.calls.at(-1)[0].json
  }

  beforeEach(() => { localStorage.clear(); _resetWatchSync(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); platform = 'ios' })

  it('is escaped to ASCII on the iPhone, and reads back the same', async () => {
    const json = await sentJson()
    expect(ascii(json)).toBe(true)
    expect(JSON.parse(json).active.name).toBe('Día × 2')
  })

  it('goes as it is on Android (UTF-8 on the wire)', async () => {
    platform = 'android'
    const json = await sentJson()
    expect(json).toContain('Día × 2')
  })
})
