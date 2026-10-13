import { describe, expect, it } from 'vitest'
import { isExtra, plannedExerciseCount, sessionPlanSummary } from './session-extras.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { swapActiveExercise } from './active-exercise-swap.js'
import { workoutVolume } from './history.js'

const set = (w, r, done = true) => ({ w, r, done })
const planned = (id, sets) => ({ id, rid: 'tue', target: { sets: 3, reps: 10 }, sets })
const extra = (id, sets) => ({ ...planned(id, sets), extra: true })

// Tuesday: four planned exercises, all done, then two more added in the session.
const active = {
  id: 'w1', d: '2026-10-13', start: 1, name: 'Tuesday', routineIds: ['tue'], cur: 0,
  entries: [
    planned('hipthrust', [set(100, 10), set(100, 10), set(100, 10)]),
    planned('rdl', [set(80, 10), set(80, 10), set(80, 10)]),
    planned('legcurl', [set(40, 12), set(40, 12), set(40, 12)]),
    planned('abductor', [set(50, 15), set(50, 15), set(50, 15)]),
    extra('legext', [set(45, 12), set(45, 12), set(45, 12)]),
    extra('calf', [set(60, 15), set(60, 15)]),
  ],
}

describe('extra exercises in a session', () => {
  it('keeps the mark when the session is finished, and counts the plan apart', () => {
    const w = buildCompletedWorkout(active, { end: 2 })
    expect(w.entries.filter(isExtra).map(e => e.id)).toEqual(['legext', 'calf'])
    expect(w.planEx).toBe(4)
    expect(sessionPlanSummary(w)).toEqual({ planned: 4, plannedDone: 4, extra: 2, plannedSets: 12, extraSets: 5, totalSets: 17, totalDone: 6 })
  })

  it('counts extra work in the volume like any other work', () => {
    const w = buildCompletedWorkout(active, { end: 2 })
    const withoutExtras = workoutVolume({ entries: w.entries.filter(e => !isExtra(e)) })
    expect(workoutVolume(w)).toBe(withoutExtras + 45 * 12 * 3 + 60 * 15 * 2)
  })

  it('a planned exercise left undone still counts as planned', () => {
    const a = { ...active, entries: [...active.entries.slice(0, 3), planned('abductor', [set(50, 15, false)]), active.entries[4]] }
    const w = buildCompletedWorkout(a, { end: 2 })
    expect(w.entries.map(e => e.id)).not.toContain('abductor')
    expect(sessionPlanSummary(w)).toMatchObject({ planned: 4, plannedDone: 3, extra: 1 })
  })

  it('an ordinary session keeps exactly its old shape', () => {
    const a = { ...active, entries: active.entries.slice(0, 4) }
    const w = buildCompletedWorkout(a, { end: 2 })
    expect('planEx' in w).toBe(false)
    expect(w.entries.some(e => 'extra' in e)).toBe(false)
    expect(plannedExerciseCount(a.entries, w.entries)).toBeNull()
    expect(sessionPlanSummary(w)).toMatchObject({ planned: 4, plannedDone: 4, extra: 0, extraSets: 0 })
  })

  it('a freestyle session has no plan and nothing extra', () => {
    const w = { entries: [{ id: 'a', sets: [set(10, 10)] }] }
    expect(sessionPlanSummary(w)).toMatchObject({ planned: 0, plannedDone: 0, extra: 0, totalDone: 1 })
  })

  it('an extra stays an extra when it is swapped for another exercise', () => {
    const a = JSON.parse(JSON.stringify(active))
    const r = swapActiveExercise(a, 4, { id: 'legpress', target: { sets: 3, reps: 10 }, sets: [set(0, 10, false)] }, { loggedConfirmed: true })
    expect(r.inserted).toBe(true)
    expect(a.entries.find(e => e.id === 'legpress').extra).toBe(true)
  })
})
