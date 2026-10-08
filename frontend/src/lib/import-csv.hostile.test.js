// What a file from someone else's app can do to the CSV / Apple Health importer. An export is the
// one input the person did not write and cannot read before handing it over, so every cell is
// treated as hostile here: wrong types, impossible dates, prototype names in the lookup columns,
// absurd sizes, files that are not exports at all. Two rules are under test — the parser's own,
// that a bad row is skipped and counted rather than thrown on, and that nothing leaves parseImport
// the rest of the app cannot render — plus the merge rule that an import adds and never overwrites.
import { describe, expect, it } from 'vitest'
import { parseImport, parseWhen, mergeImport } from './import-csv.js'
import { EXIDX } from './exercises.js'

const BODY_PARTS = new Set(['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'cardio', 'neck'])
const kg = { unit: 'kg' }
const FITNOTES = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment'
// One FitNotes row; "Zorb Twirl" matches nothing in the catalogue, so it always becomes a custom.
const row = (o = {}) => [o.date ?? '2024-03-07', o.ex ?? 'Zorb Twirl', o.cat ?? '', o.w ?? '', o.u ?? '', o.r ?? '', o.dist ?? '', o.du ?? '', o.time ?? '', o.note ?? ''].join(',')
const csv = (...rows) => [FITNOTES, ...rows].join('\n')
const health = (...recs) => '<?xml version="1.0"?><HealthData>' + recs.map(r =>
  `<Record type="HKQuantityTypeIdentifierBodyMass" unit="${r.unit ?? 'kg'}" value="${r.value}" startDate="${r.date} 08:00:00 +0000"/>`).join('') + '</HealthData>'

describe('lookup columns that spell a prototype property', () => {
  it('a category of __proto__ or constructor still yields a real body part', () => {
    for (const cat of ['__proto__', 'constructor']) {
      const p = parseImport(csv(row({ cat, w: 50, u: 'kg', r: 5 })), kg)
      expect(p.error).toBeUndefined()
      expect(p.customEx).toHaveLength(1)
      const bp = p.customEx[0].bp
      expect(typeof bp, `category "${cat}" gave bp ${String(bp)}`).toBe('string')
      expect(BODY_PARTS.has(bp)).toBe(true)
    }
  })

  it('a distance unit of __proto__ does not turn the speed into NaN', () => {
    const p = parseImport(csv(row({ ex: 'Zorb Jog', dist: 5, du: '__proto__', time: '30:00' })), kg)
    const set = p.workouts[0].entries[0].sets[0]
    expect(set.min).toBe(30)
    expect(Number.isFinite(set.speed), `speed ${set.speed}`).toBe(true)
  })
})

describe('Apple Health records that are not a weight', () => {
  it('drops a record whose value is not a positive number instead of storing NaN or 0', () => {
    const p = parseImport(health({ value: '.', date: '2024-03-07' }, { value: '0', date: '2024-03-08' }, { value: '80.5', date: '2024-03-09' }), kg)
    expect(p.kind).toBe('bodyweight')
    expect(p.bodyweight.map(b => b.w)).toEqual([80.5])
  })

  it('a file of nothing but junk values is refused rather than imported empty', () => {
    expect(parseImport(health({ value: '.', date: '2024-03-07' }), kg).error).toBe('unrecognised')
  })

  it('a record without a unit follows the profile; lb is converted', () => {
    const p = parseImport(health({ value: '176.4', unit: 'lb', date: '2024-03-07' }), kg)
    expect(p.converted).toBe(true)
    expect(p.bodyweight[0].w).toBe(80)
  })
})

describe('dates the calendar does not have', () => {
  it('garbage in the date column skips the row', () => {
    const p = parseImport(csv(
      row({ date: 'yesterday', w: 50, u: 'kg', r: 5 }),
      row({ date: '', w: 50, u: 'kg', r: 5 }),
      row({ date: '2024-03-07', w: 50, u: 'kg', r: 5 }),
    ), kg)
    expect(p.workouts).toHaveLength(1)
    expect(p.skipped).toBe(2)
  })
})

describe('numbers that are not numbers', () => {
  const one = o => parseImport(csv(row(o)), kg)

  it('text, NaN and Infinity read as 0, and a row with nothing measured is skipped', () => {
    for (const w of ['abc', 'NaN', 'Infinity', '-Infinity', '', '   ', '0x10']) {
      const p = one({ w, u: 'kg' })
      expect(p.workouts, `weight "${w}"`).toHaveLength(0)
      expect(p.skipped).toBe(1)
    }
  })

  it('a decimal comma is read as a decimal point', () => {
    expect(one({ w: '"52,5"', u: 'kg', r: 5 }).workouts[0].entries[0].sets[0].w).toBe(52.5)
  })

  it('reps: a billion is a broken cell and skipped, text is 0', () => {
    expect(one({ w: 50, u: 'kg', r: '1e9' })).toMatchObject({ workouts: [], skipped: 1 })
    expect(one({ w: 50, u: 'kg', r: 'ten' }).workouts[0].entries[0].sets[0].r).toBe(0)
  })

  it('an unknown weight unit is read as the profile unit; a mixed file converts per row', () => {
    const p = one({ w: 50, u: 'stones', r: 5 })
    expect(p.fileUnit).toBe('')
    expect(p.converted).toBe(false)
    const mixed = parseImport(csv(row({ w: 50, u: 'kg', r: 5 }), row({ date: '2024-03-08', w: 100, u: 'lbs', r: 5 })), kg)
    expect(mixed.mixedUnits).toBe(true)
    expect(mixed.workouts[1].entries[0].sets[0].w).toBe(45.4)
  })
})

describe('sizes nobody exports', () => {
  it('a thousand rows, each a different unknown exercise, is one workout with a thousand entries', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({ ex: `Zorb Move ${i}`, w: 50, u: 'kg', r: 5 }))
    const t0 = performance.now()
    const p = parseImport(csv(...rows), kg)
    expect(performance.now() - t0).toBeLessThan(5000)
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries).toHaveLength(1000)
    expect(p.customEx).toHaveLength(1000)
    expect(p.created).toBe(1000)
  })

  it('a thousand sets of one exercise on one day stay one entry', () => {
    const p = parseImport(csv(...Array.from({ length: 1000 }, () => row({ w: 50, u: 'kg', r: 5 }))), kg)
    expect(p.workouts[0].entries).toHaveLength(1)
    expect(p.workouts[0].entries[0].sets).toHaveLength(1000)
    expect(p.sets).toBe(1000)
  })

  it('a thousand days become a thousand workouts, oldest first', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), w: 50, u: 'kg', r: 5 }))
    const p = parseImport(csv(...rows), kg)
    expect(p.workouts).toHaveLength(1000)
    expect(p.from).toBe('2020-01-01')
    expect(p.workouts.map(w => w.d)).toEqual([...p.workouts.map(w => w.d)].sort())
  })
})

