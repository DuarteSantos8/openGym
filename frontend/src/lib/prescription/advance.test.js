import { describe, expect, it } from 'vitest'
import { defaultPlanRule } from '../../../../api/engine/rules.js'
import { generatePrescription } from '../../../../api/engine/generate.js'
import { advanceProgression } from '../../../../api/engine/advance.js'
import { summarizeActual } from '../../../../api/engine/audit.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
const rule = (preset, options = {}) => defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg', ...options })
const prescribe = (r, extra = {}) => generatePrescription({ id: 'p1', now: NOW, trackId: 't1', rule: r, ...extra })
const finish = (p, actual, state = null) => advanceProgression({ state, prescription: p, log: { id: 'log-' + p.id, actual }, now: NOW })
const metrics = (...names) => names.map(metric => ({ metric, target: null }))
// The load the next session targets once this one is finished.
const nextLoad = (p, actual, state) => finish(p, actual, state).values.load.value

describe('earning a load step', () => {
  it('linear steps only when every set hit the prescription, from the load that was lifted', () => {
    const p = prescribe(rule('linear'))
    expect(nextLoad(p, { sets: 3, reps: 5, load: kg(20) })).toBe(22.5)
    expect(nextLoad(p, { sets: 3, reps: 4, load: kg(20) })).toBe(20)
    expect(nextLoad(p, { sets: 2, reps: 5, load: kg(20) })).toBe(20)
    // The load lifted is not part of the verdict (v1 judged sets and reps); the next load starts from it.
    expect(nextLoad(p, { sets: 3, reps: 5, load: kg(17.5) })).toBe(20)
  })

  it('linear uses seconds instead of repetitions for a timed rule', () => {
    const p = prescribe(rule('linear', { durationSeconds: { min: 45, max: 45 } }))
    expect(nextLoad(p, { sets: 3, reps: null, durationSeconds: 45, load: kg(20) })).toBe(22.5)
  })

  it('double progression moves the load only at the top of the rep range, and climbs a rep otherwise', () => {
    const p = prescribe(rule('double'))
    // null: back to the bottom of the range, read against the plan the next session is built from.
    expect(finish(p, { sets: 3, reps: 12, load: kg(20) }).values).toMatchObject({ load: { value: 22.5 }, reps: null })
    expect(finish(p, { sets: 3, reps: 11, load: kg(20) }).values).toMatchObject({ load: { value: 20 }, reps: 12 })
  })

  it('double progression moves the load only at the top of a time range', () => {
    const p = prescribe(rule('double', { durationSeconds: { min: 45, max: 60 } }))
    expect(nextLoad(p, { sets: 3, reps: null, durationSeconds: 60, load: kg(20) })).toBe(22.5)
    expect(nextLoad(p, { sets: 3, reps: null, durationSeconds: 59, load: kg(20) })).toBe(20)
  })

  it('triple progression climbs a rep, then a set, then the load', () => {
    const r = rule('triple')
    const p = prescribe(r)
    expect(finish(p, { sets: 3, reps: 8, load: kg(20) }).values).toMatchObject({ load: { value: 20 }, sets: 3, reps: 9 })
    const top = generatePrescription({ id: 'p2', now: NOW, trackId: 't1', rule: r, state: { ...finish(p, { sets: 3, reps: 8, load: kg(20) }), values: { ...finish(p, { sets: 3, reps: 8, load: kg(20) }).values, reps: 12, rowReps: [12, 12, 12] } }, lastPrescription: p })
    expect(finish(top, { sets: 3, reps: 12, load: kg(20) }).values).toMatchObject({ load: { value: 20 }, sets: 4, reps: 12, rowReps: [12, 12, 12, 8] })
    const full = generatePrescription({ id: 'p3', now: NOW, trackId: 't1', rule: r, state: { ...finish(p, { sets: 3, reps: 8, load: kg(20) }), values: { load: { mode: 'absolute', value: 20, unit: 'kg' }, sets: 5, reps: 12 } }, lastPrescription: p })
    expect(full.rows).toHaveLength(5)
    expect(finish(full, { sets: 5, reps: 12, load: kg(20) }).values).toMatchObject({ load: { value: 22.5 }, sets: null, reps: null })
  })

  it('manual never steps anything', () => {
    expect(finish(prescribe(rule('autoregulated')), { sets: 3, reps: 8, load: null }).values).toMatchObject({ load: { mode: 'empty' }, sets: 3, reps: 8 })
  })

  it('the same finish twice earns nothing twice', () => {
    const p = prescribe(rule('linear'))
    const once = finish(p, { sets: 3, reps: 5, load: kg(20) })
    expect(finish(p, { sets: 3, reps: 5, load: kg(20) }, once)).toBe(once)
  })
})

