import { describe, expect, it } from 'vitest'
import { defaultPlanRule } from '../../../../api/engine/rules.js'
import { generatePrescription } from '../../../../api/engine/generate.js'
import { advanceProgression } from '../../../../api/engine/advance.js'
import { summarizeActual } from '../../../../api/engine/audit.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
const rule = (preset, patch = r => r) => patch(defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg' }))
const prescribe = (r, extra = {}) => generatePrescription({ id: 'p1', now: NOW, trackId: 't1', rule: r, ...extra })
const finish = (p, actual, state = null) => advanceProgression({ state, prescription: p, log: { id: 'log-' + p.id, actual }, now: NOW })
const metrics = (...names) => names.map(metric => ({ metric, target: null }))

describe('the increment gate', () => {
  it('linear earns an increment only when every set hit the prescription', () => {
    const p = prescribe(rule('linear'))
    expect(finish(p, { sets: 3, reps: 5, load: kg(20) }).readyToIncrement).toBe(true)
    expect(finish(p, { sets: 3, reps: 4, load: kg(20) }).readyToIncrement).toBe(false)
    expect(finish(p, { sets: 2, reps: 5, load: kg(20) }).readyToIncrement).toBe(false)
    expect(finish(p, { sets: 3, reps: 5, load: kg(17.5) }).readyToIncrement).toBe(false)
  })

  it('linear uses seconds instead of repetitions for a timed rule', () => {
    const p = prescribe(rule('linear', r => ({ ...r, parameters: { ...r.parameters, durationSeconds: { min: 45, max: 45 } } })))
    expect(finish(p, { sets: 3, reps: null, durationSeconds: 45, load: kg(20) }).readyToIncrement).toBe(true)
  })

  it('double progression moves the load only at the top of the rep range', () => {
    const p = prescribe(rule('double'))
    expect(finish(p, { sets: 3, reps: 12, load: kg(20) }).readyToIncrement).toBe(true)
    expect(finish(p, { sets: 3, reps: 11, load: kg(20) }).readyToIncrement).toBe(false)
  })

  it('double progression moves the load only at the top of a time range', () => {
    const p = prescribe(rule('double', r => ({ ...r, parameters: { ...r.parameters, durationSeconds: { min: 45, max: 60 } } })))
    expect(finish(p, { sets: 3, reps: null, durationSeconds: 60, load: kg(20) }).readyToIncrement).toBe(true)
    expect(finish(p, { sets: 3, reps: null, durationSeconds: 59, load: kg(20) }).readyToIncrement).toBe(false)
  })

  it('triple progression needs the most sets and the most reps', () => {
    const p = prescribe(rule('triple'))
    expect(finish(p, { sets: 5, reps: 12, load: kg(20) }).readyToIncrement).toBe(true)
    expect(finish(p, { sets: 3, reps: 12, load: kg(20) }).readyToIncrement).toBe(false)
  })

  it('manual never earns an increment', () => {
    expect(finish(prescribe(rule('manual')), { sets: 3, reps: 8, load: null }).readyToIncrement).toBe(false)
  })
})

describe('completion', () => {
  const capped = rule('triple', r => ({ ...r, parameters: { ...r.parameters, sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 100, unit: 'kg' } }, completion: metrics('target_load', 'max_reps') }))

  it('completes only when every condition passes, then freezes increments', () => {
    const p = prescribe(capped)
    expect(finish(p, { sets: 3, reps: 4, load: kg(100) })).toMatchObject({ status: 'active', readyToIncrement: false })
    const done = finish(p, { sets: 3, reps: 5, load: kg(100) })
    expect(done).toMatchObject({ status: 'completed', terminalTarget: kg(100), completedAt: NOW, readyToIncrement: false, lastPrescriptionId: 'p1', lastCompletedLogId: 'log-p1' })
  })

  it('keeps logging on a completed track without advancing, until an edit reopens it', () => {
    const p = prescribe(capped)
    const done = finish(p, { sets: 3, reps: 5, load: kg(100) })
    const lastLog = { id: 'log-p1', actual: { sets: 3, reps: 5, load: kg(100) }, audit: [] }
    const held = prescribe(capped, { id: 'p2', state: done, lastPrescription: p, lastLog })
    expect(held.statusAtGeneration).toBe('completed')
    expect(held.parameters.load.resolved).toEqual(kg(100))
    expect(finish(held, { sets: 3, reps: 5, load: kg(105) }, done)).toMatchObject({ status: 'completed', lastCompletedLogId: 'log-p2', readyToIncrement: false, terminalTarget: kg(100) })
    const edited = prescribe({ ...capped, revision: 2 }, { id: 'p3', state: done, lastPrescription: p, lastLog })
    expect(finish(edited, { sets: 3, reps: 4, load: kg(100) }, done)).toMatchObject({ status: 'active', planRuleRevision: 2, terminalTarget: null, completedAt: null })
  })

  it('an initial load above the cap completes once the other conditions pass', () => {
    const over = rule('triple', r => ({ ...r, parameters: { ...r.parameters, sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 120, unit: 'kg' } }, completion: metrics('target_load', 'max_sets') }))
    const p = prescribe(over)
    expect(p.parameters.load.resolved).toEqual(kg(100))
    expect(finish(p, { sets: 3, reps: 5, load: kg(120) }).status).toBe('completed')
  })

  it('5/3/1 walks the weeks, adds the TM increment at cycle end, and completes on cycle count', () => {
    const r = rule('five_three_one', x => ({ ...x, special: { ...x.special, trainingMax: { mode: 'direct', value: 100, unit: 'kg' } }, completion: [{ metric: 'cycle_count', target: 1 }] }))
    let state = null
    let last = null
    for (let week = 0; week < 4; week++) {
      const p = prescribe(r, { id: 'w' + week, state, lastPrescription: last })
      expect(p.position).toBe(week)
      state = finish(p, { sets: 3, reps: 5, load: p.rows[2].load }, state)
      last = p
    }
    expect(state).toMatchObject({ cyclesCompleted: 1, position: 0, trainingMax: kg(102.5), status: 'completed' })
  })

  it('5/3/1 completes on a training-max target', () => {
    const r = rule('five_three_one', x => ({ ...x, special: { ...x.special, trainingMax: { mode: 'direct', value: 100, unit: 'kg' } }, completion: [{ metric: 'training_max', target: 102.5 }] }))
    let state = null
    let last = null
    for (let week = 0; week < 4; week++) {
      const p = prescribe(r, { id: 'w' + week, state, lastPrescription: last })
      state = finish(p, { sets: 3, reps: 5, load: p.rows[2].load }, state)
      last = p
    }
    expect(state.status).toBe('completed')
  })

  it('climbs a bodyweight ladder at max volume and completes on the final rung', () => {
    const r = rule('bodyweight_ladder', x => ({ ...x, special: { rungs: ['knee push-up', 'push-up'] }, completion: metrics('max_sets', 'max_reps', 'difficulty_rung') }))
    const p0 = prescribe(r)
    const s1 = finish(p0, { sets: 5, reps: 10, load: null })
    expect(s1).toMatchObject({ position: 1, status: 'active', readyToIncrement: false })
    const p1 = prescribe(r, { id: 'p2', state: s1, lastPrescription: p0, lastLog: { id: 'l1', actual: { sets: 5, reps: 10, load: null }, audit: [] } })
    expect(p1.prefill).toMatchObject({ sets: 3, reps: 5 })
    expect(finish(p1, { sets: 5, reps: 10, load: null }, s1).status).toBe('completed')
  })
})

