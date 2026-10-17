// LFopen v3 over Bluetooth LE: the bytes, without the radio (docs/LIFE_FITNESS_CARDIO_CONNECT.md,
// part A3). Constants and pure codecs only — the session (scan, login, stream) and the native
// transport build on these, and every function here is tested against hand-made frames.
//
// Source: LFOpen2ServiceBuilder, LFOpen2Flow, LoginFlow/WorkoutFlow and ByteArrayHelper in the
// decompiled LFconnect 3.9.5.

const std = short => `0000${short}-0000-1000-8000-00805f9b34fb`

export const UUID = {
  // Life Fitness data service and its characteristics
  LF_DATA_SERVICE: 'fb694b90-f49e-4597-8306-171bba78f846',
  CURRENT_STATE: '5da551de-9cb2-11e5-8994-feff819cdc9f',
  CLIENT_MESSAGE: '5da558dc-9cb2-11e5-8994-feff819cdc9f',
  WORKOUT_SUMMARY: '5da552a6-9cb2-11e5-8994-feff819cdc9f',
  WORKOUT_DETAIL: '5da55bc0-9cb2-11e5-8994-feff819cdc9f',
  CONSOLE_NOTIFICATION: '5da55aa8-9cb2-11e5-8994-feff819cdc9f',
  GET_FEATURES: '5da55aa9-9cb2-11e5-8994-feff819cdc9f',
  PRESET_SUMMARY: '5da569e2-9cb2-11e5-8994-feff819cdc9f',
  START_PRESET: '5da569e4-9cb2-11e5-8994-feff819cdc9f',
  SELECT_PRESET: '5da56ab6-9cb2-11e5-8994-feff819cdc9f',
  SET_LEVEL: 'ce78f4e8-9cb6-11e5-8994-feff819cdc9f',
  SET_INCLINE: 'ce78f164-9cb6-11e5-8994-feff819cdc9f',
  SET_WATTS: 'ce78f330-9cb6-11e5-8994-feff819cdc9f',
  SET_TARGET_HR: 'ce78fb00-9cb6-11e5-8994-feff819cdc9f',
  DISPLAY_MESSAGE: 'ce78fd94-9cb6-11e5-8994-feff819cdc9f',
  MAXIMUM_DURATION: 'ce78eca0-9cb6-11e5-8994-feff819cdc9f',
  MAXIMUM_INCLINE: 'ce78ef5c-9cb6-11e5-8994-feff819cdc9f',
  // user data service: the standard characteristics plus LF's HMAC and unit
  USER_DATA_SERVICE: 'fb694b91-f49e-4597-8306-171bba78f846',
  FIRST_NAME: std('2a8a'), LAST_NAME: std('2a90'), EMAIL: std('2a87'), AGE: std('2a80'),
  GENDER: std('2a8c'), LANGUAGE: std('2aa2'), WEIGHT: std('2a98'), HEIGHT: std('2a8e'),
  HMAC: '5da54cf2-9cb2-11e5-8994-feff819cdc9f',
  MEASUREMENT_UNIT: 'ce78e85e-9cb6-11e5-8994-feff819cdc9f',
  // Fitness Machine Service
  FTMS_SERVICE: std('1826'),
  TREADMILL_DATA: std('2acd'), CROSS_TRAINER_DATA: std('2ace'), STAIR_CLIMBER_DATA: std('2ad0'),
  INDOOR_BIKE_DATA: std('2ad2'), TRAINING_STATUS: std('2ad3'), MACHINE_STATUS: std('2ada'),
  // Wahoo's service on an LFopen v2 console
  WAHOO_SERVICE: 'a026ee07-0a7d-4ab3-97fa-f1500f9feb8b',
}

// Client messages and console states the login and workout flows wait for.
export const CLIENT = { LOGIN_START: 0x01, DATA_COMPLETE: 0x02 }
export const STATE = { LOGIN_CONFIRMED: [0x07], LOGGED_IN: [0x04, 0x01], PRESET_SELECTED: 21 }
// FTMS training status values and machine status op codes that mean "the workout is running".
export const TRAINING_RUNNING = [13, 14]
export const MACHINE = { PAUSED: 0x02, RESUMED: 0x04 }

// Phase watchdogs, ms (ConnectionState.java), and how long the scan may take.
export const TIMEOUTS = { SCAN: 10000, INIT: 10000, BLE_FOUND: 5000, BLE_CONNECTED: 5000, PRESETS_FETCHED: 10000 }
// The MTU asked for, and how much of it a chunk may use (LFconnect keeps 100 bytes spare; when
// the MTU request fails it falls back to 20).
export const MTU = 517
export const payloadSize = mtu => (Number(mtu) > 100 ? Number(mtu) - 100 : 20)

