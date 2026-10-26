import { describe, expect, it } from 'vitest'
import { cleanBackups, withBackups, MAX_BACKUPS, backupSlotConfig } from './routine-backups.js'
import { replaceSlotExercise } from './routines.js'
import { parsePlan, buildPlanBundle } from './plan-share.js'
import { ruleOccurrence } from './test-fixtures.js'

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
