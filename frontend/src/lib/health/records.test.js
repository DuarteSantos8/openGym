import { describe, expect, it } from 'vitest'
import { isoOf } from '../format.js'
import {
  makeRecord, normalizeHealthState, importRecords, withoutSource, compositionMeasurements, saveComposition,
  deleteComposition, bridgeWeights, weighInsWithoutSource, dailyValues, derivedBmi, latestOf, seriesOf, historyOf, importId,
} from './records.js'
import { readingsFromSamples, readingsFromDays, readingsFromSleep, APPLE_HEALTH } from './apple-health.js'
import { applyReadings, readSince, FIRST_DAYS, OVERLAP_DAYS } from './sync.js'
import { toDisplay, fromDisplay, displayUnit, fmtHealth, fmtHealthDelta, fmtMinutes, fmtFeetInches } from './units.js'
import { mergeHealth, mergeStates, stampChange, stampHealth } from '../sync-merge.js'

const T = new Date('2026-10-10T07:30:00').getTime()
const AH = APPLE_HEALTH

describe('makeRecord', () => {
  it('keeps the canonical unit, the local day and the source', () => {
    const r = makeRecord({ type: 'bodyFat', v: 18.4, t: T }, 5)
    expect(r).toMatchObject({ type: 'bodyFat', v: 18.4, u: '%', t: T, d: '2026-10-10', src: 'manual', c: 5, _ts: 5 })
    expect(r.id).toBeTruthy()
  })
  it('derives the id of an imported reading from its source id, so two devices make the same one', () => {
    expect(makeRecord({ type: 'weight', v: 80, t: T, src: AH, sid: 'U1' }).id).toBe(importId(AH, 'U1'))
  })
  it('refuses unknown metrics and out-of-range values instead of clamping them', () => {
    expect(makeRecord({ type: 'nope', v: 1, t: T })).toBeNull()
    expect(makeRecord({ type: 'bodyFat', v: 0, t: T })).toBeNull()
    expect(makeRecord({ type: 'bodyFat', v: 120, t: T })).toBeNull()
    expect(makeRecord({ type: 'weight', v: 'x', t: T })).toBeNull()
  })
})

describe('normalizeHealthState', () => {
  it('gives an older profile an empty list', () => {
    expect(normalizeHealthState({}).health).toEqual([])
  })
  it('drops malformed records, keeps unknown types, one record per id and per source reading', () => {
    const S = { health: [
      null, { id: 'x' },
      { id: 'a', type: 'futureMetric', v: 1, t: T, d: '2026-10-10', src: 'manual', _ts: 1 },
      { id: 'b', type: 'steps', v: 10, t: T, d: '2026-10-10', src: AH, sid: 'steps:2026-10-10', _ts: 1 },
      { id: 'b', type: 'steps', v: 20, t: T, d: '2026-10-10', src: AH, sid: 'steps:2026-10-10', _ts: 2 },
      { id: 'c', type: 'steps', v: 30, t: T, d: '2026-10-10', src: AH, sid: 'steps:2026-10-10', _ts: 3 },
    ] }
    normalizeHealthState(S)
    expect(S.health.map(r => [r.id, r.v])).toEqual([['a', 1], ['c', 30]])
  })
})

describe('importRecords', () => {
  const steps = (v, d = '2026-10-10') => ({ type: 'steps', v, t: new Date(d + 'T12:00:00').getTime(), d, sid: `steps:${d}`, src: AH })
  it('adds new readings and ignores the same reading twice', () => {
    const a = importRecords([], [steps(1000)], { now: 1 })
    expect(a).toMatchObject({ added: 1, updated: 0 })
    const b = importRecords(a.health, [steps(1000)], { now: 2 })
    expect(b).toMatchObject({ added: 0, updated: 0 })
    expect(b.health).toHaveLength(1)
    expect(b.health[0]._ts).toBe(1)
  })
  it('updates a day total that grew, keeping its id and creation time', () => {
    const a = importRecords([], [steps(1000)], { now: 1 })
    const b = importRecords(a.health, [steps(5400)], { now: 9 })
    expect(b).toMatchObject({ added: 0, updated: 1 })
    expect(b.health[0]).toMatchObject({ id: a.health[0].id, v: 5400, c: 1, _ts: 9 })
  })
  it('keeps several readings of one day apart, each with its own time', () => {
    const w = (sid, h, v) => ({ type: 'weight', v, t: new Date(`2026-10-10T${h}:00:00`).getTime(), sid, src: AH })
    const r = importRecords([], [w('A', '07', 80.1), w('B', '21', 81.0)], { now: 1 })
    expect(r.health.map(x => [x.sid, x.v, x.d])).toEqual([['A', 80.1, '2026-10-10'], ['B', 81, '2026-10-10']])
  })
  it('never brings back a record the user deleted, unless reconnecting', () => {
    const deleted = { [importId(AH, 'steps:2026-10-10')]: 50 }
    expect(importRecords([], [steps(1000)], { deleted }).added).toBe(0)
    expect(importRecords([], [steps(1000)], { deleted, ignoreDeleted: true }).added).toBe(1)
  })
  it('never touches manual records', () => {
    const manual = makeRecord({ type: 'steps', v: 5, t: T }, 1)
    const r = importRecords([manual], [{ ...steps(9), src: 'manual' }], { now: 2 })
    expect(r.health).toEqual([manual])
  })
})

