import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXIDX } from './exercises.js'
import { exerciseType, goneIds, healthRecords, planSync, plannedType, recordKey, sessionRecord, sessionType, SESSION_TYPES, TEXT_MAX, weightRecord, writtenIds } from './health-connect.js'

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
  it('is mixed cardio for cardio on two machines, "other" for one the catalogue does not place', () => {
    expect(sessionType(workout([treadmill, bike]))).toBe('mixed_cardio')
    expect(sessionType(workout([{ ...treadmill, id: 'custom-rower' }]))).toBe('other_workout')
    expect(sessionType(workout([treadmill, { ...treadmill, id: 'custom-rower' }]))).toBe('other_workout')
  })
  it('ignores exercises with no set done', () => {
    const skipped = { ...strength, sets: [{ w: 60, r: 8, done: false }] }
    expect(sessionType(workout([treadmill, skipped]))).toBe('walking')
  })
  // #799: a running-only session went to Apple Health as strength training.
  const cardio = (id, extra = {}) => ({ id, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 8, done: true }], ...extra })
  const reps = id => ({ id, target: { mode: 'reps' }, sets: [{ r: 20, done: true }] })
  it.each([
    ['5216', 'running'],            // sprint
    ['4004', 'running'],            // place jog
    ['2197', 'running'],            // run on treadmill (filed with the stationary bike)
    ['2259', 'walking'],            // walking on treadmill
    ['2258', 'walking'],
    ['1161', 'rowing'],             // rowing (with rowing machine)
    ['3893', 'biking_stationary'],  // assault bike run
    ['5214', 'biking'],             // riding outdoor bicycle
    ['2192', 'elliptical'],
    ['2612', 'jump_rope'],
    ['6100', 'jump_rope'],          // bodyweight skipping
    ['3384', 'hiit'],               // battling ropes power slam
    ['3037', 'mixed_cardio'],       // butt kicks: cardio, no machine, no name to go by
  ])('files cardio %s as %s', (id, type) => {
    expect(sessionType(workout([cardio(id)]))).toBe(type)
  })
  it('counts burpees and jacks as HIIT also when they are logged as reps', () => {
    expect(sessionType(workout([reps('1160'), reps('3094')]))).toBe('hiit')
    expect(exerciseType(reps('0630'))).toBe('hiit') // mountain climber
  })
  it('keeps a strength move named like cardio strength (bent over row)', () => {
    expect(exerciseType(reps('0027'))).toBe('strength_training')
    expect(sessionType(workout([reps('0027'), cardio('0685')]))).toBe('strength_training')
  })
  it('files yoga and stretching, and leaves a run with a stretch after it a run', () => {
    const yoga = Object.values(EXIDX).find(e => e.cat === 'yoga').id
    const stretch = Object.values(EXIDX).find(e => e.cat === 'stretching').id
    expect(sessionType(workout([reps(yoga)]))).toBe('yoga')
    expect(sessionType(workout([reps(stretch)]))).toBe('flexibility')
    expect(sessionType(workout([reps(stretch), reps(yoga)]))).toBe('yoga')
    expect(sessionType(workout([cardio('0685'), reps(stretch)]))).toBe('running')
    expect(sessionType(workout([strength, reps(stretch)]))).toBe('strength_training')
  })
  it('still files a strength move logged as minutes as "other"', () => {
    expect(sessionType(workout([cardio('0025')]))).toBe('other_workout')
  })
  it('only ever answers a type the native side knows', () => {
    for (const w of [workout([]), workout([strength]), workout([treadmill]), workout([bike, treadmill])]) {
      expect(SESSION_TYPES).toContain(sessionType(w))
    }
  })
})

// Each name has its own type on the native side; a name it does not know is filed as "other".
describe('the native tables', () => {
  const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')
  it.each([['../../ios/App/App/AppleHealthPlugin.swift'], ['../../ios/App/Watch/WorkoutManager.swift']])('%s knows every type', f => {
    const s = src(f)
    for (const name of SESSION_TYPES) expect(s).toContain(`"${name}": .`)
  })
  it('Health Connect knows every type it has a constant for', () => {
    const s = src('../../android/app/src/main/java/ch/duartesantos/opengym/HealthConnectPlugin.java')
    for (const name of SESSION_TYPES.filter(n => !['jump_rope', 'mixed_cardio', 'other_workout'].includes(n))) {
      expect(s).toContain(`case "${name}": return`)
    }
  })
})

describe('plannedType', () => {
  it('types a planned session before any set is done, for the watch (#799)', () => {
    const plan = id => ({ id, target: { mode: 'cardio', min: 30 }, sets: [{ min: 30, speed: 10, done: false }] })
    expect(plannedType([plan('0685')])).toBe('running')
    expect(plannedType([plan('0685'), { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8 }] }])).toBe('strength_training')
    expect(plannedType([])).toBeNull()
    expect(plannedType(undefined)).toBeNull()
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
  it('with the deletions on record, removes only those and keeps the merely missing as written', () => {
    const { written } = planSync(records(), {})
    const plan = planSync({ sessions: [], weights: [] }, written, new Set(['opengym-bw-2026-09-17']))
    expect(plan.remove).toEqual({ sessions: [], weights: ['opengym-bw-2026-09-17'] })
    expect(Object.keys(plan.written)).toEqual(['opengym-w-w1'])
  })
  it('goneIds reads removals, add-backs and a reset', () => {
    const ids = goneIds({
      deleted: { workouts: { a: 5, b: -6 }, bodyweight: { '2026-09-01': 7 }, routines: { r: 9 } },
      resetIds: { workouts: ['c'], bodyweight: ['2026-09-02|123', '2026-09-03|'] },
    })
    expect([...ids].sort()).toEqual(['opengym-bw-2026-09-01', 'opengym-bw-2026-09-02', 'opengym-bw-2026-09-03', 'opengym-w-a', 'opengym-w-c'])
    expect(goneIds(null).size).toBe(0)
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
