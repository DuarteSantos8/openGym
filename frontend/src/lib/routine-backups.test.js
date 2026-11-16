import { describe, expect, it } from 'vitest'
import { cleanBackups, cleanBackupConfigs, withBackups, MAX_BACKUPS, backupSlotConfig } from './routine-backups.js'
import { replaceSlotExercise } from './routines.js'
import { parsePlan, buildPlanBundle } from './plan-share.js'
import { ruleOccurrence } from './test-fixtures.js'
import { planPhase } from './prescription/index.js'

/* Planned substitutes for an exercise in a routine (Discord): an optional list on the entry. */
describe('cleanBackups', () => {
  it('unique string ids, never the exercise itself, only known ones, at most five', () => {
    expect(cleanBackups(['a', 'b', 'a', 'self', 3, '', null, 'c'], 'self')).toEqual(['a', 'b', 'c'])
    expect(cleanBackups(['a', 'gone'], 'x', id => id !== 'gone')).toEqual(['a'])
    expect(cleanBackups(['1', '2', '3', '4', '5', '6', '7'], 'x')).toHaveLength(MAX_BACKUPS)
    expect(cleanBackups('a', 'x')).toEqual([])
  })
  it('no list, no field', () => {
    expect(withBackups([], 'x')).toEqual({})
    expect(withBackups(undefined, 'x')).toEqual({})
    expect(withBackups(['a'], 'x')).toEqual({ subs: ['a'] })
  })
})

describe('a replaced exercise', () => {
  it('keeps the slot\'s backups, less the one now in the slot', () => {
    const slot = { id: '0025', sets: 3, reps: 8, weight: 60, subs: ['0047', '0289'] }
    expect(replaceSlotExercise(slot, '0047', { workouts: [] }, 'r').subs).toEqual(['0289'])
    expect('subs' in replaceSlotExercise({ ...slot, subs: ['0047'] }, '0047', { workouts: [] }, 'r')).toBe(false)
  })
})

describe('a backup taking the slot in one tap (#649)', () => {
  const slot = { ...ruleOccurrence('0025', { routineId: 'r' }), note: 'Pause', subs: ['0047', '0289'] }
  it('keeps the slot\'s plan, and the exercise it replaces becomes the first backup', () => {
    const out = backupSlotConfig(slot, '0047', { workouts: [], unit: 'kg' }, 'r')
    expect(out).toMatchObject({ exerciseId: '0047', note: 'Pause' })
    expect(out.rule.exerciseId).toBe('0047')
    expect(out.subs).toEqual(['0025', '0289'])
    // And back again: the bench is free.
    expect(backupSlotConfig(out, '0025', { workouts: [], unit: 'kg' }, 'r').subs).toEqual(['0047', '0289'])
  })
  it('never more than five, and never an exercise that is gone', () => {
    const S = { workouts: [], unit: 'kg' }
    const full = { ...slot, subs: ['0047', '1', '2', '3', '4'] }
    expect(backupSlotConfig(full, '0047', S, 'r').subs).toEqual(['0025', '1', '2', '3', '4'])
    expect(backupSlotConfig({ ...slot, subs: ['0047', 'gone'] }, '0047', S, 'r', id => id !== 'gone').subs).toEqual(['0025'])
  })
})

describe('plan files', () => {
  const S = ex => ({ unit: 'kg', week: {}, customEx: [{ id: 'cu1', n: 'mine', bp: 'back', custom: true }], routines: [{ id: 'r', name: 'R', ex: [ex] }] })
  const roundTrip = ex => parsePlan(JSON.stringify(buildPlanBundle(S(ex), 'Plan'))).routines[0].ex[0]
  it('carry the catalogue backups, not someone\'s own exercises, and nothing when there are none', () => {
    expect(roundTrip({ ...ruleOccurrence('0025'), subs: ['0047', 'cu1', 'nope', '0025'] }).subs).toEqual(['0047'])
    expect('subs' in roundTrip(ruleOccurrence('0025'))).toBe(false)
  })
})

