import { describe, expect, it } from 'vitest'
import { cardioSetFromResult, findResult, normalizeResult, parseLfDate, resultKey, resultNote } from './result.js'
import { exerciseForKind, kindOfModel, modelFromDeviceName } from './devices.js'

const BIKE = { bs: 'BS123', id: 'guid-1', t: 42, et: 1800, c: 312, d: { v: 12.5, u: 1 }, as: { v: 25, u: 1 }, ahr: 142, aw: 180, ar: 85.4, al: 8, am: 65, dt: 'Fri Oct 17 18:05:12 CEST 2026' }

describe('normalizeResult', () => {
  it('a metric upright bike summary', () => {
    const r = normalizeResult(BIKE)
    expect(r).toMatchObject({ guid: 'guid-1', serial: 'BS123', model: 42, kind: 'upright', sec: 1800, km: 12.5, kcal: 312, speedKmh: 25, hr: 142, watts: 180, rpm: 85.4, level: 8, mets: 6.5 })
    expect(r.date).toEqual({ d: '2026-10-17', time: '18:05' })
  })

  it('imperial: miles and mph become km and km/h', () => {
    const r = normalizeResult({ ...BIKE, d: { v: 5, u: 0 }, as: { v: 10, u: 0 } })
    expect(r.km).toBeCloseTo(8.04672, 5)
    expect(r.speedKmh).toBeCloseTo(16.09344, 5)
  })

  it('a stair climber reports steps or floors, not metres', () => {
    expect(normalizeResult({ t: 44, et: 600, dc: { v: 340, u: 1 } })).toMatchObject({ steps: 340, floors: 20, climbM: null, kind: 'stairs' })
    expect(normalizeResult({ t: 44, et: 600, dc: { v: 12, u: 0 } })).toMatchObject({ floors: 12, steps: 204 })
  })

  it('a treadmill’s climb in feet becomes metres', () => {
    expect(normalizeResult({ t: 41, et: 600, d: { v: 1, u: 0 }, dc: { v: 100, u: 0 } }).climbM).toBeCloseTo(30.48, 2)
  })

  it('no time and no distance is no summary; zeros are "not sent"', () => {
    expect(normalizeResult({ id: 'x', c: 10 })).toBeNull()
    expect(normalizeResult(null)).toBeNull()
    expect(normalizeResult({ et: 60, c: 0, ahr: 0, d: { v: 0, u: 1 } })).toMatchObject({ kcal: null, hr: null, km: null })
  })

  it('an unknown model has no kind', () => {
    expect(normalizeResult({ t: 9999, et: 60 }).kind).toBeNull()
  })
})

describe('parseLfDate', () => {
  it('Java Date.toString, read off the console’s clock', () => {
    expect(parseLfDate('Mon Mar 02 07:04:00 GMT+01:00 2026')).toEqual({ d: '2026-03-02', time: '07:04' })
    expect(parseLfDate('Fri Oct 17 18:05:12 Central European Summer Time 2026')).toEqual({ d: '2026-10-17', time: '18:05' })
    expect(parseLfDate('Fri Oct 17 18:05:12 2026')).toEqual({ d: '2026-10-17', time: '18:05' })
  })
  it('ISO without an offset as written', () => {
    expect(parseLfDate('2026-10-17T18:05:12')).toEqual({ d: '2026-10-17', time: '18:05' })
  })
  it('nonsense is null', () => {
    expect(parseLfDate('yesterday')).toBeNull()
    expect(parseLfDate(undefined)).toBeNull()
  })
})

describe('cardioSetFromResult', () => {
  it('minutes, speed from distance and time, the GUID and a note', () => {
    const s = cardioSetFromResult(normalizeResult(BIKE))
    expect(s).toMatchObject({ min: 30, speed: 25, done: true, lf: 'guid-1' })
    expect(s.incline).toBeUndefined()
    expect(s.note).toBe('Life Fitness · 12.5 km · 312 kcal · Ø 142 bpm · Ø 180 W · Ø 85.4 rpm · Level 8 · 6.5 METs')
  })

  it('a treadmill keeps its average incline, on the half percent', () => {
    const s = cardioSetFromResult(normalizeResult({ id: 'g', t: 41, et: 1200, d: { v: 2, u: 1 }, ai: 3.2 }))
    expect(s).toMatchObject({ min: 20, speed: 6, incline: 3 })
  })

  it('no distance: the console’s average speed; neither: 0', () => {
    expect(cardioSetFromResult(normalizeResult({ id: 'g', t: 42, et: 600, as: { v: 20, u: 1 } })).speed).toBe(20)
    expect(cardioSetFromResult(normalizeResult({ id: 'g', t: 42, et: 600 })).speed).toBe(0)
  })

  it('the level label is the caller’s (translated)', () => {
    expect(resultNote(normalizeResult(BIKE), { level: n => 'Stufe ' + n })).toContain('Stufe 8')
  })
})

describe('resultKey / findResult', () => {
  it('the GUID, else serial, date and duration', () => {
    expect(resultKey(normalizeResult(BIKE))).toBe('guid-1')
    const k = resultKey(normalizeResult({ ...BIKE, id: '' }))
    expect(k).toBe('lf|BS123|2026-10-17|18:05|1800|12.5')
  })

  it('finds a summary in the running workout or the history', () => {
    const S = {
      active: { entries: [{ id: 'a', sets: [{ min: 1 }] }, { id: 'b', sets: [{ min: 30, lf: 'k1' }] }] },
      workouts: [{ d: '2026-10-01', entries: [{ id: 'c', sets: [{ lf: 'k2' }] }] }],
    }
    expect(findResult(S, 'k1')).toEqual({ where: 'active', idx: 1 })
    expect(findResult(S, 'k2')).toEqual({ where: 'history', d: '2026-10-01' })
    expect(findResult(S, 'k3')).toBeNull()
    expect(findResult(S, null)).toBeNull()
  })
})

describe('devices', () => {
  it('model ids to kinds of machine', () => {
    expect(kindOfModel(41)).toBe('treadmill')
    expect(kindOfModel(42)).toBe('upright')
    expect(kindOfModel(30)).toBe('recumbent')
    expect(kindOfModel(43)).toBe('crossTrainer')
    expect(kindOfModel(88)).toBe('crossTrainer') // Arc Trainer
    expect(kindOfModel(61)).toBe('stairs') // PowerMill
    expect(kindOfModel(160)).toBe('upright') // ICG
    expect(kindOfModel(1)).toBeNull()
  })

  it('the model in a Bluetooth name is its last three digits', () => {
    expect(modelFromDeviceName('LF Console 7F3A042')).toBe(42)
    expect(modelFromDeviceName('LF')).toBeNull()
  })

  it('your own exercise named for the machine wins over the catalogue', () => {
    expect(exerciseForKind('upright', [])).toBe('2138')
    expect(exerciseForKind('upright', [{ id: 'mine', n: 'Upright  bike' }])).toBe('mine')
    expect(exerciseForKind('treadmill', [{ id: 'x', n: 'Something else' }])).toBe('2259')
    expect(exerciseForKind(null)).toBeNull()
  })
})
