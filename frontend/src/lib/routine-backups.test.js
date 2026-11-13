import { describe, expect, it } from 'vitest'
import { cleanBackups, cleanBackupConfigs, withBackups, MAX_BACKUPS, backupSlotConfig } from './routine-backups.js'
import { replaceSlotExercise } from './routines.js'
import { parsePlan, buildPlanBundle } from './plan-share.js'

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
  const slot = { id: '0025', sets: 4, reps: 6, repsMin: 5, weight: 80, restSec: 150, warmupSets: 2, prog: 'double', note: 'Pause', subs: ['0047', '0289'] }
  it('keeps the slot\'s plan, and the exercise it replaces becomes the first backup', () => {
    const out = backupSlotConfig(slot, '0047', { workouts: [] }, 'r')
    expect(out).toMatchObject({ id: '0047', sets: 4, reps: 6, repsMin: 5, restSec: 150, warmupSets: 2, prog: 'double', note: 'Pause' })
    expect(out.subs).toEqual(['0025', '0289'])
    // And back again: the bench is free.
    expect(backupSlotConfig(out, '0025', { workouts: [] }, 'r').subs).toEqual(['0047', '0289'])
  })
  it('never more than five, and never an exercise that is gone', () => {
    const full = { ...slot, subs: ['0047', '1', '2', '3', '4'] }
    expect(backupSlotConfig(full, '0047', { workouts: [] }, 'r').subs).toEqual(['0025', '1', '2', '3', '4'])
    expect(backupSlotConfig({ ...slot, subs: ['0047', 'gone'] }, '0047', { workouts: [] }, 'r', id => id !== 'gone').subs).toEqual(['0025'])
  })
  it('opens a backup at its own last weight in this routine, not the bench\'s 80', () => {
    const S = { workouts: [{ id: 'w', d: '2026-10-01', start: 1, entries: [{ id: '0047', rid: 'r', target: { mode: 'reps', sets: 3, reps: 8, weight: 30 }, sets: [{ w: 30, r: 8, done: true }] }] }] }
    expect(backupSlotConfig(slot, '0047', S, 'r').weight).toBe(30)
  })
})

describe('plan files', () => {
  const S = ex => ({ unit: 'kg', week: {}, customEx: [{ id: 'cu1', n: 'mine', bp: 'back', custom: true }], routines: [{ id: 'r', name: 'R', ex: [ex] }] })
  const roundTrip = ex => parsePlan(JSON.stringify(buildPlanBundle(S(ex), 'Plan'))).routines[0].ex[0]
  it('carry the catalogue backups, not someone\'s own exercises, and nothing when there are none', () => {
    expect(roundTrip({ id: '0025', sets: 3, reps: 8, subs: ['0047', 'cu1', 'nope', '0025'] }).subs).toEqual(['0047'])
    expect('subs' in roundTrip({ id: '0025', sets: 3, reps: 8 })).toBe(false)
  })
})

// #978: a backup in a routine could only be listed, never given its own weight, reps or rule.
describe('a backup with its own plan (#978)', () => {
  const slot = {
    id: '0025', sets: 4, reps: 6, weight: 80, prog: 'double', sg: 'g1', sgName: 'Push',
    subs: ['0047', '0289'],
    subCfg: { '0047': { sets: 3, reps: 12, weight: 24, prog: 'linear', inc: 2, restSec: 90 } },
  }
  it('opens at that plan when it takes the slot, in the slot\'s superset', () => {
    const out = backupSlotConfig(slot, '0047', { workouts: [] }, 'r')
    expect(out).toMatchObject({ id: '0047', sets: 3, reps: 12, weight: 24, prog: 'linear', inc: 2, restSec: 90, sg: 'g1', sgName: 'Push' })
  })
  it('the exercise it replaces keeps its plan, so swapping back restores it', () => {
    const out = backupSlotConfig(slot, '0047', { workouts: [] }, 'r')
    expect(out.subs).toEqual(['0025', '0289'])
    expect(out.subCfg['0025']).toMatchObject({ sets: 4, reps: 6, weight: 80, prog: 'double' })
    expect(out.subCfg['0047']).toBeUndefined()
    const back = backupSlotConfig(out, '0025', { workouts: [] }, 'r')
    expect(back).toMatchObject({ id: '0025', sets: 4, reps: 6, weight: 80, prog: 'double' })
    expect(back.subCfg['0047']).toMatchObject({ sets: 3, reps: 12, weight: 24 })
  })
  it('one without a plan still takes the slot\'s', () => {
    expect(backupSlotConfig(slot, '0289', { workouts: [] }, 'r')).toMatchObject({ id: '0289', sets: 4, reps: 6, prog: 'double' })
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
    const S = { unit: 'kg', week: {}, customEx: [], routines: [{ id: 'r', name: 'R', ex: [{ id: '0025', sets: 3, reps: 8, subs: ['0047'], subCfg: { '0047': { sets: 3, reps: 8 } } }] }] }
    const bundle = buildPlanBundle(S, 'Plan')
    bundle.routines[0].ex[0].subCfg = { '0047': { sets: 99, reps: 1 } }
    expect('subCfg' in parsePlan(JSON.stringify(bundle)).routines[0].ex[0]).toBe(false)
  })
})
