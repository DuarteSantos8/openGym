// v1.4.3 (#544, #127): what openGym takes back from Health Connect / Apple Health. Heart rate only
// fills what is missing (the Apple Watch's own reading is never replaced), weigh-ins typed into
// openGym always win, openGym's own records are never read back, nothing imported is written back.
import { describe, expect, it } from 'vitest'
import { isOwnRecord, mergeHeartRate, mergeWeighIns, lacksHeartRate, hubReadingId } from './health-read.js'
import { removeWeighIn } from './weigh-ins.js'
import { healthRecords, planSync } from './health-connect.js'
import { mergeBodyweight, mergeStates, stampChange } from './sync-merge.js'
import { logWeighIn } from './bodyweight.js'

const T0 = Date.UTC(2026, 9, 15, 17, 0, 0)
const s = sec => T0 + sec * 1000
const dense = (from, to, bpm) => { const out = []; for (let x = from; x <= to; x++) out.push([s(x), bpm]); return out }
const workout = sets => ({ id: 'w1', d: '2026-10-15', name: 'Push', start: s(0), end: s(600), _ts: 5, entries: [{ id: '0025', target: { mode: 'reps' }, sets }] })
const at = (d, h) => new Date(2026, 9, d, h).getTime()
const rec = (d, h, kg, extra = {}) => ({ t: at(d, h), kg, id: `r${d}${h}`, origin: 'com.withings.wiscale2', clientId: null, ...extra })

describe('isOwnRecord', () => {
  it('knows openGym by client id and by origin', () => {
    expect(isOwnRecord({ clientId: 'opengym-bw-2026-10-15', origin: 'x' })).toBe(true)
    expect(isOwnRecord({ origin: 'ch.duartesantos.opengym' })).toBe(true)
    expect(isOwnRecord({ origin: 'ch.duartesantos.opengym.test' })).toBe(true)
    expect(isOwnRecord({ origin: 'ch.duartesantos.opengymx' })).toBe(false)
    expect(isOwnRecord({ origin: 'com.garmin.android.apps.connectmobile', clientId: 'abc' })).toBe(false)
  })
})

describe('mergeHeartRate', () => {
  it('fills sets without a reading and stamps the workout', () => {
    const S = { workouts: [workout([{ w: 60, r: 8, done: true, at: s(100) }])] }
    expect(mergeHeartRate(S, 'w1', dense(0, 600, 130), 'hc', 99)).toBe(true)
    const w = S.workouts[0]
    expect(w.entries[0].sets[0].hr).toEqual({ avg: 130, max: 130 })
    expect(w.hr).toEqual({ avg: 130, max: 130, src: 'hc', n: 601 })
    expect(w._ts).toBe(99)
  })

  it('never overwrites a heart rate the Apple Watch measured', () => {
    const watch = { avg: 111, max: 122 }
    const S = { workouts: [{ ...workout([{ w: 60, r: 8, done: true, at: s(100), hr: watch, restHr: watch }]), hr: { avg: 1, max: 2, src: 'watch', n: 900 } }] }
    mergeHeartRate(S, 'w1', dense(0, 600, 150), 'ah', 99)
    expect(S.workouts[0].entries[0].sets[0].hr).toEqual(watch)
    expect(S.workouts[0].entries[0].sets[0].restHr).toEqual(watch)
    expect(S.workouts[0].hr.src).toBe('watch')
  })

  it('takes a fuller read from the same hub later (a watch that syncs late), not a thinner one', () => {
    const S = { workouts: [workout([{ w: 60, r: 8, done: true, at: s(100) }])] }
    mergeHeartRate(S, 'w1', dense(0, 120, 120), 'hc', 1)
    expect(S.workouts[0].hr.n).toBe(121)
    mergeHeartRate(S, 'w1', dense(0, 600, 140), 'hc', 2)
    expect(S.workouts[0].hr).toMatchObject({ avg: 140, n: 601 })
    // The set's reading from the first read stays.
    expect(S.workouts[0].entries[0].sets[0].hr.avg).toBe(120)
    expect(mergeHeartRate(S, 'w1', dense(0, 100, 90), 'hc', 3)).toBe(false)
  })

  it('is a no-op the second time, and for a workout it does not know', () => {
    const S = { workouts: [workout([{ w: 60, r: 8, done: true, at: s(100) }])] }
    mergeHeartRate(S, 'w1', dense(0, 600, 130), 'hc', 1)
    expect(mergeHeartRate(S, 'w1', dense(0, 600, 130), 'hc', 2)).toBe(false)
    expect(mergeHeartRate(S, 'nope', dense(0, 600, 130), 'hc', 2)).toBe(false)
  })

  it('lacksHeartRate', () => {
    expect(lacksHeartRate(workout([{ w: 60, r: 8, done: true }]))).toBe(true)
    expect(lacksHeartRate({ ...workout([{ w: 60, r: 8, done: true, hr: { avg: 100, max: 120 } }]), hr: { avg: 1, max: 2 } })).toBe(false)
  })

  it('the fields survive a sync merge between two devices', () => {
    const base = { _ts: 1, unit: 'kg', workouts: [workout([{ w: 60, r: 8, done: true, at: s(100) }])], routines: [], bodyweight: [] }
    const phone = JSON.parse(JSON.stringify(base))
    mergeHeartRate(phone, 'w1', dense(0, 600, 130), 'hc', 50)
    phone._ts = stampChange(base, phone, 50)
    const merged = mergeStates(phone, base)
    expect(merged.workouts[0].hr.src).toBe('hc')
    expect(merged.workouts[0].entries[0].sets[0].hr).toEqual({ avg: 130, max: 130 })
  })
})

