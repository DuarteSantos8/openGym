// LIFTIQ-FORK: a simulated LiftIQ sensor (BleTransport of the vendored package) for the browser pane and
// CI, where there is no Bluetooth. Only loaded by dynamic import when ?liftiqSim=1 is in the URL.
//
// It plays back a REAL recording (a seated cable row, 5 reps plus a setup pull, tests/fixtures/
// seated-row-2026-11-22 in the LiftIQ repo, public/liftiq-sim/seated-row-86c1eceb.csv) as real 50 Hz
// packets in the v1 18-byte format, so the package's own decoder, packet tracker, ready check, live
// counter and analysis run exactly as they do with the hardware. Before `beginPlayback()` the sensor
// "rests": a still stretch of the recording loops. `beginPlayback()` starts the set a few seconds
// before the first movement; after the last row the sensor rests again.
import { INFO_UUID, NOTIFY_UUID, RAW_UUID } from './vendor/liftiq-sensor/index.js'

export const SIM_URL = 'liftiq-sim/seated-row-86c1eceb.csv'
export const SIM_FIRMWARE = 'sim-0.1'
export const SIM_BATTERY_MV = 3900
const IDLE_ROWS = 100 // 2 s of rest, looped
const LEAD_ROWS = 150 // 3 s of rest before the first movement

/** Rows ({ax, ay, az, phase, repCount}) from a LiftIQ session CSV text. Pure. */
export function parseSimCsv(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim())
  const head = lines.shift().split(',')
  const col = name => head.indexOf(name)
  const c = { ax: col('ax_m_s2'), ay: col('ay_m_s2'), az: col('az_m_s2'), phase: col('phase_id'), rep: col('rep_count') }
  if (c.ax < 0 || c.ay < 0 || c.az < 0) throw new Error('Not a LiftIQ session CSV.')
  return lines.map(l => {
    const f = l.split(',')
    return { ax: +f[c.ax], ay: +f[c.ay], az: +f[c.az], phase: c.phase >= 0 ? +f[c.phase] || 0 : 0, repCount: c.rep >= 0 ? +f[c.rep] || 0 : 0 }
  }).filter(r => [r.ax, r.ay, r.az].every(Number.isFinite))
}

/** Index of the row where playback starts: LEAD_ROWS before the first clear movement. */
export function playbackStart(rows) {
  if (!rows.length) return 0
  const g0 = Math.hypot(rows[0].ax, rows[0].ay, rows[0].az)
  const moving = rows.findIndex(r => Math.abs(Math.hypot(r.ax, r.ay, r.az) - g0) > 0.8)
  return Math.max(0, (moving < 0 ? 0 : moving) - LEAD_ROWS)
}

/** One v1 telemetry packet (18 bytes, little endian) as the firmware sends it. */
export function encodePacket(row, seq, { batteryMv = SIM_BATTERY_MV, calibration = 2 } = {}) {
  const dv = new DataView(new ArrayBuffer(18))
  const total = Math.hypot(row.ax, row.ay, row.az)
  const cent = x => Math.max(-32768, Math.min(32767, Math.round(x * 100)))
  dv.setInt16(0, cent(row.ax), true)
  dv.setInt16(2, cent(row.ay), true)
  dv.setInt16(4, cent(row.az), true)
  dv.setInt16(6, cent(total), true)
  dv.setInt16(8, cent(0), true)
  dv.setUint16(10, seq & 0xffff, true)
  dv.setUint8(12, row.phase || 0)
  dv.setUint8(13, calibration)
  dv.setUint16(14, row.repCount & 0xffff, true)
  dv.setUint16(16, batteryMv, true)
  return dv
}

function infoView() {
  const dv = new DataView(new ArrayBuffer(20))
  dv.setUint8(0, 1)
  dv.setUint8(1, 1)
  dv.setUint16(2, 0, true)
  for (let i = 0; i < SIM_FIRMWARE.length; i++) dv.setUint8(4 + i, SIM_FIRMWARE.charCodeAt(i))
  return dv
}

/**
 * @param {object} o
 * @param {Array} o.rows       parsed recording (parseSimCsv)
 * @param {number} [o.speed]   1 = real time; 4 plays four packets per tick (the sensor clock stays 50 Hz)
 * @param {number} [o.tickMs]  real time between ticks (one tick = `speed` packets); 20 ms = 50 Hz
 * @param {object} [o.timers]  { setInterval, clearInterval } for tests
 */
export function createSimTransport({ rows, speed = 1, tickMs = 20, timers = globalThis } = {}) {
  if (!rows?.length) throw new Error('Simulated sensor has no recording.')
  const startRow = playbackStart(rows)
  const disconnects = new Set()
  let notify = null
  let timer = null
  let connected = false
  let seq = 23441
  let playing = false
  let cursor = 0
  let idle = 0
  const device = { name: 'LiftIQ-SIM0', id: 'liftiq-sim', simulated: true }

  const nextRow = () => {
    if (playing) {
      if (cursor < rows.length) return rows[cursor++]
      playing = false // the recording ended: the sensor rests again
    }
    const r = rows[idle % IDLE_ROWS]
    idle++
    return { ...r, phase: 0, repCount: 0 }
  }
  const tick = () => {
    if (!notify || !connected) return
    for (let k = 0; k < speed; k++) notify(encodePacket(nextRow(), seq++))
  }

  return {
    simulated: true,
    device,
    // Hooks beyond the BleTransport interface, used by the controller when it finds them.
    beginPlayback() { cursor = startRow; playing = true },
    get playing() { return playing },
    isSupported: () => true,
    async requestDevice() { return device },
    async connect() { connected = true },
    disconnect() {
      if (!connected) return
      connected = false
      timers.clearInterval(timer); timer = null
      for (const cb of [...disconnects]) cb()
    },
    isConnected: () => connected,
    async getCharacteristic(_device, _service, uuid) {
      if (uuid === RAW_UUID) throw new Error('No research-capture characteristic (simulated older firmware).')
      return { uuid }
    },
    async startNotifications(characteristic, onValue) {
      if (characteristic.uuid !== NOTIFY_UUID) return
      notify = onValue
      if (!timer) timer = timers.setInterval(tick, tickMs)
    },
    async stopNotifications(characteristic) {
      if (characteristic.uuid !== NOTIFY_UUID) return
      notify = null
      timers.clearInterval(timer); timer = null
    },
    async readValue(characteristic) {
      if (characteristic.uuid === INFO_UUID) return infoView()
      throw new Error('Not readable.')
    },
    async writeValue() {},
    onDisconnect(_device, callback) {
      disconnects.add(callback)
      return () => disconnects.delete(callback)
    },
  }
}

/** Fetch the bundled recording and build the transport (the browser path). */
export async function loadSimTransport({ speed = 1 } = {}) {
  const url = new URL(SIM_URL, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not load the simulated recording (' + res.status + ').')
  return createSimTransport({ rows: parseSimCsv(await res.text()), speed })
}
