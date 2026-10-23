import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proposeWeek, applyPlanEdit, updatePlanEdit, PlanChoiceRequiredError } from '../src/planEdits.js'
import { ProfileConflictError } from '../src/profileStore.js'
import { CATALOGUE, EXIDX, registerCustom } from '../../frontend/src/lib/exercises.js'

const exId = '1045'
assert.ok(CATALOGUE.some(e => e.id === exId))
assert.ok(CATALOGUE.some(e => e.id === '0025'))
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
  assert.equal(next.routines[0].ex[0].sets, 4)
  assert.equal(next.routines[0].ex[0].note, 'keep?')
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
  const edit = proposeWeek(profile, { routines: [{ name: 'Fresh', ex: [{ id: 'my-ex', sets: 2, weight: 20 }] }], week: {} })
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

test('existing routine merges by exercise id; concurrent extra exercise remains', () => {
  const profile = base()
  profile.routines[0].ex = [
    { id: '1045', sets: 3, reps: 5, weight: 100, note: 'keep?' },
    { id: '0025', sets: 2, reps: 8, weight: 50, note: 'row' },
  ]
  const edit = proposeWeek(profile, { routines: [{ id: 'old', ex: [{ id: '1045', weight: 120 }] }], week: {} })
  const next = applyPlanEdit(profile, edit)
  assert.equal(next.routines[0].ex.length, 2)
  assert.equal(next.routines[0].ex[0].weight, 120)
  assert.equal(next.routines[0].ex[0].sets, 3)
  assert.equal(next.routines[0].ex[0].note, 'keep?')
  assert.deepEqual(next.routines[0].ex[1], profile.routines[0].ex[1])
  const concurrent = structuredClone(profile)
  concurrent.routines[0].ex.push({ id: '1060', sets: 1, weight: 10 })
  const after409 = applyPlanEdit(concurrent, edit)
  assert.equal(after409.routines[0].ex[0].weight, 120)
  assert.equal(after409.routines[0].ex[1].id, '0025')
  assert.equal(after409.routines[0].ex[2].id, '1060')
  assert.equal(after409.routines[0].ex[2].weight, 10)
  assert.throws(() => proposeWeek(profile, { routines: [{ id: 'old', ex: [{ id: '1045' }, { id: '1045' }] }], week: {} }), /duplicate/i)
})

test('exercise-only edit keeps concurrent rename; explicit rename wins', () => {
  const profile = base()
  const edit = proposeWeek(profile, { routines: [{ id: 'old', ex: [{ id: '1045', weight: 120 }] }], week: {} })
  assert.equal(Object.hasOwn(edit.routines[0], 'name'), false)
  const phone = structuredClone(profile)
  phone.routines[0].name = 'Phone'
  const next = applyPlanEdit(phone, edit)
  assert.equal(next.routines[0].name, 'Phone')
  assert.equal(next.routines[0].ex[0].weight, 120)
  const named = proposeWeek(profile, { routines: [{ id: 'old', name: 'New name', ex: [{ id: '1045', weight: 120 }] }], week: {} })
  assert.equal(applyPlanEdit(phone, named).routines[0].name, 'New name')
})

test('duplicate existing exercise slots reject before mutation', () => {
  const edit = proposeWeek(base(), { routines: [{ id: 'old', ex: [{ id: '1045', weight: 60 }] }], week: {} })
  const dup = base()
  dup.routines[0].ex = [
    { id: '1045', sets: 3, reps: 5, weight: 40 },
    { id: '1045', sets: 3, reps: 5, weight: 80 },
  ]
  const before = structuredClone(dup)
  assert.throws(() => applyPlanEdit(dup, edit), /duplicate/i)
  assert.deepEqual(dup, before)
})

test('empty exercise lists and empty weekdays are rejected without writing', async () => {
  let writes = 0
  const store = { updateProfile() { writes++; throw new Error('wrote') } }
  const profile = base()
  const before = structuredClone(profile)
  assert.throws(() => proposeWeek(profile, { routines: [{ id: 'old', ex: [] }], week: {} }), /invalid/i)
  assert.throws(() => proposeWeek(profile, { routines: [{ name: 'New', ex: [{ id: '1045', sets: 1 }] }], week: { 2: [] } }), /invalid/i)
  assert.throws(() => applyPlanEdit(profile, { type: 'week', unit: 'lb', routines: [{ id: 'old', name: 'Old', ex: [], isNew: false }], week: {} }), /invalid/i)
  assert.throws(() => applyPlanEdit(profile, { type: 'week', unit: 'lb', routines: [], week: { 1: [] } }), /invalid/i)
  assert.deepEqual(profile, before)
  assert.equal(writes, 0)
  await assert.rejects(() => updatePlanEdit(store, 'token', { type: 'week', unit: 'lb', routines: [{ id: 'old', name: 'Old', ex: [] }], week: {} }), /invalid/i)
  assert.equal(writes, 0)
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

test('foreign custom registered on EXIDX is unknown for this profile', () => {
  registerCustom([{ id: 'foreign-custom', n: 'Other user', eq: 'barbell' }])
  try {
    assert.equal(Object.hasOwn(EXIDX, 'foreign-custom'), true)
    assert.throws(() => proposeWeek(base(), { routines: [{ id: 'old', ex: [{ id: 'foreign-custom' }] }], week: {} }), /unknown exercise/i)
    assert.throws(() => proposeWeek(base(), { routines: [{ id: 'old', ex: [{ id: '__proto__' }] }], week: {} }), /unknown exercise/i)
    assert.equal(proposeWeek(base(), { routines: [{ id: 'old', ex: [{ id: 'my-ex' }] }], week: {} }).routines[0].ex[0].id, 'my-ex')
  } finally {
    registerCustom([])
  }
})

test('unit mismatch rejects before mutation', () => {
  const edit = proposeWeek(base(), request())
  const kg = { ...base(), unit: 'kg' }
  const before = structuredClone(kg)
  assert.throws(() => applyPlanEdit(kg, edit), /unit/i)
  assert.deepEqual(kg, before)
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
  assert.doesNotMatch(JSON.stringify(result), /(?:"img"|"gif"|base64|\/media\/)/i)
})

test('persistent conflict hides profile, bearer and media', async () => {
  const planted = {
    routines: [{ id: 'secret-routine', name: 'Do not leak' }],
    customEx: [{ id: 'x', img: '/media/planted.gif', gif: 'base64abc' }],
  }
  const store = { updateProfile: async () => { throw new ProfileConflictError(planted) } }
  await assert.rejects(() => updatePlanEdit(store, 'secret-bearer-token', proposeWeek(base(), request())), e => {
    assert.equal(e.profile, undefined)
    assert.equal(e.cause, undefined)
    const text = [e.message, e.stack, e.name, JSON.stringify(e)].join('\n')
    assert.doesNotMatch(text, /secret-routine|secret-bearer|\/media\/|planted|base64/i)
    assert.match(e.message, /conflict/i)
    return true
  })
})
