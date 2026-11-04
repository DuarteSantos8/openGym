// @vitest-environment happy-dom
// A Garmin on the phone's watch link (docs/GARMIN.md): when WatchBridge.status says one is there,
// every snapshot goes along with its cut-down Garmin copy (lib/garmin-snapshot.js), and Settings →
// Modules → Watch off pauses it like every other watch. The link is remembered for the Modules page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({ loadHealth: async () => ({ on: false }), onHealthChange: () => () => {} }))

import { startWatchSync, startLinkSync, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { readGarminLink, writeWatchPrefs } from './watch-settings.js'
import { GARMIN_SNAPSHOT_VERSION } from './garmin-snapshot.js'

function store(initial) {
  const split = state => {
    if (!state.S || !Object.hasOwn(state.S, 'active')) return state
    const { active, ...S } = state.S
    return { ...state, S, A: active }
  }
  let st = split(initial)
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { const prev = st; st = { ...st, ...split(patch) }; subs.forEach(fn => fn(st, prev)) },
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
}

function bridge(status = { paired: true, installed: true, garmin: true }) {
  return {
    status: vi.fn(async () => status),
    sendSnapshot: vi.fn(async () => ({ sent: true })),
    sendClips: vi.fn(async () => ({})),
    dropClips: vi.fn(async () => ({})),
    openOnWatch: vi.fn(async () => ({ ok: true })),
    drain: vi.fn(async () => ({ events: [] })),
    ack: vi.fn(async () => ({})),
    addListener: vi.fn(async () => ({ remove: () => {} })),
  }
}

const S0 = { unit: 'kg', restSec: 90, workouts: [], routines: [], active: null }
const active = { id: 'w-1', start: 1, cur: 0, entries: [{ id: '0025', sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }] }] }
const ui = store({ timer: null })
const lastCall = b => b.sendSnapshot.mock.calls.at(-1)[0]

async function run(b, S, link = false) {
  _setWatchPluginForTest(b)
  const st = store({ S })
  _setWatchPluginForTest(b, () => st.getState())
  const stop = link ? await startLinkSync(b, { useStore: st, useUI: ui }, { health: false, clips: false }) : await startWatchSync({ useStore: st, useUI: ui })
  st.setState({ S: { ...S } })
  await vi.runAllTimersAsync()
  return { st, stop }
}

beforeEach(() => { localStorage.clear(); _resetWatchSync(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('a Garmin on the watch link', () => {
  it('gets the cut-down snapshot next to the full one, and the link is remembered', async () => {
    const b = bridge()
    const { stop } = await run(b, { ...S0, active })
    const call = lastCall(b)
    expect(JSON.parse(call.json).active.id).toBe('w-1')
    const g = JSON.parse(call.garmin)
    expect(g.v).toBe(GARMIN_SNAPSHOT_VERSION)
    expect(g.active.id).toBe('w-1')
    expect(g.active.progress).toEqual([0, 2])
    expect(readGarminLink()).toBe(true)
    stop()
  })

  it('pauses with the Watch module: told there is nothing, still linked', async () => {
    const b = bridge()
    const { stop } = await run(b, { ...S0, active, modules: { watch: false } })
    const call = lastCall(b)
    expect(JSON.parse(call.json).active).toBe(null)
    const g = JSON.parse(call.garmin)
    expect(g.active).toBe(null)
    expect(g.ready).toBe(null)
    expect(g.streak).toBe(null)
    expect(readGarminLink()).toBe(true)
    stop()
  })

  it('pauses with the watch\'s own switch too', async () => {
    writeWatchPrefs({ enabled: false })
    const b = bridge()
    const { stop } = await run(b, { ...S0, active })
    expect(JSON.parse(lastCall(b).garmin).active).toBe(null)
    stop()
  })

  it('no Garmin, no Garmin copy, and the remembered link is cleared', async () => {
    localStorage.setItem('gym_garmin_link_v1', 'true')
    const b = bridge({ paired: true, installed: true })
    const { stop } = await run(b, { ...S0, active })
    expect(lastCall(b).garmin).toBeUndefined()
    expect(readGarminLink()).toBe(false)
    stop()
  })

  it('the Zepp relay never makes one, whatever its status says', async () => {
    const b = bridge()
    const { stop } = await run(b, { ...S0, active }, true)
    expect(lastCall(b).garmin).toBeUndefined()
    expect(readGarminLink()).toBe(false)
    stop()
  })
})
