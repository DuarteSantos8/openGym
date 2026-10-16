// The week strip's dot for a day (lib/training-day.js dayMark): trained, excused with a note, a
// changed plan, the plan, nothing. The day's kinds are covered through Home and the Training hub.
import { describe, expect, it } from 'vitest'
import { workoutDay } from './history.js'
import { dayMark, trainingDay, workoutsByDay } from './training-day.js'

const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', THU = '2026-10-15', FRI = '2026-10-16'
const S = over => ({
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025' }] }],
  week: { 1: ['r1'], 3: ['r1'] }, dayPlan: {}, workouts: [], dayNotes: {}, queue: null, ...over,
})

describe('dayMark', () => {
  it('reads each day the way the calendar does', () => {
    const state = S({
      workouts: [{ id: 'w', d: MON, start: 1, end: 2, routineIds: ['r1'] }],
      dayPlan: { [FRI]: 'r1' },
      dayNotes: { [TUE]: { tag: 'sick', text: '', t: 1 } },
    })
    expect(dayMark(state, MON)).toBe('done')
    expect(dayMark(state, TUE)).toBe('noted')
    expect(dayMark(state, WED)).toBe('plan')
    expect(dayMark(state, THU)).toBeUndefined()
    expect(dayMark(state, FRI)).toBe('ovr')
  })

  it('a planned day set to rest has no dot', () => {
    expect(dayMark(S({ dayPlan: { [WED]: 'rest' } }), WED)).toBeUndefined()
  })
})

describe('workoutsByDay', () => {
  const at = iso => new Date(iso + 'T10:00:00').getTime()
  const w = (id, d, extra = {}) => ({ id, d, start: at(d), end: at(d) + 3600000, ...extra })

  it('reads each workout once per workouts array, however many days are asked about', () => {
    let reads = 0
    const counted = id => Object.defineProperty(w(id, MON), 'd', { get() { reads++; return MON }, enumerable: true })
    const workouts = [counted('a'), counted('b'), counted('c')]
    const state = S({ workouts })
    for (let i = 0; i < 9; i++) dayMark(state, MON)
    trainingDay(state, MON, THU)
    expect(reads).toBe(workouts.length)
    // A changed history is a new array (the store clones S), so it is read again.
    dayMark({ ...state, workouts: [...workouts] }, MON)
    expect(reads).toBe(workouts.length * 2)
  })

  it('answers as the per-workout scan did: same days, same order, nothing for a day without one', () => {
    const workouts = [w('a', MON), w('b', TUE), w('c', MON, { d: undefined }), w('d', MON), { id: 'x', d: 'nope', start: at(WED) }]
    const state = S({ workouts })
    const old = iso => workouts.filter(x => workoutDay(x) === iso)
    for (const iso of [MON, TUE, WED, THU]) {
      expect(workoutsByDay(workouts).get(iso) ?? []).toEqual(old(iso))
      expect(dayMark(state, iso) === 'done').toBe(old(iso).length > 0)
    }
    expect(trainingDay(state, MON, THU)).toMatchObject({ kind: 'past-logged', workouts: old(MON) })
    expect(trainingDay(state, WED, THU).kind).toBe('past-logged')
  })
})
