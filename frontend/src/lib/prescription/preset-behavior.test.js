import { describe, expect, it } from 'vitest'
import { advanceProgression, defaultPlanRule, editPlan, generatePrescription, isTemplateRule, planOptions, replayProgression, summarizeActual, validatePlanRule } from './index.js'
import { entriesForExposures } from '../session-ui-adapter.js'

const NOW = '2026-10-12T10:00:00Z'
const fixed = n => ({ min: n, max: n })
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })
const rule = (preset, options = {}) => defaultPlanRule(preset, { id: 'r', exerciseId: 'e', ...options })
const prescribe = (r, state = null, previous = null, id = 'p') => generatePrescription({ id, now: NOW, trackId: 't', rule: r, state, lastPrescription: previous })
const rows = (p, reps, load, rir) => p.rows.map((row, i) => ({ row: i, reps: reps ?? row.reps.min, load: load == null ? row.load : { value: load, unit: 'kg' }, rir }))
const finish = (p, performed, state = null) => advanceProgression({ prescription: p, state, log: { id: 'log-' + p.id, actual: summarizeActual(p, performed) }, now: NOW })

it.each(['double_controlled', 'undulating'])('%s replays its saved history into the same next prescription', preset => {
  const r = rule(preset, preset === 'double_controlled'
    ? { load: abs(40), reps: { min: 8, max: 9 }, completion: [] }
    : { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, completion: [{ metric: 'cycle_count', target: 2 }] })
  const history = { workouts: [], prescriptions: {} }
  let state = null, previous = null
  for (let i = 0; i < 8; i++) {
    const p = prescribe(r, state, previous, 'p' + i)
    const actual = summarizeActual(p, rows(p, i === 1 ? 0 : undefined))
    const log = { id: 'log-' + p.id, actual }
    state = advanceProgression({ prescription: p, state, log, now: NOW })
    history.prescriptions[p.id] = p
    history.workouts.push({ id: 'w' + i, start: Date.parse(NOW) + i * 86400000, exposures: [{ exposureId: log.id, trackId: 't', prescriptionId: p.id, actual, completedAt: NOW }] })
    previous = p
  }
  const saved = JSON.parse(JSON.stringify(history))
  const replayed = replayProgression({ ...saved, trackId: 't' })
  expect(replayed).toEqual(state)
  expect(prescribe(r, replayed, saved.prescriptions[previous.id], 'next')).toEqual(prescribe(r, state, previous, 'next'))
})

