// @vitest-environment happy-dom
// The phone's side of "open on the watch": a workout started on the phone opens the watch app
// (WatchBridge.openOnWatch, HealthKit's startWatchApp), and Apple Health on the watch follows the
// phone's Apple Health switch.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const health = vi.hoisted(() => ({ on: false, listeners: new Set() }))
vi.mock('./health-sync.js', () => ({
  loadHealth: async () => ({ on: health.on }),
  onHealthChange: cb => { health.listeners.add(cb); return () => health.listeners.delete(cb) },
}))

import { shouldOpenOnWatch, startWatchSync, applyEvents, bindWatchAppActions, _setWatchPluginForTest, _resetWatchSync, OPEN_ON_WATCH_WINDOW_MS } from './watch-sync.js'
import { WATCH_DEFAULTS, writeWatchPrefs } from './watch-settings.js'

const now = 1_800_000_000_000
const live = (over = {}) => ({ id: 'w-9', start: now - 1000, entries: [], ...over })

beforeEach(() => { localStorage.clear(); _resetWatchSync(); health.on = false; health.listeners.clear() })

describe('which workouts open the watch app', () => {
  const prefs = { ...WATCH_DEFAULTS }
  it('a new one started here a moment ago', () => {
    expect(shouldOpenOnWatch(null, live(), { prefs, now })).toBe(true)
    expect(shouldOpenOnWatch(live({ id: 'old' }), live(), { prefs, now })).toBe(true)
  })
  it('not the same one again, nor none', () => {
    expect(shouldOpenOnWatch(live(), live({ cur: 2 }), { prefs, now })).toBe(false)
    expect(shouldOpenOnWatch(live(), null, { prefs, now })).toBe(false)
  })
  it('not one restored at launch or synced in long after its start, nor a backfill', () => {
    expect(shouldOpenOnWatch(null, live({ start: now - OPEN_ON_WATCH_WINDOW_MS - 1 }), { prefs, now })).toBe(false)
    expect(shouldOpenOnWatch(null, live({ start: undefined }), { prefs, now })).toBe(false)
    expect(shouldOpenOnWatch(null, live({ backfill: { durationMin: 60 } }), { prefs, now })).toBe(false)
  })
  it('not with the switch off, or with the watch off altogether', () => {
    expect(shouldOpenOnWatch(null, live(), { prefs: { ...prefs, autoShow: false }, now })).toBe(false)
    expect(shouldOpenOnWatch(null, live(), { prefs: { ...prefs, enabled: false }, now })).toBe(false)
  })
  it('not one the watch started itself', () => {
    const start = vi.fn()
    bindWatchAppActions({ start, patchSet: vi.fn() })
    applyEvents([{ id: 'e1', type: 'start', wid: 'w-9', at: now, routineIds: [] }], () => ({ S: { active: null } }))
    expect(start).toHaveBeenCalled()
    expect(shouldOpenOnWatch(null, live(), { prefs, now })).toBe(false)
    expect(shouldOpenOnWatch(null, live({ id: 'w-other' }), { prefs, now })).toBe(true)
  })
})

// A store as small as zustand's: getState, setState, subscribe((s, prev)).
function store(initial) {
  let st = initial
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) },
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
}

function bridge({ installed = true } = {}) {
  return {
    status: vi.fn(async () => ({ paired: true, installed })),
    sendSnapshot: vi.fn(async () => ({ sent: true })),
    sendClips: vi.fn(async () => ({})),
    openOnWatch: vi.fn(async () => ({ ok: true })),
    drain: vi.fn(async () => ({ events: [] })),
    ack: vi.fn(async () => ({})),
    addListener: vi.fn(async () => ({ remove: () => {} })),
  }
}

