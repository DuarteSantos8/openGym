// LIFTIQ-FORK: the simulator through the package's real decoder path, the controller (connect, ready
// check, record, stop, review) and the write-back sequence of review.js.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { decodeTelemetry } from './vendor/liftiq-sensor/index.js'
import { parseSimCsv, createSimTransport, encodePacket, playbackStart } from './sim-transport.js'
import { createController, fail } from './controller.js'
import { createMiniStore, INITIAL_SENSOR_STATE } from './mini-store.js'
import { pickAnalysis, vbtFromReview, writeBack, defaultIncludeSetup } from './review.js'
import { sanitizeVbt } from './sanitize.js'

const CSV = readFileSync(new URL('../../public/liftiq-sim/seated-row-86c1eceb.csv', import.meta.url), 'utf8')
const rows = parseSimCsv(CSV)

// A timer the test drives by hand: tick() delivers `speed` packets.
function manualTimers() {
  let fn = null
  return { setInterval: f => { fn = f; return 1 }, clearInterval: () => { fn = null }, tick: (n = 1) => { for (let k = 0; k < n && fn; k++) fn() } }
}

async function rig({ speed = 1 } = {}) {
  const timers = manualTimers()
  const transport = createSimTransport({ rows, speed, timers })
  const store = createMiniStore({ ...INITIAL_SENSOR_STATE })
  let clockMs = 0
  const sensor = createController({ makeTransport: async () => transport, store, now: () => clockMs += 20, support: () => ({ ok: true }) })
  await sensor.connect()
  return { sensor, store, timers, transport }
}

describe('simulated sensor', () => {
  it('parses the real recording', () => {
    expect(rows.length).toBeGreaterThan(1800)
    expect(rows[0].az).toBeGreaterThan(9)
  })

  it('encodes v1 packets the package decoder reads back', () => {
    const dv = encodePacket({ ax: -0.17, ay: -0.75, az: 10.12, phase: 1, repCount: 3 }, 70000)
    expect(dv.byteLength).toBe(18)
    const d = decodeTelemetry(dv)
    expect(d).toMatchObject({ ax: -0.17, ay: -0.75, az: 10.12, phase: 1, repCount: 3, calibrationCode: 2, seq: 70000 & 0xffff, batteryMillivolts: 3900 })
  })

  it('starts playback a few seconds before the first movement', () => {
    const start = playbackStart(rows)
    expect(start).toBeGreaterThan(20)
    expect(start).toBeLessThan(400)
  })
})

