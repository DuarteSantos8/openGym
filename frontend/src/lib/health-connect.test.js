import { migratedFixture } from './test-fixtures.js'
import { describe, expect, it } from 'vitest'
import { healthRecords, planSync, recordKey, sessionRecord, sessionType, SESSION_TYPES, TEXT_MAX, weightRecord, writtenIds } from './health-connect.js'

// #200: what the Android app writes to Health Connect, worked out from the state alone.
const nameOf = e => ({ '0025': 'barbell bench press', '3666': 'walking on incline treadmill', '2138': 'stationary bike run v. 3' })[e.id] || e.id
const at = (h, m = 0) => new Date(2026, 8, 17, h, m).getTime()
const strength = { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }
const treadmill = { id: '3666', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 5, done: true }] }
const bike = { id: '2138', target: { mode: 'cardio' }, sets: [{ min: 15, speed: 20, done: true }] }
const workout = (entries, extra = {}) => ({ id: 'w1', d: '2026-09-17', start: at(18), end: at(19), name: 'Push', entries, ...extra })

describe('sessionType', () => {
  it('is strength training as soon as one exercise is not cardio', () => {
    expect(sessionType(workout([treadmill, strength]))).toBe('strength_training')
  })
  it('takes the machine of an all-cardio workout from the catalogue', () => {
    expect(sessionType(workout([treadmill]))).toBe('walking')
    expect(sessionType(workout([bike]))).toBe('biking_stationary')
  })
  it('is "other" for cardio on two machines, or on one the catalogue does not place', () => {
    expect(sessionType(workout([treadmill, bike]))).toBe('other_workout')
    expect(sessionType(workout([{ ...treadmill, id: 'custom-rower' }]))).toBe('other_workout')
  })
  it('ignores exercises with no set done', () => {
    const skipped = { ...strength, sets: [{ w: 60, r: 8, done: false }] }
    expect(sessionType(workout([treadmill, skipped]))).toBe('walking')
  })
  it('only ever answers a type the native side knows', () => {
    for (const w of [workout([]), workout([strength]), workout([treadmill]), workout([bike, treadmill])]) {
      expect(SESSION_TYPES).toContain(sessionType(w))
    }
  })
})

describe('sessionRecord', () => {
  it('carries the workout id, its times, the name and the sets as text', () => {
    const rec = sessionRecord(workout([strength], { note: 'Felt strong.' }), { unit: 'kg', nameOf })
    expect(rec).toEqual({
      id: 'opengym-w-w1', start: at(18), end: at(19), type: 'strength_training', title: 'Push',
      notes: 'Barbell Bench Press\n60×8, 60×8\n\nFelt strong.',
    })
  })
  it('leaves out a workout without real times instead of inventing them', () => {
    expect(sessionRecord(workout([strength], { start: undefined }), { unit: 'kg', nameOf })).toBeNull()
    expect(sessionRecord(workout([strength], { end: at(18) }), { unit: 'kg', nameOf })).toBeNull()
    expect(sessionRecord(workout([strength], { id: undefined }), { unit: 'kg', nameOf })).toBeNull()
  })
  it('keeps title and notes within what Health Connect accepts', () => {
    const long = 'x'.repeat(3000)
    const rec = sessionRecord(workout([strength], { name: long, note: long }), { unit: 'kg', nameOf })
    expect(rec.title.length).toBe(TEXT_MAX)
    expect(rec.notes.length).toBe(TEXT_MAX)
  })
})

describe('weightRecord', () => {
  it('is in kilograms whatever the profile unit', () => {
    expect(weightRecord({ d: '2026-09-17', w: 80, t: at(7) }, 'kg').kg).toBe(80)
    expect(weightRecord({ d: '2026-09-17', w: 176.4, t: at(7) }, 'lb').kg).toBeCloseTo(80.014, 3)
  })
  it('is at the time it was typed when that was on its own day', () => {
    expect(weightRecord({ d: '2026-09-17', w: 80, t: at(7, 12) }, 'kg')).toEqual({ id: 'opengym-bw-2026-09-17', time: at(7, 12), kg: 80 })
  })
  it('is at 08:00 on its day when it was added to that day later, or carries no time', () => {
    const morning = new Date(2026, 8, 10, 8).getTime()
    expect(weightRecord({ d: '2026-09-10', w: 80, t: at(7) }, 'kg').time).toBe(morning)
    expect(weightRecord({ d: '2026-09-10', w: 80 }, 'kg').time).toBe(morning)
  })
  it('skips a weigh-in with no day or no weight', () => {
    expect(weightRecord({ w: 80 }, 'kg')).toBeNull()
    expect(weightRecord({ d: '2026-09-17', w: 0 }, 'kg')).toBeNull()
  })
})

