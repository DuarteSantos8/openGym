import { describe, it, expect } from 'vitest'
import { migrateRotationToWeek, loopOf } from './week-migrate.js'

const routines = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase(), ex: [] }))
const base = extra => ({ routines: routines.map(r => ({ ...r })), week: {}, workouts: [], ...extra })

describe('migrateRotationToWeek', () => {
  it('leaves a profile with no loop alone', () => {
    const S = base({ week: { 1: ['a'] } })
    const before = JSON.stringify(S)
    expect(migrateRotationToWeek(S)).toBe(false)
    expect(JSON.stringify(S)).toBe(before)
  })

  it('lays the loop on the week from Monday, a rest leaving its day empty', () => {
    const S = base({ rotation: { id: 'r', sequence: ['a', 'rest', 'b', 'c'] }, scheduleMode: 'rotation' })
    expect(migrateRotationToWeek(S)).toBe(true)
    expect(S.week).toEqual({ 1: ['a'], 3: ['b'], 4: ['c'] })
    expect(S.rotation).toBeUndefined()
    expect(S.scheduleMode).toBeUndefined()
  })

  it('starts on Sunday when the week does', () => {
    const S = base({ weekStart: 0, rotation: { id: 'r', sequence: ['a', 'b'] } })
    migrateRotationToWeek(S)
    expect(S.week).toEqual({ 0: ['a'], 1: ['b'] })
  })

  it('drops the managed pass and keeps every routine', () => {
    const S = base({
      rotation: { id: 'r', sequence: ['a', 'b'] },
      queue: { ids: ['a', 'b'], since: 1, startsOn: '2026-01-01', rotationId: 'r' },
    })
    migrateRotationToWeek(S)
    expect(S.queue).toBeNull()
    expect(S.routines.map(r => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reads a managed pass that has no saved loop beside it', () => {
    const S = base({ queue: { ids: ['c', 'd'], since: 1, startsOn: '2026-01-01', rotationId: 'x' } })
    expect(loopOf(S)).toEqual(['c', 'd'])
    migrateRotationToWeek(S)
    expect(S.week).toEqual({ 1: ['c'], 2: ['d'] })
    expect(S.queue).toBeNull()
  })

  it('leaves a coach or planner week (no rotationId) in place', () => {
    const queue = { ids: ['a', 'b'], since: 1, startsOn: '2026-01-01' }
    const S = base({ rotation: { id: 'r', sequence: ['c'] }, queue })
    migrateRotationToWeek(S)
    expect(S.queue).toBe(queue)
    expect(S.rotation).toBeUndefined()
  })

  it('only fills the empty days of a week that already has sessions', () => {
    const S = base({ week: { 1: ['d'], 2: ['a'] }, rotation: { id: 'r', sequence: ['a', 'b', 'c'] } })
    migrateRotationToWeek(S)
    // a is already on Tuesday; b and c take the next empty days, Wednesday and Thursday
    expect(S.week).toEqual({ 1: ['d'], 2: ['a'], 3: ['b'], 4: ['c'] })
  })

  it('cuts a loop longer than a week at seven days', () => {
    const many = Array.from({ length: 9 }, (_, i) => 'r' + i)
    const S = { routines: many.map(id => ({ id, name: id, ex: [] })), week: {}, rotation: { id: 'r', sequence: many } }
    migrateRotationToWeek(S)
    expect(Object.keys(S.week)).toHaveLength(7)
    expect(S.routines).toHaveLength(9)
  })

  it('ignores routines that no longer exist', () => {
    const S = base({ rotation: { id: 'r', sequence: ['gone', 'a'] } })
    migrateRotationToWeek(S)
    expect(S.week).toEqual({ 1: ['a'] })
  })

  it('is idempotent and never touches the logged workouts', () => {
    const workouts = [{ id: 'w1', d: '2026-01-02', ex: [] }]
    const S = base({ workouts, rotation: { id: 'r', sequence: ['a', 'b'] } })
    migrateRotationToWeek(S)
    const once = JSON.stringify(S)
    expect(migrateRotationToWeek(S)).toBe(false)
    expect(JSON.stringify(S)).toBe(once)
    expect(S.workouts).toBe(workouts)
  })
})