describe('completion', () => {
  const capped = rule('triple', { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 100, unit: 'kg' }, completion: metrics('target_load', 'max_reps') })

  it('completes only when every condition passes, then freezes the load', () => {
    const p = prescribe(capped)
    expect(finish(p, { sets: 3, reps: 4, load: kg(100) })).toMatchObject({ status: 'active' })
    const done = finish(p, { sets: 3, reps: 5, load: kg(100) })
    expect(done).toMatchObject({ status: 'completed', terminalTarget: kg(100), completedAt: NOW, values: { load: { value: 100 } }, lastPrescriptionId: 'p1', lastCompletedLogId: 'log-p1' })
  })

  it('keeps logging on a completed track without advancing, until an edit reopens it', () => {
    const p = prescribe(capped)
    const done = finish(p, { sets: 3, reps: 5, load: kg(100) })
    const lastLog = { id: 'log-p1', actual: { sets: 3, reps: 5, load: kg(100) }, audit: [] }
    const held = prescribe(capped, { id: 'p2', state: done, lastPrescription: p, lastLog })
    expect(held.statusAtGeneration).toBe('completed')
    expect(held.parameters.load.resolved).toEqual(kg(100))
    expect(finish(held, { sets: 3, reps: 5, load: kg(105) }, done)).toMatchObject({ status: 'completed', lastCompletedLogId: 'log-p2', terminalTarget: kg(100), values: { load: { value: 100 } } })
    const edited = prescribe({ ...capped, revision: 2 }, { id: 'p3', state: done, lastPrescription: p, lastLog })
    expect(finish(edited, { sets: 3, reps: 4, load: kg(100) }, done)).toMatchObject({ status: 'active', planRuleRevision: 2, terminalTarget: null, completedAt: null })
  })

  it('an initial load above the cap completes once the other conditions pass', () => {
    const over = rule('triple', { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 120, unit: 'kg' }, completion: metrics('target_load', 'max_sets') })
    const p = prescribe(over)
    expect(p.parameters.load.resolved).toEqual(kg(100))
    expect(finish(p, { sets: 3, reps: 5, load: kg(120) }).status).toBe('completed')
  })

  it('5/3/1 walks the weeks, adds the TM increment at cycle end, and completes on cycle count', () => {
    const r = rule('five_three_one', { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, completion: [{ metric: 'cycle_count', target: 1 }] })
    let state = null
    let last = null
    for (let week = 0; week < 4; week++) {
      const p = prescribe(r, { id: 'w' + week, state, lastPrescription: last })
      expect(p.phaseId).toBe('w' + (week + 1))
      state = finish(p, { sets: 3, reps: 5, load: p.rows[2].load }, state)
      last = p
    }
    expect(state).toMatchObject({ cyclesCompleted: 1, phaseId: 'w1', values: { trainingMax: kg(102.5) }, status: 'completed' })
  })

  it('5/3/1 completes on a training-max target', () => {
    const r = rule('five_three_one', { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, completion: [{ metric: 'training_max', target: 102.5 }] })
    let state = null
    let last = null
    for (let week = 0; week < 4; week++) {
      const p = prescribe(r, { id: 'w' + week, state, lastPrescription: last })
      state = finish(p, { sets: 3, reps: 5, load: p.rows[2].load }, state)
      last = p
    }
    expect(state.status).toBe('completed')
  })

  it('climbs a ladder\'s reps and sets, then the next rung, and completes on the final rung', () => {
    const r = rule('bodyweight_ladder', { rungs: ['knee push-up', 'push-up'], completion: metrics('difficulty_rung') })
    const p0 = prescribe(r, { state: { ...finish(prescribe(r), { sets: 3, reps: 5 }), values: { load: { mode: 'empty' }, sets: 5, reps: 10, difficulty: 0 } }, lastPrescription: prescribe(r) })
    const s1 = finish(p0, { sets: 5, reps: 10, load: null })
    expect(s1).toMatchObject({ status: 'active', values: { difficulty: 1, sets: null, reps: null } })
    const p1 = prescribe(r, { id: 'p2', state: s1, lastPrescription: p0, lastLog: { id: 'l1', actual: { sets: 5, reps: 10, load: null }, audit: [] } })
    expect(p1.prefill).toMatchObject({ sets: 3, reps: 5 })
    expect(finish(p1, { sets: 3, reps: 5, load: null }, s1).status).toBe('completed')
  })
})