/** Anything byte-like (Uint8Array, ArrayBuffer, DataView, number[]) as a Uint8Array. */
export function toBytes(v) {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  if (Array.isArray(v)) return Uint8Array.from(v)
  if (typeof v === 'string') return new TextEncoder().encode(v)
  return new Uint8Array(0)
}

/** LF's checksum: the payload's bytes summed, mod 256. */
export function checksum(bytes) {
  let sum = 0
  for (const b of toBytes(bytes)) sum = (sum + b) & 0xff
  return sum
}

/**
 * Data (a string or bytes) as the frames LF writes it in: each `[seq u16 BE][total u16 BE]
 * [checksum u8]` followed by up to `size` bytes of payload.
 */
export function splitChunks(data, size) {
  const bytes = toBytes(data)
  const n = Math.max(1, Math.ceil(bytes.length / size))
  const out = []
  for (let i = 0; i < n; i++) {
    const part = bytes.subarray(i * size, (i + 1) * size)
    const frame = new Uint8Array(part.length + 5)
    frame.set([(i >> 8) & 0xff, i & 0xff, (n >> 8) & 0xff, n & 0xff, checksum(part)], 0)
    frame.set(part, 5)
    out.push(frame)
  }
  return out
}

const isJson = s => { try { JSON.parse(s); return true } catch { return false } }

/**
 * Puts the WORKOUT_SUMMARY frames back together. `push(frame)` returns the whole text once it is
 * complete and null until then; a frame with a wrong checksum (or too short) is dropped and is
 * reported by `dropped`. As in LFconnect, a first frame whose payload is already valid JSON is
 * the whole summary.
 */
export class ChunkAssembler {
  constructor() { this.reset() }
  reset() { this.parts = null; this.got = 0; this.dropped = 0; this.done = null }
  push(frame) {
    if (this.done != null) return this.done
    const b = toBytes(frame)
    if (b.length <= 5) { this.dropped++; return null }
    const seq = (b[0] << 8) | b[1]
    const total = (b[2] << 8) | b[3]
    const payload = b.subarray(5)
    if (b[4] !== checksum(payload) || total < 1 || seq >= total) { this.dropped++; return null }
    const text = new TextDecoder().decode(payload)
    if (seq === 0 && isJson(text)) return (this.done = text)
    if (!this.parts || this.parts.length !== total) { this.parts = new Array(total).fill(null); this.got = 0 }
    if (this.parts[seq] == null) { this.parts[seq] = text; this.got++ }
    if (this.got < total) return null
    return (this.done = this.parts.join(''))
  }
}

/* ---------------------------------------------------------------- FTMS ---- */

// Field readers: [bytes, read(DataView, offset)]
const U8 = [1, (v, o) => v.getUint8(o)]
const U16 = [2, (v, o) => v.getUint16(o, true)]
const S16 = [2, (v, o) => v.getInt16(o, true)]
const U24 = [3, (v, o) => v.getUint16(o, true) | (v.getUint8(o + 2) << 16)]

/*
 * A machine's data record: a flags field, then the fields its bits announce, in order. Bit 0 is
 * "more data" and works backwards: clear means the instantaneous speed IS there. Each entry is
 * [bit, [[name, reader, scale], …]].
 */
function parseFtms(raw, flagBytes, spec) {
  const b = toBytes(raw)
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length < flagBytes) return null
  let flags = 0
  for (let i = 0; i < flagBytes; i++) flags |= b[i] << (8 * i)
  let o = flagBytes
  const out = {}
  for (const [bit, fields] of spec) {
    const present = bit === 0 ? !(flags & 1) : !!(flags & (1 << bit))
    if (!present) continue
    for (const [name, [size, read], scale = 1] of fields) {
      if (o + size > b.length) return out
      if (name) out[name] = Math.round(read(v, o) * scale * 1000) / 1000
      o += size
    }
  }
  return out
}

const ENERGY = [['kcal', U16], ['kcalPerHour', U16], ['kcalPerMinute', U8]]

/** Indoor Bike Data (0x2AD2): speed km/h, cadence rpm, distance m, resistance, watts, kcal, hr, s. */
export const parseIndoorBike = raw => parseFtms(raw, 2, [
  [0, [['speed', U16, 0.01]]],
  [1, [['avgSpeed', U16, 0.01]]],
  [2, [['cadence', U16, 0.5]]],
  [3, [['avgCadence', U16, 0.5]]],
  [4, [['distance', U24]]],
  [5, [['level', S16]]],
  [6, [['watts', S16]]],
  [7, [['avgWatts', S16]]],
  [8, ENERGY],
  [9, [['hr', U8]]],
  [10, [['mets', U8, 0.1]]],
  [11, [['elapsed', U16]]],
  [12, [['remaining', U16]]],
])