// #978: a backup in a routine could only be listed, never given its own weight, reps or rule.
// v2: the slot is a rule occurrence, and a backup's own plan an occurrence without who it is.
describe('a backup with its own plan (#978)', () => {
  const abs = value => ({ mode: 'absolute', value, unit: 'kg' })
  const plan = (id, preset, options) => { const { occurrenceId: _o, exerciseId: _e, ...rest } = ruleOccurrence(id, { preset, routineId: 'r', options }); return rest }
  const slot = {
    ...ruleOccurrence('0025', { preset: 'double', routineId: 'r', options: { sets: { min: 4, max: 4 }, reps: { min: 6, max: 6 }, load: abs(80) } }),
    sg: 'g1', sgName: 'Push', subs: ['0047', '0289'],
    subCfg: { '0047': { ...plan('0047', 'linear', { reps: { min: 12, max: 12 }, load: abs(24) }), restSec: 90 } },
  }
  const load = o => planPhase(o.rule).parameters.load.value
  it('opens at that plan when it takes the slot, in the slot\'s superset', () => {
    const out = backupSlotConfig(slot, '0047', { workouts: [] }, 'r')
    expect(out).toMatchObject({ exerciseId: '0047', restSec: 90, sg: 'g1', sgName: 'Push' })
    expect(out.rule).toMatchObject({ preset: 'linear', exerciseId: '0047', id: out.occurrenceId })
    expect(load(out)).toBe(24)
  })
  it('the exercise it replaces keeps its plan, so swapping back restores it', () => {
    const out = backupSlotConfig(slot, '0047', { workouts: [] }, 'r')
    expect(out.subs).toEqual(['0025', '0289'])
    expect(out.subCfg['0025'].rule.preset).toBe('double')
    expect(out.subCfg['0047']).toBeUndefined()
    const back = backupSlotConfig(out, '0025', { workouts: [] }, 'r')
    expect(back).toMatchObject({ exerciseId: '0025' })
    expect(back.rule.preset).toBe('double')
    expect(load(back)).toBe(80)
    expect(back.subCfg['0047'].rule.preset).toBe('linear')
  })
  it('one without a plan still takes the slot\'s', () => {
    const out = backupSlotConfig(slot, '0289', { workouts: [] }, 'r')
    expect(out.exerciseId).toBe('0289')
    expect(out.rule.preset).toBe('double')
  })
  it('is saved only for backups still listed, and never with an id, backups or a superset of its own', () => {
    expect(withBackups(['0047'], '0025', undefined, { '0047': { id: 'x', sets: 3, reps: 8, subs: ['y'], sg: 'z' }, '0289': { sets: 2, reps: 5 } }))
      .toEqual({ subs: ['0047'], subCfg: { '0047': { sets: 3, reps: 8 } } })
    expect(withBackups(['0047'], '0025', undefined, { '0047': 'junk' })).toEqual({ subs: ['0047'] })
    expect(cleanBackupConfigs({ '0047': { reps: 8 } }, ['0047'])).toEqual({})
  })
  it('a replaced exercise drops the plan of the backup that now fills the slot', () => {
    const out = replaceSlotExercise(slot, '0047', { workouts: [] }, 'r')
    expect(out.subs).toEqual(['0289'])
    expect('subCfg' in out).toBe(false)
  })
  it('plan files do not take a backup plan from someone else\'s file', () => {
    const S = { unit: 'kg', week: {}, customEx: [], routines: [{ id: 'r', name: 'R', ex: [{ ...ruleOccurrence('0025', { routineId: 'r' }), subs: ['0047'], subCfg: { '0047': plan('0047', 'linear', {}) } }] }] }
    const bundle = buildPlanBundle(S, 'Plan')
    bundle.routines[0].ex[0].subCfg = { '0047': { sets: 99, reps: 1 } }
    expect('subCfg' in parsePlan(JSON.stringify(bundle)).routines[0].ex[0]).toBe(false)
  })
})
