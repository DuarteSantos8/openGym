import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logWorkout, logBodyWeight, logMeasurement, changeSetting, applyWorkout, applyBodyWeight, applyMeasurement, applySetting } from '../src/profileEdits.js'
import { ProfileConflictError } from '../src/profileStore.js'

const NOW = new Date('2026-10-22T12:00:00').getTime()
const cid = '123e4567-e89b-42d3-a456-426614174000'
const cid2 = '123e4567-e89b-42d3-a456-426614174001'
const base = () => ({
  unit: 'lb', restSec: 90, theme: 'dark', isAdmin: false, credentials: [{ id: 'k1' }], secret: 's',
  customEx: [{ id: 'my-ex', n: 'Custom', eq: 'barbell' }],
  workouts: [{ id: 'old', d: '2026-10-20', start: 1, entries: [], note: 'keep' }, { id: 'late', d: '2026-10-21', start: 9 }],
  routines: [{ id: 'r', name: 'R', ex: [] }],
  bodyweight: [{ d: '2026-10-20', w: 180, t: 5 }], measurements: [],
})
const workout = (over = {}) => ({
  creationId: cid, date: '2026-10-21', name: 'Chat session', durationMin: 45,
  exercises: [{ id: '1045', sets: [{ weight: 100, reps: 5 }, { weight: 105, reps: 3 }] }], ...over,
})
// Runs the patch once per state, like a 409 refetch; records what would have been PUT.
const fakeStore = (...states) => {
  const store = {
    produced: [],
    async updateProfile(bearer, patch, options) {
      assert.equal(options?.allowDelete, undefined)
      let last
      for (const state of states) { last = patch(structuredClone(state)); store.produced.push(last) }
      return last
    },
  }
  return store
}

test('logWorkout adds one workout under the caller id, built by buildCompletedWorkout, leaving others alone', () => {
  const profile = base()
  const before = structuredClone(profile)
  const next = applyWorkout(profile, workout(), { now: NOW })
  assert.deepEqual(profile, before)
  assert.equal(next.workouts.length, 3)
  const w = next.workouts.find(x => x.id === cid)
  assert.equal(w.d, '2026-10-21')
  assert.equal(w.name, 'Chat session')
  assert.deepEqual(w.prs, [])
  assert.equal(w.routineId, null)
  assert.equal(w.entries[0].id, '1045')
  assert.deepEqual(w.entries[0].sets, [{ w: 100, r: 5, done: true }, { w: 105, r: 3, done: true }])
  assert.equal(w.entries[0].topW, 105)
  assert.equal(w.vol, 100 * 5 + 105 * 3)
  assert.equal(w.end - w.start, 45 * 60000)
  assert.equal(typeof w._ts, 'number')
  assert.deepEqual(next.workouts.find(x => x.id === 'old'), before.workouts[0])
  assert.deepEqual(next.workouts.find(x => x.id === 'late'), before.workouts[1])
  assert.equal(next.unit, 'lb')
  assert.equal(next.isAdmin, false)
  assert.deepEqual(next.credentials, before.credentials)
})

test('logWorkout files by date and start so history stays chronological', () => {
  const next = applyWorkout(base(), workout({ date: '2026-10-19' }), { now: NOW })
  assert.deepEqual(next.workouts.map(w => w.id), [cid, 'old', 'late'])
})

test('a replay of the same creationId does not duplicate; a new creationId is a new workout', () => {
  const once = applyWorkout(base(), workout(), { now: NOW })
  const twice = applyWorkout(once, workout(), { now: NOW + 5000 })
  assert.equal(twice.workouts.filter(w => w.id === cid).length, 1)
  assert.deepEqual(twice, once)
  const other = applyWorkout(once, workout({ creationId: cid2 }), { now: NOW })
  assert.equal(other.workouts.length, once.workouts.length + 1)
})

test('creationId already used by a different workout fails closed and never overwrites', () => {
  const once = applyWorkout(base(), workout(), { now: NOW })
  const before = structuredClone(once)
  assert.throws(() => applyWorkout(once, workout({ exercises: [{ id: '1045', sets: [{ weight: 50, reps: 5 }] }] }), { now: NOW }), /creationId/i)
  assert.throws(() => applyWorkout(base(), workout({ creationId: 'old' }), { now: NOW }), /creationId/i)
  assert.deepEqual(once, before)
})

