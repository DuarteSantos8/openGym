import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReadModel } from '../src/readModel.js'
import { createMcpTools } from '../src/mcpTools.js'

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
  const model = createReadModel(profile())
  assert.equal(model.listRoutines().routines[1].url, 'https://gym.areum.cl/#/plan/r/queued')
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

test('reject invalid calendar dates, empty IDs and invalid options at the boundary', () => {
  const model = createReadModel(profile())
  assert.throws(() => model.previewSession({ date: '2026-02-30' }), /date/i)
  assert.throws(() => model.getWorkout({ workout_id: '' }), /id/i)
  assert.throws(() => model.getRoutine({ routine_id: '' }), /id/i)
  assert.throws(() => model.listWorkouts({ limit: 300 }), /limit/i)
  assert.throws(() => model.estimateOneRm({ formula: 'fake' }), /formula/i)
})

test('nine MCP tools fetch each bearer profile independently; no image data travels', async () => {
  const tools = createMcpTools(async bearer => ({
    ...profile(),
    routines: [{ id: bearer, name: bearer, ex: [] }],
    workouts: [],
    queue: null,
  }))
  assert.equal(tools.length, 9)
  const list = tools.find(tool => tool.name === 'list_routines')
  assert.equal((await list.handler('one', {})).routines[0].id, 'one')
  assert.equal((await list.handler('two', {})).routines[0].id, 'two')
  assert.doesNotMatch(JSON.stringify(await list.handler('two', {})), /one|base64|media\//)
})
