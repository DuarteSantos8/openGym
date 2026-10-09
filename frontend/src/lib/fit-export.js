// A finished workout as a Garmin .fit activity (#447), for Garmin Connect's "Import Data".
//
// FIT is a small binary container: a 14-byte header, then records, then a CRC. Each record is
// either a definition (which fields a local message type carries, in which base types) or a data
// message laid out the way its definition said. Everything is little-endian, timestamps count
// seconds from the FIT epoch, 1989-12-31T00:00:00Z. A writer for the handful of messages an
// activity needs is a page of code, so this is hand-written rather than a dependency.
//
// What goes in: file_id, file_creator, device_info, a timer start and stop, the session's sets
// (FIT "set" messages: active sets with reps, weight and an exercise category, and the rests
// between them), one lap, the session and the activity. A workout of nothing but cardio becomes
// a run, a ride, a row and so on, with a lap per cardio set instead of strength sets.
//
// openGym keeps a tick time per set (`at`, since v1.3.x), not a start and an end, so when a set
// started is estimated from how long it lasts: its minutes or seconds when it has them, a few
// seconds a rep when it does not. Workouts from before the tick was kept spread their sets over
// the session. No heart rate, no calories: openGym never had them.
import { exOr } from './exercises.js'
import { modeOf, workoutAt } from './history.js'
import { isSideSet, dropsOf } from './workout-model.js'

/* ------------------------------------------------------------- the container -- */

// Seconds between the Unix epoch and the FIT epoch.
export const FIT_EPOCH_OFFSET = 631065600
/** A JavaScript time (ms since 1970) as a FIT date_time (s since 1989-12-31). */
export const fitTime = ms => Math.max(0, Math.round(ms / 1000) - FIT_EPOCH_OFFSET)

// The FIT CRC-16 (CRC-16/ARC: polynomial 0x8005 reflected, start 0), a nibble at a time, the
// way the FIT SDK computes it.
const CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400]
export function fitCrc(bytes, crc = 0) {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    let tmp = CRC_TABLE[crc & 0xF]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xF]
    tmp = CRC_TABLE[crc & 0xF]
    crc = (crc >> 4) & 0x0FFF
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xF]
  }
  return crc
}

// The base types used here: [base type byte, size, invalid value]. A field left undefined is
// written as its type's invalid value, which is how FIT says "not recorded".
export const BASE = {
  enum: [0x00, 1, 0xFF],
  uint8: [0x02, 1, 0xFF],
  uint16: [0x84, 2, 0xFFFF],
  uint32: [0x86, 4, 0xFFFFFFFF],
  uint32z: [0x8C, 4, 0],
  string: [0x07, 0, 0],
}

const PROTOCOL_VERSION = 0x10   // 1.0: no developer fields, nothing a 1.0 reader cannot read
const PROFILE_VERSION = 2132    // 21.32

/**
 * Encode `messages` into a complete .fit file. A message is `{ global, fields }`, each field
 * `[number, type, value, size?]` (size only for a string). A local message type is defined the
 * first time a layout is used, and defined again only when the slot is reused for another.
 */
