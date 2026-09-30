import { describe, expect, it } from 'vitest'
import { cardioParameters, defaultPlanRule, generatePrescription } from './prescription/index.js'
import { actualOfRow, entriesForExposures, exposuresWithPerformance, loadStepFor, planSummary, rowFindings, rowIndexOf, rowsOfPerformance } from './session-ui-adapter.js'
import { makeSideSet, toggleSide } from './workout-model.js'
import { legacyEntriesOf } from './prescription/index.js'
import { volumeOf } from './history.js'

const NOW = '2026-09-24T10:00:00.000Z'
const pyramid = generatePrescription({
  id: 'p1', now: NOW, trackId: 't1',
  rule: { ...defaultPlanRule('pyramid', { id: 'r', exerciseId: '0025', unit: 'kg' }), parameters: { ...defaultPlanRule('pyramid', { id: 'r', exerciseId: '0025', unit: 'kg' }).parameters, load: { mode: 'absolute', value: 100, unit: 'kg' } }, target: { mode: 'absolute', value: 150, unit: 'kg' } }
})
const rpt = generatePrescription({
  id: 'p3', now: NOW, trackId: 't3',
  rule: { ...defaultPlanRule('reverse_pyramid', { id: 'r3', exerciseId: '0025', unit: 'kg' }), parameters: { ...defaultPlanRule('reverse_pyramid', { id: 'r3', exerciseId: '0025', unit: 'kg' }).parameters, reps: { min: 6, max: 6 }, load: { mode: 'absolute', value: 100, unit: 'kg' } }, special: { offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] } }
})

describe('entriesForExposures', () => {
  it('projects prescription rows into editable rows with prefill and rest', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x1', exerciseId: '0025', prescriptionId: 'p1', routineId: 'r1' }], { p1: pyramid })
    expect(entry).toMatchObject({ id: '0025', exposureId: 'x1', rid: 'r1', target: { sets: 3, reps: 8, weight: 70, restSec: 150 } })
    expect(entry.sets.map(s => [s.setId, s.r, s.w, s.done])).toEqual([['r0', 8, 70, false], ['r1', 8, 85, false], ['r2', 8, 100, false]])
    expect(loadStepFor(pyramid, 'kg')).toBe(2.5)
    expect(rowIndexOf(entry.sets[2])).toBe(2)
    expect(rowIndexOf({ done: true })).toBe(null)
  })

  it('gives every RPT row its own reps and shows them in the summary', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x3', exerciseId: '0025', prescriptionId: 'p3' }], { p3: rpt })
    expect(entry.sets.map(s => [s.r, s.w])).toEqual([[6, 100], [8, 90], [10, 80]])
    expect(planSummary(rpt)).toBe('3 × 6/8/10 @ 100/90/80 kg')
  })
})

