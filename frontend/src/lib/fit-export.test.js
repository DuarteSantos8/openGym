// A finished workout as a Garmin .fit file (#447). The file is read back here with a decoder
// written from the FIT protocol document, independent of the encoder: header, both CRCs, the
// definition and data records, and what the messages say about the workout.
import { describe, it, expect } from 'vitest'
import {
  fitCrc, fitTime, FIT_EPOCH_OFFSET, encodeFit, workoutFitMessages, workoutFit, fitFileName,
  fitCategory, cardioSport, CATEGORY, SPORT, SUB_SPORT, MSG,
} from './fit-export.js'
import { EXIDX } from './exercises.js'

/* ---------------------------------------------------------------- decoder -- */

const SIZE = { 0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x07: 0, 0x0A: 1, 0x8B: 2, 0x8C: 4, 0x0D: 1 }
function decode(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = {
    size: bytes[0], protocol: bytes[1], profile: v.getUint16(2, true), dataSize: v.getUint32(4, true),
    type: String.fromCharCode(...bytes.slice(8, 12)), crc: v.getUint16(12, true),
  }
  const defs = []
  const messages = []
  const definitions = []
  let p = header.size
  const end = header.size + header.dataSize
  while (p < end) {
    const h = bytes[p++]
    expect(h & 0x80, 'no compressed timestamp headers').toBe(0)
    const local = h & 0x0F
    if (h & 0x40) {
      expect(h & 0x20, 'no developer data').toBe(0)
      expect(bytes[p + 1], 'little-endian').toBe(0)
      const global = v.getUint16(p + 2, true)
      const n = bytes[p + 4]
      p += 5
      const fields = []
      for (let i = 0; i < n; i++, p += 3) {
        const [num, size, base] = [bytes[p], bytes[p + 1], bytes[p + 2]]
        expect(SIZE[base], `known base type ${base}`).not.toBeUndefined()
        if (SIZE[base]) expect(size % SIZE[base], 'size is a whole number of values').toBe(0)
        fields.push({ num, size, base })
      }
      defs[local] = { global, fields }
      definitions.push({ local, global })
    } else {
      const def = defs[local]
      expect(def, `local type ${local} defined before use`).toBeTruthy()
      const out = {}
      for (const f of def.fields) {
        let val
        if (f.base === 0x07) {
          const raw = bytes.slice(p, p + f.size)
          const z = raw.indexOf(0)
          val = new TextDecoder().decode(raw.slice(0, z < 0 ? raw.length : z))
        } else if (f.size === 1) val = bytes[p]
        else if (f.size === 2) val = v.getUint16(p, true)
        else val = v.getUint32(p, true)
        out[f.num] = val
        p += f.size
      }
      messages.push({ global: def.global, local, f: out })
    }
  }
  expect(p).toBe(end)
  return { header, messages, definitions, fileCrc: v.getUint16(end, true) }
}
const of = (decoded, global) => decoded.messages.filter(m => m.global === global).map(m => m.f)

/* ----------------------------------------------------------- the container -- */

describe('the FIT CRC', () => {
  it('is CRC-16/ARC, as the FIT SDK computes it', () => {
    expect(fitCrc(new TextEncoder().encode('123456789'))).toBe(0xBB3D)
    expect(fitCrc(new Uint8Array(0))).toBe(0)
    // It can be fed in pieces.
    const bytes = new TextEncoder().encode('openGym .fit')
    expect(fitCrc(bytes.subarray(5), fitCrc(bytes.subarray(0, 5)))).toBe(fitCrc(bytes))
  })
})

describe('FIT time', () => {
  it('counts seconds from 1989-12-31T00:00:00Z', () => {
    expect(FIT_EPOCH_OFFSET).toBe(Date.UTC(1989, 11, 31) / 1000)
    expect(fitTime(Date.UTC(1989, 11, 31))).toBe(0)
    expect(fitTime(Date.UTC(1989, 11, 31, 0, 1, 0))).toBe(60)
    expect(fitTime(Date.UTC(2026, 9, 9, 17))).toBe(Date.UTC(2026, 9, 9, 17) / 1000 - 631065600)
    expect(fitTime(0)).toBe(0)
  })
})

