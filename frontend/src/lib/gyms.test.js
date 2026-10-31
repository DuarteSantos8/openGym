import { describe, it, expect } from 'vitest'
import { gymsOf, gymOf, gymNameOf, gymHistory, carriedFromOtherGym, cleanGymName, withGym, renamedGym, MAX_GYMS, GYM_NAME_MAX } from './gyms.js'
import { lastEntryFor } from './history.js'

const done = (w, r = 8) => ({ w, r, done: true })
const workout = (d, gym, exId, sets) => ({ d, start: 1, ...(gym ? { gym } : {}), entries: [{ id: exId, sets }] })

describe('gym helpers', () => {
  it('reads the gym from the running session or the pending start', () => {
    expect(gymOf({ active: { gym: 'a' } })).toBe('a')
    expect(gymOf({ pendingGym: 'b' })).toBe('b')
    expect(gymOf({ active: {} })).toBe(null)
    expect(gymOf(null)).toBe(null)
  })

  it('ignores malformed gym entries', () => {
    expect(gymsOf({ gyms: [{ id: 'a', name: 'Basic-Fit' }, null, { id: '', name: 'x' }, { id: 'b', name: '  ' }, { name: 'no id' }] })).toEqual([{ id: 'a', name: 'Basic-Fit' }])
    expect(gymsOf({})).toEqual([])
    expect(gymNameOf({ gyms: [{ id: 'a', name: 'Basic-Fit' }] }, 'a')).toBe('Basic-Fit')
    expect(gymNameOf({ gyms: [] }, 'a')).toBe(null)
  })

  it('cleans, de-duplicates and caps names', () => {
    expect(cleanGymName('  Basic   Fit \n')).toBe('Basic Fit')
    expect(cleanGymName('x'.repeat(100))).toHaveLength(GYM_NAME_MAX)
    expect(withGym([], '   ', 'n')).toBe(null)
    expect(withGym([], 'Gigafit', 'g')).toEqual({ gyms: [{ id: 'g', name: 'Gigafit' }], id: 'g' })
    const list = [{ id: 'g', name: 'Gigafit' }]
    expect(withGym(list, 'gigafit', 'z')).toEqual({ gyms: list, id: 'g' })
    const full = Array.from({ length: MAX_GYMS }, (_, i) => ({ id: 'g' + i, name: 'Gym ' + i }))
    expect(withGym(full, 'One more', 'z')).toBe(null)
  })

  it('renames a gym unless the name is empty or taken', () => {
    const list = [{ id: 'a', name: 'Basic-Fit' }, { id: 'b', name: 'Gigafit' }]
    expect(renamedGym(list, 'a', 'Basic-Fit Dijon')).toEqual([{ id: 'a', name: 'Basic-Fit Dijon' }, { id: 'b', name: 'Gigafit' }])
    expect(renamedGym(list, 'a', 'gigafit')).toBe(null)
    expect(renamedGym(list, 'a', ' ')).toBe(null)
    // Changing only the case of its own name is a rename, not a clash with itself.
    expect(renamedGym(list, 'a', 'basic-fit')[0].name).toBe('basic-fit')
  })
})

describe('gymHistory', () => {
  const S = {
    workouts: [
      workout('2026-10-01', 'bf', 'bench', [done(20)]),
      workout('2026-10-08', 'giga', 'bench', [done(50)]),
      workout('2026-10-15', 'bf', 'bench', [done(22.5)]),
      workout('2026-10-20', 'giga', 'squat', [done(80)]),
    ],
  }

  it('is the log itself with no gym', () => {
    expect(gymHistory(S, 'bench', null)).toBe(S)
    expect(gymHistory(S, 'bench')).toBe(S)
  })

  it('reads last time from the same gym, not the most recent session anywhere', () => {
    expect(lastEntryFor(S, 'bench').sets[0].w).toBe(22.5)
    expect(lastEntryFor(gymHistory(S, 'bench', 'giga'), 'bench').sets[0].w).toBe(50)
    expect(lastEntryFor(gymHistory(S, 'bench', 'bf'), 'bench').sets[0].w).toBe(22.5)
  })

  it('takes the active session gym when none is given', () => {
    const view = gymHistory({ ...S, active: { gym: 'giga' } }, 'bench')
    expect(lastEntryFor(view, 'bench').sets[0].w).toBe(50)
  })

  it('falls back to the whole log for an exercise never done in that gym', () => {
    // Squat was only ever done at the Gigafit: a first visit to Basic-Fit starts from that.
    expect(gymHistory(S, 'squat', 'bf')).toBe(S)
    expect(lastEntryFor(gymHistory(S, 'squat', 'bf'), 'squat').sets[0].w).toBe(80)
  })

  it('does not count sessions saved before gyms existed as being in a gym', () => {
    const old = { workouts: [workout('2026-09-01', null, 'bench', [done(40)]), workout('2026-10-01', 'bf', 'bench', [done(20)])] }
    expect(lastEntryFor(gymHistory(old, 'bench', 'bf'), 'bench').sets[0].w).toBe(20)
    // A gym with no history of the exercise reads the old, gym-less sessions too.
    expect(gymHistory(old, 'bench', 'giga')).toBe(old)
  })

  it('does not count planned rows that were never ticked', () => {
    const S2 = { workouts: [workout('2026-10-01', 'giga', 'bench', [{ w: 99, r: 8, done: false }]), workout('2026-10-02', 'bf', 'bench', [done(20)])] }
    expect(gymHistory(S2, 'bench', 'giga')).toBe(S2)
  })

  it('never mutates the state it reads', () => {
    const before = JSON.stringify(S)
    gymHistory(S, 'bench', 'giga')
    expect(JSON.stringify(S)).toBe(before)
  })
})

describe('carriedFromOtherGym', () => {
  const S = { workouts: [workout('2026-10-01', 'giga', 'bench', [done(50)])] }
  it('is true when the exercise has history but none in this gym', () => {
    expect(carriedFromOtherGym(S, 'bench', 'bf')).toBe(true)
    expect(carriedFromOtherGym(S, 'bench', 'giga')).toBe(false)
  })
  it('is false with no gym or no history at all', () => {
    expect(carriedFromOtherGym(S, 'bench', null)).toBe(false)
    expect(carriedFromOtherGym(S, 'squat', 'bf')).toBe(false)
  })
})