describe('body composition measurements', () => {
  it('saves one record per filled field, grouped, and reads them back together', () => {
    const h = saveComposition([], { t: T, values: { weight: 80.2, bodyFat: 18, muscleMass: '', bodyWater: null } }, 7)
    expect(h).toHaveLength(2)
    const [m] = compositionMeasurements(h)
    expect(m.values).toEqual({ weight: 80.2, bodyFat: 18 })
    expect(m.t).toBe(T)
  })
  it('edits in place: kept fields keep their id, removed ones go, unchanged ones keep their stamp', () => {
    const h1 = saveComposition([], { t: T, values: { weight: 80, bodyFat: 18, bodyWater: 55 } }, 1)
    const g = h1[0].g
    const ids = Object.fromEntries(h1.map(r => [r.type, r.id]))
    const h2 = saveComposition(h1, { g, t: T, values: { weight: 80, bodyFat: 17.5 } }, 2)
    const by = Object.fromEntries(h2.map(r => [r.type, r]))
    expect(Object.keys(by).sort()).toEqual(['bodyFat', 'weight'])
    expect(by.weight).toMatchObject({ id: ids.weight, _ts: 1, c: 1 })
    expect(by.bodyFat).toMatchObject({ id: ids.bodyFat, v: 17.5, _ts: 2, c: 1 })
    expect(deleteComposition(h2, g)).toEqual([])
  })
  it('refuses an empty measurement and names the field out of range', () => {
    expect(() => saveComposition([], { t: T, values: {} })).toThrow('empty')
    try { saveComposition([], { t: T, values: { bodyFat: 400 } }); throw new Error('no') } catch (e) { expect(e.type).toBe('bodyFat') }
  })
})

describe('weight and the weigh-in log', () => {
  const r = (src, v, h = '07', d = '2026-10-10') => ({ type: 'weight', v, t: new Date(`${d}T${h}:00:00`).getTime(), d, src })
  it('a form reading is the day\'s weigh-in, in the profile unit', () => {
    const out = bridgeWeights([{ d: '2026-10-10', w: 170, t: 1, src: AH }], [r('manual', 80)], 'lb', 9)
    expect(out.bodyweight).toEqual([{ d: '2026-10-10', w: 176.4, t: 9 }])
  })
  it('an import fills empty days with the latest reading and never overwrites a typed weigh-in', () => {
    const log = [{ d: '2026-10-09', w: 81, t: 1 }]
    const out = bridgeWeights(log, [r(AH, 80, '07', '2026-10-09'), r(AH, 79.5, '07'), r(AH, 79.9, '20')], 'kg', 9)
    expect(out.bodyweight).toEqual([{ d: '2026-10-09', w: 81, t: 1 }, { d: '2026-10-10', w: 79.9, t: 9, src: AH }])
    expect(weighInsWithoutSource(out.bodyweight, AH)).toEqual(log)
  })
  it('reports no change when nothing changed', () => {
    expect(bridgeWeights([{ d: '2026-10-10', w: 80, t: 1, src: AH }], [r(AH, 80)], 'kg').changed).toBe(false)
  })
})