describe('entriesForExposures intensifier', () => {
  const linear = generatePrescription({ id: 'p2', now: NOW, trackId: 't2', rule: defaultPlanRule('linear', { id: 'r2', exerciseId: '0025', unit: 'kg' }) })
  const run = intensifier => entriesForExposures([{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p2', intensifier }], { p2: linear })[0]
  it('stamps drops on every work row and exposes the plan on the target', () => {
    const entry = run({ type: 'dropset', count: 2, pct: 20 })
    expect(entry.target.intensifier.type).toBe('dropset')
    expect(entry.sets.every(s => s.type === 'dropset' && s.drops.length === 2 && s.setId)).toBe(true)
  })
  it('collapses to one prescribed rest-pause row', () => {
    const entry = run({ type: 'restpause', totalReps: 12, restSec: 15 })
    const work = entry.sets.filter(s => s.type === 'restpause')
    expect(work).toHaveLength(1)
    expect(work[0]).toMatchObject({ setId: 'r0', r: 12 })
  })
})

describe('exposuresWithPerformance', () => {
  it('writes the exact rows back with role, mode and normalized effort', () => {
    const exposures = [{ exposureId: 'x1', exerciseId: '0025', prescriptionId: 'p1' }]
    const entries = [{ exposureId: 'x1', id: '0025', target: { sets: 3, reps: 8 }, sets: [
      { phase: 'warmup', done: true, r: 12, w: 40 },
      { setId: 'r0', done: true, r: 7, w: 101.3, rpe: 8 },
      { done: false, r: 8, w: 70 }
    ] }]
    const [x] = exposuresWithPerformance(exposures, entries, 'kg')
    expect(x.mode).toBe('reps')
    expect(x.performance.sets.map(s => [s.role, s.status, s.prescribed])).toEqual([['warmup', 'completed', false], ['work', 'completed', true], ['work', 'skipped', false]])
    expect(x.performance.sets[1]).toMatchObject({ setId: 'r0', resistance: { kind: 'external-load', value: 101.3, unit: 'kg' }, rir: 2, rpeEntered: 8 })
  })
})

describe('live audit and plan line', () => {
  const linear = generatePrescription({ id: 'p2', now: NOW, trackId: 't', rule: defaultPlanRule('linear', { id: 'r', exerciseId: '0025', unit: 'kg' }) })

  it('reports findings per UI row, skipping warm-ups, and never blocks', () => {
    const entry = { sets: [{ phase: 'warmup', r: 12, w: 10 }, { setId: 'r0', r: 5, w: 20 }, { setId: 'r1', r: 3, w: 20 }, { r: 5, w: 150 }] }
    const found = rowFindings(linear, entry, 'kg')
    expect([...found.keys()]).toEqual([2, 3])
    expect(found.get(2).map(f => f.code)).toEqual(['below_range'])
    expect(found.get(3).map(f => f.code)).toEqual(['above_range', 'above_cap'])
  })

  it('summarizes sets, reps and per-row loads', () => {
    expect(planSummary(linear)).toBe('3 × 5 @ 20 kg')
    expect(planSummary(pyramid)).toBe('3 × 8 @ 70/85/100 kg')
  })

  it('shows a load range as low–high', () => {
    const base = defaultPlanRule('autoregulated', { id: 'r', exerciseId: '0025', unit: 'kg' })
    const rule = { ...base, parameters: { ...base.parameters, load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } } }
    expect(planSummary(generatePrescription({ id: 'p3', now: NOW, trackId: 't', rule }))).toBe('3 × 8–12 @ 60–80 kg')
  })
})

describe('warm-up materialization', () => {
  const r = defaultPlanRule('linear', { id: 'w1', exerciseId: 'ex1', routineId: 'rt', unit: 'kg' })
  r.parameters.load = { mode: 'absolute', value: 100, unit: 'kg' }
  const p = generatePrescription({ id: 'pw', now: '2026-09-25T00:00:00.000Z', trackId: 't', rule: r, warmup: { mode: 'smart', count: 2 }, equipment: 'barbell' })
  it('puts generated warm-ups before work, flagged automatic', () => {
    const [entry] = entriesForExposures([{ exerciseId: 'ex1', exposureId: 'e1', prescriptionId: 'pw' }], { pw: p })
    expect(entry.sets.slice(0, 2)).toEqual([
      { w: 75, r: 1, done: false, phase: 'warmup', warmup: true, autoWarmup: true },
      { w: 85, r: 1, done: false, phase: 'warmup', warmup: true, autoWarmup: true }
    ])
    expect(entry.sets.slice(2).every(s => !s.warmup && s.setId)).toBe(true)
    expect(entry.target.sets).toBe(p.rows.length)
  })
})

describe('a drop chain in a saved row', () => {
  it('is kept as segments, each drop at its own load, and read back as the drops it was', () => {
    const exposures = [{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p1', trackId: 't' }]
    const entries = [{ exposureId: 'x', sets: [{ w: 100, r: 8, done: true, type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] }] }]
    const [x] = exposuresWithPerformance(exposures, entries, 'kg')
    const [row] = x.performance.sets
    expect(row.segments.map(s => [s.resistance.value, s.observations[0].value, s.status])).toEqual([[80, 6, 'completed'], [60, 5, 'completed']])
    expect(legacyEntriesOf({ exposures: [x] })[0].sets[0]).toMatchObject({ w: 100, r: 8, type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] })
    expect(volumeOf(x.performance)).toBe(100 * 8 + 80 * 6 + 60 * 5)
  })
})

describe('saved rows read back as the rows that were logged', () => {
  const save = (sets, mode) => rowsOfPerformance(exposuresWithPerformance([{ exposureId: 'x', exerciseId: '0025' }], [{ exposureId: 'x', target: mode === 'cardio' ? { mode } : {}, sets }], 'kg')[0].performance.sets, mode)
  it('keeps a per-side row\'s limbs, one ticked and one not, and counts each as a saved row', () => {
    const half = toggleSide({ ...makeSideSet({ w: 20, r: 16 }), setId: 'r0' }, 'L')
    const [x] = exposuresWithPerformance([{ exposureId: 'x', exerciseId: '0025' }], [{ exposureId: 'x', sets: [half] }], 'kg')
    expect(x.performance.sets.map(s => [s.side, s.status, s.setId])).toEqual([['L', 'completed', 'r0'], ['R', 'skipped', 'r0']])
    expect(save([half])).toEqual([half])
  })
  it('keeps drop chains, rest-pause bursts, effort and warm-ups', () => {
    const rows = [
      { done: true, w: 40, r: 10, phase: 'warmup' },
      { setId: 'r0', done: true, w: 100, r: 6, rpe: 8, type: 'dropset', drops: [{ w: 80, r: 4 }] },
      { setId: 'r1', done: true, w: 90, r: 14, rir: 1, type: 'restpause', clusters: [{ r: 8, restSec: 15 }, { r: 4, restSec: 15 }, { r: 2, restSec: 15 }] },
    ]
    expect(save(rows)).toEqual(rows)
  })
  it('keeps a cardio interval\'s minutes and speed', () => {
    expect(save([{ done: true, min: 20, speed: 9.5, w: 0 }], 'cardio')).toEqual([{ done: true, min: 20, speed: 9.5, w: 0 }])
  })
  it('reads a migrated v1 per-side row, whose limbs sit under `sides`', () => {
    const limb = (w, done) => ({ role: 'work', status: done ? 'completed' : 'skipped', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: w }, segments: [] })
    const [row] = rowsOfPerformance([{ ...limb(22.5, false), sides: { L: limb(22.5, true), R: limb(20, false) } }])
    expect(row.sides).toEqual({ L: { w: 22.5, r: 5, done: true }, R: { w: 20, r: 5, done: false } })
  })
})

describe('entriesForExposures cardio', () => {
  const rule = { ...defaultPlanRule('manual', { id: 'rc', exerciseId: '3220', unit: 'kg' }), parameters: { ...defaultPlanRule('manual', { id: 'rc', exerciseId: '3220', unit: 'kg' }).parameters, ...cardioParameters({ sets: 2, min: 25, speed: 9.5 }) } }
  const p = generatePrescription({ id: 'pc', now: NOW, trackId: 'tc', rule })
  it('opens minutes-and-speed rows and says it is cardio, not a hold', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x', exerciseId: '3220', prescriptionId: 'pc', mode: 'cardio' }], { pc: p })
    expect(entry.target).toMatchObject({ mode: 'cardio', sets: 2, min: 25, speed: 9.5 })
    expect(entry.target).not.toHaveProperty('sec')
    expect(entry.sets).toEqual([{ setId: 'r0', done: false, min: 25, speed: 9.5 }, { setId: 'r1', done: false, min: 25, speed: 9.5 }])
  })
  it('a hold with the same duration stays a timed set', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x', exerciseId: '0001', prescriptionId: 'pc', mode: 'time' }], { pc: p })
    expect(entry.target).toMatchObject({ mode: 'time', sec: 1500 })
    expect(entry.sets[0]).toEqual({ setId: 'r0', done: false, sec: 1500 })
  })
  it('a finished cardio row is a duration in seconds and a speed to the engine', () => {
    expect(actualOfRow({ setId: 'r0', done: true, min: 20, speed: 9 }, 'kg')).toMatchObject({ row: 0, reps: null, durationSeconds: 1200, speed: 9 })
  })
})

