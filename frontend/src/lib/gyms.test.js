import { describe, it, expect } from 'vitest'
import { gymsOf, gymNameOf, entryGym, defaultGymFor, gymHistory, cleanGymName, withGym, renamedGym, MAX_GYMS, GYM_NAME_MAX } from './gyms.js'
import { lastEntryFor } from './history.js'

const done = (w, r = 8) => ({ w, r, done: true })
const entry = (exId, sets, gym) => ({ id: exId, sets, ...(gym ? { gym } : {}) })
const workout = (d, entries, gym) => ({ d, start: 1, ...(gym ? { gym } : {}), entries })
const LIST = [{ id: 'bf', name: 'Basic-Fit' }, { id: 'tg', name: 'Technogym' }]

describe('machine list helpers', () => {
  it('ignores malformed entries', () => {
    expect(gymsOf({ gyms: [{ id: 'a', name: 'Basic-Fit' }, null, { id: '', name: 'x' }, { id: 'b', name: '  ' }, { name: 'no id' }] })).toEqual([{ id: 'a', name: 'Basic-Fit' }])
    expect(gymsOf({})).toEqual([])
    expect(gymNameOf({ gyms: LIST }, 'bf')).toBe('Basic-Fit')
    expect(gymNameOf({ gyms: [] }, 'bf')).toBe(null)
    expect(gymNameOf({ gyms: LIST }, null)).toBe(null)
  })

  it('cleans, de-duplicates and caps names', () => {
    expect(cleanGymName('  Basic   Fit \n')).toBe('Basic Fit')
    expect(cleanGymName('x'.repeat(100))).toHaveLength(GYM_NAME_MAX)
    expect(withGym([], '   ', 'n')).toBe(null)
    expect(withGym([], 'Technogym', 'g')).toEqual({ gyms: [{ id: 'g', name: 'Technogym' }], id: 'g' })
    const list = [{ id: 'g', name: 'Technogym' }]
    expect(withGym(list, 'technogym', 'z')).toEqual({ gyms: list, id: 'g' })
    const full = Array.from({ length: MAX_GYMS }, (_, i) => ({ id: 'g' + i, name: 'M ' + i }))
    expect(withGym(full, 'One more', 'z')).toBe(null)
  })

  it('renames a machine unless the name is empty or taken', () => {
    expect(renamedGym(LIST, 'bf', 'Basic-Fit Dijon')).toEqual([{ id: 'bf', name: 'Basic-Fit Dijon' }, LIST[1]])
    expect(renamedGym(LIST, 'bf', 'technogym')).toBe(null)
    expect(renamedGym(LIST, 'bf', ' ')).toBe(null)
    // Changing only the case of its own name is a rename, not a clash with itself.
    expect(renamedGym(LIST, 'bf', 'basic-fit')[0].name).toBe('basic-fit')
  })
})

describe('entryGym', () => {
  it('is the entry\'s own machine, else the one its whole workout was tagged with', () => {
    expect(entryGym({ gym: 'tg' }, { gym: 'bf' })).toBe('bf')
    expect(entryGym({ gym: 'tg' }, {})).toBe('tg')
    expect(entryGym({}, {})).toBe(null)
  })
})