test('workout input at the trust boundary is refused', () => {
  const bad = patch => () => applyWorkout(base(), workout(patch), { now: NOW })
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-5', 'yesterday', '', null, 20261021, '2026-10-21T00:00', '2027-01-01']) {
    assert.throws(bad({ date }), /date/i, String(date))
  }
  for (const weight of [-1, NaN, Infinity, '100', null, 700, 1e9]) {
    assert.throws(bad({ exercises: [{ id: '1045', sets: [{ weight, reps: 5 }] }] }), /weight|load|invalid/i, String(weight))
  }
  for (const reps of [0, -3, 1.5, NaN, '5', null, 1000]) {
    assert.throws(bad({ exercises: [{ id: '1045', sets: [{ weight: 50, reps }] }] }), /reps|invalid/i, String(reps))
  }
  assert.throws(bad({ exercises: [] }), /invalid/i)
  assert.throws(bad({ exercises: [{ id: '1045', sets: [] }] }), /invalid/i)
  assert.throws(bad({ exercises: [{ id: 'not-real', sets: [{ weight: 1, reps: 1 }] }] }), /unknown exercise/i)
  assert.throws(bad({ exercises: [{ id: '__proto__', sets: [{ weight: 1, reps: 1 }] }] }), /invalid|unknown exercise/i)
  assert.throws(bad({ exercises: [{ id: '1045', sets: [{ weight: 1, reps: 1, done: false }] }] }), /invalid/i)
  assert.throws(bad({ exercises: [{ id: '1045', note: 'x', sets: [{ weight: 1, reps: 1 }] }] }), /invalid/i)
  assert.throws(bad({ extra: 1 }), /invalid/i)
  assert.throws(bad({ creationId: undefined }), /creationId/i)
  assert.throws(bad({ creationId: 'not-a-uuid' }), /creationId/i)
  assert.throws(bad({ name: '' }), /name/i)
  assert.throws(bad({ durationMin: 0 }), /duration/i)
  assert.throws(bad({ durationMin: 2000 }), /duration/i)
  assert.equal(applyWorkout(base(), workout({ exercises: [{ id: 'my-ex', sets: [{ weight: 0, reps: 8 }] }] }), { now: NOW }).workouts.length, 3)
})

test('workout weights are in the profile unit: no conversion, kg and lb caps differ', () => {
  const heavy = workout({ exercises: [{ id: '1045', sets: [{ weight: 400, reps: 1 }] }] })
  assert.equal(applyWorkout(base(), heavy, { now: NOW }).workouts.find(w => w.id === cid).entries[0].sets[0].w, 400)
  assert.throws(() => applyWorkout({ ...base(), unit: 'kg' }, heavy, { now: NOW }), /weight|load/i)
})

test('logBodyWeight upserts by date in {d,w,t}, keeps other and concurrent days', () => {
  const profile = base()
  const added = applyBodyWeight(profile, { date: '2026-10-22', weight: 181.26 }, { now: NOW })
  assert.deepEqual(added.bodyweight, [{ d: '2026-10-20', w: 180, t: 5 }, { d: '2026-10-22', w: 181.3, t: NOW }])
  const again = applyBodyWeight(added, { date: '2026-10-22', weight: 182 }, { now: NOW + 1 })
  assert.deepEqual(again.bodyweight[1], { d: '2026-10-22', w: 182, t: NOW + 1 })
  assert.equal(again.bodyweight.length, 2)
  const concurrent = structuredClone(profile)
  concurrent.bodyweight.push({ d: '2026-10-21', w: 179, t: 7 })
  const after409 = applyBodyWeight(concurrent, { date: '2026-10-22', weight: 181.3 }, { now: NOW })
  assert.deepEqual(after409.bodyweight.map(b => b.d), ['2026-10-20', '2026-10-21', '2026-10-22'])
  assert.equal(profile.bodyweight.length, 1)
})

test('repeated body-weight request is a no-op, retaining the first check-in stamp', () => {
  const once = applyBodyWeight(base(), { date: '2026-10-22', weight: 181 }, { now: NOW })
  const again = applyBodyWeight(once, { date: '2026-10-22', weight: 181 }, { now: NOW + 5000 })
  assert.deepEqual(again, once)
})

