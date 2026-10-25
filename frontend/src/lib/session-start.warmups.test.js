import { describe, it, expect } from 'vitest'
import { buildPlannedEntry, buildSessionEntries } from './session-start.js'
import { isWarmupRow, syncSideAggregate } from './workout-model.js'
import { warmupRestSecFor } from './supersetFlow.js'

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
const loggedWarmup = (w, r, extra = {}) => ({ w, r, done: true, phase: 'warmup', warmup: true, ...extra })
const loggedWork = (w = 60, r = 8) => ({ w, r, done: true })
const loggedSideWork = (w = 60, r = 8) => ({ sides: { L: { w, r: r / 2, done: true }, R: { w, r: r / 2, done: true } }, w, r, done: true })
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

    expect(warmups(entry)).toEqual([{ w: 30, r: 8, done: false, phase: 'warmup', warmup: true }])
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
      phase: 'warmup', warmup: true,
      sides: { L: { w: 10, r: 6, done: true }, R: { w: 12, r: 6, done: true } },
    })
    const entry = entryFor(state(routine, [sideRow, loggedSideWork(), loggedSideWork(), loggedSideWork(), loggedSideWork()]))
    expect(isWarmupRow(entry.sets[0])).toBe(true)
    expect(entry.sets[0].sides).toEqual({ L: { w: 10, r: 6, done: false }, R: { w: 12, r: 6, done: false } })
    expect(entry.sets[0]).toMatchObject({ w: 12, r: 12, done: false, phase: 'warmup', warmup: true })
  })

  it('case 9: carries the duration of a timed warm-up', () => {
    const routine = routineWith({ id: 'custom-hold', sets: 2, sec: 45, weight: 0, mode: 'time', warmupSets: 0 })
    const st = state(routine, [
      { sec: 20, w: 0, done: true, phase: 'warmup', warmup: true },
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
    const noReps = state(repsRoutine, [{ w: 30, done: true, phase: 'warmup', warmup: true }, loggedWork(), loggedWork(), loggedWork()])
    expect(warmups(entryFor(noReps))).toEqual(generatedWarmups(noReps))
  })

  it('case 13: an assistance exercise with nothing to carry keeps its ramp-down', () => {
    // '1431' assisted standing chin-up (leverage machine with "assist" in its name). Its `w`
    // is help, so warm-ups ramp down from more of it: v1.4.2's own rule, unchanged.
    const routine = routineWith({ id: '1431', sets: 3, reps: 8, weight: 25, prog: 'linear', mode: 'reps', warmupSets: 2 })
    const st = state(routine, [loggedWork(25, 8), loggedWork(25, 8), loggedWork(25, 8)])
    const entry = entryFor(st)
    expect(warmups(entry)).toEqual(generatedWarmups(st))
    // More help than the work rows ask for, stepping down toward them.
    expect(warmups(entry)[0].w).toBeGreaterThan(work(entry)[0].w)
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

  // v1.4.2's per-exercise warm-up rest reads off entry.target (lib/supersetFlow.js); carrying
  // must not drop or rewrite the target.
  it('carried rows keep the target per-exercise warm-up rest', () => {
    const routine = routineWith(cfg({ warmupRestSec: 45, warmupSets: 2 }))
    const st = state(routine, [
      loggedWarmup(20, 12), loggedWarmup(30, 8),
      loggedWork(), loggedWork(), loggedWork(),
    ])
    const entry = entryFor(st)

    expect(entry.target.warmupRestSec).toBe(45)
    expect(warmups(entry)).toHaveLength(2)
    // The first of two carried warm-ups rests at the exercise's own 45 s, like a ramped one;
    // the last warm-up before the work rows rests workRestSec, not profileSec.
    expect(warmupRestSecFor(entry, 0, 120, undefined)).toBe(45)
    expect(warmupRestSecFor(entry, 1, 120, undefined)).toBe(120)

    // Same answer for a generated ramp, so carrying changes nothing about the rest.
    const ramped = entryFor({ ...st, startFrom: 'plan' })
    expect(warmupRestSecFor(ramped, 0, 120, undefined)).toBe(45)
    expect(warmupRestSecFor(ramped, 1, 120, undefined)).toBe(120)
  })

  // Heart rate per set (v1.4.2): a logged hr belongs to last session's effort, not to the rows
  // the next one opens with.
  it('carried rows carry no heart rate', () => {
    const routine = routineWith(cfg())
    const entry = entryFor(state(routine, [
      { ...loggedWarmup(30, 8), hr: 120 },
      { ...loggedWork(60, 8), hr: 130 },
      { ...loggedWork(60, 8), hr: 132 },
      loggedWork(),
    ]))
    expect(warmups(entry)).toEqual([{ w: 30, r: 8, done: false, phase: 'warmup', warmup: true }])
    // The work rows read last session as they always did (hr rides on `sets`).
    expect(work(entry).every(row => row.hr === undefined && row.done === false)).toBe(true)
  })
})
