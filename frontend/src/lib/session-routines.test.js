import { describe, expect, it } from 'vitest'
import { routineFromSession, saveSessionAsRoutine } from './session-routines.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { buildSessionEntries } from './session-start.js'
import { makeSideSet, setSideField, toggleSide, isWarmupRow } from './workout-model.js'

const row = (patch = {}) => ({ w: 40, r: 8, done: true, ...patch })
const entry = (id, target, sets, extra = {}) => ({ id, target, sets, ...extra })
const completeSides = set => toggleSide(toggleSide(set, 'L'), 'R')
const rebuild = cfg => buildSessionEntries(
  { unit: 'kg', workouts: [], exWeights: {}, routines: [] },
  { id: 'copied-routine', prog: 'off', ex: [cfg] },
)[0]

describe('routineFromSession', () => {
  it('saves a per-side timed hold with its planned sets, not one per side row (#322)', () => {
    const hold = side => ({ sec: 40, w: 0, side, done: true })
    const w = { id: 'w-hold', entries: [entry('plank', { mode: 'time', side: true, sets: 2, sec: 30 }, [hold('L'), hold('R'), hold('L'), hold('R')])] }
    const cfg = routineFromSession(w, 'Core').ex[0]
    expect(cfg).toMatchObject({ mode: 'time', side: true, sets: 2, sec: 40 })
    expect(rebuild(cfg).sets).toHaveLength(4)
  })

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

// A copy made from a planned session is a routine like any other: the plan owns its sets and reps
// (#275), and its first session continues from the logged one rather than restarting as an
// edited plan. Each case trains the source routine the way the app does (buildSessionEntries →
// buildCompletedWorkout), copies the saved workout and opens the copy.
describe('a routine saved from a planned session', () => {
  const BENCH = '0025'   // barbell bench press — loaded, 2.5 kg step
  const PUSHUP = '0662'  // push-up — body weight
  const work = e => e.sets.filter(s => !isWarmupRow(s))
  const stateOf = routines => ({ unit: 'kg', exWeights: {}, routines: structuredClone(routines), workouts: [], week: {}, dayPlan: {} })
  const train = (st, routine, typed = {}) => {
    const entries = buildSessionEntries(st, routine).map(e => ({ ...e, rid: routine.id,
      sets: e.sets.map(s => ({ ...s, ...(isWarmupRow(s) ? {} : typed), done: true })) }))
    const n = st.workouts.length + 1
    const saved = buildCompletedWorkout({ id: 'w' + n, d: `2026-09-${String(n).padStart(2, '0')}`, start: n * 1000, routineIds: [routine.id], name: routine.name, entries }, { end: n * 1000 + 1 })
    st.workouts.push(saved)
    return saved
  }
  const open = (st, routine) => buildSessionEntries(st, routine)[0]

  it('keeps a double-progression range and its rule, not the reps of the day', () => {
    const source = { id: 'A', name: 'Push', prog: 'double', ex: [{ id: BENCH, sets: 3, reps: 12, repsMin: 8, weight: 60 }] }
    const st = stateOf([source])
    const saved = train(st, source, { r: 9 })
    const id = saveSessionAsRoutine(st, saved)
    const copy = st.routines.find(r => r.id === id)
    expect(copy.ex[0]).toMatchObject({ sets: 3, reps: 12, repsMin: 8, weight: 60, prog: 'double' })
    // The copy picks up where the source stands: the same aim the source itself opens at next.
    const next = open(st, copy)
    expect(next.plan.why[0]).not.toBe('Plan changed, so starting from your new target.')
    expect(work(next).map(s => [s.w, s.r])).toEqual(work(open(st, source)).map(s => [s.w, s.r]))
  })

  it('takes the planned set count, not a set the bodyweight ceiling added or a bonus set', () => {
    const source = { id: 'B', name: 'Body', ex: [{ id: PUSHUP, sets: 2, reps: 10, repsMax: 10, weight: 0, bodyweight: true }] }
    const st = stateOf([source])
    train(st, source, { r: 10 })
    const saved = train(st, source, { r: 10 })   // the ceiling added a third set
    expect(work(saved.entries[0])).toHaveLength(3)
    const copy = routineFromSession(saved, 'Copy', st.routines)
    expect(copy.ex[0]).toMatchObject({ sets: 2, reps: 10 })

    const bonus = { ...saved, entries: [{ ...saved.entries[0], sets: [...saved.entries[0].sets, { w: 0, r: 12, done: true }] }] }
    expect(routineFromSession(bonus, 'Copy', st.routines).ex[0].sets).toBe(2)
  })

  it('takes the planned reps when the session started from last time\'s', () => {
    const source = { id: 'C', name: 'Legs', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 100 }] }
    const st = { ...stateOf([source]), startFrom: 'last' }
    train(st, source, { r: 8 })
    const saved = train(st, source)   // opened at last time's 8, not the plan's 5
    expect(work(saved.entries[0]).map(s => s.r)).toEqual([8, 8])
    expect(routineFromSession(saved, 'Copy', st.routines).ex[0].reps).toBe(5)
  })

  it('carries none of the session\'s own stamps into the plan', () => {
    const source = { id: 'D', name: 'Pull', ex: [{ id: BENCH, sets: 2, reps: 8, weight: 50 }] }
    const st = stateOf([source])
    const saved = train(st, source)
    saved.entries[0].noProg = true
    saved.entries[0].target = { ...saved.entries[0].target, planned: { sets: 9 }, rid: 'D', carried: true }
    const cfg = routineFromSession(saved, 'Copy', st.routines).ex[0]
    for (const key of ['planned', 'plan', 'carried', 'rid', 'noProg', 'muscleSnapshot']) expect(cfg).not.toHaveProperty(key)
    expect(cfg).toMatchObject({ id: BENCH, sets: 2, reps: 8 })
  })

  it('leaves the rule to the default when the source routine is gone', () => {
    const source = { id: 'E', name: 'Gone', prog: 'double', ex: [{ id: BENCH, sets: 3, reps: 12, repsMin: 8, weight: 60 }] }
    const st = stateOf([source])
    const saved = train(st, source, { r: 9 })
    expect(routineFromSession(saved, 'Copy', []).ex[0]).not.toHaveProperty('prog')
  })
})