describe('gymHistory', () => {
  const S = {
    gyms: LIST,
    workouts: [
      workout('2026-10-01', [entry('bench', [done(20)], 'bf')]),
      workout('2026-10-08', [entry('bench', [done(50)], 'tg')]),
      workout('2026-10-15', [entry('bench', [done(22.5)], 'bf')]),
      workout('2026-10-20', [entry('squat', [done(80)], 'tg')]),
    ],
  }

  it('is the log itself with no machine', () => {
    expect(gymHistory(S, 'bench', null)).toBe(S)
    expect(gymHistory(S, 'bench', undefined)).toBe(S)
  })

  it('reads last time from the same machine, not the most recent session anywhere', () => {
    expect(lastEntryFor(S, 'bench').sets[0].w).toBe(22.5)
    expect(lastEntryFor(gymHistory(S, 'bench', 'tg'), 'bench').sets[0].w).toBe(50)
    expect(lastEntryFor(gymHistory(S, 'bench', 'bf'), 'bench').sets[0].w).toBe(22.5)
  })

  it('falls back to the whole log for an exercise never done on that machine', () => {
    // Squat was only ever done on the Technogym: a first time on the Basic-Fit one starts from that.
    expect(gymHistory(S, 'squat', 'bf')).toBe(S)
    expect(lastEntryFor(gymHistory(S, 'squat', 'bf'), 'squat').sets[0].w).toBe(80)
  })

  it('does not count entries saved before machines existed as being on one', () => {
    const old = { workouts: [workout('2026-09-01', [entry('bench', [done(40)])]), workout('2026-10-01', [entry('bench', [done(20)], 'bf')])] }
    expect(lastEntryFor(gymHistory(old, 'bench', 'bf'), 'bench').sets[0].w).toBe(20)
    expect(gymHistory(old, 'bench', 'tg')).toBe(old)
  })

  it('reads a whole-workout tag from the first version as the machine of its exercises', () => {
    const old = { workouts: [workout('2026-10-01', [entry('bench', [done(50)])], 'tg'), workout('2026-10-02', [entry('bench', [done(20)])], 'bf')] }
    expect(lastEntryFor(gymHistory(old, 'bench', 'tg'), 'bench').sets[0].w).toBe(50)
  })

  it('does not count planned rows that were never ticked', () => {
    const S2 = { workouts: [workout('2026-10-01', [entry('bench', [{ w: 99, r: 8, done: false }], 'tg')]), workout('2026-10-02', [entry('bench', [done(20)], 'bf')])] }
    expect(gymHistory(S2, 'bench', 'tg')).toBe(S2)
  })

  it('keeps the same exercise on another machine out of the view, even in one workout', () => {
    const S3 = { workouts: [workout('2026-10-01', [entry('bench', [done(50)], 'tg'), entry('bench', [done(20)], 'bf')])] }
    expect(lastEntryFor(gymHistory(S3, 'bench', 'bf'), 'bench').sets[0].w).toBe(20)
    expect(lastEntryFor(gymHistory(S3, 'bench', 'tg'), 'bench').sets[0].w).toBe(50)
  })

  it('never mutates the state it reads', () => {
    const before = JSON.stringify(S)
    gymHistory(S, 'bench', 'tg')
    expect(JSON.stringify(S)).toBe(before)
  })
})

describe('defaultGymFor', () => {
  const base = [
    workout('2026-10-01', [entry('bench', [done(50)], 'tg')]),
    workout('2026-10-08', [entry('bench', [done(20)], 'bf')]),
  ]

  it('is the machine the exercise was last done on', () => {
    expect(defaultGymFor({ gyms: LIST, workouts: base }, 'bench')).toBe('bf')
  })

  it('is null for an exercise with no machine in its history', () => {
    expect(defaultGymFor({ gyms: LIST, workouts: base }, 'squat')).toBe(null)
    expect(defaultGymFor({ gyms: LIST, workouts: [workout('2026-10-01', [entry('bench', [done(50)])])] }, 'bench')).toBe(null)
  })

  it('is null when no machine is listed, or when the last one was deleted from the list', () => {
    expect(defaultGymFor({ workouts: base }, 'bench')).toBe(null)
    expect(defaultGymFor({ gyms: [LIST[1]], workouts: base }, 'bench')).toBe(null)
  })

  it('skips rows that were never ticked', () => {
    const w = [...base, workout('2026-10-09', [entry('bench', [{ w: 99, r: 8, done: false }], 'tg')])]
    expect(defaultGymFor({ gyms: LIST, workouts: w }, 'bench')).toBe('bf')
  })
})