describe('encodeFit', () => {
  const file = encodeFit([
    { global: MSG.fileId, fields: [[0, 'enum', 4], [1, 'uint16', 255], [3, 'uint32z', 1234], [4, 'uint32', 1000]] },
    { global: MSG.deviceInfo, fields: [[0, 'uint8', 0], [27, 'string', 'openGym', 16]] },
  ])
  const d = decode(file)

  it('writes the 14-byte header with its CRC, and the file CRC after the records', () => {
    expect(d.header).toMatchObject({ size: 14, protocol: 0x10, type: '.FIT' })
    expect(d.header.profile).toBeGreaterThan(2000)
    expect(d.header.dataSize).toBe(file.length - 16)
    expect(d.header.crc).toBe(fitCrc(file.subarray(0, 12)))
    expect(d.fileCrc).toBe(fitCrc(file.subarray(0, file.length - 2)))
    // The check a reader does: the CRC over everything, its own two bytes included, is zero.
    expect(fitCrc(file)).toBe(0)
  })

  it('defines each message before its data, and the data decodes back', () => {
    expect(d.definitions.map(x => x.global)).toEqual([MSG.fileId, MSG.deviceInfo])
    expect(d.messages).toEqual([
      { global: MSG.fileId, local: 0, f: { 0: 4, 1: 255, 3: 1234, 4: 1000 } },
      { global: MSG.deviceInfo, local: 1, f: { 0: 0, 27: 'openGym' } },
    ])
  })

  it('writes a value it does not have, or one that does not fit, as the type\'s invalid value', () => {
    const m = decode(encodeFit([{ global: MSG.set, fields: [
      [0, 'uint32', undefined], [3, 'uint16', null], [4, 'uint16', 70000], [5, 'uint8', -1], [7, 'uint16', NaN], [9, 'uint32z', undefined], [10, 'enum', 300],
    ] }])).messages[0].f
    expect(m).toEqual({ 0: 0xFFFFFFFF, 3: 0xFFFF, 4: 0xFFFF, 5: 0xFF, 7: 0xFFFF, 9: 0, 10: 0xFF })
  })

  it('rounds numbers and cuts a long string on a whole character, null-terminated', () => {
    const m = decode(encodeFit([{ global: MSG.deviceInfo, fields: [[5, 'uint16', 104.6], [27, 'string', 'Übungsgerät', 6]] }])).messages[0].f
    expect(m[5]).toBe(105)
    expect(m[27]).toBe('Übun')   // Ü is two bytes: 5 bytes fit before the terminator, "Übun" is 5
  })

  it('defines a layout once, and again only when its local slot was taken over', () => {
    const one = { global: MSG.event, fields: [[253, 'uint32', 1], [0, 'enum', 0], [1, 'enum', 0]] }
    const twice = decode(encodeFit([one, one, one]))
    expect(twice.definitions).toHaveLength(1)
    expect(twice.messages).toHaveLength(3)
    // Seventeen layouts and the first again: sixteen local types, so the first is redefined.
    const many = Array.from({ length: 17 }, (_, i) => ({ global: MSG.set, fields: [[10, 'uint16', i], ...Array.from({ length: i }, (_, k) => [20 + k, 'uint8', k])] }))
    const d2 = decode(encodeFit([...many, many[0], many[16]]))
    expect(d2.definitions).toHaveLength(18)
    expect(d2.messages.map(m => m.f[10])).toEqual([...Array.from({ length: 17 }, (_, i) => i), 0, 16])
    expect(d2.messages.at(-1).f[35]).toBe(15)
  })
})

/* ----------------------------------------------------------- the workout -- */

const BENCH = Object.values(EXIDX).find(e => e.n === 'barbell bench press').id
const CURL = Object.values(EXIDX).find(e => e.n === 'dumbbell curl' || /^dumbbell.*curl$/.test(e.n)).id
const PLANK = Object.values(EXIDX).find(e => e.n === 'front plank' || /plank$/.test(e.n)).id
const TREADMILL = '2259'   // walking on treadmill
const BIKE = '2138'        // stationary bike run v. 3
const T0 = Date.UTC(2026, 9, 9, 17)
const min = n => n * 60000