describe('the effort floor', () => {
  const lifted = rir => ({ sets: 3, reps: 5, load: kg(20), ...(rir === undefined ? {} : { rir }) })
  const linearRir = () => prescribe(rule('linear', { rir: { min: 1, max: 3 } }))

  it('holds the load when the weakest set left fewer reps in reserve than the floor', () => {
    expect(nextLoad(linearRir(), lifted(0))).toBe(20)
    expect(nextLoad(linearRir(), lifted(1))).toBe(22.5)
    expect(nextLoad(linearRir(), lifted(4))).toBe(22.5)
  })

  it('reads effort entered as RPE through the same floor', () => {
    const rpe = rpeEntered => summarizeActual(linearRir(), [0, 1, 2].map(row => ({ row, reps: 5, load: kg(20), rpeEntered })))
    expect(nextLoad(linearRir(), rpe(9))).toBe(22.5)    // RPE 9 = RIR 1
    expect(nextLoad(linearRir(), rpe(10))).toBe(20)     // RPE 10 = RIR 0
  })

  it('never blocks when no effort was logged, and is off when the rule names no target effort', () => {
    expect(nextLoad(linearRir(), lifted())).toBe(22.5)
    expect(nextLoad(prescribe(rule('linear')), lifted(0))).toBe(22.5)
  })

  it('applies to double progression', () => {
    const p = prescribe(rule('double', { rir: { min: 1, max: 3 } }))
    expect(nextLoad(p, { sets: 3, reps: 12, load: kg(20), rir: 0 })).toBe(20)
    expect(nextLoad(p, { sets: 3, reps: 12, load: kg(20), rir: 2 })).toBe(22.5)
  })

  it('does not hold greyskull, whose last set is an AMRAP taken to failure', () => {
    expect(nextLoad(prescribe(rule('greyskull', { rir: { min: 1, max: 3 } })), { sets: 3, reps: 5, load: kg(20), rir: 0 })).toBe(22.5)
  })

  it('reads only the anchor set of a reverse pyramid', () => {
    const p = prescribe(rule('pyramid', { direction: 'descending', rir: { min: 1, max: 3 } }))
    const set = (row, rir, load) => ({ row, reps: 8, load: kg(load), rir })
    expect(nextLoad(p, summarizeActual(p, [set(0, 0, 20), set(1, 3, 17.5), set(2, 3, 15)]))).toBe(20)
    expect(nextLoad(p, summarizeActual(p, [set(0, 2, 20), set(1, 0, 17.5), set(2, 0, 15)]))).toBe(22.5)
  })
})

