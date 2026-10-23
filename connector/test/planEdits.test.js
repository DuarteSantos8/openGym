import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposeWeek, applyPlanEdit, updatePlanEdit, PlanChoiceRequiredError } from '../src/planEdits.js'
import { EXIDX } from '../../frontend/src/lib/exercises.js'

const exId = '1045'
assert.ok(Object.hasOwn(EXIDX, exId))
const base = () => ({
  unit: 'lb', note: { private: true }, workouts: [{ id: 'logged' }], customEx: [{ id: 'my-ex', n: 'Custom', eq: 'barbell' }],
  routines: [{ id: 'old', name: 'Old', ex: [{ id: exId, sets: 3, reps: 5, weight: 100, note: 'keep?' }] }, { id: 'untouched', name: 'Other', ex: [] }],
  week: { 1: ['old'], 3: ['untouched'] }, queue: null,
})
const request = () => ({ routines: [{ id: 'old', name: 'New name', ex: [{ id: exId, sets: 4, reps: 6, weight: 120, restSec: 90 }] }], week: { 1: ['old'] } })

test('propose only describes; apply sets existing ID, preserves unrelated records, week days, unit and source', () => {
  const profile = base()
  const before = structuredClone(profile)
  const edit = proposeWeek(profile, request())
  assert.deepEqual(profile, before)
  assert.equal(edit.routines[0].url, 'https://gym.areum.cl/#/plan/r/old')
  const next = applyPlanEdit(profile, edit)
  assert.equal(next.routines[0].id, 'old')
  assert.equal(next.routines[0].ex[0].weight, 120)
  assert.deepEqual(next.routines[1], before.routines[1])
  assert.deepEqual(next.week[3], ['untouched'])
  assert.deepEqual(next.workouts, before.workouts)
  assert.deepEqual(next.note, before.note)
  assert.equal(next.unit, 'lb')
  assert.deepEqual(profile, before)
  assert.deepEqual(applyPlanEdit(next, edit), next)
  assert.doesNotMatch(JSON.stringify(edit), /(?:"img"|"gif"|base64|\/media\/)/i)
})

test('fresh routine IDs stabilize in edit; retry preserves concurrent routines and workouts', () => {
  const profile = base()
  const edit = proposeWeek(profile, { routines: [{ name: 'Fresh', ex: [{ id: 'my-ex', sets: 2, weight: 20 }] }], week: { 2: [] } })
  const id = edit.routines[0].id
  assert.ok(id && id !== 'old' && id !== 'untouched')
  assert.equal(edit.routines[0].url, `https://gym.areum.cl/#/plan/r/${id}`)
  const concurrent = { ...profile, workouts: [...profile.workouts, { id: 'later' }], routines: [...profile.routines, { id: 'elsewhere', name: 'Concurrent', ex: [] }] }
  const next = applyPlanEdit(concurrent, edit)
  assert.equal(next.routines.filter(r => r.id === id).length, 1)
  assert.equal(next.routines.some(r => r.id === 'elsewhere'), true)
  assert.equal(next.workouts.length, 2)
  assert.deepEqual(applyPlanEdit(next, edit), next)
})

test('equipment filter uses active profile, catalogue and profile customs; unknown IDs rejected', () => {
  const s = base()
  s.equipFilterOn = true
  s.activeEquipId = 'home'
  s.equipProfiles = [{ id: 'home', accV: 1, equipment: ['dumbbell'] }]
  assert.throws(() => proposeWeek(s, request()), /equipment/i)
  assert.throws(() => proposeWeek(s, { routines: [{ id: 'old', ex: [{ id: 'my-ex' }] }], week: {} }), /equipment/i)
  assert.throws(() => proposeWeek(s, { routines: [{ id: 'old', ex: [{ id: 'not-a-real-exercise' }] }], week: {} }), /unknown exercise/i)
  s.equipFilterOn = false
  assert.equal(proposeWeek(s, request()).routines[0].ex[0].id, exId)
  assert.equal(proposeWeek(s, { routines: [{ id: 'old', ex: [{ id: 'my-ex' }] }], week: {} }).routines[0].ex[0].id, 'my-ex')
})

test('live queue and fixed week require explicit choice; updateProfile never called', async () => {
  const s = base()
  s.queue = { ids: ['untouched'], label: 'Coach week', since: Date.now() }
  const choice = proposeWeek(s, request())
  assert.ok(choice instanceof PlanChoiceRequiredError)
  assert.deepEqual(choice.queue, { name: 'Coach week', ids: ['untouched'], names: ['Other'] })
  assert.deepEqual(choice.week.ids, ['old', 'untouched'])
  assert.deepEqual(choice.week.names, ['Old', 'Other'])
  let writes = 0
  const store = { updateProfile() { writes++; throw new Error('called updateProfile') } }
  assert.equal(await updatePlanEdit(store, 'bearer', choice), choice)
  assert.equal(writes, 0)
  assert.throws(() => applyPlanEdit(s, request()), /invalid edit/i)
  assert.throws(() => applyPlanEdit(s, proposeWeek(base(), request())), PlanChoiceRequiredError)
  assert.equal(writes, 0)
})

test('updateProfile patch returns complete idempotent profile without deletion options', async () => {
  const initial = base()
  const edit = proposeWeek(initial, request())
  let writes = 0
  const store = { updateProfile: async (bearer, patch, options) => {
    assert.equal(bearer, 'token')
    assert.equal(options?.allowDelete, undefined)
    writes++
    return patch(structuredClone(initial))
  } }
  const result = await updatePlanEdit(store, 'token', edit)
  assert.equal(writes, 1)
  assert.equal(result.routines.find(r => r.id === 'old').url, 'https://gym.areum.cl/#/plan/r/old')
  assert.equal(result.unit, 'lb')
  assert.equal(result.profile, undefined)
  assert.doesNotMatch(JSON.stringify(result), /(?:\"img\"|\"gif\"|base64|\/media\/)/i)
})