describe('reading the records back', () => {
  const S = {
    unit: 'kg',
    bodyweight: [{ d: '2026-10-01', w: 82, t: 1 }, { d: '2026-10-08', w: 81, t: 1 }],
    health: [
      makeRecord({ type: 'heartRate', v: 60, lo: 50, hi: 120, t: T, d: '2026-10-10', src: AH, sid: 'h1' }),
      makeRecord({ type: 'heartRate', v: 70, t: T + 1000, d: '2026-10-10', src: AH, sid: 'h2' }),
      makeRecord({ type: 'steps', v: 4000, t: T, d: '2026-10-09', src: AH, sid: 'steps:2026-10-09' }),
      makeRecord({ type: 'steps', v: 6000, t: T, d: '2026-10-10', src: AH, sid: 'steps:2026-10-10' }),
      makeRecord({ type: 'steps', v: 5000, t: T, d: '2026-10-10' }),
      makeRecord({ type: 'height', v: 180, t: T, src: AH, sid: 'hh' }),
    ],
  }
  it('folds a day by the metric\'s rule: mean with range, larger total of two sources', () => {
    expect(dailyValues(S, 'heartRate')).toMatchObject([{ d: '2026-10-10', v: 65, lo: 50, hi: 120 }])
    expect(dailyValues(S, 'steps').map(x => x.v)).toEqual([4000, 6000])
  })
  it('weight comes from the weigh-in log, in kg whatever the profile shows', () => {
    expect(dailyValues({ ...S, unit: 'lb', bodyweight: [{ d: '2026-10-01', w: 176.4 }] }, 'weight')[0].v).toBeCloseTo(80.01, 1)
  })
  it('works BMI out from weight and height when there is no reading', () => {
    expect(derivedBmi(S).map(x => x.v)).toEqual([25.3, 25])
    expect(latestOf(S, 'bmi')).toMatchObject({ v: 25, derived: true })
  })
  it('latest value and the change since the previous one', () => {
    expect(latestOf(S, 'weight')).toMatchObject({ v: 81, prev: 82, delta: -1, d: '2026-10-08' })
    expect(latestOf(S, 'sleep')).toBeNull()
  })
  it('buckets a long range into weekly and monthly means', () => {
    const now = new Date('2026-10-11T12:00:00').getTime()
    expect(seriesOf(S, 'steps', 'week', { now }).map(p => p.v)).toEqual([4000, 6000])
    expect(seriesOf(S, 'steps', 'all', { now })).toMatchObject([{ d: '2026-10-01', v: 5000, n: 2 }])
    expect(seriesOf(S, 'weight', 'year', { now, ws: 1 }).map(p => p.d)).toEqual(['2026-09-28', '2026-10-05'])
  })
  it('lists a metric\'s history newest first', () => {
    expect(historyOf(S, 'steps').map(r => r.v)).toEqual([6000, 5000, 4000])
    expect(historyOf(S, 'weight')[0]).toMatchObject({ d: '2026-10-08', weighIn: true })
  })
  it('removes a source\'s records', () => {
    expect(withoutSource(S.health, AH).map(r => r.v)).toEqual([5000])
  })
})

describe('Apple Health readings', () => {
  it('samples: one reading per time, the same id an export gives it, percent scaled to 0–100', () => {
    expect(readingsFromSamples('bodyFat', [{ id: 'U', value: 0.184, start: T }, { value: 0.184, start: T }, { value: 'x', start: T }]))
      .toEqual([{ type: 'bodyFat', v: 18.4, t: T, d: isoOf(new Date(T)), sid: `bodyFat:${T}`, src: AH }])
  })
  it('daily statistics: one per day, keyed by day, zero totals skipped, heart rate range kept', () => {
    expect(readingsFromDays('steps', [{ date: '2026-10-10', value: 8123.6 }, { date: '2026-10-11', value: 0 }]))
      .toMatchObject([{ type: 'steps', v: 8124, d: '2026-10-10', sid: 'steps:2026-10-10' }])
    expect(readingsFromDays('heartRate', [{ date: '2026-10-10', value: 64.4, min: 48.2, max: 151.7 }])[0])
      .toMatchObject({ v: 64.4, lo: 48, hi: 152 })
  })
  it('sleep: minutes per night, on the day it ended', () => {
    const end = new Date('2026-10-10T06:40:00').getTime()
    expect(readingsFromSleep([{ date: '2026-10-10', minutes: 431.6, end }, { minutes: 0, end }]))
      .toEqual([{ type: 'sleep', v: 432, t: end, d: '2026-10-10', sid: 'sleep:2026-10-10', src: AH }])
  })
})