const strength = {
  id: 'w1', d: '2026-10-09', start: T0, end: T0 + min(50), name: 'Push', vol: 0,
  entries: [
    { id: BENCH, target: { mode: 'reps' }, sets: [
      { w: 40, r: 8, done: true, phase: 'warmup', at: T0 + min(2) },
      { w: 60, r: 8, done: true, at: T0 + min(5) },
      { w: 60, r: 6, done: true, type: 'dropset', drops: [{ w: 45, r: 6 }], at: T0 + min(8) },
      { w: 60, r: 8, done: false },
    ] },
    { id: CURL, target: { mode: 'reps' }, sets: [
      { w: 12, r: 10, done: true, sides: { L: { w: 12, r: 10, done: true, at: T0 + min(12) }, R: { w: 12, r: 9, done: true, at: T0 + min(13) } }, at: T0 + min(13) },
    ] },
    { id: PLANK, target: { mode: 'time' }, sets: [{ sec: 60, w: 0, done: true, at: T0 + min(16) }] },
    { id: TREADMILL, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 6, incline: 8, done: true, at: T0 + min(45) }] },
  ],
}

describe('a strength workout as FIT', () => {
  const d = decode(workoutFit(strength, { unit: 'kg', version: '1.4.0' }))
  const sets = of(d, MSG.set)
  const active = sets.filter(s => s[5] === 1)

  it('is a valid activity file from openGym', () => {
    expect(fitCrc(workoutFit(strength))).toBe(0)
    const [id] = of(d, MSG.fileId)
    expect(id[0]).toBe(4)                         // activity
    expect(id[1]).toBe(255)                       // development
    expect(id[3]).toBeGreaterThan(0)              // serial, stable per workout
    expect(id[4]).toBe(fitTime(T0))
    expect(of(d, MSG.fileCreator)[0][0]).toBe(104)
    expect(of(d, MSG.deviceInfo)[0][27]).toBe('openGym')
    expect(decode(workoutFit(strength)).messages.find(m => m.global === MSG.fileId).f[3]).toBe(id[3])
  })

  it('runs file_id, creator, timer start, device, sets, timer stop, lap, session, activity in that order', () => {
    const order = d.messages.map(m => m.global).filter((g, i, a) => g !== a[i - 1])
    expect(order).toEqual([MSG.fileId, MSG.fileCreator, MSG.event, MSG.deviceInfo, MSG.set, MSG.event, MSG.lap, MSG.session, MSG.activity])
    const [start, stop] = of(d, MSG.event)
    expect([start[0], start[1], start[253]]).toEqual([0, 0, fitTime(T0)])
    expect([stop[0], stop[1], stop[253]]).toEqual([0, 4, fitTime(T0 + min(50))])
  })

  it('has a strength-training session, lap and activity over the whole workout', () => {
    const [session] = of(d, MSG.session)
    expect([session[5], session[6]]).toEqual([SPORT.training, SUB_SPORT.strengthTraining])
    expect(session[2]).toBe(fitTime(T0))
    expect(session[253]).toBe(fitTime(T0 + min(50)))
    expect(session[7]).toBe(min(50))             // total_elapsed_time, ms
    expect(session[8]).toBe(min(50))
    expect([session[0], session[1], session[25], session[26]]).toEqual([8, 1, 0, 1])
    // The treadmill's 2 km ride along as the distance, in centimetres.
    expect(session[9]).toBe(200000)
    const [lap] = of(d, MSG.lap)
    expect([lap[0], lap[1], lap[2], lap[7], lap[25], lap[39]]).toEqual([9, 1, fitTime(T0), min(50), SPORT.training, SUB_SPORT.strengthTraining])
    const [activity] = of(d, MSG.activity)
    expect([activity[0], activity[1], activity[2], activity[3], activity[4]]).toEqual([min(50), 1, 0, 26, 1])
    // `|| 0`: in UTC the offset is -0, and the encoder writes a plain 0.
    expect(activity[5] - activity[253]).toBe((-new Date(T0 + min(50)).getTimezoneOffset() * 60) || 0)
  })

  it('writes every set that was done, with its reps, weight and category, and leaves the rest out', () => {
    // Warm-up, two work sets, the drop, left and right, the plank, the treadmill.
    expect(active.map(s => s[3])).toEqual([8, 8, 6, 6, 10, 9, 0xFFFF, 0xFFFF])
    expect(active.map(s => s[4] / 16)).toEqual([40, 60, 60, 45, 12, 12, 0, 0xFFFF / 16])
    expect(active.map(s => s[7])).toEqual([0, 0, 0, 0, 7, 7, CATEGORY.plank, CATEGORY.run])
    expect(active.slice(0, 7).every(s => s[9] === 1)).toBe(true)   // kilograms
    expect(sets.map(s => s[10])).toEqual(sets.map((_, i) => i))  // message_index
  })

  it('ends a set at its tick, starts it its length earlier, and fills the gaps with rests', () => {
    const [warm, rest1, work1] = sets
    expect(warm[254]).toBe(fitTime(T0 + min(2)))
    expect(warm[0]).toBe(24000)                   // 8 reps at 3 s
    expect(warm[6]).toBe(fitTime(T0 + min(2) - 24000))
    expect(rest1[5]).toBe(0)
    expect(rest1[6]).toBe(warm[254])
    expect(rest1[254]).toBe(work1[6])
    expect(rest1[0]).toBe((work1[6] - rest1[6]) * 1000)
    // The drop follows its set with no rest between them.
    const i = sets.findIndex(s => s[4] === 45 * 16)
    expect(sets[i - 1][5]).toBe(1)
    expect(sets[i][6]).toBe(sets[i - 1][254])
    // The plank lasts its minute, the treadmill its 20 minutes.
    expect(active[6][0]).toBe(60000)
    expect(active[7][0]).toBe(min(20))
    expect(active[7][254]).toBe(fitTime(T0 + min(45)))
    // Rest and active alternate, in time order, and never overlap.
    for (let k = 1; k < sets.length; k++) {
      expect(sets[k][6]).toBeGreaterThanOrEqual(sets[k - 1][254])
      if (sets[k][5] === 0) expect(sets[k - 1][5]).toBe(1)
    }
  })

  it('converts pounds to kilograms and says the display unit is pounds', () => {
    const lb = of(decode(workoutFit(strength, { unit: 'lb' })), MSG.set).filter(s => s[5] === 1)
    expect(lb[1][4]).toBe(Math.round(60 * 0.45359237 * 16))
    expect(lb[1][9]).toBe(2)
  })

  it('spreads the sets of a workout from before the tick over the session', () => {
    const old = { id: 'old', d: '2025-01-01', start: T0, end: T0 + min(30), entries: [
      { id: BENCH, target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] },
    ] }
    const s = of(decode(workoutFit(old)), MSG.set)
    expect(s.map(x => x[5])).toEqual([1, 0, 1, 0, 1])
    expect(s[0][6]).toBe(fitTime(T0))
    expect(s.at(-1)[254]).toBe(fitTime(T0 + min(30)))
    expect(s[1][0]).toBe(s[3][0])                 // the same rest after each set
    // A workout too short for its sets has them back to back, squeezed into it.
    const short = { ...old, end: T0 + 30000 }
    const s2 = of(decode(workoutFit(short)), MSG.set)
    expect(s2.map(x => x[5])).toEqual([1, 1, 1])
    expect(s2.at(-1)[254]).toBe(fitTime(T0 + 30000))
  })

  it('does not let ticks bunched after the end stretch the session', () => {
    const late = { id: 'late', d: '2026-10-09', start: T0, end: T0 + min(10), entries: [
      { id: BENCH, target: { mode: 'reps' }, sets: [5, 5, 5].map(r => ({ w: 60, r, done: true, at: T0 + min(60) })) },
    ] }
    const dd = decode(workoutFit(late))
    expect(of(dd, MSG.session)[0][7]).toBe(min(10))
    expect(of(dd, MSG.set).at(-1)[254]).toBe(fitTime(T0 + min(10)))
  })

  it('reads a workout with no end as long as its sets', () => {
    const open = { id: 'o', d: '2026-10-09', start: T0, entries: [{ id: PLANK, target: { mode: 'time' }, sets: [{ sec: 45, done: true }] }] }
    expect(of(decode(workoutFit(open)), MSG.session)[0][7]).toBe(45000)
  })

  it('refuses a workout without a date', () => {
    expect(() => workoutFitMessages({ entries: [] })).toThrow()
  })
})