describe('files that are not an export at all', () => {
  it('an openGym backup dropped on the wrong button is refused', () => {
    expect(parseImport('{"workouts":"hello","routines":"world"}', kg).error).toBe('empty')
    expect(parseImport(JSON.stringify({ workouts: 'hello', routines: [] }, null, 2), kg).error).toBe('unrecognised')
  })

  it('a header with no rows, or nothing at all, is empty; whitespace lines are refused', () => {
    expect(parseImport(FITNOTES, kg).error).toBe('empty')
    expect(parseImport(FITNOTES + '\n\n\n', kg).error).toBe('empty')
    expect(parseImport('', kg).error).toBe('empty')
    expect(parseImport('   \n  \n', kg).error).toBeTruthy()
  })

  it('a recognised header whose rows are all junk parses to nothing, without an error', () => {
    const p = parseImport(csv(row({ date: 'x' }), ',,,,,,,,,', 'a,b,c'), kg)
    expect(p.error).toBeUndefined()
    expect(p.workouts).toEqual([])
    expect(p.from).toBeNull()
  })

  it('rows shorter or longer than the header do not throw', () => {
    const p = parseImport(csv('2024-03-07,Zorb Twirl', '2024-03-08,Zorb Twirl,,50,kg,5,,,,,extra,cells,here'), kg)
    expect(p.workouts).toHaveLength(1)     // the short row has nothing measured; the long one is fine
  })

  it('an HTML page or an XML that is not Apple Health is refused', () => {
    expect(parseImport('<!doctype html>\n<html>\n<body>Sign in</body>\n</html>', kg).error).toBeTruthy()
    expect(parseImport('<?xml version="1.0"?>\n<root>\n<item/>\n</root>', kg).error).toBeTruthy()
  })

  it('never throws, whatever the bytes', () => {
    const nasty = [
      '"', '"""', '"unterminated', ',,,\n,,,', '\u0000\u0001\u0002', '﻿', '﻿Date,Exercise\n', '‮abc',
      '🏋️‍♂️,💪\n🤸,🧘', 'Date,Exercise\n' + '\r'.repeat(1000), 'a'.repeat(200_000), ','.repeat(10_000), '\n'.repeat(10_000),
      'Date,Exercise,Weight\n' + '2024-03-07,"a,b",c\n'.repeat(500), 'Exercise,Date\n"' + 'x'.repeat(100_000) + ',2024-03-07',
      'Date,Exercise,Weight\n2024-03-07,__proto__,5\n2024-03-07,constructor,5\n2024-03-07,toString,5',
    ]
    for (const text of nasty) {
      let out
      expect(() => { out = parseImport(text, kg) }, JSON.stringify(text.slice(0, 20))).not.toThrow()
      expect(out && typeof out === 'object').toBe(true)
      if (!out.error) expect(Array.isArray(out.workouts) || Array.isArray(out.bodyweight)).toBe(true)
    }
  })
})