export function encodeFit(messages) {
  const out = []
  const u8 = v => out.push(v & 0xFF)
  const u16 = v => { u8(v); u8(v >>> 8) }
  const u32 = v => { u16(v & 0xFFFF); u16(v >>> 16) }
  const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null
  const slots = new Map()   // layout signature -> local message type
  const owner = []          // local message type -> the signature it holds now
  let next = 0
  for (const m of messages) {
    const fields = m.fields.filter(Boolean).map(([num, type, value, size]) => {
      const [base, width, invalid] = BASE[type]
      return { num, type, value, base, invalid, size: type === 'string' ? Math.max(1, size || 1) : width }
    })
    const sig = m.global + ':' + fields.map(f => `${f.num}/${f.base}/${f.size}`).join(',')
    let local = slots.get(sig)
    if (local == null || owner[local] !== sig) {
      local = next
      next = (next + 1) % 16
      if (owner[local]) slots.delete(owner[local])
      owner[local] = sig
      slots.set(sig, local)
      // Definition record: header (bit 6 set), reserved, architecture 0 (little-endian), the
      // global message number, the field count, then number/size/base type per field.
      u8(0x40 | local); u8(0); u8(0); u16(m.global); u8(fields.length)
      for (const f of fields) { u8(f.num); u8(f.size); u8(f.base) }
    }
    u8(local)
    for (const f of fields) {
      const v = f.value == null || !Number.isFinite(Number(f.value)) && f.type !== 'string' ? null : f.value
      if (f.type === 'string') {
        // Null-terminated and padded to the defined size; cut on a whole character.
        let bytes = enc ? Array.from(enc.encode(String(v ?? ''))) : Array.from(String(v ?? ''), c => c.charCodeAt(0) & 0x7F)
        while (bytes.length > f.size - 1) {
          bytes = bytes.slice(0, f.size - 1)
          while (bytes.length && (bytes[bytes.length - 1] & 0xC0) === 0x80) bytes.pop()
          if (bytes.length && bytes[bytes.length - 1] >= 0xC0) bytes.pop()
        }
        for (let i = 0; i < f.size; i++) u8(bytes[i] ?? 0)
      } else {
        // A number that does not fit its type is not recorded rather than wrapped round.
        const n = v == null ? f.invalid : Math.round(Number(v))
        const max = f.size === 1 ? 0xFF : f.size === 2 ? 0xFFFF : 0xFFFFFFFF
        const val = n < 0 || n > max ? f.invalid : n
        if (f.size === 1) u8(val); else if (f.size === 2) u16(val); else u32(val)
      }
    }
  }
  const data = Uint8Array.from(out)
  const header = new Uint8Array(14)
  const hv = new DataView(header.buffer)
  header[0] = 14
  header[1] = PROTOCOL_VERSION
  hv.setUint16(2, PROFILE_VERSION, true)
  hv.setUint32(4, data.length, true)
  header.set([0x2E, 0x46, 0x49, 0x54], 8)   // ".FIT"
  hv.setUint16(12, fitCrc(header.subarray(0, 12)), true)
  const file = new Uint8Array(14 + data.length + 2)
  file.set(header, 0)
  file.set(data, 14)
  const crc = fitCrc(file.subarray(0, 14 + data.length))
  file[file.length - 2] = crc & 0xFF
  file[file.length - 1] = crc >> 8
  return file
}

/* ------------------------------------------------------- the FIT profile bits -- */

export const MSG = { fileId: 0, session: 18, lap: 19, event: 21, deviceInfo: 23, activity: 34, fileCreator: 49, set: 225 }
export const SPORT = { generic: 0, running: 1, cycling: 2, fitnessEquipment: 4, training: 10, walking: 11, rowing: 15 }
export const SUB_SPORT = { generic: 0, treadmill: 1, indoorCycling: 6, indoorRowing: 14, elliptical: 15, stairClimbing: 16, strengthTraining: 20, cardioTraining: 26 }
const MANUFACTURER_DEVELOPMENT = 255
const UNKNOWN_CATEGORY = 65534

// FIT's exercise_category, by the exercise's name first: the catalogue names are English and say
// what the movement is ("barbell bench press", "lying leg curl"). Specific words come before
// general ones, so a leg curl is not a biceps curl and a split squat is a lunge.
export const CATEGORY = {
  benchPress: 0, calfRaise: 1, cardio: 2, carry: 3, chop: 4, core: 5, crunch: 6, curl: 7, deadlift: 8,
  flye: 9, hipRaise: 10, hipStability: 11, hipSwing: 12, hyperextension: 13, lateralRaise: 14,
  legCurl: 15, legRaise: 16, lunge: 17, olympicLift: 18, plank: 19, plyo: 20, pullUp: 21, pushUp: 22,
  row: 23, shoulderPress: 24, shoulderStability: 25, shrug: 26, sitUp: 27, squat: 28, totalBody: 29,
  tricepsExtension: 30, warmUp: 31, run: 32,
}
const C = CATEGORY
const BY_NAME = [
  [/leg curl|hamstring curl|nordic/, C.legCurl],
  [/leg raise|knee raise|toes to bar|knees to elbow/, C.legRaise],
  [/calf|heel raise/, C.calfRaise],
  [/bench press|chest press|floor press/, C.benchPress],
  [/deadlift|rack pull|good morning/, C.deadlift],
  [/hip thrust|glute bridge|hip raise|bridge/, C.hipRaise],
  [/hyperextension|back extension|superman/, C.hyperextension],
  [/lateral raise|side raise|front raise|rear delt|reverse fly/, C.lateralRaise],
  [/\bfly|flye|crossover|pec deck/, C.flye],
  [/curl/, C.curl],
  [/lunge|split squat|step ?up/, C.lunge],
  [/clean|snatch|jerk/, C.olympicLift],
  [/plank/, C.plank],
  [/burpee|thruster|turkish get/, C.totalBody],
  [/jump|plyo|bound/, C.plyo],
  [/pull ?up|chin ?up|pull ?down/, C.pullUp],
  [/push ?up/, C.pushUp],
  [/\brow\b|rows\b/, C.row],
  [/shoulder press|overhead press|military press|arnold press|push press/, C.shoulderPress],
  [/shrug/, C.shrug],
  [/sit ?up/, C.sitUp],
  [/crunch/, C.crunch],
  [/squat|leg press|hack/, C.squat],
  [/tricep|push ?down|skull|\bdips?\b|kickback/, C.tricepsExtension],
  [/swing/, C.hipSwing],
  [/carry|farmer/, C.carry],
  [/chop/, C.chop],
]
// Then by the muscle it trains, which also covers your own exercises named in any language.
const BY_TARGET = {
  biceps: C.curl, forearms: C.curl, triceps: C.tricepsExtension, pectorals: C.benchPress, delts: C.shoulderPress,
  lats: C.pullUp, 'upper back': C.row, traps: C.shrug, abs: C.crunch, quads: C.squat, glutes: C.hipRaise,
  hamstrings: C.legCurl, calves: C.calfRaise, spine: C.hyperextension, adductors: C.hipStability, abductors: C.hipStability,
}

