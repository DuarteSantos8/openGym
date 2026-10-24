import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadModel } from '../src/readModel.js'
import { createMcpTools } from '../src/mcpTools.js'
import { EXIDX } from '../../frontend/src/lib/exercises.js'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const profile = () => {
  const d = today()
  const wd = new Date(d + 'T12:00:00').getDay()
  return {
    unit: 'lb',
    week: { [wd]: 'fixed' },
    dayPlan: {},
    queue: { ids: ['queued'], since: 0, startsOn: d, label: 'Coach week' },
    routines: [
      { id: 'fixed', name: 'Fixed', ex: [{ id: 'bench_press', sets: 2, reps: 8, restSec: 45 }] },
      { id: 'queued', name: 'Queued', ex: [{ id: 'unlisted-exercise', sets: 3, reps: 5, weight: 80, restSec: 90 }] },
    ],
    workouts: [{
      id: 'w1',
      d,
      name: 'Fixed',
      routineId: 'fixed',
      start: 1000,
      end: 61000,
      entries: [{ id: 'bench_press', target: { sets: 2, reps: 8 }, sets: [{ w: 100, r: 5, done: true }] }],
    }],
    bodyweight: [{ d, w: 180 }],
    customEx: [],
  }
}

test('routine reads preserve targets, rests, units, URLs and unknown exercise IDs without media', () => {
  const model = createReadModel(profile(), { origin: 'https://gym.example.test' })
  assert.equal(model.listRoutines().routines[1].url, 'https://gym.example.test/#/plan/r/queued')
  const r = model.getRoutine({ routine_id: 'queued' })
  assert.equal(r.unit, 'lb')
  assert.equal(r.exercises[0].id, 'unlisted-exercise')
  assert.equal(r.exercises[0].unknown, true)
  assert.equal(r.exercises[0].sets, 3)
  assert.equal(r.exercises[0].reps, 5)
  assert.equal(r.exercises[0].rest_sec, 90)
  assert.doesNotMatch(JSON.stringify(r), /\b(?:gif|png|jpe?g|base64|media)\b/i)
})

test('queue takes priority over weekday when previewing today', () => {
  const model = createReadModel(profile())
  assert.equal(model.getWeek().today_routine_id, 'queued')
  assert.equal(model.previewSession().routine_id, 'queued')
  assert.equal(model.getWeek().weekdays[new Date(today() + 'T12:00:00').getDay()].routine_id, 'fixed')
})

test('workout, bodyweight, 1RM and muscle reads stay on injected profile', () => {
  const model = createReadModel(profile())
  assert.equal(model.listWorkouts().workouts[0].id, 'w1')
  assert.equal(model.getWorkout({ workout_id: 'w1' }).unit, 'lb')
  assert.equal(model.getBodyweight().latest.weight, 180)
  assert.ok(Array.isArray(model.estimateOneRm().pr_table))
  assert.equal(model.muscleBalance({ period: 'all' }).workouts_in_period, 1)
})

test('exercise names follow the profile language and equipment filter', async () => {
  const p = profile()
  p.lang = 'es'
  p.equipFilterOn = true
  p.activeEquipId = 'home'
  p.equipProfiles = [{ id: 'home', accV: 1, equipment: ['body weight'] }]
  const model = createReadModel(p, { origin: 'https://gym.example.test' })
  const found = model.searchExercises({ query: 'flexión arquero', limit: 5 })
  assert.ok(found.exercises.some(e => e.id === '3294' && e.name === 'flexión arquero'))
  assert.ok(found.exercises.every(e => e.id && e.name && !e.media))
  assert.ok(found.exercises.every(e => e.equipment === 'body weight'))
  assert.equal(model.getRoutine({ routine_id: 'fixed' }).exercises[0].name, 'Unknown exercise')
})

test('reject invalid calendar dates, empty IDs and invalid options at the boundary', () => {
  const model = createReadModel(profile())
  assert.throws(() => model.previewSession({ date: '2026-02-30' }), /date/i)
  assert.throws(() => model.getWorkout({ workout_id: '' }), /id/i)
  assert.throws(() => model.getRoutine({ routine_id: '' }), /id/i)
  assert.throws(() => model.listWorkouts({ limit: 300 }), /limit/i)
  assert.throws(() => model.estimateOneRm({ formula: 'fake' }), /formula/i)
})

