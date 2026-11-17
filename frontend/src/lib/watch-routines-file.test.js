// @vitest-environment happy-dom
// Every routine reaches the watch: the list goes as a file next to the size-limited snapshot, and
// the snapshot names the file it goes with (routinesHash). The old way (others in the snapshot) stays.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routinesFile } from './watch-routines-file.js'
import { startWatchSync, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { writeWatchStatus } from './watch-settings.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const others = n => Array.from({ length: n }, (_, i) => ({ routineIds: ['r' + i], name: 'R' + i, entries: [], ...(i > 1 ? { folder: 'Legs' } : {}) }))

describe('routinesFile', () => {
  it('holds all the routines, in order, with the hash the watch compares', () => {
    const f = routinesFile({ today: null, others: others(40) })
    const body = JSON.parse(f.json)
    expect(body.others).toHaveLength(40)
    expect(body.others[2].folder).toBe('Legs')
    expect(body.h).toBe(f.hash)
  })
  it('the hash changes with the list, and not otherwise', () => {
    const a = routinesFile({ others: others(3) }).hash
    expect(routinesFile({ others: others(3) }).hash).toBe(a)
    const o = others(3); o[1].name = 'Changed'
    expect(routinesFile({ others: o }).hash).not.toBe(a)
  })
  it('no routines (or nothing ready): no file', () => {
    expect(routinesFile({ others: [] })).toBeNull()
    expect(routinesFile(null)).toBeNull()
  })
})

describe('sending it', () => {
  const store = initial => {
    let st = initial
    const subs = new Set()
    return { getState: () => st, setState: p => { const prev = st; st = { ...st, ...p }; subs.forEach(fn => fn(st, prev)) }, subscribe: fn => { subs.add(fn); return () => subs.delete(fn) } }
  }
  const bridge = (extra = {}) => ({ status: vi.fn(async () => ({ paired: true, installed: true })), sendSnapshot: vi.fn(async () => ({ sent: true })), sendRoutines: vi.fn(async () => ({ sent: true })), sendClips: vi.fn(async () => ({})), dropClips: vi.fn(async () => ({})), drain: vi.fn(async () => ({ events: [] })), ack: vi.fn(async () => ({})), addListener: vi.fn(async () => ({ remove: () => {} })), ...extra })
  const ex = [{ id: '0025', target: { sets: 3, reps: 8 } }]
  const S = n => ({ unit: 'kg', workouts: [], active: null, week: {}, dayPlan: {}, routines: Array.from({ length: n }, (_, i) => ({ id: 'r' + i, name: 'R' + i, ex })) })
  const run = async (b, st) => {
    vi.useFakeTimers({ now: 1_800_000_000_000 })
    _setWatchPluginForTest(b)
    const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
    await vi.advanceTimersByTimeAsync(1000)
    return stop
  }

  it('the snapshot names the file, the file goes once, and again when a routine changes', async () => {
    try {
      const b = bridge()
      const st = store({ S: S(5), ready: true })
      const stop = await run(b, st)
      const snap = JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json)
      expect(b.sendRoutines).toHaveBeenCalledTimes(1)
      const sent = b.sendRoutines.mock.calls[0][0]
      expect(snap.routinesHash).toBe(sent.hash)
      expect(JSON.parse(sent.json).others).toHaveLength(5)
      // a tick-like change that leaves the routines alone: no second file
      st.setState({ S: { ...st.getState().S, restSec: 120 } })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.sendRoutines).toHaveBeenCalledTimes(1)
      st.setState({ S: S(6) })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.sendRoutines).toHaveBeenCalledTimes(2)
      expect(JSON.parse(b.sendRoutines.mock.calls[1][0].json).others).toHaveLength(6)
      stop()
    } finally { vi.useRealTimers() }
  })

  it('a link that cannot take the file (an older or F-Droid build) still gets the snapshot, clips and all', async () => {
    try {
      const b = bridge({ sendRoutines: undefined })
      const stop = await run(b, store({ S: S(3), ready: true }))
      expect(b.sendSnapshot).toHaveBeenCalled()
      expect(JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json).ready.others).toHaveLength(3)
      stop()
    } finally { vi.useRealTimers() }
  })

  it('a refused file is tried again with the next snapshot', async () => {
    try {
      const b = bridge({ sendRoutines: vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue({ sent: true }) })
      const st = store({ S: S(3), ready: true })
      const stop = await run(b, st)
      st.setState({ S: { ...st.getState().S, restSec: 120 } })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.sendRoutines).toHaveBeenCalledTimes(2)
      stop()
    } finally { vi.useRealTimers() }
  })

  it('a file the watch never got goes again: once per report, and not while it may still be on its way', async () => {
    try {
      const b = bridge()
      const st = store({ S: S(3), ready: true })
      const stop = await run(b, st)
      const h = b.sendRoutines.mock.calls[0][0].hash
      const report = async ev => { writeWatchStatus({ at: Date.now(), ...ev }); await vi.advanceTimersByTimeAsync(1000) }
      // reported right after the send: the file may still be on its way
      await report({ routinesHash: '' })
      expect(b.sendRoutines).toHaveBeenCalledTimes(1)
      // an older watch app says nothing about its routines: nothing to go by
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      await report({})
      expect(b.sendRoutines).toHaveBeenCalledTimes(1)
      // minutes later the watch still shows its own list: lost, sent again
      await report({ routinesHash: '' })
      expect(b.sendRoutines).toHaveBeenCalledTimes(2)
      expect(b.sendRoutines.mock.calls[1][0].hash).toBe(h)
      // the same report again with the next change: not again (a full watch is not sent it on every set)
      st.setState({ S: { ...st.getState().S, restSec: 120 } })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.sendRoutines).toHaveBeenCalledTimes(2)
      // it has it now: nothing more
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      await report({ routinesHash: h, routinesCount: 3 })
      expect(b.sendRoutines).toHaveBeenCalledTimes(2)
      stop()
    } finally { vi.useRealTimers() }
  })

  it('nothing ready (the watch switched off): no hash, no file', async () => {
    try {
      const b = bridge()
      const stop = await run(b, store({ S: { ...S(3), watchPrefs: undefined, modules: { watch: false } }, ready: true }))
      expect(b.sendRoutines).not.toHaveBeenCalled()
      expect(JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json)).not.toHaveProperty('routinesHash')
      stop()
    } finally { vi.useRealTimers() }
  })
})