describe('healthRecords', () => {
  it('turns the state into sessions and weights, dropping what cannot be written', () => {
    const S = {
      unit: 'kg',
      workouts: [workout([strength]), workout([strength], { id: 'w2', start: undefined })],
      bodyweight: [{ d: '2026-09-17', w: 80, t: at(7) }, { d: '2026-09-18', w: null }],
    }
    const r = healthRecords(S, { nameOf })
    expect(r.sessions.map(s => s.id)).toEqual(['opengym-w-w1'])
    expect(r.weights.map(s => s.id)).toEqual(['opengym-bw-2026-09-17'])
  })
  it('copes with a state that has neither', () => {
    expect(healthRecords({}, { nameOf })).toEqual({ sessions: [], weights: [] })
  })
})

describe('planSync', () => {
  const S = { unit: 'kg', workouts: [workout([strength])], bodyweight: [{ d: '2026-09-17', w: 80, t: at(7) }] }
  const records = () => healthRecords(S, { nameOf })

  it('writes everything the first time', () => {
    const plan = planSync(records(), {})
    expect(plan.sessions).toHaveLength(1)
    expect(plan.weights).toHaveLength(1)
    expect(plan.remove).toEqual({ sessions: [], weights: [] })
    expect(Object.keys(plan.written)).toEqual(['opengym-w-w1', 'opengym-bw-2026-09-17'])
  })
  it('writes nothing again when nothing changed', () => {
    const { written } = planSync(records(), {})
    const again = planSync(records(), written)
    expect(again.sessions).toEqual([])
    expect(again.weights).toEqual([])
    expect(again.written).toEqual(written)
  })
  it('writes a record again when it was edited', () => {
    const { written } = planSync(records(), {})
    const edited = healthRecords({ ...S, bodyweight: [{ d: '2026-09-17', w: 79.5, t: at(7) }] }, { nameOf })
    const plan = planSync(edited, written)
    expect(plan.weights.map(w => w.kg)).toEqual([79.5])
    expect(plan.sessions).toEqual([])
  })
  it('removes what was deleted from openGym, and only what this phone wrote', () => {
    const { written } = planSync(records(), {})
    const plan = planSync({ sessions: [], weights: [] }, written)
    expect(plan.remove).toEqual({ sessions: ['opengym-w-w1'], weights: ['opengym-bw-2026-09-17'] })
    expect(plan.written).toEqual({})
  })
  it('writes one record for two workouts that share an id', () => {
    const twice = { sessions: [...records().sessions, { ...records().sessions[0], title: 'Copy' }], weights: [] }
    expect(planSync(twice, {}).sessions.map(s => s.title)).toEqual(['Push'])
  })
})

describe('recordKey', () => {
  it('is the same for the same record and differs for a changed one', () => {
    const rec = { id: 'opengym-bw-2026-09-17', time: at(7), kg: 80 }
    expect(recordKey({ ...rec })).toBe(recordKey(rec))
    expect(recordKey({ ...rec, kg: 80.1 })).not.toBe(recordKey(rec))
  })
})

describe('writtenIds', () => {
  it('lists what this phone wrote, by type', () => {
    expect(writtenIds({ a: { k: 'session', h: '1' }, b: { k: 'weight', h: '2' }, c: { k: 'other' } }))
      .toEqual({ sessions: ['a'], weights: ['b'] })
  })
})

describe('canonical workouts in Health Connect', () => {
  it('preserves strength, cardio machine types and the exact notes after migration', () => {
    for (const entries of [[strength], [treadmill], [bike], [treadmill, strength]]) {
      const original = workout(entries)
      const canonical = migratedFixture({ workouts: [original], routines: [], unit: 'kg' }).workouts[0]
      expect(sessionRecord(canonical, { unit: 'kg', nameOf })).toEqual(sessionRecord(original, { unit: 'kg', nameOf }))
    }
  })
})