describe('sync', () => {
  it('reads two years the first time, then from the last read less an overlap', () => {
    expect(readSince(0, 1e12)).toBe(1e12 - FIRST_DAYS * 86400000)
    expect(readSince(5e11, 1e12)).toBe(5e11 - OVERLAP_DAYS * 86400000)
  })
  it('folds readings in and the weights into the weigh-in log, twice without duplicates', () => {
    const s = { unit: 'kg', health: [], bodyweight: [], deleted: {} }
    const readings = [
      ...readingsFromSamples('weight', [{ id: 'W', value: 79.8, start: T }]),
      ...readingsFromDays('steps', [{ date: '2026-10-10', value: 900 }]),
    ]
    expect(applyReadings(s, readings, { now: 3 })).toEqual({ added: 2, updated: 0 })
    expect(applyReadings(s, readings, { now: 4 })).toEqual({ added: 0, updated: 0 })
    expect(s.health).toHaveLength(2)
    expect(s.bodyweight).toEqual([{ d: '2026-10-10', w: 79.8, t: 3, src: AH }])
  })
})

describe('units', () => {
  const kg = { unit: 'kg' }, lb = { unit: 'lb' }
  it('converts at the edge and back', () => {
    expect(displayUnit('muscleMass', lb)).toBe('lb')
    expect(toDisplay('muscleMass', 40, lb)).toBe(88.2)
    expect(fromDisplay('muscleMass', 88.2, lb)).toBeCloseTo(40.007, 2)
    expect(displayUnit('distance', kg)).toBe('km')
    expect(displayUnit('distance', lb)).toBe('mi')
    expect(toDisplay('distance', 1.609344, lb)).toBe(1)
    expect(displayUnit('activeEnergy', lb)).toBe('kcal')
  })
  it('formats sleep and height', () => {
    expect(fmtMinutes(452)).toBe('7 h 32 min')
    expect(fmtMinutes(45)).toBe('45 min')
    expect(fmtFeetInches(180)).toBe('5′ 11″')
    expect(fmtHealth('height', 180, lb)).toBe('5′ 11″')
    expect(fmtHealth('bodyFat', 18.44, kg)).toBe('18.4 %')
    expect(fmtHealth('sleep', null, kg)).toBe('–')
  })
})

describe('sync merge of health records', () => {
  const rec = (id, v, ts) => ({ id, type: 'steps', v, u: 'count', t: T, d: '2026-10-10', src: 'manual', c: 1, _ts: ts })
  it('unites both copies by id, the record edited last winning', () => {
    expect(mergeHealth([rec('a', 1, 5), rec('b', 2, 5)], [rec('a', 9, 6), rec('c', 3, 1)]).map(r => [r.id, r.v]).sort())
      .toEqual([['a', 9], ['b', 2], ['c', 3]])
  })
  it('stamps only records that changed', () => {
    const prev = [rec('a', 1, 5), rec('b', 2, 5)]
    const next = [rec('a', 1, 5), rec('b', 3, 5), rec('c', 4, 0)]
    stampHealth(prev, next, 99)
    expect(next.map(r => r._ts)).toEqual([5, 99, 99])
  })
  it('a record logged on each device survives the merge, and a deletion on one wins over an older copy', () => {
    const base = { _ts: 10, unit: 'kg', health: [rec('a', 1, 5)] }
    const phone = JSON.parse(JSON.stringify(base)); phone.health.push(rec('p', 2, 0))
    phone._ts = stampChange(base, phone, 20)
    const desk = JSON.parse(JSON.stringify(base)); desk.health = []
    desk._ts = stampChange(base, desk, 30)
    const merged = mergeStates(phone, desk)
    expect(merged.health.map(r => r.id)).toEqual(['p'])
  })
})

describe('a change too small to show', () => {
  it('reads as no change rather than a signed zero', () => {
    expect(fmtHealthDelta('spo2', -0.4, { unit: 'kg' })).toBe('')
    expect(fmtHealthDelta('spo2', 2, { unit: 'kg' })).toBe('+2 %')
    expect(fmtHealthDelta('sleep', 0.2, { unit: 'kg' })).toBe('')
  })
})