const RUNNING = /treadmill|\brun|jog|sprint/

/** The FIT exercise_category of an exercise ({ n, tg, bp }), or 65534 (unknown). */
export function fitCategory(ex, mode) {
  const name = String(ex?.n || '').toLowerCase()
  if (mode === 'cardio' || ex?.bp === 'cardio') return RUNNING.test(name) && !/bike|bicycl|cycl|rowing/.test(name) ? C.run : C.cardio
  for (const [re, cat] of BY_NAME) if (re.test(name)) return cat
  return BY_TARGET[ex?.tg] ?? UNKNOWN_CATEGORY
}

/** [sport, sub_sport] of one cardio exercise, read off its name and equipment. */
export function cardioSport(ex) {
  const name = String(ex?.n || '').toLowerCase()
  const eq = String(ex?.eq || '').toLowerCase()
  if (/bike|bicycl|cycl|spin/.test(name)) return [SPORT.cycling, eq === 'stationary bike' || /stationary|indoor|spin|assault/.test(name) ? SUB_SPORT.indoorCycling : SUB_SPORT.generic]
  if (/rowing|rower|\brow\b/.test(name)) return [SPORT.rowing, SUB_SPORT.indoorRowing]
  if (/elliptical|cross trainer/.test(name) || eq === 'elliptical machine') return [SPORT.fitnessEquipment, SUB_SPORT.elliptical]
  if (/stair|stepmill|stepper/.test(name) || eq === 'stepmill machine') return [SPORT.fitnessEquipment, SUB_SPORT.stairClimbing]
  if (/treadmill/.test(name)) return [/walk/.test(name) ? SPORT.walking : SPORT.running, SUB_SPORT.treadmill]
  if (/walk|hik(e|ing)|march/.test(name)) return [SPORT.walking, SUB_SPORT.generic]
  if (RUNNING.test(name)) return [SPORT.running, SUB_SPORT.generic]
  return [SPORT.training, SUB_SPORT.cardioTraining]
}

/* ----------------------------------------------------------- the workout -- */

const LB_TO_KG = 0.45359237
// How long one rep takes, for a rep set that has no clock of its own, and the bounds of a set.
const REP_MS = 3000
const SET_MIN_MS = 15000
const SET_MAX_MS = 120000

// One FIT "set" per thing that was done: a straight set, each side of a per-side set, and each
// drop of a drop set (right after its set, with no rest in between).
function itemsOf(w, exOf) {
  const items = []
  ;(w?.entries || []).forEach(entry => {
    if (!entry?.id) return
    const ex = exOf(entry.id)
    const mode = modeOf({ ...(entry.target || {}), id: entry.id })
    const category = fitCategory(ex, mode)
    const push = (row, at, chained) => {
      const reps = Math.round(Number(row.r) || 0)
      const sec = Number(row.sec) || 0
      const min = Number(row.min) || 0
      const len = mode === 'cardio' ? min * 60000
        : mode === 'time' ? sec * 1000
          : Math.min(SET_MAX_MS, Math.max(SET_MIN_MS, reps * REP_MS))
      if (!(len > 0)) return
      items.push({
        ex, mode, category, len, chained, at: Number.isFinite(at) ? at : null,
        reps: mode === 'reps' && reps > 0 ? reps : null,
        w: mode === 'cardio' ? null : Number(row.w) || 0,
        km: mode === 'cardio' ? (Number(row.speed) || 0) * min / 60 : 0,
      })
    }
    for (const s of entry.sets || []) {
      if (!s) continue
      const rows = isSideSet(s) ? [s.sides.L, s.sides.R].filter(x => x?.done === true) : s.done === true ? [s] : []
      for (const row of rows) {
        push(row, Number.isFinite(row.at) ? row.at : s.at, false)
        for (const d of dropsOf(row)) if (Number(d?.r) > 0) push({ ...d, w: Number(d.w) || 0 }, null, true)
      }
    }
  })
  return items
}

