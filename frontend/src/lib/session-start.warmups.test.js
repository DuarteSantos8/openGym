import { describe, it, expect } from 'vitest'
import { buildPlannedEntry, buildSessionEntries } from './session-start.js'
import { isWarmupRow, syncSideAggregate } from './workout-model.js'

const BENCH = '0025'
const routineWith = cfg => ({ id: 'A', name: 'A', ex: [cfg] })
const cfg = extra => ({ id: BENCH, sets: 3, reps: 8, weight: 60, prog: 'linear', mode: 'reps', ...extra })
const state = (routine, sets = [], startFrom = 'last', extra = {}) => ({
  unit: 'kg', exWeights: {}, routines: [routine], startFrom, workouts: [], week: {}, dayPlan: {}, ...extra,
  ...(sets.length ? { workouts: [{
    id: 'prior', d: '2026-09-01', routineIds: [routine.id],
    entries: [{
      id: routine.ex[0].id, rid: routine.id,
      target: { sets: routine.ex[0].sets, reps: routine.ex[0].reps, sec: routine.ex[0].sec, weight: routine.ex[0].weight, mode: routine.ex[0].mode },
      planned: { sets: routine.ex[0].sets, reps: routine.ex[0].reps, sec: routine.ex[0].sec, weight: routine.ex[0].weight },
      sets,
    }],
  }] } : {}),
})
// A warm-up the lifter set up (typed, stepped or added by hand), the only kind that is carried.
const loggedWarmup = (w, r, extra = {}) => ({ w, r, done: true, phase: 'warmup', warmup: true, edited: true, ...extra })
// A rung the routine's ramp made and nobody touched.
const autoWarmup = (w, r, extra = {}) => ({ w, r, done: true, phase: 'warmup', warmup: true, ...extra })
const loggedWork = (w = 60, r = 8) => ({ w, r, done: true })
const entryFor = st => buildSessionEntries(st, st.routines[0])[0]
const plannedEntryFor = st => buildPlannedEntry(st, st.routines[0].ex[0], st.routines[0])
const warmups = entry => entry.sets.filter(isWarmupRow)
const work = entry => entry.sets.filter(set => !isWarmupRow(set))
const generatedWarmups = (st, build = entryFor) => warmups(build({ ...st, startFrom: 'plan' }))