describe('the effort floor', () => {
  const withRir = (r, rir = { min: 1, max: 3 }) => ({ ...r, parameters: { ...r.parameters, rir } })
  const lifted = rir => ({ sets: 3, reps: 5, load: kg(20), ...(rir === undefined ? {} : { rir }) })
  const linearRir = () => prescribe(withRir(rule('linear')))

  it('holds the load when the weakest set left fewer reps in reserve than the floor', () => {
    expect(finish(linearRir(), lifted(0)).readyToIncrement).toBe(false)
    expect(finish(linearRir(), lifted(1)).readyToIncrement).toBe(true)
    expect(finish(linearRir(), lifted(4)).readyToIncrement).toBe(true)
  })

  it('reads effort entered as RPE through the same floor', () => {
    const rpe = rpeEntered => summarizeActual(linearRir(), [0, 1, 2].map(row => ({ row, reps: 5, load: kg(20), rpeEntered })))
    expect(finish(linearRir(), rpe(9)).readyToIncrement).toBe(true)    // RPE 9 = RIR 1
    expect(finish(linearRir(), rpe(10)).readyToIncrement).toBe(false)   // RPE 10 = RIR 0
  })

  it('never blocks when no effort was logged', () => {
    expect(finish(linearRir(), lifted()).readyToIncrement).toBe(true)
  })

  it('is off when the rule names no target effort', () => {
    expect(finish(prescribe(rule('linear')), lifted(0)).readyToIncrement).toBe(true)
  })

  it('applies to double progression', () => {
    const p = prescribe(withRir(rule('double')))
    expect(finish(p, { sets: 3, reps: 12, load: kg(20), rir: 0 }).readyToIncrement).toBe(false)
    expect(finish(p, { sets: 3, reps: 12, load: kg(20), rir: 2 }).readyToIncrement).toBe(true)
  })

  it('does not hold greyskull, whose last set is an AMRAP taken to failure', () => {
    const p = prescribe(withRir(rule('greyskull')))
    expect(finish(p, { sets: 3, reps: 5, load: kg(20), rir: 0 }).readyToIncrement).toBe(true)
  })

  it('reads only the anchor set of a reverse pyramid', () => {
    const p = prescribe(withRir(rule('reverse_pyramid')))
    const set = (row, rir, load) => ({ row, reps: 8, load: kg(load), rir })
    expect(finish(p, summarizeActual(p, [set(0, 0, 20), set(1, 3, 17.5), set(2, 3, 15)])).readyToIncrement).toBe(false)
    expect(finish(p, summarizeActual(p, [set(0, 2, 20), set(1, 0, 17.5), set(2, 0, 15)])).readyToIncrement).toBe(true)
  })
})