// Each item's start and end (ms). With every set ticked (`at`), a set ends at its tick and
// starts its length earlier, but not before the one ahead of it ended: the gaps are the rests.
// Ticks that do not leave the sets room (a log caught up after the session, all in one go) say
// nothing about when they happened, and those sets are spread like the ones below. Without ticks
// the sets share the session evenly: back to back when their lengths fill it, otherwise with the
// same rest after each one (a drop follows its set at once).
function placeItems(items, start, end) {
  if (!items.length) return []
  if (items.every(x => x.at != null || x.chained)) {
    let cursor = start
    const placed = items.map(x => {
      const tick = x.chained ? cursor + x.len : Math.max(x.at, cursor)
      const s = x.chained ? cursor : Math.max(cursor, tick - x.len)
      const e = Math.max(tick, s + x.len)
      cursor = e
      return { ...x, start: s, end: e }
    })
    if (cursor <= end + 1000) return placed
  }
  const total = Math.max(0, end - start)
  const active = items.reduce((n, x) => n + x.len, 0)
  const rests = items.slice(1).filter(x => !x.chained).length
  const scale = active > total && active > 0 ? total / active : 1
  const rest = rests && active < total ? (total - active) / rests : 0
  let cursor = start
  return items.map((x, i) => {
    if (i > 0 && !x.chained) cursor += rest
    const s = cursor
    const e = s + Math.max(1000, x.len * scale)
    cursor = e
    return { ...x, start: s, end: e }
  })
}

// A small stable number for the file's serial: the same workout exported twice is the same
// device and file to Garmin Connect, which then recognises it as already imported.
function serialOf(w) {
  const s = String(w?.id ?? workoutAt(w))
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h || 1
}

/**
 * The FIT messages for a finished workout `w`. `unit` is the profile's weight unit (weights are
 * stored in it, FIT wants kilograms), `version` the app's ("1.4.0"), `exOf(id)` the exercise.
 */