test('body weight input refused: dates, non-positive, too heavy, non-numbers', () => {
  const bad = r => () => applyBodyWeight(base(), r, { now: NOW })
  for (const date of ['2026-02-30', 'x', undefined, '2027-01-01']) assert.throws(bad({ date, weight: 80 }), /date/i)
  for (const weight of [0, -5, NaN, Infinity, '80', null, 1501]) assert.throws(bad({ date: '2026-10-22', weight }), /weight|invalid/i, String(weight))
  assert.throws(() => applyBodyWeight({ ...base(), unit: 'kg' }, { date: '2026-10-22', weight: 701 }, { now: NOW }), /weight/i)
  assert.throws(bad({ date: '2026-10-22', weight: 80, extra: 1 }), /invalid/i)
})

test('logMeasurement upserts one entry per date in centimetres, merging partial fields', () => {
  const first = applyMeasurement(base(), { date: '2026-10-22', valuesCm: { waist: 80.04, chest: 100 } }, { now: NOW })
  assert.equal(first.measurements.length, 1)
  const e = first.measurements[0]
  assert.equal(e.d, '2026-10-22')
  assert.equal(e.waist, 80)
  assert.equal(e.chest, 100)
  assert.equal(e.neck, null)
  assert.equal(e.t, NOW)
  assert.deepEqual(e.other, [])
  const second = applyMeasurement(first, { date: '2026-10-22', valuesCm: { waist: 79, bodyFat: 18.5 } }, { now: NOW + 1 })
  assert.equal(second.measurements.length, 1)
  assert.equal(second.measurements[0].waist, 79)
  assert.equal(second.measurements[0].chest, 100)
  assert.equal(second.measurements[0].bodyFat, 18.5)
  const other = applyMeasurement(second, { date: '2026-10-21', valuesCm: { neck: 38 } }, { now: NOW })
  assert.deepEqual(other.measurements.map(m => m.d), ['2026-10-21', '2026-10-22'])
  assert.deepEqual(other.measurements[1], second.measurements[0])
  const concurrent = structuredClone(first)
  concurrent.measurements.push({ ...first.measurements[0], d: '2026-10-19', waist: 90 })
  assert.equal(applyMeasurement(concurrent, { date: '2026-10-22', valuesCm: { waist: 80 } }, { now: NOW }).measurements.length, 2)
})

test('repeated measurement request is a no-op, retaining the original check-in stamp', () => {
  const request = { date: '2026-10-22', valuesCm: { waist: 80 } }
  const once = applyMeasurement(base(), request, { now: NOW })
  const again = applyMeasurement(once, request, { now: NOW + 5000 })
  assert.deepEqual(again, once)
})

test('measurement input refused: dates, unknown keys, non-positive, bodyFat over 100, empty', () => {
  const bad = r => () => applyMeasurement(base(), r, { now: NOW })
  assert.throws(bad({ date: '2026-02-30', valuesCm: { waist: 80 } }), /date/i)
  assert.throws(bad({ date: '2027-01-01', valuesCm: { waist: 80 } }), /date/i)
  assert.throws(bad({ date: '2026-10-22', valuesCm: {} }), /invalid/i)
  assert.throws(bad({ date: '2026-10-22', valuesCm: { toe: 5 } }), /invalid/i)
  assert.throws(bad({ date: '2026-10-22', valuesCm: { __proto__: 1, waist: 80 }, extra: 1 }), /invalid/i)
  assert.throws(bad({ date: '2026-10-22', valuesCm: JSON.parse('{"__proto__":5}') }), /invalid/i)
  for (const v of [0, -1, NaN, Infinity, '80', null, 1001]) assert.throws(bad({ date: '2026-10-22', valuesCm: { waist: v } }), /invalid|measurement/i, String(v))
  assert.throws(bad({ date: '2026-10-22', valuesCm: { bodyFat: 101 } }), /body ?fat|invalid/i)
})

