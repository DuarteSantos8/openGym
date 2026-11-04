import { describe, it, expect } from 'vitest'
import { defaultPlanRule, generatePrescription, supports, failureSetsOf, failureSetSelected, failureSetRange, failureSuffix, auditExecution, summarizeActual, verdictOf } from './index.js'
import { applyFailurePlan } from '../history.js'
import { entriesForExposures, exposuresWithPerformance, rowsOfPerformance } from '../session-ui-adapter.js'
import { buildSessionExposures } from '../session-start.js'
import { buildPlanBundle, parsePlan, planPrintHTML } from '../plan-share.js'

const rule = (preset = 'manual', options = {}) => defaultPlanRule(preset, { id: 'o', exerciseId: '0025', routineId: 'r', sets: { min: 3, max: 3 }, reps: { min: 7, max: 7 }, ...options })
const prescribe = (options = {}, planned = rule()) => generatePrescription({ id: 'p', now: '2026-10-11T12:00:00Z', trackId: 'o', rule: planned, ...options })

describe('planned failure selection', () => {
  it('accepts any combination, all, last, and legacy last; rejects malformed selections', () => {
    expect(failureSetsOf({ failureSets: [3, 1, 3] })).toEqual([1, 3])
    expect(failureSetsOf({ lastToFailure: true })).toBe('last')
    expect(failureSetsOf({ failureSets: [], lastToFailure: true })).toEqual([])
    for (const failureSets of [[0], [1.5], [51], ['1'], {}, 'first']) expect(() => failureSetsOf({ failureSets })).toThrow()
  })
  it('keeps all and last meaningful when a set range changes, ignores unprescribed indices', () => {
    expect(failureSetSelected({ failureSets: 'last' }, 2, 3)).toBe(true)
    expect(failureSetSelected({ failureSets: 'last' }, 2, 4)).toBe(false)
    expect(failureSetSelected({ failureSets: 'all' }, 3, 4)).toBe(true)
    expect(failureSuffix({ failureSets: [4] }, 3)).toBe('')
    expect(failureSuffix({ failureSets: [1, 3] }, 3)).toBe('(+)')
    expect(failureSuffix({ failureSets: [1, 2, 3] }, 3)).toBe('+')
  })
  it('freezes selected rows, keeps warmups separate and changes the prescription hash', () => {
    const r = rule('manual', { load: { mode: 'absolute', value: 60, unit: 'kg' } })
    const p = prescribe({ failureSets: [1, 3], warmup: { mode: 'smart', count: 2 } }, r)
    expect(p.rows.map(r => !!r.failure)).toEqual([true, false, true])
    expect(p.warmupRows.every(r => !r.failure)).toBe(true)
    expect(Object.isFrozen(p.failureSets)).toBe(true)
    expect(p.contentHash).not.toBe(prescribe({ failureSets: [2], warmup: { mode: 'smart', count: 2 } }, r).contentHash)
    expect(p.contentHash).toBe(prescribe({ failureSets: [3, 1], warmup: { mode: 'smart', count: 2 } }, r).contentHash)
    expect(prescribe({ lastToFailure: true }).rows.map(r => !!r.failure)).toEqual([false, false, true])
  })
  it('exposes failure on autoregulation and holds, excludes intrinsic AMRAP, cycles, Max and density', () => {
    for (const id of ['manual', 'linear', 'double', 'triple', 'hold_seconds', 'bodyweight_ladder', 'pyramid', 'top_set_backoff']) expect(supports(rule(id)).failure, id).toBe(true)
    for (const id of ['greyskull', 'five_three_one', 'accumulation_intensification', 'pyramid_reps', 'density']) {
      const r = defaultPlanRule(id, { id: 'o', exerciseId: '0025' })
      expect(supports(r).failure, id).toBe(false)
      expect(prescribe({ failureSets: 'all' }, r).rows.every(x => !x.failure), id).toBe(true)
    }
    expect(prescribe({ failureSets: 'all', restPause: true }).rows.every(x => !x.failure)).toBe(true)
    const cardio = rule('manual', { durationSeconds: { min: 60, max: 60 }, speed: { value: 8, unit: 'kmh' } })
    expect(supports(cardio).failure).toBe(false)
  })
  it('counts every group, including back-off sets, for arbitrary selection', () => {
    const r = defaultPlanRule('top_set_backoff', { id: 'o', exerciseId: '0025' })
    expect(failureSetRange(r)).toEqual({ min: 4, max: 4 })
    expect(prescribe({ failureSets: [2, 4] }, r).rows.map(x => !!x.failure)).toEqual([false, true, false, true])
  })
  it('allows excess reps or seconds on failure rows but keeps the floor and other rows bounded', () => {
    const p = prescribe({ failureSets: [1] }, rule('manual', { reps: { min: 7, max: 10 }, rir: { min: 2, max: 3 } }))
    expect(auditExecution(p, { row: 0, reps: 14, rir: 0 })).toEqual([])
    expect(auditExecution(p, { row: 0, reps: 6 })[0]).toMatchObject({ code: 'below_range', field: 'reps' })
    expect(auditExecution(p, { row: 1, reps: 14 })[0]).toMatchObject({ code: 'above_range', field: 'reps' })
    const timed = prescribe({ failureSets: 'all' }, rule('manual', { durationSeconds: { min: 30, max: 45 } }))
    expect(auditExecution(timed, { row: 0, durationSeconds: 65 })).toEqual([])
    expect(auditExecution(timed, { row: 0, durationSeconds: 25 })[0]).toMatchObject({ code: 'below_range', field: 'durationSeconds' })
  })
  it('does not make planned RIR zero block progression, while retaining effort on other sets', () => {
    const p = prescribe({ failureSets: [1] }, rule('linear', { rir: { min: 2, max: 3 } }))
    const rows = [{ row: 0, reps: 9, rir: 0 }, { row: 1, reps: 7, rir: 2 }, { row: 2, reps: 7, rir: 3 }].map(s => ({ ...s, load: { value: 20, unit: 'kg' } }))
    const actual = summarizeActual(p, rows)
    expect(actual.rir).toBe(0)
    expect(verdictOf(p, actual).success).toBe(true)
    rows[1].rir = 1
    expect(verdictOf(p, summarizeActual(p, rows)).success).toBe(false)
    const all = prescribe({ failureSets: 'all' }, rule('linear', { rir: { min: 2, max: 3 } }))
    expect(verdictOf(all, summarizeActual(all, rows)).success).toBe(true)
    rows[2].reps = 6
    expect(verdictOf(all, summarizeActual(all, rows)).success).toBe(false)
  })
  it('marks both limbs of selected timed sets, excludes warmups and leaves logged rows alone', () => {
    const rows = [{ phase: 'warmup' }, { side: 'L', sec: 30 }, { side: 'R', sec: 30 }, { side: 'L', sec: 30 }, { side: 'R', sec: 30, done: true }]
    expect(applyFailurePlan(rows, { mode: 'time', failureSets: [1] }).map(r => !!r.failure)).toEqual([false, true, true, false, false])
    expect(applyFailurePlan(rows, { mode: 'time', failureSets: 'all' }).map(r => !!r.failure)).toEqual([false, true, true, true, false])
    expect(applyFailurePlan(rows, { mode: 'cardio', failureSets: 'all' })).toBe(rows)
  })
  it('carries the plan through session start, editable sides, logged performance and read-back', () => {
    const profile = { unit: 'kg', routines: [], workouts: [], progression: {}, prescriptions: {}, oneRepMaxes: {} }
    const routine = { id: 'r', ex: [{ occurrenceId: 'o', exerciseId: '0025', rule: rule(), failureSets: [1, 3], side: true }] }
    const exposures = buildSessionExposures(profile, routine, { now: Date.parse('2026-10-11T12:00:00Z'), newId: x => x })
    expect(exposures[0].failureSets).toEqual([1, 3])
    const [entry] = entriesForExposures(exposures, profile.prescriptions)
    expect(entry.sets.map(x => !!x.failure)).toEqual([true, false, true])
    entry.sets.forEach(s => { s.sides.L.done = true; s.sides.R.done = true })
    const [logged] = exposuresWithPerformance(exposures, [entry], 'kg')
    expect(rowsOfPerformance(logged.performance.sets, 'reps').map(x => !!x.failure)).toEqual([true, false, true])
  })
  it('shares, imports and prints the chosen sets without dropping the selection', () => {
    const profile = { unit: 'kg', routines: [{ id: 'r', name: 'Test', ex: [{ occurrenceId: 'o', exerciseId: '0025', rule: rule(), failureSets: [1, 3] }] }], week: {}, customEx: [] }
    const bundle = buildPlanBundle(profile)
    expect(bundle.routines[0].ex[0].failureSets).toEqual([1, 3])
    expect(parsePlan(JSON.stringify(bundle), 'kg').routines[0].ex[0].failureSets).toEqual([1, 3])
    expect(planPrintHTML(profile)).toContain('Sets to failure: 1, 3')
    bundle.routines[0].ex[0].failureSets = [0]
    expect(parsePlan(bundle).routines[0].ex[0].failureSets).toBeUndefined()
  })
})
