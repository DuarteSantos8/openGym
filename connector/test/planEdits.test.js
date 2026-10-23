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
// Stands in for profileStore: runs the patch once per state (each later state is a 409 refetch)
// and records every state the patch produced, i.e. everything that would have been PUT.
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
  const store = fakeStore(base())
  const profile = base()
  const before = structuredClone(profile)
  assert.throws(() => proposeWeek(profile, { routines: [{ id: 'old', ex: [] }], week: {} }), /invalid/i)
  assert.throws(() => proposeWeek(profile, { routines: [{ name: 'New', ex: [{ id: '1045', sets: 1 }] }], week: { 2: [] } }), /invalid/i)
  assert.throws(() => applyPlanEdit(profile, { type: 'week', unit: 'lb', routines: [{ id: 'old', name: 'Old', ex: [], isNew: false }], week: {} }), /invalid/i)
  assert.throws(() => applyPlanEdit(profile, { type: 'week', unit: 'lb', routines: [], week: { 1: [] } }), /invalid/i)
  assert.deepEqual(profile, before)
  await assert.rejects(() => updatePlanEdit(store, 'token', { routines: [{ id: 'old', ex: [] }], week: {} }), /invalid/i)
  await assert.rejects(() => updatePlanEdit(store, 'token', { routines: [{ id: 'old', ex: [{ id: exId }] }], week: { 1: [] } }), /invalid/i)
  assert.equal(store.produced.length, 0)
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
  const store = fakeStore(s)
  const answered = await updatePlanEdit(store, 'bearer', request())
  assert.ok(answered instanceof PlanChoiceRequiredError)
  assert.deepEqual(answered.queue, choice.queue)
  assert.deepEqual(answered.week, choice.week)
  assert.equal(store.produced.length, 0)
  // A queue that appears only after a 409 stops the retry; nothing is produced for that state.
  const late = fakeStore(base(), s)
  assert.ok(await updatePlanEdit(late, 'bearer', request()) instanceof PlanChoiceRequiredError)
  assert.equal(late.produced.length, 1)
  assert.throws(() => applyPlanEdit(s, proposeWeek(base(), request())), PlanChoiceRequiredError)
})

test('updateProfile patch returns complete idempotent profile without deletion options', async () => {
  const store = fakeStore(base())
  const result = await updatePlanEdit(store, 'token', request())
  assert.equal(store.produced.length, 1)
  assert.equal(store.produced[0].routines.length, 2)
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
  await assert.rejects(() => updatePlanEdit(store, 'secret-bearer-token', request()), e => {
    assert.equal(e.profile, undefined)
    assert.equal(e.cause, undefined)
    const text = [e.message, e.stack, e.name, JSON.stringify(e)].join('\n')
    assert.doesNotMatch(text, /secret-routine|secret-bearer|\/media\/|planted|base64/i)
    assert.match(e.message, /conflict/i)
    return true
  })
})

test('exercise-only request keeps a routine renamed before the 409 retry', async () => {
  const phone = base()
  phone.routines[0].name = 'Phone'
  const store = fakeStore(base(), phone)
  const result = await updatePlanEdit(store, 'token', { routines: [{ id: 'old', ex: [{ id: exId, weight: 120 }] }], week: {} })
  assert.equal(store.produced.length, 2)
  assert.equal(store.produced[0].routines[0].name, 'Old')
  assert.equal(store.produced[1].routines[0].name, 'Phone')
  assert.equal(store.produced[1].routines[0].ex[0].weight, 120)
  assert.equal(result.routines[0].name, 'Phone')
  // An explicit rename in the request still wins on every attempt.
  const named = await updatePlanEdit(fakeStore(base(), phone), 'token', { routines: [{ id: 'old', name: 'Chosen', ex: [{ id: exId, weight: 120 }] }], week: {} })
  assert.equal(named.routines[0].name, 'Chosen')
})

test('updatePlanEdit takes a request, never a prebuilt edit that could force a rename or skip a patch', async () => {
  const store = fakeStore(base())
  const edit = proposeWeek(base(), { routines: [{ id: 'old', ex: [{ id: exId, weight: 120 }] }], week: {} })
  await assert.rejects(() => updatePlanEdit(store, 'token', edit), /invalid/i)
  await assert.rejects(() => updatePlanEdit(store, 'token', { type: 'week', unit: 'lb', routines: [{ id: 'old', name: 'Forced', ex: [{ id: exId }], isNew: true }], week: {} }), /invalid/i)
  assert.equal(store.produced.length, 0)
})

test('a unit change between attempts rejects instead of saving the old numbers', async () => {
  const kg = { ...base(), unit: 'kg' }
  const store = fakeStore(base(), kg)
  await assert.rejects(() => updatePlanEdit(store, 'token', { routines: [{ id: 'old', ex: [{ id: exId, weight: 120 }] }], week: {} }), /unit/i)
  assert.equal(store.produced.length, 1)
  assert.equal(store.produced[0].unit, 'lb')
})
