import { expect, it } from 'vitest'
import { defaultPlanRule, generatePrescription, advanceProgression, summarizeActual, replayProgression } from './prescription/index.js'
import { reconcileDerivedOneRms, currentOneRm } from './prescription/index.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures, plannedOf } from './session-ui-adapter.js'
import { rowsOfPerformance } from './session-ui-adapter.js'
import { resolveProgressionContext, chronologicalWorkouts } from './prescription/index.js'
import { buildCompletedSession } from './finish-session.js'
import { deleteEditedWorkout, editCompletedSession } from './session-edit.js'
import { EXIDX, isAssisted } from './exercises.js'
const make = (preset, options = {}) => defaultPlanRule(preset, { id: 'r', exerciseId: '0025', target: { mode: 'none' }, completion: [], ...options })
const gen = (rule, extra = {}) => generatePrescription({ id: 'p', now: '2026-01-01', trackId: 't', rule, ...extra })
const rows = (p, reps = 10) => p.rows.map((r, row) => ({ row, reps, load: r.load }))
const next = (rule, p, performed) => { const actual = summarizeActual(p, performed); return gen(rule, { state: advanceProgression({ prescription: p, log: { id: 'x', actual } }), lastPrescription: p, lastLog: { actual } }) }
it('A36 clean double progression earns one rep before the load increase', () => {
  const rule = make('double'), p = gen(rule)
  expect(next(rule, p, rows(p)).prefill.reps).toBe(11)
  expect(next(rule, p, rows(p, 12)).prefill.reps).toBe(8)
})
it('A37 unnamed bodyweight ladder climbs reps then sets', () => {
  const rule = make('bodyweight_ladder'), p = gen(rule)
  expect(next(rule, p, rows(p, 5)).prefill.reps).toBe(6)
  // One over the target asked for, never over what was done (v1 `goal`).
  expect(next(rule, p, rows(p, 10)).prefill).toMatchObject({ sets: 3, reps: 6 })
  // The target at the top of the range adds a set and starts the reps over.
  const top = gen(rule, { at: { phaseId: p.phaseId, values: { reps: 10 } } })
  expect(next(rule, top, rows(top, 10)).prefill).toMatchObject({ sets: 4, reps: 5 })
})
it('A39 final AMRAP earns the double increment', () => {
  const rule = make('greyskull'), p = gen(rule), performed = rows(p, 5); performed[2].reps = 10
  expect(next(rule, p, performed).parameters.load.resolved.value).toBe(25)
})
it('A41 bonus work neither spoils nor replaces prescribed work', () => {
  const p = gen(make('linear')), required = rows(p, 5)
  expect(summarizeActual(p, [...required, { row: Infinity, reps: 1, load: p.rows[0].load }]).reps).toBe(5)
  const actual = summarizeActual(p, [required[0], required[1], { row: Infinity, reps: 5, load: p.rows[0].load }])
  expect(advanceProgression({ prescription: p, log: { id: 'x', actual } }).values.load.value).toBe(20)
})
it.each(['reps', 'load'])('A42 missing %s on a required row cannot earn progression', field => {
  const p = gen(make('linear')), performed = rows(p, 5); performed[2][field] = null
  expect(advanceProgression({ prescription: p, log: { id: 'x', actual: summarizeActual(p, performed) } }).values.load.value).toBe(20)
})
it('A47 replay resets a stall run at a changed plan fingerprint', () => {
  const rule = make('linear'), p = gen(rule), other = gen(make('linear', { sets: { min: 4, max: 4 } }))
  const workouts = [other, p].map((r, i) => ({ start: i, exposures: [{ trackId: 't', prescriptionId: r === p ? 'p' : 'q', exposureId: 'x' + i, actual: { sets: 3, reps: 1, load: { value: 20, unit: 'kg' } } }] }))
  expect(replayProgression({ workouts, trackId: 't', prescriptions: { p, q: other } }).stalls).toBe(1)
})
it('A43 rest-pause freezes exactly one required activation/burst block', () => {
  const rule = make('linear'), p = gen(rule, { restPause: true, restPauseReps: 12 })
  expect(p.parameters.sets).toEqual({ min: 1, max: 1 })
  expect(p.rows).toHaveLength(1)
  expect(advanceProgression({ prescription: p, log: { id: 'x', actual: summarizeActual(p, rows(p, 12)) } }).values.load.value).toBe(22.5)
  // The block aims at its 12, but v1 judged it against the plan's reps (docs/dev/SET_TYPES.md).
  expect(advanceProgression({ prescription: p, log: { id: 'x', actual: summarizeActual(p, rows(p, 11)) } }).values.load.value).toBe(22.5)
  expect(advanceProgression({ prescription: p, log: { id: 'x', actual: summarizeActual(p, rows(p, 4)) } }).values.load.value).toBe(20)
})
it('A40 progressed duration retains the original plan identity and continues the window', () => {
  const rule = make('hold_seconds', { durationSeconds: { min: 45, max: 45 } })
  // A migrated log whose v1 target had grown to 60 s on a 45 s plan: same plan identity, a slid window.
  const p = gen(make('hold_seconds', { durationSeconds: { min: 60, max: 60 } }), { fingerprint: gen(rule).planFingerprint })
  const actual = { sets: 3, durationSeconds: 60 }, state = advanceProgression({ prescription: p, log: { id: 'x', actual } })
  const q = gen(rule, { state, lastPrescription: p, lastLog: { actual } })
  // The values carry the window the last session earned; the declared 45 s plan stays the identity.
  expect(q.prefill.durationSeconds).toBe(65)
  expect(plannedOf(q).sec).toBe(45)
})
it.each([true, false])('A48 live estimation follows the explicit assistance override %s', assisted => {
  const exerciseId = assisted ? '0025' : Object.keys(EXIDX).find(isAssisted)
  const rule = { ...make('linear'), exerciseId }, profile = { prescriptions: {}, workouts: [] }
  const exposures = buildSessionExposures(profile, { id: 'r', ex: [{ exerciseId, occurrenceId: 't', rule, assisted }] }, { now: 1, newId: s => s })
  const entries = entriesForExposures(exposures, profile.prescriptions); entries[0].sets.forEach(r => { r.done = true })
  const result = buildCompletedSession({ id: 'w', exposures, entries }, profile, { end: 2, unit: 'kg', newId: s => s })
  expect(result.oneRepMaxes.length).toBe(assisted ? 0 : 1)
})
it('A54 deletion drops source-linked estimates and restores remaining history, preserving manual values', () => {
  const exposure = (id, value) => ({ exposureId: id, exerciseId: '0025', mode: 'reps', performance: { sets: [{ status: 'completed', role: 'work', resistance: { kind: 'external-load', value, unit: 'kg' }, observations: [{ metric: 'repetitions', value: 5 }] }] } })
  const profile = { unit: 'kg', workouts: [{ id: 'light', start: 1, end: 2, exposures: [exposure('light-x', 60)] }, { id: 'heavy', start: 3, end: 4, exposures: [exposure('heavy-x', 100)] }], oneRepMaxes: { manual: { id: 'manual', exerciseId: '0025', value: 65, unit: 'kg', source: 'manual', capturedAt: new Date(0).toISOString() } } }
  reconcileDerivedOneRms(profile)
  expect(currentOneRm(profile.oneRepMaxes, '0025').value).toBe(116.7)
  editCompletedSession(profile, 'heavy'); deleteEditedWorkout(profile)
  expect(currentOneRm(profile.oneRepMaxes, '0025').value).toBe(70)
  expect(profile.oneRepMaxes.manual.value).toBe(65)
})
it.each(['linear', 'double', 'greyskull'])('A38 unloaded ladder restores %s when load is added', preset => {
  const rule = make('bodyweight_ladder', { loadedPreset: preset })
  const p = gen(rule), performed = rows(p, 10).map(s => ({ ...s, load: { value: 20, unit: 'kg' } }))
  const q = next(rule, p, performed)
  expect(q.phaseId).toBe(preset)
  expect(q.parameters.load.resolved.value).toBe(22.5)
})
it('A38 assistance at zero switches to repetition climbing', () => {
  const rule = make('linear', { unloadedLadder: true })
  const p = gen(rule, { assisted: true }), actual = summarizeActual(p, rows(p, 5).map(s => ({ ...s, load: { value: 0, unit: 'kg' } })))
  const q = gen(rule, { assisted: true, state: advanceProgression({ prescription: p, log: { id: 'x', actual } }), lastPrescription: p, lastLog: { actual } })
  expect(q.phaseId).toBe('ladder')
  expect(q.prefill.reps).toBe(6)
})
it('A44 ordinary unlinked history remains fallback while explicitly excluded work does not', () => {
  const x = { exerciseId: '0025', performance: { sets: [{ status: 'completed', role: 'work', resistance: { kind: 'external-load', value: 10, unit: 'kg' } }] } }
  const inputs = { trackId: 't', exerciseId: '0025', rule: make('linear') }
  expect(resolveProgressionContext({ ...inputs, workouts: [{ start: 1, exposures: [x] }] }).heldLoad.value).toBe(10)
  expect(resolveProgressionContext({ ...inputs, workouts: [{ start: 1, exposures: [{ ...x, progressionExclusion: 'explicit' }] }] }).heldLoad).toBe(null)
})
it('A45 baseline selection uses chronological order and deterministic ties', () => {
  const p = gen(make('linear')), x = id => ({ exposureId: id, exerciseId: '0025', trackId: 't', prescriptionId: 'p' })
  const workouts = [{ id: 'new', start: 2, exposures: [x('new')] }, { id: 'old', start: 1, exposures: [x('old')] }]
  expect(resolveProgressionContext({ trackId: 't', exerciseId: '0025', rule: make('linear'), workouts, prescriptions: { p } }).baseline.exposureId).toBe('new')
  expect(chronologicalWorkouts([{ id: 'b', start: 1 }, { id: 'a', start: 1 }]).map(w => w.id)).toEqual(['a', 'b'])
})
it('A50 unilateral read-back preserves entered parent effort without inventing limb values', () => {
  const limb = { status: 'completed', role: 'work', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 20 } }
  const row = { ...limb, rpeEntered: 8, sides: { L: limb, R: limb } }
  const ui = rowsOfPerformance([row], 'reps')[0]
  expect(ui.rpe).toBe(8)
  expect(ui.sides.L.r).toBe(5)
  expect(ui.sides.R.r).toBe(5)
})
it('A42 a completed timed row without its duration cannot earn a step', () => {
  const p = gen(make('hold_seconds')), performed = p.rows.map((r, row) => ({ row, durationSeconds: p.parameters.durationSeconds.max }))
  delete performed[1].durationSeconds
  expect(advanceProgression({ prescription: p, log: { id: 'x', actual: summarizeActual(p, performed) } }).values.durationSeconds).toEqual(p.parameters.durationSeconds)
})
it('A36 unilateral progression uses a two-repetition stride, from the last result after a miss too (v1: low + step)', () => {
  // Per side is frozen with the prescription that was finished: its climb steps two reps.
  const rule = make('double'), p = gen(rule, { perSide: true }), actual = summarizeActual(p, rows(p, 10))
  const state = advanceProgression({ prescription: p, log: { id: 'x', actual } })
  expect(gen(rule, { perSide: true, state, lastPrescription: p, lastLog: { actual } }).prefill.reps).toBe(12)
  const short = summarizeActual(p, rows(p, 7)), missed = advanceProgression({ prescription: p, log: { id: 'x', actual: short } })
  expect(gen(rule, { perSide: true, state: missed, lastPrescription: p, lastLog: { actual: short } }).prefill.reps).toBe(9)
})
it('A43 unilateral rest-pause counts one full block, judged by its total as v1 did', () => {
  const rule = make('linear'), profile = { prescriptions: {}, workouts: [] }
  const exposures = buildSessionExposures(profile, { id: 'r', ex: [{ exerciseId: '0025', occurrenceId: 't', rule, side: true, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }] }, { now: 1, newId: s => s })
  const entries = entriesForExposures(exposures, profile.prescriptions), work = entries[0].sets.find(r => r.sides && r.phase !== 'warmup')
  expect(work.sides.L.r).toBe(6)
  expect(work.sides.R.r).toBe(6)
  work.done = true; work.sides.L.done = true; work.sides.R.done = true
  const active = { id: 'w', exposures, entries }, ctx = { end: 2, unit: 'kg', newId: s => s }
  expect(buildCompletedSession(active, profile, ctx).progression.t.values.load.value).toBe(22.5)
  work.sides.L.r = 5   // 11 in all: a short limb, still over the plan's 5
  expect(buildCompletedSession(active, profile, ctx).progression.t.values.load.value).toBe(22.5)
  work.sides.L.r = 2; work.sides.R.r = 2; work.r = 4
  expect(buildCompletedSession(active, profile, ctx).progression.t.values.load.value).toBe(20)
})