describe('RPT pyramids', () => {
  it('lets only the anchor set decide, using its own reps', () => {
    const r = rule('reverse_pyramid', x => ({ ...x, parameters: { ...x.parameters, reps: { min: 6, max: 6 } }, special: { offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] } }))
    const p = prescribe(r)
    const set = (row, reps, load) => ({ row, reps, load: kg(load) })
    expect(finish(p, summarizeActual(p, [set(0, 6, 20), set(1, 5, 17.5), set(2, 6, 15)])).readyToIncrement).toBe(true)
    expect(finish(p, summarizeActual(p, [set(0, 5, 20), set(1, 8, 17.5), set(2, 10, 15)])).readyToIncrement).toBe(false)
  })
})

describe('timed holds that climb in seconds', () => {
  const held = durationSeconds => ({ sets: 3, reps: null, durationSeconds, load: null })

  it('slides the window up one step when the top of it is held on every set', () => {
    const r = rule('hold_seconds')
    const p0 = prescribe(r)
    expect(p0.parameters.durationSeconds).toEqual({ min: 20, max: 30 })
    expect(finish(p0, held(29))).toMatchObject({ position: 0, readyToIncrement: false })
    const s1 = finish(p0, held(30))
    expect(s1).toMatchObject({ position: 1, status: 'active', readyToIncrement: false })
    const p1 = prescribe(r, { id: 'p2', state: s1, lastPrescription: p0, lastLog: { id: 'l1', actual: held(30), audit: [] } })
    expect(p1.parameters.durationSeconds).toEqual({ min: 25, max: 35 })
    expect(p1.prefill.durationSeconds).toBe(25)
  })

  it('completes at the stop time, then freezes: another session moves nothing', () => {
    const r = rule('hold_seconds', x => ({ ...x, completion: [{ metric: 'max_duration', target: 30 }] }))
    const p0 = prescribe(r)
    const done = finish(p0, held(30))
    expect(done.status).toBe('completed')
    const p1 = prescribe(r, { id: 'p2', state: done, lastPrescription: p0, lastLog: { id: 'l1', actual: held(30), audit: [] } })
    expect(finish(p1, held(40), done)).toMatchObject({ status: 'completed', position: done.position })
  })

  it('does not complete at the top of the first window when the stop time is higher', () => {
    expect(finish(prescribe(rule('hold_seconds')), held(30)).status).toBe('active')
  })

  it('leaves the other timed presets on their old completion rule', () => {
    const r = rule('duration', x => ({ ...x, completion: metrics('max_duration') }))
    expect(finish(prescribe(r), held(60)).status).toBe('completed')
  })
})
