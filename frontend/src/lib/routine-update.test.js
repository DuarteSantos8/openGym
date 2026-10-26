import { describe, expect, it } from 'vitest'
import { editPlan, planPhase, withRest } from './prescription/index.js'
import { routineChangesFromEntry, routineSlotFor, updateRoutineFromEntry } from './routine-update.js'
import { ruleOccurrence } from './test-fixtures.js'

const BENCH = '0025'   // a barbell lift: a ramp can scale its load
const slotOf = (patch = {}) => {
  const occ = ruleOccurrence(BENCH, { occurrenceId: 'o1', routineId: 'r1', options: { load: { mode: 'absolute', value: 60, unit: 'kg' }, restSeconds: 120 } })
  return { ...occ, ...patch }
}
const routine = (slot = slotOf()) => ({ id: 'r1', name: 'Push', ex: [slot] })
const exposure = { exposureId: 'x1', exerciseId: BENCH, occurrenceId: 'o1' }
const warm = { w: 30, r: 8, done: false, phase: 'warmup' }
const entry = (over = {}) => ({ id: BENCH, exposureId: 'x1', rid: 'r1', routineWarmups: 0, target: { restSec: 120 }, sets: [{ w: 60, r: 5, done: false }], ...over })
const changes = (r, e) => routineChangesFromEntry(r, exposure, e, 90)?.changes

describe('routineChangesFromEntry', () => {
  it('is null while the session says what the routine says', () => {
    expect(changes(routine(), entry())).toBeUndefined()
  })
  it('names a warm-up added or taken away, against what the plan gave', () => {
    expect(changes(routine(), entry({ sets: [warm, { w: 60, r: 5, done: false }] }))).toEqual([{ key: 'warmupSets', from: 0, to: 1 }])
    expect(changes(routine(), entry({ routineWarmups: 2, sets: [warm, { w: 60, r: 5, done: false }] }))).toEqual([{ key: 'warmupSets', from: 2, to: 1 }])
  })
  it('caps a ramp at what a recipe can hold', () => {
    expect(changes(routine(), entry({ sets: [...Array(8).fill(warm), { w: 60, r: 5, done: false }] }))[0].to).toBe(5)   // a barbell ramp has five steps
  })
  it('leaves warm-ups alone where a ramp has no load to scale, under rest-pause, or when the plan\'s count is unknown', () => {
    const unloaded = slotOf(); unloaded.rule = editPlan(unloaded.rule, { load: { mode: 'empty' } })
    expect(changes(routine(unloaded), entry({ sets: [warm] }))).toBeUndefined()
    expect(changes(routine(), entry({ target: { restSec: 120, intensifier: { type: 'restpause' } }, sets: [warm] }))).toBeUndefined()
    expect(changes(routine(), entry({ routineWarmups: undefined, sets: [warm] }))).toBeUndefined()
  })
  it('compares rests as they would run: a missing one is the profile\'s', () => {
    expect(changes(routine(), entry({ target: { restSec: 150 } }))).toEqual([{ key: 'restSec', from: 120, to: 150 }])
    expect(changes(routine(slotOf({ restFromProfile: true })), entry({ target: { restSec: 90 } }))).toBeUndefined()
    expect(changes(routine(), entry({ target: { restSec: 0 } }))).toEqual([{ key: 'restSec', from: 120, to: 0 }])
  })
  it('names the settings-sheet note, never today\'s', () => {
    expect(changes(routine(), entry({ target: { restSec: 120, note: ' pause ' } }))).toEqual([{ key: 'note', from: '', to: 'pause' }])
    expect(changes(routine(), entry({ note: 'for today' }))).toBeUndefined()
    expect(changes(routine(slotOf({ note: 'old' })), entry())).toEqual([{ key: 'note', from: 'old', to: '' }])
  })
  it('is null for another routine\'s exercise, a slot that is gone, or a swapped exercise', () => {
    expect(changes(routine(), entry({ rid: 'other', target: { restSec: 150 } }))).toBeUndefined()
    expect(routineSlotFor({ id: 'r1', ex: [] }, exposure)).toBeNull()
    expect(routineSlotFor(routine(), { ...exposure, exerciseId: '0027' })).toBeNull()
  })
})

describe('updateRoutineFromEntry', () => {
  it('writes the changes into the slot and nothing else', () => {
    const r = routine()
    const before = structuredClone(r)
    updateRoutineFromEntry(r, { occurrenceId: 'o1', changes: [{ key: 'warmupSets', to: 2 }, { key: 'restSec', to: 150 }, { key: 'note', to: 'pause' }] })
    expect(r.ex[0]).toEqual({ ...before.ex[0], warmup: { mode: 'smart', count: 2 }, note: 'pause', rule: withRest(before.ex[0].rule, 150) })
  })
  it('takes keys back out, and hands a rest of 0 to the profile', () => {
    const r = routine(slotOf({ warmup: { mode: 'smart', count: 2 }, note: 'old' }))
    updateRoutineFromEntry(r, { occurrenceId: 'o1', changes: [{ key: 'warmupSets', to: 0 }, { key: 'note', to: '' }, { key: 'restSec', to: 0 }] })
    expect(r.ex[0].warmup).toBeUndefined()
    expect(r.ex[0].note).toBeUndefined()
    expect(r.ex[0].restFromProfile).toBe(true)
  })
  it('does nothing for a slot that is gone', () => {
    expect(updateRoutineFromEntry(routine(), { occurrenceId: 'gone', changes: [] })).toBeNull()
  })
})

describe('a rest kept from a session on a program of several phases', () => {
  it('sets every phase\'s rest and keeps the phases and their groups', () => {
    const occ = ruleOccurrence('0025', { preset: 'five_three_one', occurrenceId: 'o1', routineId: 'r1' })
    const r = { id: 'r1', name: 'Push', ex: [occ] }
    updateRoutineFromEntry(r, { occurrenceId: 'o1', changes: [{ key: 'restSec', to: 150 }] })
    expect(r.ex[0].rule.program.phases.map(ph => [ph.id, ph.parameters.restSeconds, ph.groups.length])).toEqual([['w1', 150, 3], ['w2', 150, 3], ['w3', 150, 3], ['w4', 150, 3]])
  })
})
