import { describe, it, expect } from 'vitest'
import { isFailureSet, toggleFailure, makeSideSet } from './workout-model.js'
import { rirOf, effortSummary, effortHistogram, isHardSet, hasEffort } from './effort.js'
import { resolveSetRir, anchorsByWorkout } from './recovery.js'
import { setLabel, workoutVolume, applyFailurePlan, applyIntensifierPlan, copyRowAt, makeWarmupAt } from './history.js'
import { buildSessionEntries } from './session-start.js'
import { readSession, nextPrescription } from './progression.js'
import { workoutText } from './workout-text.js'
import { finishCompare } from './finish-compare.js'
import { buildPlanBundle, parsePlan, planPrintHTML } from './plan-share.js'

// Sets to failure (Discord request, roadmap v1.4.2 "a universal AMRAP / to failure flag"): an
// optional `failure: true` on a row, and `lastToFailure: true` on a planned exercise.
const work = rows => rows.filter(s => s.phase !== 'warmup')

describe('the to-failure mark on a row', () => {
  it('is only ever on a work set, and toggles off to the row it was', () => {
    expect(isFailureSet({ w: 60, r: 8, failure: true })).toBe(true)
    expect(isFailureSet({ w: 60, r: 8 })).toBe(false)
    expect(isFailureSet({ w: 40, r: 8, failure: true, phase: 'warmup' })).toBe(false)
    expect(isFailureSet(null)).toBe(false)
    const row = { w: 60, r: 8, done: true }
    const on = toggleFailure(row)
    expect(on).toEqual({ w: 60, r: 8, done: true, failure: true })
    expect(toggleFailure(on)).toEqual(row)
    expect('failure' in toggleFailure(on)).toBe(false)
  })

  it('survives on a per-side row and is copied with the set, but not into a warm-up', () => {
    const side = { ...makeSideSet({ w: 20, r: 16 }), failure: true }
    expect(isFailureSet(side)).toBe(true)
    const copied = copyRowAt([{ w: 60, r: 8, done: true, failure: true }], 0)
    expect(copied[1]).toEqual({ w: 60, r: 8, done: false, failure: true })
    const warm = makeWarmupAt([{ w: 60, r: 8 }, { w: 60, r: 8, failure: true }], 1)
    expect(warm[0].failure).toBeUndefined()
  })
})

describe('effort reads a failure set as RIR 0', () => {
  it('when nothing was rated, and a logged rating still wins', () => {
    expect(rirOf({ w: 60, r: 8, failure: true })).toBe(0)
    expect(rirOf({ w: 60, r: 8, failure: true, rir: 1 })).toBe(1)
    expect(rirOf({ w: 60, r: 8, failure: true, rpe: 9 })).toBe(1)
    expect(rirOf({ w: 60, r: 8 })).toBeNull()
    // A warm-up carrying the key is still not a failure set.
    expect(rirOf({ w: 40, r: 8, failure: true, phase: 'warmup' })).toBeNull()
    expect(isHardSet({ w: 60, r: 8, failure: true })).toBe(true)
  })

  it('counts in the effort summary and histogram as rated sets at 0', () => {
    const sets = [1, 2, 3, 4, 5].map(() => ({ w: 60, r: 8, done: true, failure: true }))
    const S = { workouts: [{ d: '2026-10-01', start: Date.now(), entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, ...sets] }] }] }
    expect(hasEffort(S)).toBe(true)
    const sum = effortSummary(S, 0)
    expect(sum).toMatchObject({ done: 6, rated: 5, est: 0, hard: 5, avg: 0 })
    expect(effortHistogram(S, 0)[0].n).toBe(5)
  })

  it('feeds the fatigue model as a logged RIR 0, ahead of the load estimate', () => {
    const entry = { id: '0025', sets: [{ w: 100, r: 5, done: true }, { w: 60, r: 8, done: true, failure: true }] }
    const workout = { d: '2026-10-01', start: Date.parse('2026-10-01T10:00:00'), entries: [entry] }
    const anchors = anchorsByWorkout([workout]).get(workout)
    const plain = resolveSetRir({ w: 60, r: 8, done: true }, null, entry, workout, anchors)
    expect(plain.source).not.toBe('logged')
    expect(plain.rir).toBeGreaterThan(0)
    const failed = entry.sets[1]
    expect(resolveSetRir(failed, failed, entry, workout, anchors)).toEqual({ rir: 0, source: 'logged' })
    expect(resolveSetRir({ ...failed, rir: 2 }, failed, entry, workout, anchors)).toEqual({ rir: 2, source: 'logged' })
  })
})

