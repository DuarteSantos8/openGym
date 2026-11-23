// LIFTIQ-FORK: the sensor controller. Glue between the vendored package (BleClient, PacketTracker,
// ready check, live counter, offline analysis) and the UI. Holds connection and live state in the
// non-persisted sensorStore. No React, no openGym state. Raw samples live only in memory here and
// are dropped on discard/confirm: nothing of them reaches openGym's persisted state.
import {
  BleClient, PacketTracker, createStillnessDetector, createLiveCounter, analyzeSet,
  describeBattery, describeInfo, NOTIFY_HZ,
} from './vendor/liftiq-sensor/index.js'
import { sensorStore } from './mini-store.js'
import { simRequested, simSpeed, bluetoothSupport, SUPPORT_TEXT } from './feature.js'

export const MAX_SAMPLES = 50 * 60 * 10 // 10 minutes at 50 Hz: a set never takes that long

function fail(error) {
  const msg = error && error.message ? String(error.message) : String(error || 'Unknown error')
  // The chooser being dismissed is not an error worth shouting about.
  if (error && (error.name === 'NotFoundError' || /cancelled|canceled|user cancel/i.test(msg))) return 'No sensor chosen.'
  return msg
}

/**
 * @param {object} [o]
 * @param {() => Promise<object|undefined>} [o.makeTransport] a BleTransport; undefined = Web Bluetooth
 * @param {object} [o.store]
 * @param {() => number} [o.now]
 * @param {() => {ok: boolean, reason?: string}} [o.support]
 */