export function workoutFitMessages(w, { unit = 'kg', version = '', exOf = exOr } = {}) {
  const startMs = workoutAt(w)
  if (!Number.isFinite(startMs)) throw new Error('This workout has no date')
  let endMs = Number.isFinite(w?.end) && w.end > startMs ? w.end : startMs
  const items = itemsOf(w, exOf)
  const cardioOnly = items.length > 0 && items.every(x => x.mode === 'cardio')
  // A workout with no end of its own lasts as long as its sets do.
  if (endMs <= startMs) endMs = startMs + items.reduce((n, x) => n + x.len, 0) + Math.max(0, items.length - 1) * 60000
  const placed = placeItems(items, startMs, endMs)
  endMs = Math.max(endMs, ...placed.map(x => x.end))
  const T0 = fitTime(startMs), T1 = fitTime(endMs)
  const elapsedMs = Math.max(0, endMs - startMs)
  const kg = v => (unit === 'lb' ? v * LB_TO_KG : v)
  // software_version has two decimals: v1.4.x (a build suffix and all) reads 1.04.
  const ver = /^(\d+)\.(\d+)/.exec(String(version))
  const swVersion = ver ? Number(ver[1]) * 100 + Number(ver[2]) : undefined
  const serial = serialOf(w)

  let sport = [SPORT.training, SUB_SPORT.strengthTraining]
  if (cardioOnly) {
    const kinds = [...new Set(items.map(x => cardioSport(x.ex).join('/')))]
    sport = kinds.length === 1 ? kinds[0].split('/').map(Number) : [SPORT.training, SUB_SPORT.cardioTraining]
  }
  const km = items.reduce((n, x) => n + x.km, 0)
  const meters = km > 0 ? km * 1000 : undefined

  const msgs = []
  msgs.push({ global: MSG.fileId, fields: [
    [0, 'enum', 4],                        // type: activity
    [1, 'uint16', MANUFACTURER_DEVELOPMENT],
    [2, 'uint16', 0],                      // product
    [3, 'uint32z', serial],
    [4, 'uint32', T0],                     // time_created
  ] })
  msgs.push({ global: MSG.fileCreator, fields: [[0, 'uint16', swVersion]] })
  msgs.push({ global: MSG.event, fields: [[253, 'uint32', T0], [0, 'enum', 0], [1, 'enum', 0]] })   // timer start
  msgs.push({ global: MSG.deviceInfo, fields: [
    [253, 'uint32', T0], [0, 'uint8', 0], [2, 'uint16', MANUFACTURER_DEVELOPMENT], [3, 'uint32z', serial],
    [4, 'uint16', 0], [5, 'uint16', swVersion], [27, 'string', 'openGym', 16],
  ] })

  const laps = []
  if (cardioOnly) {
    // A lap per cardio set: its time, its distance and its speed, the way a watch splits a run.
    placed.forEach(x => {
      const ms = x.end - x.start
      laps.push({ start: x.start, end: x.end, ms, meters: x.km * 1000, speed: ms > 0 ? x.km * 1000 / (ms / 1000) : 0 })
    })
  } else {
    let index = 0
    const setMsg = (s, e, type, x) => msgs.push({ global: MSG.set, fields: [
      [254, 'uint32', fitTime(e)],          // timestamp: when the set ended
      [0, 'uint32', e - s],                 // duration, ms (scale 1000)
      [3, 'uint16', x?.reps ?? undefined],  // repetitions
      [4, 'uint16', x && x.w != null && x.mode !== 'cardio' ? kg(x.w) * 16 : undefined],   // weight, kg (scale 16)
      [5, 'uint8', type],                   // set_type: 0 rest, 1 active
      [6, 'uint32', fitTime(s)],            // start_time
      [7, 'uint16', x ? x.category : undefined],
      [9, 'uint16', x && x.w != null ? (unit === 'lb' ? 2 : 1) : undefined],   // weight_display_unit
      [10, 'uint16', index++],              // message_index
    ] })
    let prevEnd = null
    for (const x of placed) {
      if (prevEnd != null && x.start - prevEnd >= 1000) setMsg(prevEnd, x.start, 0, null)
      setMsg(x.start, x.end, 1, x)
      prevEnd = x.end
    }
    laps.push({ start: startMs, end: endMs, ms: elapsedMs, meters, speed: undefined })
  }

  msgs.push({ global: MSG.event, fields: [[253, 'uint32', T1], [0, 'enum', 0], [1, 'enum', 4]] })   // timer stop_all
  laps.forEach((l, i) => msgs.push({ global: MSG.lap, fields: [
    [254, 'uint16', i], [253, 'uint32', fitTime(l.end)], [0, 'enum', 9], [1, 'enum', 1],   // event lap, stop
    [2, 'uint32', fitTime(l.start)], [7, 'uint32', l.ms], [8, 'uint32', l.ms],
    [9, 'uint32', l.meters != null && l.meters > 0 ? l.meters * 100 : undefined],          // total_distance, cm
    [13, 'uint16', l.speed > 0 ? l.speed * 1000 : undefined],                              // avg_speed, mm/s
    [25, 'enum', sport[0]], [39, 'enum', sport[1]],
  ] }))
  msgs.push({ global: MSG.session, fields: [
    [254, 'uint16', 0], [253, 'uint32', T1], [0, 'enum', 8], [1, 'enum', 1],               // event session, stop
    [2, 'uint32', T0], [5, 'enum', sport[0]], [6, 'enum', sport[1]],
    [7, 'uint32', elapsedMs], [8, 'uint32', elapsedMs],
    [9, 'uint32', meters != null ? meters * 100 : undefined],
    [14, 'uint16', cardioOnly && meters && elapsedMs > 0 ? meters / (elapsedMs / 1000) * 1000 : undefined],
    [25, 'uint16', 0], [26, 'uint16', laps.length],
  ] })
  // local_timestamp: the same moment on the wall clock where the workout happened.
  const offset = -new Date(endMs).getTimezoneOffset() * 60
  msgs.push({ global: MSG.activity, fields: [
    [253, 'uint32', T1], [0, 'uint32', elapsedMs], [1, 'uint16', 1], [2, 'enum', 0],       // type manual
    [3, 'enum', 26], [4, 'enum', 1], [5, 'uint32', T1 + offset],                            // event activity, stop
  ] })
  return msgs
}

/** The finished workout `w` as the bytes of a .fit file. Options as workoutFitMessages. */
export const workoutFit = (w, options) => encodeFit(workoutFitMessages(w, options))

/** "opengym-2026-10-09-1830.fit": the day and the start time, so two sessions a day stay apart. */
export function fitFileName(w) {
  const d = new Date(workoutAt(w))
  if (!Number.isFinite(d.getTime())) return 'opengym-workout.fit'
  const p = n => String(n).padStart(2, '0')
  return `opengym-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.fit`
}