describe('successful completion', () => {
  it('does not complete at the target load after missed reps, missing sets or insufficient RIR', () => {
    const p = prescribe(rule('linear', { load: abs(100), rir: { min: 2, max: 3 } }))
    for (const performed of [rows(p, 1), rows(p).slice(0, 1), rows(p, 5, 100, 0)]) {
      expect(finish(p, performed).status).toBe('active')
    }
    expect(finish(p, rows(p, 5, 100, 2)).status).toBe('completed')
  })

  it('requires every selected condition even when the final phase exits', () => {
    const r = rule('accumulation_intensification', { end: 'complete', reps: fixed(8), trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, intensification: { sets: 3, reps: 4, percent: 80, successes: 1 }, completion: [{ metric: 'training_max', target: 150 }] })
    const p = prescribe(r)
    const first = finish(p, rows(p))
    const last = prescribe(r, first, p, 'p2')
    expect(finish(last, rows(last), first).status).toBe('active')
  })

  it('freezes reps as well as load when a controlled-double target completes', () => {
    const r = rule('double_controlled', { load: abs(100), completion: [{ metric: 'target_load', target: null }] })
    const p = prescribe(r)
    const state = finish(p, rows(p))
    expect(state.status).toBe('completed')
    expect(prescribe(r, state, p, 'p2').rows.map(row => [row.reps.min, row.load.value])).toEqual([[8, 100], [8, 100], [8, 100]])
  })

  it('does not count repeated final-phase sessions as more completed nonrepeating cycles', () => {
    const r = rule('undulating', { end: 'complete', trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, completion: [{ metric: 'cycle_count', target: 3 }] })
    let state = null, previous = null
    for (let i = 0; i < 5; i++) {
      const p = prescribe(r, state, previous, 'p' + i)
      state = finish(p, rows(p), state)
      previous = p
    }
    expect(state.cyclesCompleted).toBe(1)
    expect(state.status).toBe('active')
  })

  it('finishes a ladder only after completing the volume of its final variation', () => {
    const r = rule('bodyweight_ladder', { sets: fixed(1), reps: { min: 1, max: 2 }, rungs: ['easy', 'hard'] })
    let state = null, previous = null
    for (let i = 0; i < 4; i++) {
      const p = prescribe(r, state, previous, 'p' + i)
      expect(p.values.difficulty).toBe(i < 2 ? 0 : 1)
      state = finish(p, rows(p), state)
      expect(state.status).toBe(i === 3 ? 'completed' : 'active')
      previous = p
    }
    expect(isTemplateRule(editPlan(r, { restSeconds: 120 }))).toBe(true)
  })

  it('adds and removes the final-rung condition when variations are edited', () => {
    const r = rule('bodyweight_ladder')
    const added = editPlan(r, { rungs: ['easy', 'hard'] })
    expect(added.program.completion.map(c => c.metric)).toContain('difficulty_rung')
    expect(editPlan(added, { rungs: [] }).program.completion.map(c => c.metric)).not.toContain('difficulty_rung')
    expect(rule('bodyweight_ladder', { rungs: ['easy', 'hard'], completion: [] }).program.completion).toEqual([])
  })

  it('requires maximum final volume even when only the final-variation condition is selected', () => {
    const r = rule('bodyweight_ladder', { rungs: ['easy', 'hard'], completion: [{ metric: 'difficulty_rung', target: null }] })
    const start = prescribe(r)
    const state = { ...finish(start, rows(start)), values: { ...start.values, load: { mode: 'empty' }, difficulty: 1 } }
    const last = prescribe(r, state, start, 'p2')
    expect(finish(last, rows(last), state).status).toBe('active')
  })
})

describe('controlled double progression', () => {
  it('starts at the minimum, holds misses and low RIR, then resets reps after a load step', () => {
    const r = rule('double_controlled', { load: abs(40), reps: { min: 8, max: 9 }, rir: { min: 2, max: 3 }, completion: [] })
    const p = prescribe(r)
    expect(p.rows.map(row => row.reps.min)).toEqual([8, 8, 8])
    for (const performed of [rows(p, 7), rows(p, 8, 35), rows(p, 8, 40, 0)]) {
      expect(finish(p, performed).values).toMatchObject({ reps: 8, load: { value: 40 } })
    }
    const s = finish(p, rows(p, 8, 40, 2))
    const top = prescribe(r, s, p, 'p2')
    expect(top.rows.map(row => row.reps.min)).toEqual([9, 9, 9])
    const next = finish(top, rows(top), s)
    expect(next.values.load.value).toBe(42.5)
    expect(prescribe(r, next, top, 'p3').rows.map(row => row.reps.min)).toEqual([8, 8, 8])
  })

  it('uses the same controls in pounds and reduces assistance when a step is earned', () => {
    const r = defaultPlanRule('double_controlled', { id: 'r', exerciseId: 'e', unit: 'lb', reps: fixed(8), completion: [] })
    expect(validatePlanRule(r).ok).toBe(true)
    expect(isTemplateRule(r)).toBe(true)
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: r, assisted: true })
    expect(finish(p, rows(p)).values.load.value).toBe(40)
  })

  it('prefills the prescribed load after a lighter unsuccessful session', () => {
    const r = rule('double_controlled', { load: abs(40), completion: [] })
    const p = prescribe(r)
    const actual = summarizeActual(p, rows(p, 8, 35))
    const log = { id: 'log', actual }
    const state = advanceProgression({ prescription: p, log, now: NOW })
    const next = generatePrescription({ id: 'p2', now: NOW, trackId: 't', rule: r, state, lastPrescription: p, lastLog: log })
    const entries = entriesForExposures([{ exerciseId: 'e', exposureId: 'x', prescriptionId: next.id, mode: 'reps' }], { [next.id]: next })
    expect(entries[0].sets.map(row => [row.r, row.w])).toEqual([[8, 40], [8, 40], [8, 40]])
  })
})

