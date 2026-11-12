// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { noteHeard, checkLinks, linkSnapshot, onLinkChange, _resetDeviceLink } from './device-link-live.js'
import { drainWatchEvents, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { readWatchSeen } from './watch-settings.js'

const T = 1_000_000_000
const S = { modules: {}, active: { id: 'w1', start: T - 120_000 } }
const state = { S, ready: true, saveNow: async () => {} }

function plugin(over = {}) {
  return {
    status: vi.fn(async () => ({ paired: true, installed: true, activated: true, reachable: false })),
    ping: vi.fn(async () => ({ ok: true, ms: 200 })),
    drain: vi.fn(async () => ({ events: [] })),
    ack: vi.fn(async () => ({})),
    ...over,
  }
}
const watchRow = (now = T) => linkSnapshot(now).rows.find(r => r.id === 'watch')

beforeEach(() => { localStorage.clear(); _resetWatchSync(); _resetDeviceLink() })
afterEach(() => { _resetWatchSync(); _resetDeviceLink() })

describe('the live link signals', () => {
  it('noteHeard then linkSnapshot shows live, delayed, offline as time passes', async () => {
    _setWatchPluginForTest(plugin(), () => state)
    await checkLinks()
    noteHeard('w1', T)
    expect(watchRow(T + 30_000)).toMatchObject({ state: 'delayed' })
    expect(watchRow(T + 90_000)).toMatchObject({ state: 'offline', lastHeard: T })
  })

  it('checkLinks is single-flight', async () => {
    const p = plugin()
    _setWatchPluginForTest(p, () => state)
    await Promise.all([checkLinks(), checkLinks({ ping: true })])
    expect(p.status).toHaveBeenCalledTimes(1)
  })

  it('a drained event stamps last heard', async () => {
    const p = plugin({ drain: vi.fn(async () => ({ events: [{ id: 'e1', type: 'setDone', wid: 'w1' }] })) })
    _setWatchPluginForTest(p, () => state)
    await checkLinks()
    await drainWatchEvents()
    expect(watchRow(Date.now() + 90_000)).toMatchObject({ state: 'offline' })
  })

  it('a ping success stamps heard and speed, and says the watch is seen', async () => {
    _setWatchPluginForTest(plugin({ status: vi.fn(async () => ({ paired: true, installed: true, reachable: true })) }), () => state)
    const seen = vi.fn()
    const off = onLinkChange(seen)
    await checkLinks({ ping: true })
    off()
    expect(watchRow(Date.now())).toMatchObject({ state: 'live', speed: 'fast' })
    expect(readWatchSeen()).toBe(true)
    expect(seen).toHaveBeenCalled()
  })

  it('never pings a watch that is not reachable', async () => {
    const p = plugin()
    _setWatchPluginForTest(p, () => state)
    await checkLinks({ ping: true })
    expect(p.ping).not.toHaveBeenCalled()
  })
})