describe('a cardio workout as FIT', () => {
  const walk = { id: 'w2', d: '2026-10-09', start: T0, end: T0 + min(31), entries: [
    { id: TREADMILL, target: { mode: 'cardio' }, sets: [{ min: 10, speed: 5, done: true }, { min: 20, speed: 6, done: true }, { min: 5, speed: 4, done: false }] },
  ] }
  const d = decode(workoutFit(walk))

  it('is a treadmill walk with a lap per set and no strength sets', () => {
    expect(of(d, MSG.set)).toEqual([])
    const [session] = of(d, MSG.session)
    expect([session[5], session[6]]).toEqual([SPORT.walking, SUB_SPORT.treadmill])
    expect(session[26]).toBe(2)
    const km = 5 * 10 / 60 + 6 * 20 / 60
    expect(session[9]).toBe(Math.round(km * 100000))
    expect(session[14]).toBe(Math.round(km * 1000 / (31 * 60) * 1000))
    const laps = of(d, MSG.lap)
    expect(laps.map(l => l[254])).toEqual([0, 1])
    expect(laps.map(l => l[7])).toEqual([min(10), min(20)])
    expect(laps.map(l => l[9])).toEqual([Math.round(5 / 6 * 100000), 200000])
    expect(laps.map(l => l[13])).toEqual([Math.round(5 / 3.6 * 1000), Math.round(6 / 3.6 * 1000)])
    expect(laps[1][253]).toBe(fitTime(T0 + min(31)))   // the last lap ends with the workout
  })

  it('is cardio training when the machines differ', () => {
    const mixed = { ...walk, entries: [...walk.entries, { id: BIKE, target: { mode: 'cardio' }, sets: [{ min: 10, speed: 25, done: true }] }] }
    const [session] = of(decode(workoutFit(mixed)), MSG.session)
    expect([session[5], session[6]]).toEqual([SPORT.training, SUB_SPORT.cardioTraining])
  })
})