describe('cycles and review', () => {
  it('walks three exposures and increases the training max once at the cycle boundary', () => {
    const r = rule('undulating', { trainingMax: { mode: 'direct', value: 100, unit: 'kg' } })
    let state = null, previous = null
    for (const [i, sets, reps, load] of [[0, 3, 10, 65], [1, 4, 6, 75], [2, 5, 3, 85], [3, 3, 10, 67.5]]) {
      const p = prescribe(r, state, previous, 'p' + i)
      expect(p.rows.map(row => [row.reps.min, row.load.value])).toEqual(Array(sets).fill([reps, load]))
      state = finish(p, rows(p), state)
      previous = p
    }
    expect(state.cyclesCompleted).toBe(1)
    expect(state.values.trainingMax.value).toBe(102.5)
    expect(isTemplateRule(r)).toBe(true)
    expect(planOptions(r).wave).toEqual([{ sets: 3, reps: 10, percent: 65 }, { sets: 4, reps: 6, percent: 75 }, { sets: 5, reps: 3, percent: 85 }])
  })

  it.each(['five_three_one', 'undulating'])('%s advances by exposure even after a miss, but completes only after success', preset => {
    const r = rule(preset, { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, end: 'complete', completion: [] })
    let state = null, previous = null
    for (let i = 0; i < r.program.phases.length; i++) {
      const p = prescribe(r, state, previous, 'p' + i)
      state = finish(p, rows(p, 0), state)
      expect(state.status).toBe('active')
      previous = p
    }
    const final = prescribe(r, state, previous, 'final')
    expect(final.phaseId).toBe(r.program.phases.at(-1).id)
    state = finish(final, rows(final), state)
    expect(state.status).toBe('completed')
    expect(state.cyclesCompleted).toBe(1)
    expect(state.values.trainingMax.value).toBe(100)
  })

  it('warns after three consecutive unsuccessful accumulation sessions, clearing on success or phase change', () => {
    const r = rule('accumulation_intensification', { trainingMax: { mode: 'direct', value: 100, unit: 'kg' } })
    let state = null, previous = null
    for (let i = 0; i < 3; i++) {
      const p = prescribe(r, state, previous, 'p' + i)
      state = finish(p, rows(p, 1), state)
      previous = p
    }
    const review = prescribe(r, state, previous, 'review')
    expect(review.provenance.reviewTrainingMax).toBe(true)
    state = finish(review, rows(review), state)
    const clean = prescribe(r, state, review, 'clean')
    expect(clean.provenance.reviewTrainingMax).toBeUndefined()
    expect(clean.trainingMax.value).toBe(100)
    const reached = { ...state, phaseMisses: 3 }
    const top = prescribe(r, reached, review, 'top')
    const next = finish(top, rows(top, 12), reached)
    expect(next.phaseId).toBe('intensification')
    expect(next.phaseMisses).toBeUndefined()
    expect(prescribe(r, next, top, 'heavier').provenance.reviewTrainingMax).toBeUndefined()
  })

  it('density stops after a successful session at the shortest rest, or continues when no stop is selected', () => {
    const r = rule('density', { load: abs(30), restSeconds: 50, restFloor: 45 })
    const p = prescribe(r)
    const s = finish(p, rows(p))
    const floor = prescribe(r, s, p, 'p2')
    expect(floor.parameters.restSeconds).toBe(45)
    expect(finish(floor, rows(floor, 1), s).status).toBe('active')
    expect(finish(floor, rows(floor), s).status).toBe('completed')
    const open = prescribe(rule('density', { load: abs(30), restSeconds: 45, restFloor: 45, completion: [] }))
    expect(finish(open, rows(open)).status).toBe('active')
  })

  it('validates new phase controls at the profile boundary', () => {
    const r = rule('accumulation_intensification')
    r.program.phases[0].reviewAfter = 0
    expect(validatePlanRule(r).ok).toBe(false)
  })
})