describe('controller with the simulated sensor', () => {
  it('connects and reports name, battery and firmware', async () => {
    const { sensor, store } = await rig()
    const s = store.getState()
    expect(s.status).toBe('connected')
    expect(s.name).toBe('LiftIQ-SIM0')
    expect(s.simulated).toBe(true)
    sensor.disconnect()
  })

  it('reports battery from the packets', async () => {
    const { sensor, store, timers } = await rig()
    timers.tick(3)
    expect(store.getState().battery).toMatchObject({ kind: 'ok', millivolts: 3900 })
    sensor.disconnect()
    expect(store.getState().status).toBe('idle')
    expect(store.getState().error).toBeNull()
  })

  it('runs ready check, record, stop and review: 5 reps, setup pull flagged', async () => {
    const { sensor, store, timers } = await rig()
    sensor.beginReady()
    expect(store.getState().mode).toBe('ready')
    timers.tick(40)
    expect(store.getState().ready.ready).toBe(false)
    timers.tick(60) // 2 s of rest in total
    expect(store.getState().ready).toMatchObject({ ready: true, progress: 1 })

    sensor.startRecording()
    expect(store.getState().mode).toBe('recording')
    timers.tick(rows.length - playbackStart(rows) + 5)
    const live = store.getState()
    expect(live.counterReady).toBe(true)
    expect(live.count).toBe(6) // the live counter counts the setup pull too
    expect(live.elapsedS).toBeGreaterThan(20)

    const review = sensor.stop()
    expect(store.getState().mode).toBe('review')
    expect(review.setupFlagged).toBe(true)
    expect(review.auto.reps).toHaveLength(5)
    expect(review.withSetup.reps).toHaveLength(6)
    expect(review.dropped).toBe(0)

    const chosen = pickAnalysis(review, defaultIncludeSetup())
    expect(chosen.count).toBe(5)
    expect(chosen.bars).toHaveLength(6)
    expect(chosen.bars[0]).toMatchObject({ setup: true, counted: false })
    expect(pickAnalysis(review, true).count).toBe(6)

    const vbt = vbtFromReview(review, false, '0.1.0')
    expect(vbt).toMatchObject({ src: 'liftiq', repsNoSetup: 5, repsWithSetup: 6, setupIncluded: false, pkg: '0.1.0', fw: 'sim-0.1' })
    expect(vbt.pv).toHaveLength(5)
    expect(vbt.mpv).toBeGreaterThan(0.4)
    expect(sanitizeVbt(vbt)).toEqual(vbt)
    expect(JSON.stringify(vbt).length).toBeLessThanOrEqual(300)
    // raw samples are not kept
    expect(JSON.stringify(vbt)).not.toMatch(/samples|series/)

    sensor.discard()
    expect(store.getState().mode).toBe('idle')
    sensor.disconnect()
  })

  it('plays back 4x faster with the same result', async () => {
    const { sensor, store, timers } = await rig({ speed: 4 })
    sensor.beginReady()
    timers.tick(30)
    expect(store.getState().ready.ready).toBe(true)
    sensor.startRecording()
    timers.tick(Math.ceil((rows.length - playbackStart(rows)) / 4) + 2)
    const review = sensor.stop()
    expect(review.auto.reps).toHaveLength(5)
    sensor.disconnect()
  })

  it('keeps what was captured when the link drops during the set', async () => {
    const { sensor, store, timers, transport } = await rig()
    sensor.beginReady()
    timers.tick(100)
    sensor.startRecording()
    timers.tick(900)
    transport.disconnect({})
    const s = store.getState()
    expect(s.mode).toBe('review')
    expect(s.interrupted).toBe(true)
    expect(sensor.getReview().samples).toBeGreaterThan(800)
  })

  it('reports a clear error when Bluetooth is unavailable and never throws', async () => {
    const store = createMiniStore({ ...INITIAL_SENSOR_STATE })
    const sensor = createController({ store, support: () => ({ ok: false, reason: 'ios' }) })
    await sensor.connect()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toMatch(/iPhone Safari/)
  })

  it('turns a failing transport into an error state', async () => {
    const store = createMiniStore({ ...INITIAL_SENSOR_STATE })
    const sensor = createController({ store, makeTransport: async () => ({ isSupported: () => true, requestDevice: async () => { const e = new Error('chooser closed'); e.name = 'NotFoundError'; throw e }, isConnected: () => false, disconnect() {}, onDisconnect: () => () => {} }), support: () => ({ ok: true }) })
    await sensor.connect()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toMatch(/NotFoundError: chooser closed/)
  })

  it('explains the different Chrome failures behind NotFoundError', () => {
    const mk = (name, message) => { const e = new Error(message); e.name = name; return e }
    expect(fail(mk('NotFoundError', 'User cancelled the requestDevice() chooser.'))).toMatch(/^No sensor chosen\./)
    expect(fail(mk('NotFoundError', 'Bluetooth adapter not available.'))).toMatch(/Bluetooth is off/)
    expect(fail(mk('NotFoundError', 'User denied the browser permission to scan for Bluetooth devices.'))).toMatch(/Nearby devices/)
    expect(fail(mk('NotFoundError', 'No Bluetooth devices in range.'))).toMatch(/No sensor found/)
    expect(fail(mk('SecurityError', 'Failed to execute requestDevice'))).toMatch(/https/)
    expect(fail(mk('NotFoundError', 'Bluetooth adapter not available.'))).toContain('NotFoundError: Bluetooth adapter not available.')
  })
})

describe('writeBack', () => {
  const vbt = sanitizeVbt({ src: 'liftiq', pv: [0.8, 0.7], repsNoSetup: 2, repsWithSetup: 3 })

  it('sets reps, weight and vbt through onField, then ticks the set, in that order', () => {
    const calls = []
    writeBack({ i: 2, set: { w: 60, r: 5, done: false }, reps: 8, weight: 62.5, vbt, onField: (...a) => calls.push(['field', ...a]), onToggle: (...a) => calls.push(['toggle', ...a]) })
    expect(calls).toEqual([['field', 2, 'r', 8], ['field', 2, 'w', 62.5], ['field', 2, 'vbt', vbt], ['toggle', 2]])
  })

  it('leaves the weight alone when it did not change, and does not un-tick a done set', () => {
    const calls = []
    writeBack({ i: 0, set: { w: 60, r: 5, done: true }, reps: 5, weight: 60, vbt, onField: (...a) => calls.push(['field', ...a]), onToggle: vi.fn(() => calls.push(['toggle'])) })
    expect(calls.map(c => c[2])).toEqual(['r', 'vbt'])
    expect(calls.some(c => c[0] === 'toggle')).toBe(false)
  })

  it('writes whole reps only', () => {
    const onField = vi.fn()
    writeBack({ i: 0, set: { w: 10 }, reps: 4.6, weight: 10, vbt: null, onField, onToggle: vi.fn() })
    expect(onField).toHaveBeenCalledWith(0, 'r', 5)
    expect(onField).toHaveBeenCalledTimes(1)
  })
})