describe('categories and sports', () => {
  const ex = n => ({ n })
  it('maps exercises to FIT categories by name, then by the muscle they train', () => {
    expect(fitCategory(ex('barbell bench press'))).toBe(CATEGORY.benchPress)
    expect(fitCategory(ex('lying leg curl'))).toBe(CATEGORY.legCurl)
    expect(fitCategory(ex('dumbbell hammer curl'))).toBe(CATEGORY.curl)
    expect(fitCategory(ex('barbell full squat'))).toBe(CATEGORY.squat)
    expect(fitCategory(ex('dumbbell bulgarian split squat'))).toBe(CATEGORY.lunge)
    expect(fitCategory(ex('barbell romanian deadlift'))).toBe(CATEGORY.deadlift)
    expect(fitCategory(ex('cable seated row'))).toBe(CATEGORY.row)
    expect(fitCategory(ex('cable pulldown'))).toBe(CATEGORY.pullUp)
    expect(fitCategory(ex('push up'))).toBe(CATEGORY.pushUp)
    expect(fitCategory(ex('cable pushdown'))).toBe(CATEGORY.tricepsExtension)
    expect(fitCategory(ex('dumbbell lateral raise'))).toBe(CATEGORY.lateralRaise)
    expect(fitCategory(ex('dumbbell fly'))).toBe(CATEGORY.flye)
    expect(fitCategory(ex('barbell hip thrust'))).toBe(CATEGORY.hipRaise)
    expect(fitCategory(ex('standing calf raise'))).toBe(CATEGORY.calfRaise)
    expect(fitCategory(ex('kettlebell swing'))).toBe(CATEGORY.hipSwing)
    expect(fitCategory({ n: 'Bankdrücken eng', tg: 'triceps' })).toBe(CATEGORY.tricepsExtension)
    expect(fitCategory({ n: 'Mystery move' })).toBe(65534)
    expect(fitCategory(EXIDX[TREADMILL], 'cardio')).toBe(CATEGORY.run)
    expect(fitCategory(EXIDX[BIKE], 'cardio')).toBe(CATEGORY.cardio)
  })
  it('reads the sport of a cardio exercise off its name and equipment', () => {
    expect(cardioSport(EXIDX[TREADMILL])).toEqual([SPORT.walking, SUB_SPORT.treadmill])
    expect(cardioSport(EXIDX[BIKE])).toEqual([SPORT.cycling, SUB_SPORT.indoorCycling])
    expect(cardioSport(EXIDX['1161'])).toEqual([SPORT.rowing, SUB_SPORT.indoorRowing])
    expect(cardioSport(EXIDX['2192'])).toEqual([SPORT.fitnessEquipment, SUB_SPORT.elliptical])
    expect(cardioSport(EXIDX['2311'])).toEqual([SPORT.fitnessEquipment, SUB_SPORT.stairClimbing])
    expect(cardioSport(EXIDX['0685'])).toEqual([SPORT.running, SUB_SPORT.generic])
    expect(cardioSport(EXIDX['3094'])).toEqual([SPORT.training, SUB_SPORT.cardioTraining])
  })
  it('names the file after the day and the start time', () => {
    const local = new Date(2026, 9, 9, 18, 5).getTime()
    expect(fitFileName({ start: local })).toBe('opengym-2026-10-09-1805.fit')
    expect(fitFileName({})).toBe('opengym-workout.fit')
  })
})
