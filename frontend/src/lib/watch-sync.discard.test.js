// @vitest-environment happy-dom
// A workout discarded on the phone while the watch runs it (#776): the snapshot names it, so the
// watch drops its Apple Health workout instead of saving it as if it had been finished.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({
  loadHealth: async () => ({ on: true }),
  onHealthChange: () => () => {},
}))

import { startWatchSync, markDiscarded, discardedFor, leftUnsaved, _setWatchPluginForTest, _resetWatchSync, DISCARDED_FOR_MS } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

function store(initial) {
  let st = initial
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) },
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
}

function bridge() {
  return {
    status: vi.fn(async () => ({ paired: true, installed: true })),
    sendSnapshot: vi.fn(async () => ({ sent: true })),
    sendClips: vi.fn(async () => ({})),
    dropClips: vi.fn(async () => ({})),
    openOnWatch: vi.fn(async () => ({ ok: true })),
    drain: vi.fn(async () => ({ events: [] })),
    ack: vi.fn(async () => ({})),
    listeners: {},
    addListener: vi.fn(async function (name, fn) { this.listeners[name] = fn; return { remove: () => {} } }),
  }
}

describe('discarded workouts, for the watch', () => {
  const now = 1_800_000_000_000
  it('remembers the newest few, for a while', () => {
    markDiscarded('a', now)
    markDiscarded('b', now + 1)
    markDiscarded('a', now + 2)
    markDiscarded(null, now)
    expect(discardedFor(now + 3)).toEqual(['b', 'a'])
    expect(discardedFor(now + 1 + DISCARDED_FOR_MS)).toEqual(['a'])
    expect(discardedFor(now + 3 + DISCARDED_FOR_MS)).toEqual([])
    for (let i = 0; i < 20; i++) markDiscarded('x' + i, now)
    expect(discardedFor(now).length).toBeLessThanOrEqual(5)
  })

  it('goes out with the snapshot that ends the workout, a finished one does not', async () => {
    vi.useFakeTimers()
    try {
      const b = bridge()
      _setWatchPluginForTest(b)
      const S0 = { unit: 'kg', workouts: [], routines: [], active: { id: 'w-1', start: Date.now() - 60e3, entries: [] } }
      const st = store({ S: S0 })
      const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
      await vi.runAllTimersAsync()
      const last = () => JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json)
      expect(last().discarded).toBeUndefined()
      markDiscarded('w-1')
      st.setState({ S: { ...S0, active: null } })
      await vi.runAllTimersAsync()
      expect(last().active).toBe(null)
      expect(last().discarded).toEqual(['w-1'])
      stop()
    } finally { vi.useRealTimers() }
  })
})

// TestFlight 1.4.4: a workout discarded on the phone still turned up in Apple Health.
describe('a discard the watch hears about, whenever it can', () => {
  const W = { id: 'w-1', start: 1, entries: [] }
  it('a workout that leaves without landing in the history was discarded', () => {
    expect(leftUnsaved({ active: W, workouts: [] }, { active: null, workouts: [] })).toBe('w-1')
    expect(leftUnsaved({ active: W, workouts: [] }, { active: { id: 'w-2' }, workouts: [] })).toBe('w-1')
    // finished: in the history now
    expect(leftUnsaved({ active: W, workouts: [] }, { active: null, workouts: [{ id: 'w-1' }] })).toBe(null)
    expect(leftUnsaved({ active: W, workouts: [] }, { active: W, workouts: [] })).toBe(null)
    // the tour sets the real one aside, the editor and a past workout never reach the watch
    expect(leftUnsaved({ active: W, workouts: [] }, { active: null, workouts: [] }, { tour: true })).toBe(null)
    expect(leftUnsaved({ active: { ...W, editingWorkoutId: 'x' } }, { active: null })).toBe(null)
    expect(leftUnsaved({ active: { ...W, backfill: {} } }, { active: null })).toBe(null)
    expect(leftUnsaved({ active: null }, { active: null })).toBe(null)
  })

  it('never names one that runs or was saved after all', () => {
    markDiscarded('w-1')
    expect(discardedFor(Date.now(), { active: W, workouts: [] })).toEqual([])
    expect(discardedFor(Date.now(), { active: null, workouts: [{ id: 'w-1' }] })).toEqual([])
    expect(discardedFor(Date.now(), { active: null, workouts: [] })).toEqual(['w-1'])
  })

  const run = async (fn) => {
    vi.useFakeTimers()
    try { await fn() } finally { vi.useRealTimers() }
  }

  it('a watch away at the discard hears it, with the copy to take out of Apple Health, once it is back', () => run(async () => {
    const b = bridge()
    let linked = true
    b.status = vi.fn(async () => ({ paired: linked, installed: linked }))
    _setWatchPluginForTest(b)
    const S0 = { unit: 'kg', workouts: [], routines: [], active: { ...W, start: Date.now() - 60e3 } }
    const st = store({ ready: true, S: S0 })
    const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
    await vi.runAllTimersAsync()
    const sent = b.sendSnapshot.mock.calls.length
    // The watch goes away (unpaired for now, out of range): nothing goes out at the discard.
    linked = false
    await b.listeners.watchState()
    await vi.runAllTimersAsync()
    markDiscarded('w-1')
    st.setState({ S: { ...S0, active: null } })
    await vi.runAllTimersAsync()
    expect(b.sendSnapshot.mock.calls.length).toBe(sent)
    // Back hours later: the first snapshot names it.
    vi.advanceTimersByTime(3 * 3600e3)
    linked = true
    await b.listeners.watchState()
    await vi.runAllTimersAsync()
    const last = JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json)
    expect(last.active).toBe(null)
    expect(last.discarded).toEqual(['w-1'])
    expect(last.healthGone).toContain('opengym-w-w-1')
    stop()
  }))

  it('discarded on another device (synced in, nobody named it): the watch hears it all the same', () => run(async () => {
    const b = bridge()
    _setWatchPluginForTest(b)
    const S0 = { unit: 'kg', workouts: [], routines: [], active: { ...W, start: Date.now() - 60e3 } }
    const st = store({ ready: true, S: S0 })
    const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
    await vi.runAllTimersAsync()
    st.setState({ S: { ...S0, active: null } })
    await vi.runAllTimersAsync()
    const last = JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json)
    expect(last.discarded).toEqual(['w-1'])
    stop()
  }))

  it('finished, or set aside for the tour and back: never named', () => run(async () => {
    const b = bridge()
    _setWatchPluginForTest(b)
    const S0 = { unit: 'kg', workouts: [], routines: [], active: { ...W, start: Date.now() - 60e3 } }
    const st = store({ ready: true, tourSandbox: false, S: S0 })
    const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
    await vi.runAllTimersAsync()
    st.setState({ tourSandbox: true, S: { ...S0, active: null } })
    st.setState({ tourSandbox: false, S: S0 })
    await vi.runAllTimersAsync()
    st.setState({ S: { ...S0, active: null, workouts: [{ id: 'w-1', start: 1, end: 2, entries: [] }] } })
    await vi.runAllTimersAsync()
    const last = JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json)
    expect(last.active).toBe(null)
    expect(last.discarded).toBeUndefined()
    expect(last.healthGone || []).not.toContain('opengym-w-w-1')
    stop()
  }))
})
