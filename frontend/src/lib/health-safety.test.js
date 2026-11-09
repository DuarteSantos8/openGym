import { describe, expect, it } from 'vitest'
import { DAY_MS, ENERGY_SPAN_MS, EPOCH_MS, MAX_KG, MAX_SESSION_MS, TEXT_MAX, healthRecords, healthTime, sessionRecord, weightRecord } from './health-connect.js'
import { activeKcal, bodyKgFor, FALLBACK_KG } from './active-energy.js'
import { MAX_REPS, workoutSegments } from './health-segments.js'
import { isoOf } from './format.js'

// v1.4.5, after TestFlight 59 died at every launch on a workout left open for more than a day:
// nothing goes to Apple Health or Health Connect that either would refuse. The native side checks
// the same rules again (HealthWriteCoreTests.swift, HealthWriteTest.java).
const NOW = 1_793_000_000_000
const H = 3600e3
const nameOf = e => e.id
const bench = (extra = {}) => ({ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true, at: NOW - 1.5 * H, ...extra }] })
const w = over => ({ id: 'w1', name: 'Push', start: NOW - 2 * H, end: NOW - H, entries: [bench()], ...over })
const D = isoOf(new Date(NOW - H))
const rec = (over, opts = {}) => sessionRecord(w(over), { unit: 'kg', nameOf, kg: 80, segments: true, now: NOW, ...opts })

describe('healthTime', () => {
  it('takes finite times from 2001 on, up to a day ahead', () => {
    expect(healthTime(NOW, NOW)).toBe(true)
    expect(healthTime(EPOCH_MS, NOW)).toBe(true)
    expect(healthTime(NOW + DAY_MS, NOW)).toBe(true)
    for (const t of [NaN, Infinity, -Infinity, 0, -1, EPOCH_MS - 1, NOW + DAY_MS + 1, 1e300, undefined, null, '1793000000000'])
      expect(healthTime(t, NOW)).toBe(false)
  })
})

describe('a workout for the stores', () => {
  it('an ordinary one has its calories and its sets', () => {
    const r = rec({})
    expect(r.kcal).toBeGreaterThan(0)
    expect(r.segments).toHaveLength(1)
  })
  it('one left open for more than a day keeps its real times, without calories or segments', () => {
    const r = rec({ start: NOW - 30 * H, end: NOW })
    expect([r.start, r.end]).toEqual([NOW - 30 * H, NOW])
    expect(r).not.toHaveProperty('kcal')
    expect(r).not.toHaveProperty('segments')
  })
  it('exactly a day still has them, a millisecond more does not', () => {
    expect(rec({ start: NOW - ENERGY_SPAN_MS, end: NOW }).kcal).toBeGreaterThan(0)
    expect(rec({ start: NOW - ENERGY_SPAN_MS - 1, end: NOW })).not.toHaveProperty('kcal')
  })
  it('one longer than a week is not written at all', () => {
    expect(rec({ start: NOW - MAX_SESSION_MS, end: NOW })).not.toBe(null)
    expect(rec({ start: NOW - MAX_SESSION_MS - 1, end: NOW })).toBe(null)
  })
  it.each([
    ['NaN start', { start: NaN }], ['NaN end', { end: NaN }],
    ['infinite end', { end: Infinity }], ['infinite start', { start: -Infinity }],
    ['no start', { start: undefined }], ['no end', { end: null }], ['text', { start: 'yesterday' }],
    ['zero', { start: 0 }], ['negative', { start: -5 * H, end: -H }],
    ['before 2001', { start: EPOCH_MS - 2 * H, end: EPOCH_MS - H }],
    ['ahead of the clock', { start: NOW + 2 * DAY_MS, end: NOW + 2 * DAY_MS + H }],
    ['huge', { end: 1e300 }],
    ['zero length', { end: NOW - 2 * H }], ['end before start', { end: NOW - 3 * H }],
    ['no id', { id: '' }], ['null id', { id: null }],
  ])('%s is left out', (_, over) => {
    expect(rec(over)).toBe(null)
  })
  it('another phone a few minutes ahead is fine', () => {
    expect(rec({ start: NOW - H, end: NOW + 10 * 60e3 })).not.toBe(null)
  })
  it('a body weight typed wrong never makes absurd calories', () => {
    const S = bw => ({ unit: 'kg', workouts: [w({ bw })], bodyweight: [] })
    const kcalOf = bw => healthRecords(S(bw), { nameOf, kcal: true, now: NOW }).sessions[0].kcal
    expect(kcalOf(8000)).toBe(kcalOf(undefined))
    expect(kcalOf(8000)).toBe(rec({}, { kg: FALLBACK_KG }).kcal)
    // And the kg handed in from outside is capped by MAX_KCAL all the same.
    expect(rec({}, { kg: 1e9 })).not.toHaveProperty('kcal')
    expect(rec({}, { kg: Infinity })).not.toHaveProperty('kcal')
    expect(rec({}, { kg: NaN })).not.toHaveProperty('kcal')
  })
  it('a long title is cut, never through an emoji', () => {
    const title = 'a'.repeat(TEXT_MAX - 2) + '😀' + 'b'.repeat(50)
    const r = rec({ name: title })
    expect(r.title.length).toBeLessThanOrEqual(TEXT_MAX)
    expect(/[\uD800-\uDBFF]$/.test(r.title.slice(0, -1))).toBe(false)
  })
  it('reps past an int are capped', () => {
    const r = rec({ entries: [bench({ r: 1e15 })] })
    expect(r.segments[0].reps).toBe(MAX_REPS)
    expect(workoutSegments(w({ entries: [bench({ r: Infinity })] }))[0].reps).toBe(MAX_REPS)
  })
  it('segments need real times', () => {
    expect(workoutSegments(w({ start: NaN }))).toEqual([])
    expect(workoutSegments(w({ end: Infinity }))).toEqual([])
  })
})