export function createController({ makeTransport, store = sensorStore, now = () => Date.now(), support = bluetoothSupport } = {}) {
  let client = null
  let transport = null
  const tracker = new PacketTracker(now)
  let detector = createStillnessDetector()
  let counter = null
  let samples = []
  let seq0 = null
  let arrival0 = null
  let dropped = 0
  let lastT = 0
  let capped = false
  let wake = null
  let capturedAt = null
  let review = null
  let firmware = ''
  let intentional = false

  const set = patch => store.setState(patch)
  const mode = () => store.getState().mode

  async function holdScreen() {
    try {
      if (typeof navigator !== 'undefined' && navigator.wakeLock?.request && !wake) {
        wake = await navigator.wakeLock.request('screen')
        wake.addEventListener?.('release', () => { wake = null })
      }
    } catch { wake = null }
  }
  function releaseScreen() { try { wake?.release?.() } catch { /* ignore */ } wake = null }

  function sampleFor(reading, seq) {
    if (seq !== null && seq !== undefined) {
      if (seq0 === null) seq0 = seq
      return { t: (seq - seq0) / NOTIFY_HZ, ax: reading.ax, ay: reading.ay, az: reading.az }
    }
    if (arrival0 === null) arrival0 = now()
    return { t: (now() - arrival0) / 1000, ax: reading.ax, ay: reading.ay, az: reading.az } // legacy packet
  }

  function onPacket(reading, dataView) {
    const { seq, dropped: gap } = tracker.record(reading, dataView)
    if (reading.batteryMillivolts !== null && reading.batteryMillivolts !== undefined) {
      const b = describeBattery(reading.batteryMillivolts)
      const cur = store.getState().battery
      if (!cur || cur.kind !== b.kind || cur.percent !== b.percent) set({ battery: b })
    }
    const m = mode()
    if (m !== 'ready' && m !== 'recording') return
    const s = sampleFor(reading, seq)
    if (m === 'ready') {
      const st = detector.push(s)
      const p = Math.round(st.progress * 50) / 50
      set({ ready: { progress: p, ready: st.ready } })
      return
    }
    // recording
    dropped += gap
    lastT = s.t
    if (samples.length >= MAX_SAMPLES) { capped = true; return }
    samples.push(s)
    const r = counter.push(s)
    set({ count: r.count, counterReady: !!r.ready, elapsedS: Math.round(s.t * 10) / 10 })
  }

  function onDisconnect() {
    if (!client) return // a late event after our own disconnect()
    const m = mode()
    client = null
    transport = null
    set({ status: 'idle', battery: null, info: null, name: null, error: m === 'recording' || intentional ? null : 'Sensor disconnected.' })
    intentional = false
    if (m === 'recording') finishRecording(true)
    else if (m === 'ready') set({ mode: 'idle', ready: { progress: 0, ready: false } })
  }

  function resetLive() {
    samples = []
    seq0 = null; arrival0 = null; dropped = 0; lastT = 0; capped = false
    counter = createLiveCounter()
    detector = createStillnessDetector()
    review = null
    set({ count: 0, counterReady: false, elapsedS: 0, ready: { progress: 0, ready: false }, interrupted: false })
  }

  function finishRecording(interrupted) {
    releaseScreen()
    const withSetup = analyzeSet(samples, { includeSetupPull: true })
    const auto = analyzeSet(samples, { includeSetupPull: 'auto' })
    review = {
      samples: samples.length, durationS: lastT, dropped, capped, interrupted: !!interrupted,
      liveCount: counter ? store.getState().count : 0,
      withSetup, auto, setupFlagged: !!auto.setupPull,
      capturedAt, fw: firmware,
    }
    samples = [] // the raw trace is not kept once analysed
    set({ mode: 'review', interrupted: !!interrupted })
    return review
  }

  const api = {
    store,

    /** Must be called from a user gesture. Resolves when connected; never throws (state carries the error). */
    async connect() {
      const st = store.getState()
      if (st.status === 'connecting' || st.status === 'connected') return
      const sup = support()
      if (!sup.ok) { set({ status: 'error', error: SUPPORT_TEXT[sup.reason] }); return }
      set({ status: 'connecting', error: null })
      try {
        // No await before client.connect() on the real path: Web Bluetooth wants the user gesture.
        transport = makeTransport ? await makeTransport() : undefined
        client = new BleClient({ onPacket, onInvalidPacket: dv => tracker.recordInvalid(dv), onDisconnect, ...(transport ? { transport } : {}) })
        tracker.reset()
        await client.connect()
        firmware = client.info?.firmware || ''
        set({
          status: 'connected', name: client.name, simulated: !!transport?.simulated, error: null,
          info: client.info ? describeInfo(client.info) : 'Unknown (firmware without version info)',
        })
      } catch (error) {
        client?.disconnect?.()
        client = null; transport = null
        set({ status: 'error', error: fail(error), name: null })
      }
    },

    disconnect() {
      if (mode() === 'recording') { api.discard(); }
      intentional = true
      client?.disconnect()
      intentional = false
      client = null; transport = null
      set({ status: 'idle', name: null, battery: null, info: null, error: null, mode: 'idle' })
    },

    /** Stillness check: the sensor streams, the detector decides. */
    beginReady() {
      if (store.getState().status !== 'connected') return
      resetLive()
      set({ mode: 'ready' })
      void holdScreen()
    },

    /** Start recording (from ready, or skipping the check). */
    startRecording() {
      if (store.getState().status !== 'connected') return
      resetLive()
      capturedAt = Date.now()
      set({ mode: 'recording' })
      void holdScreen()
      transport?.beginPlayback?.() // the simulator starts its set here; the real sensor is just moved
    },

    /** Stop and analyse: returns the review (also kept for getReview). */
    stop() {
      if (mode() !== 'recording') return review
      return finishRecording(false)
    },

    getReview: () => review,

    /** Leave a stage without keeping anything. */
    discard() {
      releaseScreen()
      samples = []; review = null
      set({ mode: 'idle', count: 0, elapsedS: 0, interrupted: false, ready: { progress: 0, ready: false } })
    },

    get firmware() { return firmware },
    get packets() { return tracker.snapshot() },
  }
  return api
}

let singleton = null
/** The app-wide controller (Web Bluetooth, or the simulator with ?liftiqSim=1). */
export function getSensor() {
  if (!singleton) {
    singleton = createController({
      makeTransport: simRequested()
        ? async () => (await import('./sim-transport.js')).loadSimTransport({ speed: simSpeed() })
        : undefined,
    })
  }
  return singleton
}
export function resetSensorForTests() { singleton = null }