describe('mergeWeighIns', () => {
  // #859: every sample with its time; the day's value is the morning one (the default).
  it('adds every weigh-in with its time, marked as imported', () => {
    const S = { unit: 'kg', bodyweight: [] }
    const days = mergeWeighIns(S, [rec(14, 9, 80.96), rec(14, 7, 81.24), rec(15, 7, 80.5)], { src: 'hc' })
    expect(days).toEqual(['2026-10-14', '2026-10-15'])
    expect(S.bodyweight.map(b => [b.d, b.w, b.src, b.ins.map(r => [r.at, r.w, r.src, r.sid])])).toEqual([
      ['2026-10-14', 81.2, 'hc', [['07:00', 81.2, 'hc', 'r147'], ['09:00', 81, 'hc', 'r149']]],
      ['2026-10-15', 80.5, 'hc', [['07:00', 80.5, 'hc', 'r157']]],
    ])
    expect(S.bodyweight[0].ins.map(r => r.id)).toEqual([hubReadingId({ id: 'r147' }), hubReadingId({ id: 'r149' })])
  })

  it('skips openGym’s own records and implausible weights', () => {
    const S = { unit: 'kg', bodyweight: [] }
    mergeWeighIns(S, [rec(14, 7, 80, { clientId: 'opengym-bw-2026-10-14' }), rec(15, 7, 80, { origin: 'ch.duartesantos.opengym' }), rec(16, 7, 5), rec(17, 7, 900)], { src: 'hc' })
    expect(S.bodyweight).toEqual([])
  })

  it('keeps a weigh-in typed into openGym that day, the scale\'s joining it at its own time', () => {
    const S = { unit: 'kg', bodyweight: [{ d: '2026-10-15', w: 82, t: at(15, 6) }] }
    expect(mergeWeighIns(S, [rec(15, 8, 80)], { src: 'hc' })).toEqual(['2026-10-15'])
    expect(S.bodyweight[0].ins.map(r => [r.id, r.at, r.w, r.src || null])).toEqual([['0', '06:00', 82, null], [hubReadingId({ id: 'r158' }), '08:00', 80, 'hc']])
    expect(S.bodyweight[0].w).toBe(82)
    expect(S.bodyweight[0].src).toBeUndefined()
  })

  it('skips a sample at the minute of a weigh-in the day already has', () => {
    const S = { unit: 'kg', bodyweight: [{ d: '2026-10-15', w: 82, t: at(15, 8) }] }
    expect(mergeWeighIns(S, [rec(15, 8, 82)], { src: 'hc' })).toEqual([])
    expect(S.bodyweight).toEqual([{ d: '2026-10-15', w: 82, t: at(15, 8) }])
  })

  it('does not bring back one weigh-in removed in openGym from a day that keeps others', () => {
    const S = { unit: 'kg', bodyweight: [] }
    mergeWeighIns(S, [rec(15, 7, 80), rec(15, 21, 81)], { src: 'hc' })
    const id = hubReadingId({ id: 'r1521' })
    removeWeighIn(S, '2026-10-15', id, at(15, 22))
    expect(mergeWeighIns(S, [rec(15, 7, 80), rec(15, 21, 81)], { src: 'hc' })).toEqual([])
    expect(S.bodyweight[0].ins).toHaveLength(1)
  })

  it('converts to pounds for a profile in lb', () => {
    const S = { unit: 'lb', bodyweight: [] }
    mergeWeighIns(S, [rec(15, 7, 80)], { src: 'ah' })
    expect(S.bodyweight[0].w).toBe(176.4)
  })

  it('is idempotent on a second read, with or without the memo, and adds a later reading of the same day', () => {
    const S = { unit: 'kg', bodyweight: [] }
    const seen = {}
    mergeWeighIns(S, [rec(15, 7, 80)], { src: 'hc', seen })
    expect(mergeWeighIns(S, [rec(15, 7, 80)], { src: 'hc', seen })).toEqual([])
    expect(mergeWeighIns(S, [rec(15, 7, 80)], { src: 'hc' })).toEqual([])   // another phone: by the sample's id
    expect(mergeWeighIns(S, [rec(15, 7, 80), rec(15, 9, 79.5)], { src: 'hc', seen })).toEqual(['2026-10-15'])
    expect(S.bodyweight[0].ins.map(r => [r.at, r.w])).toEqual([['07:00', 80], ['09:00', 79.5]])
    expect(S.bodyweight[0].w).toBe(80)
  })

  it('does not bring back a weigh-in deleted in openGym after it was taken', () => {
    const S = { unit: 'kg', bodyweight: [], deleted: { bodyweight: { '2026-10-15': at(15, 10) } } }
    expect(mergeWeighIns(S, [rec(15, 7, 80)], { src: 'hc' })).toEqual([])
    expect(mergeWeighIns(S, [rec(15, 11, 80)], { src: 'hc' })).toEqual(['2026-10-15'])
  })

  it('is never written back to the hub (no ping-pong)', () => {
    const S = { unit: 'kg', workouts: [], bodyweight: [{ d: '2026-10-14', w: 81, t: at(14, 7) }] }
    mergeWeighIns(S, [rec(15, 7, 80)], { src: 'hc' })
    const recs = healthRecords(S, { nameOf: e => e.id })
    expect(recs.weights.map(w => w.id)).toEqual(['opengym-bw-2026-10-14'])
    expect(planSync(recs, {}).weights.map(w => w.id)).toEqual(['opengym-bw-2026-10-14'])
  })
})