describe('mergeImport adds and never overwrites', () => {
  const state = () => ({
    unit: 'kg',
    workouts: [{ id: 'mine', d: '2024-03-07', name: 'Mine', exposures: [{ exposureId: 'x1', exerciseId: '0025', mode: 'reps', performance: { sets: [{ role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 100, unit: 'kg' } }] } }] }],
    bodyweight: [{ d: '2024-03-07', w: 80, t: 1 }],
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100 }] }],
    customEx: [{ id: 'cu1', n: 'grip trainer', bp: 'lower arms', custom: true, eq: 'custom', tg: '', desc: '' }],
    exWeights: { '0025': { w: 100, d: '2024-03-07', t: 1 } },
  })

  it('a day that is already here is left alone; routines and existing customs are untouched', () => {
    const S = state()
    const p = parseImport(csv(
      row({ date: '2024-03-07', ex: 'Bench Press', w: 1, u: 'kg', r: 1 }),
      row({ date: '2024-03-08', ex: 'Grip Trainer', w: 20, u: 'kg', r: 12 }),
    ), kg)
    expect(mergeImport(S, p)).toEqual({ added: 1, skipped: 1 })
    expect(S.workouts.map(w => w.d)).toEqual(['2024-03-07', '2024-03-08'])
    expect(S.workouts[0].name).toBe('Mine')
    expect(S.routines).toEqual(state().routines)
    expect(S.customEx).toEqual(state().customEx)             // "Grip Trainer" reused cu1, nothing appended
    expect(S.workouts[1].exposures[0].exerciseId).toBe('cu1')
    expect(S.exWeights['0025']).toEqual(state().exWeights['0025'])   // the skipped day seeds nothing
    expect(S.exWeights.cu1).toMatchObject({ w: 20, d: '2024-03-08' })
  })

  it('a custom exercise from a file can never shadow a built-in', () => {
    const p = parseImport(csv(row({ date: '2024-03-08', ex: 'Zorb Twirl', w: 50, u: 'kg', r: 5 }), row({ date: '2024-03-08', ex: 'Barbell Bench Press', w: 50, u: 'kg', r: 5 })), kg)
    expect(p.matched).toBe(1)
    expect(p.customEx).toHaveLength(1)
    expect(p.customEx.every(c => c.id.startsWith('im') && !EXIDX[c.id])).toBe(true)
    const S = state()
    mergeImport(S, p)
    expect(S.customEx.map(c => c.n)).toEqual(['grip trainer', 'zorb twirl'])
    expect(EXIDX['0025'].custom).toBeFalsy()
  })

  it('the merged shape is what the rest of the app reads', () => {
    const S = state()
    const p = parseImport(csv(
      row({ date: '2024-03-08', ex: 'Zorb Twirl', w: 50, u: 'kg', r: 5 }),
      row({ date: '2024-03-09', ex: 'Zorb Jog', dist: 5, du: 'km', time: '30:00' }),
    ), kg)
    mergeImport(S, p)
    expect(S.workouts).toHaveLength(3)
    for (const w of S.workouts) {
      expect(typeof w.id).toBe('string')
      expect(typeof w.d).toBe('string')
      expect(typeof w.name).toBe('string')
      expect(Array.isArray(w.exposures)).toBe(true)
      for (const x of w.exposures) {
        expect(typeof x.exerciseId).toBe('string')
        expect(Array.isArray(x.performance.sets)).toBe(true)
        expect(x.performance.sets.length).toBeGreaterThan(0)
      }
    }
    expect(S.workouts[2].exposures[0].performance.sets[0].observations).toEqual([{ metric: 'duration', unit: 'min', value: 30 }, { metric: 'speed', unit: 'kmh', value: 10 }])
  })

  it('weigh-ins: existing days win and the list stays sorted', () => {
    const S = state()
    const p = parseImport('Date,Weight (kg)\n2024-03-07,99\n2024-03-05,79\n2024-03-09,81', kg)
    expect(p.kind).toBe('bodyweight')
    expect(mergeImport(S, p)).toEqual({ added: 2, skipped: 1 })
    expect(S.bodyweight.map(b => [b.d, b.w])).toEqual([['2024-03-05', 79], ['2024-03-07', 80], ['2024-03-09', 81]])
  })

})