describe('entriesForExposures warm-up rest', () => {
  const linear = generatePrescription({ id: 'p5', now: NOW, trackId: 't5', rule: defaultPlanRule('linear', { id: 'r5', exerciseId: '0025', unit: 'kg' }) })
  it('puts the exercise\'s own ramp rest on the target, where the rest timer reads it', () => {
    const run = warmupRestSec => entriesForExposures([{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p5', warmupRestSec }], { p5: linear })[0].target
    expect(run(31).warmupRestSec).toBe(31)
    expect(run(undefined)).not.toHaveProperty('warmupRestSec')
  })
})

describe('entriesForExposures per side', () => {
  const linear = generatePrescription({ id: 'p4', now: NOW, trackId: 't4', rule: { ...defaultPlanRule('linear', { id: 'r4', exerciseId: '0025', unit: 'kg' }), parameters: { ...defaultPlanRule('linear', { id: 'r4', exerciseId: '0025', unit: 'kg' }).parameters, reps: { min: 10, max: 10 } } } })
  it('splits every work row into limbs and says so on the target (issue #60)', () => {
    const [entry] = entriesForExposures([{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p4', side: true }], { p4: linear })
    expect(entry.target.side).toBe(true)
    // A bodyweight override rides on the target too, where the workout screen and plate loading read it.
    expect(entriesForExposures([{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p4', bodyweight: true }], { p4: linear })[0].target.bodyweight).toBe(true)
    expect(entriesForExposures([{ exposureId: 'x', exerciseId: '0025', prescriptionId: 'p4' }], { p4: linear })[0].target).not.toHaveProperty('bodyweight')
    expect(entry.sets.every(s => s.sides?.L.r === 5 && s.sides.R.r === 5 && s.r === 10 && s.setId)).toBe(true)
  })
})