describe('success scopes', () => {
  it('lets only the anchor set of an RPT pyramid decide, using its own reps', () => {
    const p = prescribe(rule('pyramid', { reps: { min: 6, max: 6 }, offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] }))
    const set = (row, reps, load) => ({ row, reps, load: kg(load) })
    expect(nextLoad(p, summarizeActual(p, [set(0, 6, 20), set(1, 5, 17.5), set(2, 6, 15)]))).toBe(22.5)
    expect(nextLoad(p, summarizeActual(p, [set(0, 5, 20), set(1, 8, 17.5), set(2, 10, 15)]))).toBe(20)
  })

  it('a top set and back-off judges the top set by default, every set when asked', () => {
    const sets = (top, back, load = 100) => [{ row: 0, reps: top, load: kg(load) }, ...[1, 2, 3].map(row => ({ row, reps: back, load: kg(90) }))]
    const top = prescribe(rule('top_set_backoff', { load: { mode: 'absolute', value: 100, unit: 'kg' } }))
    expect(top.rows.map(r => [r.groupId, r.reps.min, r.load.value, r.restSeconds ?? top.parameters.restSeconds])).toEqual([['top', 6, 100, 180], ['backoff', 8, 90, 120], ['backoff', 8, 90, 120], ['backoff', 8, 90, 120]])
    expect(nextLoad(top, summarizeActual(top, sets(6, 7)))).toBe(102.5)   // a failed back-off does not block the top set
    expect(nextLoad(top, summarizeActual(top, sets(5, 8)))).toBe(100)
    expect(nextLoad(top, summarizeActual(top, sets(6, 8, 97.5)))).toBe(100)   // the prescribed load is part of a new template's success
    const all = prescribe(rule('top_set_backoff', { load: { mode: 'absolute', value: 100, unit: 'kg' }, scope: 'all' }))
    expect(nextLoad(all, summarizeActual(all, sets(6, 7)))).toBe(100)
    expect(nextLoad(all, summarizeActual(all, sets(6, 8)))).toBe(102.5)
  })

  it('sets added past the prescription never stand in for a missing one (v1 #233)', () => {
    const p = prescribe(rule('linear'))
    const actual = summarizeActual(p, [{ row: 0, reps: 5, load: kg(20) }, { row: 1, reps: 5, load: kg(20) }, { row: Infinity, reps: 5, load: kg(20) }, { row: Infinity, reps: 5, load: kg(20) }])
    expect(actual.sets).toBe(2)
    expect(nextLoad(p, actual)).toBe(20)
  })
})

describe('timed holds that climb in seconds', () => {
  const held = durationSeconds => ({ sets: 3, reps: null, durationSeconds, load: null })

  it('slides the window up one step when the top of it is held on every set', () => {
    const r = rule('hold_seconds')
    const p0 = prescribe(r)
    expect(p0.parameters.durationSeconds).toEqual({ min: 20, max: 30 })
    expect(finish(p0, held(29)).values.durationSeconds).toEqual({ min: 20, max: 30 })
    const s1 = finish(p0, held(30))
    expect(s1).toMatchObject({ status: 'active', values: { durationSeconds: { min: 25, max: 35 } } })
    const p1 = prescribe(r, { id: 'p2', state: s1, lastPrescription: p0, lastLog: { id: 'l1', actual: held(30), audit: [] } })
    expect(p1.parameters.durationSeconds).toEqual({ min: 25, max: 35 })
    expect(p1.prefill.durationSeconds).toBe(25)
  })

  it('completes at the stop time, then freezes: another session moves nothing', () => {
    const r = rule('hold_seconds', { completion: [{ metric: 'max_duration', target: 30 }] })
    const p0 = prescribe(r)
    const done = finish(p0, held(30))
    expect(done.status).toBe('completed')
    const p1 = prescribe(r, { id: 'p2', state: done, lastPrescription: p0, lastLog: { id: 'l1', actual: held(30), audit: [] } })
    expect(finish(p1, held(40), done)).toMatchObject({ status: 'completed', values: { durationSeconds: p1.parameters.durationSeconds } })
  })

  it('does not complete at the top of the first window when the stop time is higher', () => {
    expect(finish(prescribe(rule('hold_seconds')), held(30)).status).toBe('active')
  })

  it('leaves the other timed presets on their old completion rule', () => {
    expect(finish(prescribe(rule('autoregulated', { durationSeconds: { min: 30, max: 60 }, reps: { min: 1, max: 1 }, completion: metrics('max_duration') })), held(60)).status).toBe('completed')
  })
})