describe('a typed weigh-in beats an imported one in a sync merge', () => {
  it('whichever is newer', () => {
    const typed = { d: '2026-10-15', w: 82, t: at(15, 6) }
    const imported = { d: '2026-10-15', w: 80, t: at(15, 20), src: 'hc' }
    expect(mergeBodyweight([imported], [typed])).toEqual([typed])
    expect(mergeBodyweight([typed], [imported])).toEqual([typed])
    // Two imported or two typed: the newer, as before.
    expect(mergeBodyweight([{ ...imported, t: 1 }], [imported])).toEqual([imported])
  })

  it('typing a weigh-in on an imported day adds a typed one beside it', () => {
    const S = { bodyweight: [{ d: '2026-10-15', w: 80, t: at(15, 7), src: 'hc' }] }
    logWeighIn(S, 81, at(15, 9))
    expect(S.bodyweight[0].ins.map(r => [r.at, r.w, r.src || null])).toEqual([['07:00', 80, 'hc'], ['09:00', 81, null]])
    expect(S.bodyweight[0].src).toBeUndefined()
  })

  it('typing at the minute of an imported weigh-in adds it beside, never over it', () => {
    const S = { bodyweight: [{ d: '2026-10-15', w: 80, t: at(15, 7), src: 'hc' }] }
    logWeighIn(S, 81, at(15, 7))
    expect(S.bodyweight[0].ins.map(r => [r.at, r.w, r.src || null])).toEqual([['07:00', 80, 'hc'], ['07:00', 81, null]])
  })
})
