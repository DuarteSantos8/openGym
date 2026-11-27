import { describe, expect, it } from 'vitest'
import { plannedSetTarget, plannedWeeklySets } from './weekly-sets.js'

const push = { id: 'push', ex: [{ id: 'press', sets: 3, warmupSets: 1 }, { id: 'fly', sets: 2 }] }
const arms = { id: 'arms', ex: [{ id: 'curl', sets: 3 }, { id: 'press', sets: 1 }] }
const reserve = { id: 'reserve', ex: [{ id: 'fly', sets: 20 }] }
const plan = {
  routines: [push, arms, reserve],
  customEx: [
    { id: 'press', primaries: ['chest'], secondaries: ['triceps'] },
    { id: 'fly', primaries: ['chest'] },
    { id: 'curl', primaries: ['biceps'] },
  ],
  week: { 1: ['push'], 2: [], 3: 'arms', 5: ['push', 'missing'] },
  dayPlan: { '2026-11-23': ['reserve'] },
}
const counts = state => Object.fromEntries(plannedWeeklySets(state).map(row => [row.slug, row.sets]))

describe('routine builder weekly sets', () => {
  it('counts the three-day recurring plan, excludes warm-ups and dated overrides, and leaves the plan unchanged', () => {
    const state = structuredClone(plan)
    expect(counts(state)).toEqual({ chest: 11, triceps: 2.8, biceps: 3 })
    expect(state).toEqual(plan)
  })

  it('counts a floating plan once per session alongside other weekday routines', () => {
    expect(counts({ ...plan, queue: { ids: ['push', 'push'], since: 0, startsOn: '2026-11-23' } }))
      .toEqual({ chest: 6, triceps: 1.6, biceps: 3 })
  })

  it('has no rows when no working sets are scheduled, even with a growth goal', () => {
    const quiz = { goal: 'muscle' }
    expect(plannedWeeklySets({ ...plan, quiz, week: {} })).toEqual([])
    expect(plannedWeeklySets({ ...plan, quiz, routines: [] })).toEqual([])
  })

  it.each(['muscle', 'general', 'strength', 'fatloss', 'mobility', undefined])('prefers a valid personal target for goal %s', goal => {
    const state = { quiz: { goal }, muscleTargets: { chest: [3, 5], deltoids: [2, 7] } }
    expect(plannedSetTarget(state, 'chest')).toEqual({ range: [3, 5], source: 'personal' })
    expect(plannedSetTarget(state, 'rear-delts')).toEqual({ range: [2, 7], source: 'personal' })
  })

  it('uses draft defaults only with the saved muscle-growth goal, even after an invalid personal range', () => {
    const broken = { muscleTargets: { chest: [8, 3] } }
    expect(plannedSetTarget({ ...broken, quiz: { goal: 'muscle' } }, 'chest'))
      .toEqual({ range: [10, 20], source: 'default' })
    for (const goal of ['general', 'strength', 'fatloss', 'mobility', 'unknown', undefined]) {
      expect(plannedSetTarget({ ...broken, quiz: { goal } }, 'chest')).toBeNull()
    }
    expect(plannedSetTarget({ goal: 'muscle' }, 'chest')).toBeNull()
    expect(plannedSetTarget({ muscleTargets: { chest: [null, true] } }, 'chest')).toBeNull()
  })
})