describe('planned warm-ups carried from last session', () => {
  it('case 1: carries all logged reps warm-ups, in order, before work rows, reset for the new session', () => {
    const routine = routineWith(cfg())
    const st = state(routine, [
      loggedWarmup(20, 12), loggedWarmup(30, 8), loggedWarmup(40, 5),
      loggedWork(), loggedWork(), loggedWork(),
    ])
    const entry = entryFor(st)

    expect(warmups(entry).map(row => [row.w, row.r])).toEqual([[20, 12], [30, 8], [40, 5]])
    expect(warmups(entry).every(row => row.done === false && row.phase === 'warmup' && row.warmup === true)).toBe(true)
    expect(entry.sets.slice(3)).toEqual(work(entry))
    expect(work(entry)).toHaveLength(3)
  })

  it('case 2: keeps all carried rows when the routine asks for one warm-up', () => {
    const routine = routineWith(cfg({ warmupSets: 1 }))
    const st = state(routine, [loggedWarmup(20, 12), loggedWarmup(30, 8), loggedWarmup(40, 5), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toHaveLength(3)
  })

  it('case 3: leaves carried warm-ups unchanged when linear progression raises work weight', () => {
    const routine = routineWith(cfg({ warmupSets: 2 }))
    const st = state(routine, [loggedWarmup(20, 12), loggedWarmup(30, 8), loggedWarmup(40, 5), loggedWork(), loggedWork(), loggedWork()])
    const entry = entryFor(st)

    expect(work(entry).map(row => row.w)).toEqual([62.5, 62.5, 62.5])
    expect(warmups(entry).map(row => [row.w, row.r])).toEqual([[20, 12], [30, 8], [40, 5]])
  })

  it('case 4: does not carry completion, effort, tick time, drops, or clusters', () => {
    const routine = routineWith(cfg())
    const source = loggedWarmup(30, 8, { rir: 2, rpe: 8, effort: 7, at: 123, drops: [{ w: 20, r: 4 }], clusters: [{ r: 4 }] })
    const entry = entryFor(state(routine, [source, loggedWork(), loggedWork(), loggedWork()]))

    expect(warmups(entry)).toEqual([{ w: 30, r: 8, done: false, phase: 'warmup', warmup: true, edited: true }])
  })

  it('case 5: carries a warm-up even when it was not ticked last time', () => {
    const routine = routineWith(cfg())
    const entry = entryFor(state(routine, [loggedWarmup(25, 10, { done: false }), loggedWork(), loggedWork(), loggedWork()]))
    expect(warmups(entry).map(row => [row.w, row.r])).toEqual([[25, 10]])
  })

  it('case 6: uses the usual generated ramp when the last entry has no warm-ups', () => {
    const routine = routineWith(cfg({ warmupSets: 2 }))
    const st = state(routine, [loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toEqual(generatedWarmups(st))
    expect(warmups(entryFor(st))).toHaveLength(2)
    expect(warmups(entryFor(state(routine)))).toEqual(generatedWarmups(state(routine)))
  })

  it('case 7: leaves the generated ramp in place when setting is plan', () => {
    const routine = routineWith(cfg({ warmupSets: 2 }))
    const st = state(routine, [loggedWarmup(20, 12), loggedWarmup(30, 8), loggedWarmup(40, 5), loggedWork(), loggedWork(), loggedWork()], 'plan')
    expect(warmups(entryFor(st))).toEqual(generatedWarmups(st))
    expect(warmups(entryFor(st)).map(row => [row.w, row.r])).not.toEqual([[20, 12], [30, 8], [40, 5]])
  })

  it('case 8: carries both per-side loads and reps, resetting sides and aggregate', () => {
    const routine = routineWith(cfg({ side: true, warmupSets: 0 }))
    const sideRow = syncSideAggregate({
      phase: 'warmup', warmup: true, edited: true,
      sides: { L: { w: 10, r: 6, done: true }, R: { w: 12, r: 6, done: true } },
    })
    const entry = entryFor(state(routine, [sideRow, loggedWork(), loggedWork(), loggedWork()]))
    const [row] = warmups(entry)

    expect(row).toBeDefined()
    expect(row.sides).toEqual({ L: { w: 10, r: 6, done: false }, R: { w: 12, r: 6, done: false } })
    expect(row).toMatchObject({ w: 12, r: 12, done: false, phase: 'warmup', warmup: true })
  })

  it('case 9: carries the duration of a timed warm-up', () => {
    const routine = routineWith({ id: 'custom-hold', sets: 2, sec: 45, weight: 0, mode: 'time', warmupSets: 0 })
    const st = state(routine, [
      { sec: 20, w: 0, done: true, phase: 'warmup', warmup: true, edited: true },
      { sec: 45, w: 0, done: true }, { sec: 45, w: 0, done: true },
    ])
    expect(warmups(entryFor(st)).map(row => [row.sec, row.w])).toEqual([[20, 0]])
  })

  it('case 10: leaves progression-off warm-ups generated from the routine', () => {
    const routine = routineWith(cfg({ prog: 'off', warmupSets: 2 }))
    const st = state(routine, [loggedWarmup(22, 11), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toEqual(generatedWarmups(st))
  })

  it('case 11: leaves excluded-routine warm-ups generated from the routine', () => {
    const routine = { ...routineWith(cfg({ warmupSets: 2 })), excludeFromProgression: true }
    const st = state(routine, [loggedWarmup(22, 11), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toEqual(generatedWarmups(st))
  })

  it('case 12: falls back when logged warm-up rows do not match current exercise mode', () => {
    const routine = routineWith({ id: 'custom-hold', sets: 2, sec: 45, weight: 0, mode: 'time', warmupSets: 2 })
    const st = state(routine, [loggedWarmup(30, 8), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toEqual(generatedWarmups(st))

    const repsRoutine = routineWith(cfg({ warmupSets: 2 }))
    const noReps = state(repsRoutine, [{ w: 30, done: true, phase: 'warmup', warmup: true, edited: true }, loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(noReps))).toEqual(generatedWarmups(noReps))
  })

  it('buildPlannedEntry carries warm-ups through its public entry point too', () => {
    const routine = routineWith(cfg({ warmupSets: 0 }))
    const st = state(routine, [loggedWarmup(20, 12), loggedWarmup(30, 8), loggedWarmup(40, 5), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(plannedEntryFor(st)).map(row => [row.w, row.r])).toEqual([[20, 12], [30, 8], [40, 5]])
  })

  it('does not carry warm-ups for cardio or rest-pause exercises', () => {
    const cardioRoutine = routineWith({ id: 'custom-run', mode: 'cardio', sets: 1, min: 20, speed: 8, warmupSets: 2 })
    const cardioState = state(cardioRoutine, [loggedWarmup(20, 12), { min: 20, speed: 8, done: true }])
    expect(warmups(entryFor(cardioState))).toEqual(generatedWarmups(cardioState))

    const restPauseRoutine = routineWith(cfg({ warmupSets: 1, intensifier: { type: 'restpause', totalReps: 12 } }))
    const restPauseState = state(restPauseRoutine, [loggedWarmup(20, 12), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(restPauseState))).toEqual(generatedWarmups(restPauseState))
  })

  // The auto-ramp freeze: a block nobody set up is the routine's ramp, built again for today's
  // work weight, not last time's 50/75% copied forever while the work sets climb.
  it('builds an untouched automatic ramp again for the new work weight', () => {
    const routine = routineWith(cfg({ warmupSets: 2 }))
    // a ramp built for a 40 kg day, before the work sets went up to 60
    const st = state(routine, [autoWarmup(20, 8), autoWarmup(30, 8), loggedWork(), loggedWork(), loggedWork()])
    const entry = entryFor(st)
    expect(work(entry).map(row => row.w)).toEqual([62.5, 62.5, 62.5])
    expect(warmups(entry)).toEqual(generatedWarmups(st))
    expect(warmups(entry).map(row => row.w)).toEqual([30, 45])
    expect(warmups(entry).some(row => row.edited)).toBe(false)
  })

  it('follows the routine warm-up count when last time was all automatic', () => {
    const routine = routineWith(cfg({ warmupSets: 1 }))
    const st = state(routine, [autoWarmup(30, 8), autoWarmup(45, 8), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toHaveLength(1)
  })

  it('reads warm-ups saved before the mark as automatic', () => {
    const routine = routineWith(cfg({ warmupSets: 2 }))
    const st = state(routine, [autoWarmup(30, 8, { done: false }), autoWarmup(45, 8), loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(st))).toEqual(generatedWarmups(st))
  })

  it('keeps the rows you set by hand and ramps the automatic ones in between', () => {
    const routine = routineWith(cfg({ warmupSets: 0 }))
    // last time: an empty-bar set typed by hand, then an automatic rung
    const st = state(routine, [loggedWarmup(20, 15), autoWarmup(40, 8), loggedWork(), loggedWork(), loggedWork()])
    const entry = entryFor(st)
    const [first, second] = warmups(entry)
    expect(warmups(entry)).toHaveLength(2)
    expect([first.w, first.r, first.edited]).toEqual([20, 15, true])
    // the automatic rung halves the gap from 20 to today's 62.5 again, rounded down to 2.5
    expect(second.edited).toBeUndefined()
    expect(second.w).toBe(40)
    expect(second.r).toBe(work(entry)[0].r)
    expect(entry.sets.slice(2)).toEqual(work(entry))
  })
})