describe('a failure set stays a work set', () => {
  it('for volume and for progression', () => {
    const plain = { entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }] }
    const failed = { entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true, failure: true }] }] }
    expect(workoutVolume(failed)).toBe(workoutVolume(plain))
    const target = { sets: 2, reps: 8, weight: 60 }
    expect(readSession({ id: '0025', target, sets: failed.entries[0].sets }, target))
      .toEqual(readSession({ id: '0025', target, sets: plain.entries[0].sets }, target))
  })

  it('Greyskull still reads the planned last set as its AMRAP', () => {
    const cfg = { id: '0025', sets: 3, reps: 5, weight: 60, prog: 'greyskull', lastToFailure: true }
    const sets = [5, 5, 10].map((r, i) => ({ w: 60, r, done: true, ...(i === 2 ? { failure: true } : {}) }))
    const S = { unit: 'kg', workouts: [{ d: '2026-10-01', entries: [{ id: '0025', target: { ...cfg }, sets }] }] }
    const p = nextPrescription(S, cfg, null)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(65)
  })
})

describe('"Last set to failure" in a plan', () => {
  const st = { unit: 'kg', workouts: [], exWeights: {}, routines: [] }

  it('marks only the last work set of a freshly built exercise', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, warmupSets: 2, lastToFailure: true }] }
    const [entry] = buildSessionEntries(st, r)
    expect(entry.sets.filter(s => s.failure)).toHaveLength(1)
    expect(entry.sets.at(-1).failure).toBe(true)
    expect(entry.sets.filter(s => s.phase === 'warmup' && s.failure)).toHaveLength(0)
    expect(entry.target.lastToFailure).toBe(true)
  })

  it('leaves a plan without it exactly as it built before', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }
    const [entry] = buildSessionEntries(st, r)
    expect(entry.sets.some(s => 'failure' in s)).toBe(false)
  })

  it('marks the last set a progression added, not the one it copied (bodyweight sets)', () => {
    const cfg = { id: '0001', sets: 2, reps: 10, repsMax: 10, bodyweight: true, weight: 0, prog: 'linear', lastToFailure: true }
    const done = [10, 10].map(r => ({ w: 0, r, done: true }))
    const S = { ...st, workouts: [{ d: '2026-10-01', entries: [{ id: '0001', target: { ...cfg }, planned: { sets: 2, reps: 10 }, sets: done }] }] }
    const [entry] = buildSessionEntries(S, { id: 'r', ex: [cfg] })
    const rows = work(entry.sets)
    expect(rows).toHaveLength(3)
    expect(rows.map(s => !!s.failure)).toEqual([false, false, true])
  })

  it('takes both halves of a timed per-side hold, never a logged row, never cardio', () => {
    const timed = applyFailurePlan([{ sec: 30, side: 'L' }, { sec: 30, side: 'R' }, { sec: 30, side: 'L' }, { sec: 30, side: 'R' }], { id: '0025', mode: 'time', side: true, lastToFailure: true })
    expect(timed.map(s => !!s.failure)).toEqual([false, false, true, true])
    const logged = applyFailurePlan([{ w: 60, r: 5 }, { w: 60, r: 5, done: true }], { id: '0025', lastToFailure: true })
    expect(logged[1].failure).toBeUndefined()
    const cardio = [{ min: 20, speed: 8 }]
    expect(applyFailurePlan(cardio, { id: '0025', mode: 'cardio', lastToFailure: true })).toBe(cardio)
  })

  it('marks the rest-pause work set of a rest-pause plan', () => {
    const rows = applyIntensifierPlan([{ w: 60, r: 8 }], { id: '0025', reps: 8, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 }, lastToFailure: true })
    expect(rows.map(s => !!s.failure)).toEqual([false, true])
  })

  it('travels with a shared plan and reads on its printout', () => {
    const S = { unit: 'kg', week: {}, customEx: [], routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 100, lastToFailure: true }] }] }
    const bundle = buildPlanBundle(S, 'Plan')
    expect(bundle.routines[0].ex[0].lastToFailure).toBe(true)
    expect(parsePlan(JSON.stringify(bundle)).routines[0].ex[0].lastToFailure).toBe(true)
    const off = buildPlanBundle({ ...S, routines: [{ ...S.routines[0], ex: [{ id: '0025', sets: 3, reps: 5, weight: 100 }] }] }, 'Plan')
    expect('lastToFailure' in off.routines[0].ex[0]).toBe(false)
    expect(planPrintHTML(S, 'Me')).toContain('Last set to failure')
  })
})

