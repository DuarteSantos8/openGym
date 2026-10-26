// @vitest-environment happy-dom
// A workout discarded on the phone while the watch runs it (#776): the snapshot names it, so the
// watch drops its Apple Health workout instead of saving it as if it had been finished.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({
  loadHealth: async () => ({ on: true }),
  onHealthChange: () => () => {},
}))

import { startWatchSync, markDiscarded, discardedFor, _setWatchPluginForTest, _resetWatchSync, DISCARDED_FOR_MS } from './watch-sync.js'

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
    addListener: vi.fn(async () => ({ remove: () => {} })),
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