describe('startWatchSync', () => {
  const S0 = { unit: 'kg', restSec: 90, workouts: [], routines: [], active: null }
  const ui = store({ timer: null })

  it('opens the watch app for a workout started on the phone, once', async () => {
    const b = bridge()
    _setWatchPluginForTest(b)
    const st = store({ S: S0 })
    const stop = await startWatchSync({ useStore: st, useUI: ui })
    st.setState({ S: { ...S0, active: live({ start: Date.now() }) } })
    st.setState({ S: { ...S0, active: live({ start: Date.now(), cur: 1 }) } })
    await new Promise(r => setTimeout(r, 0))
    expect(b.openOnWatch).toHaveBeenCalledTimes(1)
    expect(b.openOnWatch).toHaveBeenCalledWith({ type: undefined })   // nothing in it yet: strength training
    stop()
  })

  it('opens the watch app as a run for a run (#799)', async () => {
    const b = bridge()
    _setWatchPluginForTest(b)
    const st = store({ S: S0 })
    const stop = await startWatchSync({ useStore: st, useUI: ui })
    const entries = [{ id: '0685', target: { mode: 'cardio', min: 30 }, sets: [{ min: 30, speed: 10 }] }]
    st.setState({ S: { ...S0, active: live({ start: Date.now(), entries }) } })
    await new Promise(r => setTimeout(r, 0))
    expect(b.openOnWatch).toHaveBeenCalledWith({ type: 'running' })
    stop()
  })

  it('leaves the watch alone without the app on it, or with the switch off', async () => {
    const b = bridge({ installed: false })
    _setWatchPluginForTest(b)
    const st = store({ S: S0 })
    const stop = await startWatchSync({ useStore: st, useUI: ui })
    st.setState({ S: { ...S0, active: live({ start: Date.now() }) } })
    stop()
    const b2 = bridge()
    _setWatchPluginForTest(b2)
    writeWatchPrefs({ autoShow: false })
    const st2 = store({ S: S0 })
    const stop2 = await startWatchSync({ useStore: st2, useUI: ui })
    st2.setState({ S: { ...S0, active: live({ id: 'w-10', start: Date.now() }) } })
    await new Promise(r => setTimeout(r, 0))
    expect(b.openOnWatch).not.toHaveBeenCalled()
    expect(b2.openOnWatch).not.toHaveBeenCalled()
    stop2()
  })

  // Data safety: an empty copy at launch (storage evicted, the file mirror not read back yet) must
  // not tell the watch its workout is over, nor drain its queue against nothing.
  it('sends nothing and drains nothing before the store has its copy back', async () => {
    vi.useFakeTimers()
    try {
      const b = bridge()
      _setWatchPluginForTest(b)
      const st = store({ S: S0, ready: false })
      _setWatchPluginForTest(b, () => st.getState())
      const stop = await startWatchSync({ useStore: st, useUI: ui })
      await vi.runAllTimersAsync()
      expect(b.sendSnapshot).not.toHaveBeenCalled()
      expect(b.drain).not.toHaveBeenCalled()
      st.setState({ S: { ...S0, active: live({ start: Date.now() - 3600e3 }) }, ready: true })
      await vi.runAllTimersAsync()
      expect(b.drain).toHaveBeenCalled()
      expect(JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json).active.id).toBe('w-9')
      stop()
    } finally { vi.useRealTimers() }
  })

  // The link came up (WCSession activated) while the first status() was on its way: that
  // watchState event had no listener yet. The watch heard nothing until the app was reopened.
  it('sends to the watch when the link comes up during startup, before anyone listened', async () => {
    vi.useFakeTimers()
    try {
      const b = bridge()
      b.status.mockResolvedValueOnce({ activated: false, paired: false, installed: false })
      _setWatchPluginForTest(b)
      const stop = await startWatchSync({ useStore: store({ S: S0 }), useUI: ui })
      await vi.runAllTimersAsync()
      expect(b.sendSnapshot).toHaveBeenCalled()
      stop()
    } finally { vi.useRealTimers() }
  })

  // A watch app installed or reinstalled while the phone app runs starts with nothing: the same
  // snapshot goes again (the native side stamps it, so iOS delivers it although it is unchanged).
  it('sends the same snapshot again when the watch link changes', async () => {
    vi.useFakeTimers()
    try {
      const b = bridge()
      const heard = {}
      b.addListener = vi.fn(async (name, fn) => { heard[name] = fn; return { remove: () => {} } })
      _setWatchPluginForTest(b)
      const stop = await startWatchSync({ useStore: store({ S: S0 }), useUI: ui })
      await vi.runAllTimersAsync()
      expect(b.sendSnapshot).toHaveBeenCalledTimes(1)
      heard.watchState({ installed: true })
      await vi.runAllTimersAsync()
      expect(b.sendSnapshot).toHaveBeenCalledTimes(2)
      expect(b.sendSnapshot.mock.calls[1][0].json).toBe(b.sendSnapshot.mock.calls[0][0].json)
      stop()
    } finally { vi.useRealTimers() }
  })

  it('tells the watch the phone\'s Apple Health switch, and again when it changes', async () => {
    vi.useFakeTimers()
    try {
      health.on = true
      const b = bridge()
      _setWatchPluginForTest(b)
      const st = store({ S: S0 })
      const stop = await startWatchSync({ useStore: st, useUI: ui })
      await vi.runAllTimersAsync()
      const sent = () => JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json).settings
      expect(sent().health).toBe(true)
      health.listeners.forEach(fn => fn({ on: false }))
      await vi.runAllTimersAsync()
      expect(sent().health).toBe(false)
      stop()
    } finally { vi.useRealTimers() }
  })
})
