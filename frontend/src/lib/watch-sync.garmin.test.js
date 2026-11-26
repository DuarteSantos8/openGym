// @vitest-environment happy-dom
// A Garmin on the phone's watch link (docs/GARMIN.md): when WatchBridge.status says one is there,
// every snapshot goes along with its cut-down Garmin copy (lib/garmin-snapshot.js), and Settings →
// Modules → Watch off pauses it like every other watch. The link is remembered for the Modules page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({ loadHealth: async () => ({ on: false }), onHealthChange: () => () => {} }))

import { startWatchSync, startLinkSync, huaweiCall, drainWatchEvents, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { readGarminLink, writeWatchPrefs } from './watch-settings.js'
import { GARMIN_SNAPSHOT_VERSION } from './garmin-snapshot.js'

function store(initial) {
  let st = initial
  const subs = new Set()
  return {
    getState: () => st,
    setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) },
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

  it('names the Garmin events applied here in its snapshot, so the watch lets go of them', async () => {
    const b = bridge()
    const ev = id => ({ id, type: 'setDone', wid: 'w-gone', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 1 })
    b.drain.mockResolvedValueOnce({ events: [ev('g1'), ev('g2')] })
    const { stop } = await run(b, { ...S0, active })
    await vi.runAllTimersAsync()
    expect(b.ack).toHaveBeenCalledWith({ ids: ['g1', 'g2'] })
    expect(JSON.parse(lastCall(b).garmin).acked).toEqual(['g1', 'g2'])
    stop()
  })

  it('an event sent again long after is named again, even behind many newer ones', async () => {
    // The watch was away for a whole workout: its first set is far back in the phone's list.
    localStorage.setItem('gym_watch_applied', JSON.stringify(['g-old', ...Array.from({ length: 30 }, (_, i) => 'x' + i)]))
    const b = bridge()
    b.drain.mockResolvedValueOnce({ events: [{ id: 'g-old', type: 'setDone', wid: 'w-gone', at: 1 }] })
    const { stop } = await run(b, { ...S0, active })
    await vi.runAllTimersAsync()
    expect(b.ack).toHaveBeenCalledWith({ ids: ['g-old'] })
    const acked = JSON.parse(lastCall(b).garmin).acked
    expect(acked).toHaveLength(16)
    expect(acked.at(-1)).toBe('g-old')
    // and still applied once: the list has it a single time
    expect(JSON.parse(localStorage.getItem('gym_watch_applied')).filter(x => x === 'g-old')).toHaveLength(1)
    stop()
  })
})

// Settings → Huawei watch asks the phone for the Huawei link; any other name is not its to call.
describe('huaweiCall', () => {
  it('passes the two Huawei calls to WatchBridge, and nothing else', async () => {
    const huaweiStatus = vi.fn(async () => ({ supported: true, state: 'ready', devices: [] }))
    _setWatchPluginForTest({ huaweiStatus, huaweiPick: vi.fn(async () => ({ ok: true })), status: vi.fn() })
    expect(await huaweiCall('huaweiStatus')).toMatchObject({ state: 'ready' })
    expect(await huaweiCall('huaweiPick')).toEqual({ ok: true })
    expect(await huaweiCall('status')).toBe(null)
  })

  it('no phone app, or a phone app without the call: null', async () => {
    _setWatchPluginForTest(null)
    expect(await huaweiCall('huaweiStatus')).toBe(null)
    _setWatchPluginForTest({})
    expect(await huaweiCall('huaweiStatus')).toBe(null)
  })
})

