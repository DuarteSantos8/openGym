import { describe, expect, it } from 'vitest'
import { cleanBackups, withBackups, MAX_BACKUPS } from './routine-backups.js'
import { backupSessionConfig } from './active-exercise-swap.js'
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

describe('plan files', () => {
  const S = ex => ({ unit: 'kg', week: {}, customEx: [{ id: 'cu1', n: 'mine', bp: 'back', custom: true }], routines: [{ id: 'r', name: 'R', ex: [ex] }] })
  const roundTrip = ex => parsePlan(JSON.stringify(buildPlanBundle(S(ex), 'Plan'))).routines[0].ex[0]
  it('carry the catalogue backups, not someone\'s own exercises, and nothing when there are none', () => {
    expect(roundTrip({ id: '0025', sets: 3, reps: 8, subs: ['0047', 'cu1', 'nope', '0025'] }).subs).toEqual(['0047'])
    expect('subs' in roundTrip({ id: '0025', sets: 3, reps: 8 })).toBe(false)
  })
})

describe('a backup taking the slot mid-session (#649)', () => {
  const S = { unit: 'kg', workouts: [] }
  const entry = {
    id: '0025', rid: 'r',
    target: { id: '0025', sets: 3, reps: 10, repsMin: 8, weight: 80, restSec: 150, warmupSets: 2, prog: 'double', inc: 2.5, subs: ['0047', '0289'], dbLoad: 'each', rowReps: [10, 10, 10], backoffStep: 2.5 },
    planned: { sets: 3, reps: 12, repsMin: 8 },
    sets: [{ w: 80, r: 10, done: false }],
  }
  it('opens at the slot\'s plan, not at today\'s moved target, and without the session\'s stamps', () => {
    const cfg = backupSessionConfig(entry, '0047', S)
    expect(cfg.id).toBe('0047')
    expect([cfg.sets, cfg.reps, cfg.repsMin, cfg.restSec, cfg.warmupSets, cfg.prog, cfg.inc]).toEqual([3, 12, 8, 150, 2, 'double', 2.5])
    for (const key of ['dbLoad', 'rowReps', 'backoffStep']) expect(key in cfg).toBe(false)
  })
  it('the exercise leaving the slot becomes the first backup of the one taking it', () => {
    expect(backupSessionConfig(entry, '0047', S).subs).toEqual(['0025', '0289'])
    // Swapping back the same way: the backup now stands behind the original again.
    const incline = { ...entry, id: '0047', target: { ...entry.target, id: '0047', subs: ['0025', '0289'] } }
    expect(backupSessionConfig(incline, '0025', S).subs).toEqual(['0047', '0289'])
    // Five backups already: the list stays within MAX_BACKUPS.
    const full = { ...entry, target: { ...entry.target, subs: ['1', '2', '3', '4', '5'] } }
    expect(backupSessionConfig(full, '3', S).subs).toEqual(['0025', '1', '2', '4', '5'])
  })
  it('the weight is the backup\'s own where it was logged in this routine (replaceSlotExercise)', () => {
    const logged = { ...S, workouts: [{ id: 'w', d: '2026-09-20', routineIds: ['r'], entries: [{ id: '0047', rid: 'r', target: { sets: 3, reps: 12, weight: 30 }, sets: [{ w: 30, r: 12, done: true }] }] }] }
    expect(backupSessionConfig(entry, '0047', logged).weight).toBe(30)
    // Never logged: the slot's weight, there being nothing better to start from.
    expect(backupSessionConfig(entry, '0047', S).weight).toBe(80)
  })
  it('an entry without a plan stamp or a routine still comes out as a config for the backup', () => {
    const bare = { id: '0025', target: { sets: 2, reps: 8, weight: 60, subs: ['0047'] }, sets: [] }
    const cfg = backupSessionConfig(bare, '0047', S)
    expect([cfg.id, cfg.sets, cfg.reps, cfg.subs]).toEqual(['0047', 2, 8, ['0025']])
  })
})