describe('where set types show', () => {
  it('the set label carries an F, ahead of the effort tail', () => {
    expect(setLabel('0025', { w: 60, r: 8, done: true, failure: true }, { mode: 'reps' })).toBe('60×8 F')
    expect(setLabel('0025', { w: 60, r: 8, done: true, failure: true, rir: 1 }, { mode: 'reps' })).toBe('60×8 F (RIR 1)')
    expect(setLabel('0025', { sec: 45, done: true, failure: true }, { mode: 'time' })).toBe('0:45 F')
    const side = { ...makeSideSet({ w: 20, r: 16 }), failure: true }
    expect(setLabel('0025', side, { mode: 'reps', side: true })).toMatch(/ F$/)
    expect(setLabel('0025', { w: 60, r: 8, done: true }, { mode: 'reps' })).toBe('60×8')
  })

  it('the text export lists it', () => {
    const w = { d: '2026-10-01', start: 0, end: 0, name: 'Push', entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 11, done: true, failure: true }] }] }
    expect(workoutText(w, { unit: 'kg', nameOf: () => 'bench' })).toContain('60×8, 60×11 F')
  })

  it('the finish summary keeps the mark on today’s sets', () => {
    const now = { id: 'w1', d: '2026-10-03', start: 1, end: 2, entries: [{ id: 'bench', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 9, done: true, failure: true }] }] }
    const [row] = finishCompare({ unit: 'kg', routines: [], workouts: [now] }, now)
    expect(row.today).toEqual([{ w: 60, r: 5 }, { w: 60, r: 9, f: true }])
  })
})

describe('imports keep a failure set', () => {
  it('from a CSV set type and from Hevy', async () => {
    const { parseWorkoutCSV } = await import('./import-csv.js')
    const csv = ['Date,Exercise,Weight,Reps,Set Type', '2026-08-08,Bench Press,80,5,normal', '2026-08-08,Bench Press,80,7,failure'].join('\n')
    const [plain, failed] = parseWorkoutCSV(csv, { unit: 'kg' }).workouts[0].entries[0].sets
    expect('failure' in plain).toBe(false)
    expect(failed.failure).toBe(true)
    const { parseHevyWorkouts } = await import('./import-hevy.js')
    const workout = { id: 'h', title: 'Push', start_time: '2026-08-25T10:00:00+00:00', end_time: '2026-08-25T11:00:00+00:00', exercises: [
      { index: 0, title: 'Bench', exercise_template_id: '79D0BB3A', sets: [
        { index: 0, type: 'normal', weight_kg: 60, reps: 8 },
        { index: 1, type: 'failure', weight_kg: 60, reps: 10 },
      ] },
    ] }
    const sets = parseHevyWorkouts([workout], [], { unit: 'kg' }).workouts[0].entries[0].sets
    expect(sets.map(s => !!s.failure)).toEqual([false, true])
  })
})
