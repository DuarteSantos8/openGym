// @vitest-environment happy-dom
// The watch relay (lib/watch-relay.js, docs/ZEPP_OS.md): a WatchBridge over the user's own server,
// so lib/watch-sync.js runs its one sync over it. The snapshot goes up as the native link sends it,
// the watch's events come down and go through the same actions, acknowledged once applied.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relayBridge, relayChanged, relayPairCode, relayUnlink, relayLinks } from './watch-relay.js'
import { startLinkSync, bindWatchActions, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => { _resetWatchSync(); vi.useRealTimers() })

function store(initial) {
  let st = initial
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) },
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
}

// The server, as lib/api.js api() answers for it.
function server({ paired = 1, events = [] } = {}) {
  const box = { snapshot: null, events: [...events], paired, seen: 0 }
  const calls = []
  const call = vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    calls.push(method + ' ' + path)
    if (path === '/api/watch/events') return { events: box.events, paired: box.paired, seen: box.seen }
    if (path === '/api/watch/snapshot') { box.snapshot = body.json; return { ok: true } }
    if (path === '/api/watch/ack') { box.events = box.events.filter(e => !body.ids.includes(e.id)); return { ok: true } }
    throw Object.assign(new Error('404'), { status: 404 })
  })
  return { box, calls, call }
}

const workout = () => ({
  unit: 'kg', restSec: 90, workouts: [], routines: [],
  active: { id: 'w-1', name: 'Push day', start: Date.now() - 60e3, entries: [{ id: '0025', target: { sets: 2, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }] },
})

describe('the relay bridge', () => {
  it('says there is a watch only when the server has one paired', async () => {
    const s = server({ paired: 0 })
    expect(await relayBridge({ call: s.call }).status()).toMatchObject({ paired: false, installed: false })
    s.box.paired = 2
    s.box.seen = Date.now()
    expect(await relayBridge({ call: s.call }).status()).toMatchObject({ paired: true, installed: true, reachable: true })
  })

  it('asks nobody while signed out, and takes a server that cannot answer for no watch', async () => {
    const s = server()
    expect(await relayBridge({ call: s.call, signedIn: () => false }).status()).toMatchObject({ paired: false })
    expect(s.call).not.toHaveBeenCalled()
    const down = vi.fn(async () => { throw new Error('offline') })
    expect(await relayBridge({ call: down }).status()).toMatchObject({ paired: false })
  })

  it('sends nothing before it knows of a watch', async () => {
    const s = server()
    const b = relayBridge({ call: s.call })
    expect(await b.sendSnapshot({ json: '{"v":1}' })).toEqual({ sent: false })
    expect(await b.drain()).toEqual({ events: [] })
    expect(s.call).not.toHaveBeenCalled()
  })

  it('looks for events while the page is in front, not while it is hidden', async () => {
    vi.useFakeTimers()
    const s = server()
    const doc = { visibilityState: 'visible' }
    const b = relayBridge({ call: s.call, doc, pollMs: 1000 })
    await b.status()
    const fn = vi.fn()
    const sub = b.addListener('watchEvent', fn)
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)
    doc.visibilityState = 'hidden'
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(3)
    sub.remove()
    const st = vi.fn()
    b.addListener('watchState', st)
    relayChanged()
    expect(st).toHaveBeenCalledTimes(1)
  })

  it('pairs, lists and unpairs through the server', async () => {
    const call = vi.fn(async path => (path === '/api/watch/pair' ? { code: 'AAAA-BBBB-CCCC', exp: 5 } : { links: [{ id: 'x' }] }))
    expect(await relayPairCode(call)).toEqual({ code: 'AAAA-BBBB-CCCC', exp: 5 })
    expect(await relayLinks(call)).toEqual([{ id: 'x' }])
    expect(await relayUnlink('x', call)).toEqual([{ id: 'x' }])
    expect(call).toHaveBeenLastCalledWith('/api/watch/unlink', { method: 'POST', body: '{"id":"x"}' })
  })
})

describe('the sync over the relay', () => {
  it('puts the snapshot on the server and applies what the watch left there, once', async () => {
    vi.useFakeTimers()
    const ev = { id: 'z-1', type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 62.5, r: 8, at: 1761743100000, hr: { avg: 128, max: 141 } }
    const s = server({ events: [ev] })
    const st = store({ S: workout(), ready: true, saveNow: vi.fn(async () => {}) })
    const setDone = vi.fn()
    bindWatchActions({ setDone })
    const stop = await startLinkSync(relayBridge({ call: s.call }), { useStore: st, useUI: store({ timer: null }) }, { health: false, clips: false })
    await vi.runOnlyPendingTimersAsync()
    const snap = JSON.parse(s.box.snapshot)
    expect(snap.active).toMatchObject({ id: 'w-1', name: 'Push day' })
    expect(snap.active.entries[0]).toMatchObject({ id: '0025', name: 'Barbell Bench Press' })
    // no Apple Health on a Zepp watch: nothing to measure there
    expect(snap.settings.health).toBe(false)
    expect(setDone).toHaveBeenCalledTimes(1)
    expect(setDone).toHaveBeenCalledWith(0, 0, { w: 62.5, r: 8, at: 1761743100000, hr: { avg: 128, max: 141 } })
    expect(s.box.events).toEqual([])
    expect(st.getState().saveNow).toHaveBeenCalled()
    stop()
  })

  it('without a paired watch, puts nothing on the server', async () => {
    vi.useFakeTimers()
    const s = server({ paired: 0 })
    const st = store({ S: workout(), ready: true })
    const stop = await startLinkSync(relayBridge({ call: s.call }), { useStore: st, useUI: store({ timer: null }) }, { health: false, clips: false })
    await vi.runOnlyPendingTimersAsync()
    st.setState({ S: { ...workout(), restSec: 120 } })
    await vi.runOnlyPendingTimersAsync()
    expect(s.calls.filter(c => c.startsWith('PUT'))).toEqual([])
    stop()
  })
})