test('changeSetting writes only allowlisted keys with valid values; everything else is refused unchanged', () => {
  const profile = base()
  const before = structuredClone(profile)
  assert.equal(applySetting(profile, { key: 'restSec', value: 120 }).restSec, 120)
  assert.equal(applySetting(profile, { key: 'theme', value: 'light' }).theme, 'light')
  assert.equal(applySetting(profile, { key: 'weekStart', value: 0 }).weekStart, 0)
  assert.equal(applySetting(profile, { key: 'targetW', value: 175.5 }).targetW, 175.5)
  assert.equal(applySetting(profile, { key: 'targetW', value: null }).targetW, null)
  const next = applySetting(profile, { key: 'restSec', value: 60 })
  assert.deepEqual({ ...next, restSec: 90 }, before)
  assert.deepEqual(profile, before)
  for (const key of ['unit', 'isAdmin', 'admin', 'credentials', 'secret', 'workouts', 'routines', 'bodyweight', 'lang', '__proto__', 'constructor', 'toString', '_wid', 'reminder']) {
    assert.throws(() => applySetting(profile, { key, value: 'x' }), /setting/i, key)
  }
  assert.deepEqual(profile, before)
  for (const [key, value] of [['restSec', -1], ['restSec', 1e6], ['restSec', 1.5], ['restSec', '90'], ['theme', 'neon'], ['weekStart', 2], ['targetW', -5], ['targetW', NaN], ['targetW', 5000], ['wdec', 3], ['effort', 'maybe']]) {
    assert.throws(() => applySetting(profile, { key, value }), /invalid|setting/i, `${key}=${value}`)
  }
  assert.throws(() => applySetting(profile, { key: 'restSec', value: 60, extra: 1 }), /invalid|setting/i)
})

test('update wrappers use updateProfile without delete and return narrow summaries', async () => {
  const store = fakeStore(base())
  const w = await logWorkout(store, 'tok', workout(), { now: NOW })
  assert.deepEqual(w, { id: cid, date: '2026-10-21', name: 'Chat session', exercises: 1, sets: 2, volume: 815, unit: 'lb' })
  const bw = await logBodyWeight(store, 'tok', { date: '2026-10-22', weight: 181 }, { now: NOW })
  assert.deepEqual(bw, { date: '2026-10-22', weight: 181, unit: 'lb' })
  const m = await logMeasurement(store, 'tok', { date: '2026-10-22', valuesCm: { waist: 80 } }, { now: NOW })
  assert.deepEqual(m, { date: '2026-10-22', fields: ['waist'], unit: 'cm' })
  const s = await changeSetting(store, 'tok', { key: 'restSec', value: 120 })
  assert.deepEqual(s, { key: 'restSec', value: 120 })
  for (const out of [w, bw, m, s]) assert.doesNotMatch(JSON.stringify(out), /credentials|secret|isAdmin|"workouts"/)
})

test('a 409 retry re-reads fresh state: replay stays single, concurrent records survive, unit flip refused', async () => {
  const concurrent = base()
  concurrent.workouts.push({ id: 'phone', d: '2026-10-21', start: 99 })
  concurrent.bodyweight.push({ d: '2026-10-21', w: 179, t: 7 })
  const store = fakeStore(base(), concurrent)
  await logWorkout(store, 'tok', workout(), { now: NOW })
  await logBodyWeight(store, 'tok', { date: '2026-10-22', weight: 181 }, { now: NOW })
  const [, final] = store.produced
  assert.equal(final.workouts.filter(w => w.id === cid).length, 1)
  assert.ok(final.workouts.some(w => w.id === 'phone'))
  const bwFinal = store.produced.at(-1)
  assert.ok(bwFinal.bodyweight.some(b => b.d === '2026-10-21'))

  const kg = { ...base(), unit: 'kg' }
  await assert.rejects(() => logBodyWeight(fakeStore(base(), kg), 'tok', { date: '2026-10-22', weight: 80 }, { now: NOW }), /unit mismatch/)
  await assert.rejects(() => logWorkout(fakeStore(base(), kg), 'tok', workout(), { now: NOW }), /unit mismatch/)
})

test('conflict errors are sanitized and validation happens before any write', async () => {
  const store = { calls: 0, async updateProfile() { store.calls++; throw new ProfileConflictError({ secret: 'leak', credentials: ['c'] }) } }
  await assert.rejects(() => changeSetting(store, 'tok', { key: 'restSec', value: 60 }), error => {
    assert.equal(error.message, 'profile conflict')
    assert.equal(error.profile, undefined)
    assert.doesNotMatch(JSON.stringify(error), /leak/)
    return true
  })
  store.calls = 0
  await assert.rejects(() => changeSetting(store, 'tok', { key: 'unit', value: 'kg' }), /setting/i)
  await assert.rejects(() => logWorkout(store, 'tok', workout({ date: 'nope' }), { now: NOW }), /date/i)
  await assert.rejects(() => logBodyWeight(store, 'tok', { date: '2026-10-22', weight: -1 }, { now: NOW }), /weight|invalid/i)
  await assert.rejects(() => logMeasurement(store, 'tok', { date: '2026-10-22', valuesCm: { waist: -1 } }, { now: NOW }), /invalid|measurement/i)
  assert.equal(store.calls, 0)
})
