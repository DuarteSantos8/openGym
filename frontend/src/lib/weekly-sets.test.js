import { describe, expect, it } from 'vitest'
import { defaultCircuit, roundsPerStation, setCircuit, stationsOf, stepAt, stepCount } from './circuit.js'
import { modeOf } from './history.js'
import { loadOfWeeklyPlan } from './muscles.js'
import { buildSessionEntries } from './session-start.js'
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

// Like the editor, give every station enough rows for the longest EMOM rotation.
function timedRoutine(slots, cfg) {
  const ex = slots.map(slot => ({ ...slot, sg: 'clock', sets: roundsPerStation(cfg, slots.length) }))
  setCircuit(ex, 'clock', cfg)
  return { id: 'timed', excludeFromProgression: true, ex }
}
const scheduled = routine => ({ unit: 'kg', workouts: [], routines: [routine], customEx: plan.customEx, week: { 1: [routine.id] } })

describe('routine builder weekly sets', () => {
  it.each(['intervals', 'runwalk'])('does not credit running secondary muscles in %s', type => {
    const routine = timedRoutine([{ id: '0685' }], defaultCircuit(type))
    const state = scheduled(routine)
    const [entry] = buildSessionEntries(state, routine)
    expect(modeOf(entry.target)).toBe('cardio')
    expect(loadOfWeeklyPlan(state).calves).toBeGreaterThan(0) // existing Stats map behavior
    expect(counts(state)).toEqual({})
  })

  it.each([
    [2, [0, 1], { chest: 1, biceps: 1, triceps: 0.4 }],
    [4, [0, 1, 2, 0], { chest: 3, biceps: 1, triceps: 0.8 }],
  ])('counts only the stations reached in a %i-step EMOM', (count, visited, expected) => {
    const cfg = { mode: 'emom', every: 60, count }
    const routine = timedRoutine([{ id: 'press', reps: 8 }, { id: 'curl', reps: 8 }, { id: 'fly', reps: 8 }], cfg)
    const state = scheduled(routine)
    const entries = buildSessionEntries(state, routine)
    expect(entries.map(entry => entry.sets.length)).toEqual(Array(3).fill(Math.ceil(count / 3)))
    const stations = stationsOf(entries, [0, 1, 2], modeOf)
    const steps = Array.from({ length: stepCount(cfg, stations.length) - 1 }, (_, i) => stepAt(cfg, stations, i + 1).m)
    expect(steps).toEqual(visited)
    expect(counts(state)).toEqual(expected)
  })

  it('keeps cardio in EMOM rotation order without crediting it, and counts timed strength work', () => {
    const routine = timedRoutine([
      { id: '0685' }, { id: 'press', mode: 'time', sec: 20 }, { id: 'curl', reps: 8 },
    ], { mode: 'emom', every: 60, count: 2 })
    expect(counts(scheduled(routine))).toEqual({ chest: 1, triceps: 0.4 })
  })

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

  it('falls back to saved Coach intake only when the plan quiz goal is absent', () => {
    const state = { coach: { profile: { goal: 'muscle' } } }
    expect(plannedSetTarget(state, 'chest')).toEqual({ range: [10, 20], source: 'default' })
    expect(plannedSetTarget({ ...state, quiz: { goal: 'strength' } }, 'chest')).toBeNull()
    expect(plannedSetTarget({ ...state, muscleTargets: { chest: [4, 6] } }, 'chest'))
      .toEqual({ range: [4, 6], source: 'personal' })
    expect(plannedSetTarget({ coach: { profile: { goal: 'endurance' } } }, 'chest')).toBeNull()
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
