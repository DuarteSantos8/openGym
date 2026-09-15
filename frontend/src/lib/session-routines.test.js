import { describe, expect, it } from 'vitest'
import { routineFromSession, saveSessionAsRoutine } from './session-routines.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { buildSessionEntries } from './session-start.js'
import { makeSideSet, setSideField, toggleSide } from './workout-model.js'

const row = (patch = {}) => ({ w: 40, r: 8, done: true, ...patch })
const entry = (id, target, sets, extra = {}) => ({ id, target, sets, ...extra })
const completeSides = set => toggleSide(toggleSide(set, 'L'), 'R')
const rebuild = cfg => buildSessionEntries(
  { unit: 'kg', workouts: [], exWeights: {}, routines: [] },
  { id: 'copied-routine', prog: 'off', ex: [cfg] },
)[0]

describe('routineFromSession', () => {
  it('copies the saved setup and derives current reps, weight, warm-ups, and per-side state', () => {
    const session = {
      name: 'Evening push',
      entries: [entry('bench', {
        id: 'stale', mode: 'reps', sets: 9, reps: 6, weight: 35, side: true,
        bodyweight: true, inc: 2.5, note: 'controlled', sg: 'source-group'
      }, [
        row({ phase: 'warmup', w: 20, r: 8 }),
        row({ w: 40, r: 8 }),
        row({ w: 45, r: 10 })
      ])]
    }

    const routine = routineFromSession(session)
    expect(routine.name).toBe('Evening push')
    expect(routine.ex).toEqual([expect.objectContaining({
      id: 'bench', sets: 2, warmupSets: 1, reps: 10, weight: 45,
      mode: 'reps', side: true, bodyweight: true, inc: 2.5, note: 'controlled'
    })])
    expect(routine.ex[0].id).toBe('bench')
    expect(routine.ex[0].sg).toBeUndefined() // one item is not a superset
  })

  it('keeps repeated occurrences and remaps adjacent groups within the new copy', () => {
    const session = {
      name: 'Repeated work',
      entries: [
        entry('a', { reps: 5, sg: 'target-group' }, [row({ r: 5 })]),
        entry('a', { reps: 7, sg: 'target-group' }, [row({ r: 7 })]),
        entry('b', { reps: 9 }, [row({ r: 9 })]),
        entry('c', { reps: 11, sg: 'target-group' }, [row({ r: 11 })]),
        entry('d', { reps: 12, sg: 'target-group' }, [row({ r: 12 })]),
        entry('e', { reps: 13 }, [row({ r: 13 })], { sg: 'entry-group' }),
      ]
    }

    const ex = routineFromSession(session).ex
    expect(ex.map(e => e.id)).toEqual(['a', 'a', 'b', 'c', 'd', 'e'])
    expect(ex[0].sg).toBeTruthy()
    expect(ex[0].sg).toBe(ex[1].sg)
    expect(ex[0].sg).not.toBe('target-group')
    expect(ex[3].sg).toBeTruthy()
    expect(ex[3].sg).toBe(ex[4].sg)
    expect(ex[3].sg).not.toBe(ex[0].sg)
    expect(ex[5].sg).toBeUndefined()
  })

  it('uses entry scalar group ids when present and supports timed and cardio targets', () => {
    const session = {
      entries: [
        entry('hold', { mode: 'time', sec: 20, weight: 5, sg: 'target-group' }, [
          row({ phase: 'warmup', sec: 10, w: 0 }),
          row({ sec: 35, w: 7 })
        ], { sg: 'entry-group' }),
        entry('run', { mode: 'cardio', min: 15, speed: 7, sg: 'target-group' }, [row({ min: 22, speed: 9 })], { sg: 'entry-group' }),
      ]
    }

    const [hold, run] = routineFromSession(session).ex
    expect(hold).toMatchObject({ mode: 'time', sec: 35, weight: 7, sets: 1, warmupSets: 1 })
    expect(run).toMatchObject({ mode: 'cardio', min: 22, speed: 9, sets: 1, warmupSets: 0 })
    expect(hold.sg).toBe(run.sg)
    expect(hold.sg).not.toBe('entry-group')
  })

  it('round-trips a real bilateral per-side row as a flat total, not 16 per side', () => {
    const logged = completeSides(makeSideSet({ w: 20, r: 16 })) // 8 + 8, aggregate r is 16
    const saved = buildCompletedWorkout({
      id: 'workout-1', d: '2026-09-14', start: 1,
      entries: [entry('0025', { id: '0025', mode: 'reps', side: true, reps: 16, weight: 20 }, [logged])],
    })

    expect(saved.entries[0].sets[0]).toMatchObject({ r: 16, done: true })
    expect(saved.entries[0].sets[0].sides).toMatchObject({ L: { r: 8, done: true }, R: { r: 8, done: true } })

    const cfg = routineFromSession(saved).ex[0]
    expect(cfg).toMatchObject({ side: true, reps: 16, weight: 20 })
    const rebuilt = rebuild(cfg)
    expect(rebuilt.sets[0].sides.L.r).toBe(8)
    expect(rebuilt.sets[0].sides.R.r).toBe(8)
  })

  it('uses only fully completed work for values and makes asymmetric sides representable', () => {
    let asymmetric = setSideField(makeSideSet({ w: 20, r: 16 }), 'R', 'r', 7)
    asymmetric = setSideField(asymmetric, 'R', 'w', 22.5)
    asymmetric = completeSides(asymmetric) // logged 8 + 7; a flat routine cannot encode that split
    const savedAsymmetric = buildCompletedWorkout({
      id: 'workout-2', entries: [entry('0025', { mode: 'reps', side: true, reps: 16, weight: 20 }, [asymmetric])],
    })
    const cfg = routineFromSession(savedAsymmetric).ex[0]
    expect(cfg).toMatchObject({ reps: 16, weight: 22.5 }) // nearest even total; exact 8/7 and 20/22.5 are not claimed
    expect(rebuild(cfg).sets[0].sides).toMatchObject({ L: { w: 22.5, r: 8 }, R: { w: 22.5, r: 8 } })

    const complete = completeSides(makeSideSet({ w: 20, r: 16 }))
    let partial = makeSideSet({ w: 30, r: 12 })
    partial = toggleSide(partial, 'L') // retained in the saved boundary, but not a completed row
    const savedPartial = buildCompletedWorkout({
      id: 'workout-3', entries: [entry('0025', { mode: 'reps', side: true, reps: 16, weight: 20 }, [complete, partial])],
    })
    const partialCfg = routineFromSession(savedPartial).ex[0]
    expect(partialCfg).toMatchObject({ sets: 2, reps: 16, weight: 20 })
    expect(rebuild(partialCfg).sets.map(set => [set.sides.L.w, set.sides.L.r])).toEqual([[20, 8], [20, 8]])
  })

  it('rejects a saved session with no exercise setup', () => {
    expect(() => routineFromSession({ name: 'Empty', entries: [] })).toThrow('no exercises')
  })
})

describe('saveSessionAsRoutine', () => {
  it('adds an independent routine without mutating the saved workout', () => {
    const session = { id: 'w', name: 'Push', entries: [entry('bench', { reps: 5 }, [row({ r: 5 })])] }
    const before = structuredClone(session)
    const state = { routines: [] }
    const id = saveSessionAsRoutine(state, session)

    expect(id).toBe(state.routines[0].id)
    expect(state.routines[0].name).toBe('Push')
    state.routines[0].ex[0].reps = 99
    expect(session).toEqual(before)
  })
})