describe('a weigh-in for the stores', () => {
  const b = (over = {}) => ({ d: D, w: 80, t: NOW - H, ...over })
  it('an ordinary one', () => {
    expect(weightRecord(b(), 'kg', null, NOW)).toEqual({ id: 'opengym-bw-' + D, time: NOW - H, kg: 80 })
  })
  it.each([
    ['zero', { w: 0 }], ['negative', { w: -1 }], ['a ton', { w: MAX_KG }], ['a typo', { w: 8000 }],
    ['infinite', { w: Infinity }], ['NaN', { w: NaN }], ['text', { w: 'heavy' }], ['no day', { d: '' }],
  ])('%s is left out', (_, over) => {
    expect(weightRecord(b(over), 'kg', null, NOW)).toBe(null)
  })
  it('a day not a day, before 2001 or more than a day ahead is left out', () => {
    expect(weightRecord(b({ d: 'nonsense', t: 0 }), 'kg', null, NOW)).toBe(null)
    expect(weightRecord(b({ d: '1999-05-01', t: 0 }), 'kg', null, NOW)).toBe(null)
    expect(weightRecord(b({ d: '2026-12-24', t: 0 }), 'kg', null, NOW)).toBe(null)
  })
  it('in pounds, 2300 lb is too much and 220 is fine', () => {
    expect(weightRecord(b({ w: 2300 }), 'lb', null, NOW)).toBe(null)
    expect(weightRecord(b({ w: 220 }), 'lb', null, NOW).kg).toBeCloseTo(99.79, 2)
  })
})

describe('healthRecords', () => {
  it('leaves out the bad ones and keeps the rest', () => {
    const S = {
      unit: 'kg',
      workouts: [w({ id: 'bad', end: NaN }), w({ id: 'good' }), w({ id: 'long', start: NOW - 40 * H, end: NOW })],
      bodyweight: [{ d: '2026-10-20', w: 0 }, { d: D, w: 81, t: NOW - H }],
    }
    const out = healthRecords(S, { nameOf, kcal: true, segments: true, now: NOW })
    expect(out.sessions.map(s => s.id)).toEqual(['opengym-w-good', 'opengym-w-long'])
    expect(out.sessions[1]).not.toHaveProperty('kcal')
    expect(out.weights.map(x => x.id)).toEqual(['opengym-bw-' + D])
  })
  it('a record ahead of the clock waits until it is not', () => {
    const S = { unit: 'kg', workouts: [w({ start: NOW + 3 * DAY_MS, end: NOW + 3 * DAY_MS + H })], bodyweight: [] }
    expect(healthRecords(S, { nameOf, now: NOW }).sessions).toEqual([])
    expect(healthRecords(S, { nameOf, now: NOW + 3 * DAY_MS }).sessions).toHaveLength(1)
  })
})

describe('body weight for the estimate', () => {
  it('takes the workout’s own, a weigh-in, else the fallback, skipping typos', () => {
    expect(bodyKgFor({ unit: 'kg' }, { bw: 82 })).toBe(82)
    expect(bodyKgFor({ unit: 'kg' }, { bw: 8200 })).toBe(FALLBACK_KG)
    expect(bodyKgFor({ unit: 'kg' }, { bw: 5 })).toBe(FALLBACK_KG)
    expect(bodyKgFor({ unit: 'kg' }, { bw: Infinity })).toBe(FALLBACK_KG)
    expect(bodyKgFor({ unit: 'kg', bodyweight: [{ d: D, w: 9000 }] }, { start: NOW })).toBe(FALLBACK_KG)
  })
  it('activeKcal of a workout without real times is null', () => {
    expect(activeKcal(w({ start: NaN }), 80)).toBe(null)
    expect(activeKcal(w({}), NaN)).toBe(null)
  })
})