// A Huawei watch (docs/HUAWEI_WATCH.md): the phone's status says `huawei`, and the watch gets the
// Garmin's snapshot as `huawei`; the Garmin string is made only when a Garmin is there.
describe('a Huawei watch on the watch link', () => {
  const two = { id: 'w-1', start: 1, cur: 1, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }, { id: '0026', sets: [{ w: 40, r: 10 }] }, { id: '0027', sets: [{ w: 30, r: 10 }] }] }

  it('alone: gets the Garmin window as `huawei`, no Garmin string, and the link is remembered', async () => {
    const b = bridge({ paired: true, installed: true, huawei: true })
    const { stop } = await run(b, { ...S0, active: two })
    const call = lastCall(b)
    expect(call.garmin).toBeUndefined()
    const h = JSON.parse(call.huawei)
    expect(h.v).toBe(GARMIN_SNAPSHOT_VERSION)
    expect(h.active.count).toBe(3)
    expect(h.active.entries.map(e => e.i)).toEqual([1, 2])
    expect(h.settings.lang).toBeTruthy()
    expect(JSON.parse(call.json).active.id).toBe('w-1')
    expect(readGarminLink()).toBe(true)
    stop()
  })

  it('a Garmin alone: no Huawei string, the Garmin window as before', async () => {
    const b = bridge({ paired: true, installed: true, garmin: true, huawei: false })
    const { stop } = await run(b, { ...S0, active: two })
    expect(lastCall(b).huawei).toBeUndefined()
    expect(JSON.parse(lastCall(b).garmin).active.entries.map(e => e.i)).toEqual([1, 2])
    stop()
  })

  it('both: each gets a snapshot', async () => {
    const b = bridge({ paired: true, installed: true, garmin: true, huawei: true })
    const { stop } = await run(b, { ...S0, active: two })
    expect(JSON.parse(lastCall(b).garmin).active.entries).toHaveLength(2)
    expect(JSON.parse(lastCall(b).huawei).active.entries).toHaveLength(2)
    stop()
  })

  it('neither: just the full snapshot, and the remembered link is cleared', async () => {
    localStorage.setItem('gym_garmin_link_v1', 'true')
    const b = bridge({ paired: true, installed: true })
    const { stop } = await run(b, { ...S0, active: two })
    expect(Object.keys(lastCall(b))).toEqual(['json'])
    expect(readGarminLink()).toBe(false)
    stop()
  })

  it('the Zepp relay never makes one', async () => {
    const b = bridge({ paired: true, installed: true, huawei: true })
    const { stop } = await run(b, { ...S0, active: two }, true)
    expect(lastCall(b).huawei).toBeUndefined()
    stop()
  })

  // The big workout makes both snapshots cut their `acked` list (the Garmin to 16, then 8; the Huawei
  // to 16 once the workout is too long for the frames).
  const bigWorkout = () => ({
    id: 'w-big', start: 1, cur: 30,
    // a superset of twenty exercises is up, so the window is wide and the byte budget cuts the acked list
    entries: Array.from({ length: 80 }, (_, k) => ({ id: '00' + String(10 + (k % 40)), ...(k >= 28 && k < 48 ? { sg: 'ss' } : {}), sets: Array.from({ length: 6 }, () => ({ w: 62.5, r: 8 })) })),
  })
  const evOf = id => ({ id, type: 'setDone', wid: 'w-gone', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 1 })

  it('every applied id is named to each watch at least once, a trimmed snapshot or not, and none forever', async () => {
    const hs = Array.from({ length: 70 }, (_, i) => 'h' + String(i).padStart(3, '0'))
    const gs = Array.from({ length: 40 }, (_, i) => 'g' + String(i).padStart(3, '0'))
    const b = bridge({ paired: true, installed: true, garmin: true, huawei: true })
    // the two watches' events arrive mixed, as they do on one phone
    b.drain.mockResolvedValueOnce({ events: hs.flatMap((h, i) => (i < gs.length ? [evOf(h), evOf(gs[i])] : [evOf(h)])) })
    const { stop } = await run(b, { ...S0, active: bigWorkout() })
    await vi.runAllTimersAsync()
    const calls = b.sendSnapshot.mock.calls.map(c => c[0])
    const named = k => new Set(calls.flatMap(c => (c[k] ? JSON.parse(c[k]).acked || [] : [])))
    // the snapshots really were trimmed (else this proves nothing)
    expect(Math.min(...calls.filter(c => c.huawei && JSON.parse(c.huawei).acked).map(c => JSON.parse(c.huawei).acked.length))).toBeLessThan(16)
    expect(hs.filter(id => !named('huawei').has(id))).toEqual([])
    expect(gs.filter(id => !named('garmin').has(id))).toEqual([])
    // nothing keeps being sent: the lists are empty
    const n = b.sendSnapshot.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(b.sendSnapshot.mock.calls.length).toBe(n)
    stop()
  })

  it('a snapshot the link did not take leaves its ids waiting', async () => {
    const hs = Array.from({ length: 70 }, (_, i) => 'h' + String(i).padStart(3, '0'))
    const b = bridge({ paired: true, installed: true, huawei: true })
    b.sendSnapshot.mockResolvedValue({ sent: false })
    b.drain.mockResolvedValueOnce({ events: hs.map(evOf) })
    const { st, stop } = await run(b, { ...S0, active })
    await vi.runAllTimersAsync()
    // the link takes snapshots again: the next change names all 70 (60 and then the 10 left)
    const from = b.sendSnapshot.mock.calls.length
    b.sendSnapshot.mockResolvedValue({ sent: true })
    st.setState({ S: { ...st.getState().S, restSec: 91 } })
    await vi.runAllTimersAsync()
    const named = new Set(b.sendSnapshot.mock.calls.slice(from).flatMap(c => JSON.parse(c[0].huawei).acked || []))
    expect(hs.filter(id => !named.has(id))).toEqual([])
    stop()
  })

  it('an event that arrives a second time makes the Huawei resend even an identical snapshot (again)', async () => {
    const b = bridge({ paired: true, installed: true, huawei: true })
    b.drain.mockResolvedValueOnce({ events: [evOf('h1')] })
    const { st, stop } = await run(b, { ...S0, active })
    await vi.runAllTimersAsync()
    const first = b.sendSnapshot.mock.calls.length
    // h1 is named now; the watch sends it a second time, the workout unchanged
    b.drain.mockResolvedValueOnce({ events: [evOf('h1')] })
    await drainWatchEvents()
    await vi.runAllTimersAsync()
    expect(b.sendSnapshot.mock.calls.length).toBeGreaterThan(first)
    const again = lastCall(b)
    expect(again.again).toBe(true)
    const strip = c => JSON.parse(c.huawei, (k, v) => (k === 'now' ? undefined : v))
    expect(strip(again)).toEqual(strip(b.sendSnapshot.mock.calls[first - 1][0]))
    // and an ordinary change after it does not ask for it
    st.setState({ S: { ...st.getState().S, restSec: 91 } })
    await vi.runAllTimersAsync()
    expect(lastCall(b).again).toBeUndefined()
    stop()
  })

  it('a Huawei link that did not take the snapshot keeps its ids, although the Garmin took it', async () => {
    const hs = Array.from({ length: 70 }, (_, i) => 'h' + String(i).padStart(3, '0'))
    const b = bridge({ paired: true, installed: true, garmin: true, huawei: true })
    b.sendSnapshot.mockResolvedValue({ sent: true, garmin: true, huawei: false })
    b.drain.mockResolvedValueOnce({ events: hs.map(evOf) })
    const { st, stop } = await run(b, { ...S0, active })
    await vi.runAllTimersAsync()
    const from = b.sendSnapshot.mock.calls.length
    b.sendSnapshot.mockResolvedValue({ sent: true, garmin: true, huawei: true })
    st.setState({ S: { ...st.getState().S, restSec: 91 } })
    await vi.runAllTimersAsync()
    const named = new Set(b.sendSnapshot.mock.calls.slice(from).flatMap(c => JSON.parse(c[0].huawei).acked || []))
    expect(hs.filter(id => !named.has(id))).toEqual([])
    stop()
  })

  it('a replay that comes while a snapshot is on its way is not lost', async () => {
    const b = bridge({ paired: true, installed: true, huawei: true })
    b.drain.mockResolvedValueOnce({ events: [evOf('h1')] })
    let release
    b.sendSnapshot.mockImplementationOnce(() => new Promise(r => { release = () => r({ sent: true }) }))
    const { stop } = await run(b, { ...S0, active })
    const n = b.sendSnapshot.mock.calls.length
    // the watch sends h1 again while that call is open
    b.drain.mockResolvedValueOnce({ events: [evOf('h1')] })
    await drainWatchEvents()
    release()
    await vi.runAllTimersAsync()
    expect(b.sendSnapshot.mock.calls.length).toBeGreaterThan(n)
    const last = lastCall(b)
    expect(last.again).toBe(true)
    expect(JSON.parse(last.huawei).acked).toContain('h1')
    stop()
  })

  it('a reply after the link run has stopped arms no new send', async () => {
    const hs = Array.from({ length: 70 }, (_, i) => 'h' + String(i).padStart(3, '0'))
    const b = bridge({ paired: true, installed: true, huawei: true })
    b.drain.mockResolvedValueOnce({ events: hs.map(evOf) })
    let release
    b.sendSnapshot.mockImplementationOnce(() => new Promise(r => { release = () => r({ sent: true }) }))
    const { stop } = await run(b, { ...S0, active })
    const n = b.sendSnapshot.mock.calls.length
    stop()
    release()
    await vi.advanceTimersByTimeAsync(60000)
    // 10 ids were still to name, and nothing went after the stop
    expect(b.sendSnapshot.mock.calls.length).toBe(n)
  })
})