/** Treadmill Data (0x2ACD): speed km/h, distance m, incline %, elevation m, kcal, hr, s. */
export const parseTreadmill = raw => parseFtms(raw, 2, [
  [0, [['speed', U16, 0.01]]],
  [1, [['avgSpeed', U16, 0.01]]],
  [2, [['distance', U24]]],
  [3, [['incline', S16, 0.1], ['rampAngle', S16, 0.1]]],
  [4, [['elevationGain', U16, 0.1], ['elevationLoss', U16, 0.1]]],
  [5, [['pace', U8, 0.1]]],
  [6, [['avgPace', U8, 0.1]]],
  [7, ENERGY],
  [8, [['hr', U8]]],
  [9, [['mets', U8, 0.1]]],
  [10, [['elapsed', U16]]],
  [11, [['remaining', U16]]],
  [12, [['beltForce', S16], ['watts', S16]]],
])

/** Cross Trainer Data (0x2ACE, 24-bit flags): speed, distance, steps/min, incline, level, watts… */
export const parseCrossTrainer = raw => parseFtms(raw, 3, [
  [0, [['speed', U16, 0.01]]],
  [1, [['avgSpeed', U16, 0.01]]],
  [2, [['distance', U24]]],
  [3, [['stepRate', U16], ['avgStepRate', U16]]],
  [4, [['strides', U16, 0.1]]],
  [5, [['elevationGain', U16], ['elevationLoss', U16]]],
  [6, [['incline', S16, 0.1], ['rampAngle', S16, 0.1]]],
  [7, [['level', S16, 0.1]]],
  [8, [['watts', S16]]],
  [9, [['avgWatts', S16]]],
  [10, ENERGY],
  [11, [['hr', U8]]],
  [12, [['mets', U8, 0.1]]],
  [13, [['elapsed', U16]]],
  [14, [['remaining', U16]]],
])

/** The FTMS data characteristic and parser for a kind of machine (lib/lfopen/devices.js). */
export const FTMS_FOR_KIND = {
  treadmill: { uuid: UUID.TREADMILL_DATA, parse: parseTreadmill },
  crossTrainer: { uuid: UUID.CROSS_TRAINER_DATA, parse: parseCrossTrainer },
  upright: { uuid: UUID.INDOOR_BIKE_DATA, parse: parseIndoorBike },
  recumbent: { uuid: UUID.INDOOR_BIKE_DATA, parse: parseIndoorBike },
}

/* ------------------------------------------------------------- control ---- */

const u16le = n => { const v = Math.max(0, Math.min(0xffff, Math.round(n))); return Uint8Array.of(v & 0xff, (v >> 8) & 0xff) }
const s16le = n => { const v = Math.max(-0x8000, Math.min(0x7fff, Math.round(n))) & 0xffff; return Uint8Array.of(v & 0xff, (v >> 8) & 0xff) }

/** SET_LEVEL: one byte. */
export const encodeLevel = level => Uint8Array.of(Math.max(0, Math.min(255, Math.round(level))))
/** SET_INCLINE: percent × 10, 16-bit little-endian (a decline is negative). */
export const encodeIncline = pct => s16le(pct * 10)
/** SET_WATTS: 16-bit little-endian. */
export const encodeWatts = watts => u16le(watts)
/** SET_TARGET_HR: 16-bit little-endian. */
export const encodeTargetHr = bpm => u16le(bpm)
/** AGE in the user data service: 16-bit little-endian. */
export const encodeAge = years => u16le(years)

/** Which protocol a console speaks, from the service UUIDs it advertises. */
export function protocolOf(serviceUuids = []) {
  const s = new Set(serviceUuids.map(u => String(u).toLowerCase()))
  if (s.has(UUID.WAHOO_SERVICE)) return 'v2'
  if (s.has(UUID.FTMS_SERVICE) || s.has('1826')) return 'v3'
  return 'v1'
}

/** Whether a scanned device is the console a connect code names: its name holds `a` or `u`. */
export function matchesDevice(name, { a, u } = {}) {
  const n = String(name ?? '').toLowerCase()
  if (!n) return false
  return (!!a && n.includes(String(a).toLowerCase())) || (!!u && n.includes(String(u).toLowerCase()))
}