test('MCP tools fetch each bearer profile independently; no image data travels', async () => {
  const tools = createMcpTools(async bearer => ({
    ...profile(),
    routines: [{ id: bearer, name: bearer, ex: [] }],
    workouts: [],
    queue: null,
  }))
  assert.equal(tools.length, 10)
  assert.ok(tools.some(tool => tool.name === 'search_exercises'))
  const list = tools.find(tool => tool.name === 'list_routines')
  assert.equal((await list.handler('one', {})).routines[0].id, 'one')
  assert.equal((await list.handler('two', {})).routines[0].id, 'two')
  assert.doesNotMatch(JSON.stringify(await list.handler('two', {})), /one|base64|media\//)
})

// EXIDX is a process-global plain object: nothing a profile carries may change it or its prototype.
const snapshot = () => Object.getOwnPropertyNames(EXIDX).map(k => [k, Object.getOwnPropertyDescriptor(EXIDX, k)])
const previewWith = (custom, ex) => {
  const p = profile()
  p.queue = null
  p.week = {}
  p.customEx = custom
  p.routines = [{ id: 'r', name: 'R', ex }]
  return createReadModel(p).previewSession({ routine_id: 'r' })
}

for (const id of ['__proto__', 'constructor', 'prototype']) {
  test(`custom exercise id ${id} is refused and cannot touch EXIDX or its prototype`, () => {
    const before = snapshot()
    const p = JSON.parse(`{"routines":[],"workouts":[],"customEx":[{"id":"${id}","n":"Evil","bp":"chest","polluted":true}]}`)
    assert.throws(() => createReadModel(p), /custom exercise id/i)
    assert.equal(Object.getPrototypeOf(EXIDX), Object.prototype)
    assert.equal(Object.prototype.polluted, undefined)
    assert.deepEqual(snapshot(), before)
  })
}

test('inherited Object.prototype names stay unknown exercises with a text name', () => {
  const ids = ['constructor', '__proto__', 'toString']
  const p = { ...profile(), routines: [{ id: 'r', name: 'R', ex: ids.map(id => ({ id, sets: 1, reps: 5 })) }] }
  const r = createReadModel(p).getRoutine({ routine_id: 'r' })
  assert.deepEqual(r.exercises.map(e => e.id), ids)
  for (const e of r.exercises) {
    assert.equal(e.unknown, true)
    assert.equal(typeof e.name, 'string')
  }
})

test('previewing routines that use Object.prototype names as exercise ids stays safe and visible', () => {
  const before = snapshot()
  const ids = ['constructor', '__proto__', 'toString']
  const out = previewWith([], ids.map(id => ({ id, sets: 2, reps: 5, weight: 40 })))
  assert.deepEqual(out.exercises.map(e => e.id), ids)
  assert.ok(out.exercises.every(e => e.unknown === true))
  assert.deepEqual(snapshot(), before)
  assert.equal(Object.getPrototypeOf(EXIDX), Object.prototype)
})

test('profile A custom exercise is not visible when profile B is read afterwards', () => {
  const custom = [{ id: 'cx-a', n: 'A Secret Lift', bp: 'upper legs', eq: 'barbell', tg: 'quads', sm: [], st: [] }]
  const a = previewWith(custom, [{ id: 'cx-a', sets: 3, reps: 5, weight: 100 }])
  assert.equal(a.exercises[0].name, 'A Secret Lift')
  assert.equal(Object.hasOwn(EXIDX, 'cx-a'), false)
  const b = previewWith([], [{ id: 'cx-a', sets: 3, reps: 5, weight: 100 }])
  assert.equal(b.exercises[0].unknown, true)
  assert.doesNotMatch(JSON.stringify(b), /A Secret Lift/)
})

test('stored media objects inside targets and pyramid lists never reach Claude', () => {
  const p = profile()
  p.workouts[0].entries[0].target = { sets: 2, reps: 8, img: '/exercise-media/still/1.webp', token: 'secret-token' }
  p.routines[0].ex[0].pyramid = [8, 'max', '/exercise-media/clip/1.mp4', { gif: '/exercise-media/clip/2.mp4' }]
  p.dayPlan = { [p.workouts[0].d]: { token: 'secret-override', media: '/exercise-media/still/1.webp' } }
  p.routines[0].ex[0].pyramidRest = [45, { bearer: 'abc' }]
  p.routines[0].ex[0].pyramidWeight = [100, { bytes: 'AAAA' }]
  const model = createReadModel(p)
  const text = JSON.stringify([model.getWorkout({ workout_id: 'w1' }), model.getRoutine({ routine_id: 'fixed' }), model.getWeek()])
  assert.doesNotMatch(text, /exercise-media|secret-token|secret-override|bearer|AAAA|webp|mp4/)
  assert.deepEqual(model.getRoutine({ routine_id: 'fixed' }).exercises[0].pyramid, [8, 'max'])
})

test('a write that throws mid-indexing leaves no earlier custom exercise behind', () => {
  // A key that cannot be redefined makes the second write throw. The first custom must still be removed.
  Object.defineProperty(EXIDX, 'cx-locked', { value: { id: 'cx-locked', n: 'Locked' }, writable: false, enumerable: false, configurable: false })
  const before = snapshot()
  const custom = [{ id: 'cx-first', n: 'First Secret', bp: 'chest' }, { id: 'cx-locked', n: 'Other', bp: 'chest' }]
  assert.throws(() => previewWith(custom, [{ id: 'cx-first', sets: 1, reps: 5 }]))
  assert.equal(Object.hasOwn(EXIDX, 'cx-first'), false)
  assert.deepEqual(snapshot(), before)
})

test('a custom exercise shadowing a catalogue id is restored exactly, even when the build throws', () => {
  const before = snapshot()
  const custom = [{ id: '0025', n: 'Shadow', bp: 'chest' }]
  const ok = previewWith(custom, [{ id: '0025', sets: 1, reps: 5 }])
  assert.equal(ok.exercises[0].name, 'Shadow')
  assert.deepEqual(snapshot(), before)
  assert.throws(() => previewWith(custom, [{ id: '0025', sets: 1, reps: 5 }, null]))
  assert.deepEqual(snapshot(), before)
})
