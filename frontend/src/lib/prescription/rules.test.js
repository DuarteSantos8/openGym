import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS, defaultPlanRule, needsOneRm, policyOfPreset, presetForPolicy, rptOffsets, supports, validateIntensifier, validatePlanRule } from '../../../../api/engine/rules.js'

const rule = (preset, patch = r => r) => patch(defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg' }))
const withParams = (r, params) => ({ ...r, parameters: { ...r.parameters, ...params } })
const errorsOf = r => validatePlanRule(r).errors

describe('preset catalogue', () => {
  it('has exactly the spec presets', () => {
    expect(PRESET_IDS).toEqual(['manual', 'autoregulated', 'linear', 'greyskull', 'double', 'triple', 'duration', 'hold_seconds', 'bodyweight_ladder', 'pyramid', 'reverse_pyramid', 'five_three_one'])
  })

  it.each(PRESET_IDS)('%s has a valid default rule in kg and lb', preset => {
    for (const unit of ['kg', 'lb']) expect(errorsOf(defaultPlanRule(preset, { id: 'r', exerciseId: 'e', unit }))).toEqual([])
  })

  it.each(PRESET_IDS)('%s requires rest seconds', preset => {
    const r = rule(preset)
    expect(Number.isFinite(r.parameters.restSeconds)).toBe(true)
    const { restSeconds, ...rest } = r.parameters
    expect(errorsOf({ ...r, parameters: rest })).toContain('parameters.restSeconds is required and must be ≥ 0')
  })
})

describe('validatePlanRule', () => {
  it('rejects an unknown preset, min above max, and non-finite numbers', () => {
    expect(errorsOf({ ...rule('linear'), preset: 'nope' })).toEqual(['preset "nope" is not a preset'])
    expect(errorsOf(withParams(rule('double'), { reps: { min: 12, max: 8 } }))).toContain('parameters.reps: min is above max')
    expect(errorsOf(withParams(rule('linear'), { load: { mode: 'absolute', value: NaN, unit: 'kg' } }))).toContain('parameters.load.value must be a finite number ≥ 0')
  })

  it('pairs percentage_points only with a percent_1rm load', () => {
    expect(errorsOf({ ...rule('linear'), increment: { type: 'percentage_points', value: 5 } })).toContain('percentage_points pairs only with a percent_1rm load')
    const pct = { ...withParams(rule('linear'), { load: { mode: 'percent_1rm', percent: 60 } }), increment: { type: 'percentage_points', value: 5 } }
    expect(errorsOf(pct)).toEqual([])
    expect(errorsOf({ ...pct, increment: { type: 'absolute', value: 2.5, unit: 'kg' } })).toContain('a percent_1rm load progresses in percentage_points')
  })

  it('rejects duplicate, unsupported and unsatisfiable completion metrics', () => {
    const twice = { ...rule('linear'), completion: [{ metric: 'target_load', target: null }, { metric: 'target_load', target: null }] }
    expect(errorsOf(twice)).toContain('completion metric "target_load" is listed twice')
    expect(errorsOf({ ...rule('linear'), completion: [{ metric: 'cycle_count', target: 2 }] })).toContain('completion metric "cycle_count" is not supported by linear')
    expect(errorsOf({ ...rule('linear'), target: { mode: 'none' } })).toContain('target_load needs a target')
    expect(errorsOf({ ...rule('bodyweight_ladder'), completion: [{ metric: 'difficulty_rung', target: null }] })).toContain('difficulty_rung needs special.rungs')
  })

  it('checks pyramid offsets against their direction and the set count', () => {
    const up = rule('pyramid')
    expect(errorsOf({ ...up, special: { offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 80 }, { percentOfAnchor: 90 }] } })).toContain('special.offsets must rise set by set')
    expect(errorsOf(withParams(up, { sets: { min: 4, max: 4 } }))).toContain('parameters.sets must include the number of offsets')
    expect(errorsOf(withParams(up, { sets: { min: 2, max: 4 } }))).toEqual([])
    expect(errorsOf({ ...rule('reverse_pyramid'), special: { offsets: [{ percentOfAnchor: 90 }, { percentOfAnchor: 80 }, { percentOfAnchor: 70 }] } })).toContain('special.offsets must start at the anchor (100)')
  })

  it('checks the 5/3/1 training max and cycle template', () => {
    const r = rule('five_three_one')
    expect(errorsOf({ ...r, special: { ...r.special, trainingMax: { mode: 'direct', value: -5, unit: 'kg' } } })).toContain('special.trainingMax must be direct {value, unit} or ninety_percent_1rm')
    expect(errorsOf({ ...r, special: { ...r.special, cycleSets: [[{ percentOfTM: 65, reps: 0 }]] } })).toContain('special.cycleSets must be non-empty weeks of {percentOfTM, reps}')
  })

  it('rejects a negative increment step and allows zero (hold)', () => {
    const msg = 'increment.value must be a finite number ≥ 0'
    expect(errorsOf({ ...rule('linear'), increment: { type: 'absolute', value: -2.5, unit: 'kg' } })).toContain(msg)
    const pct = withParams(rule('linear'), { load: { mode: 'percent_1rm', percent: 60 } })
    expect(errorsOf({ ...pct, increment: { type: 'percentage_points', value: -5 } })).toContain(msg)
    expect(errorsOf({ ...rule('linear'), increment: { type: 'absolute', value: 0, unit: 'kg' } })).toEqual([])
    expect(errorsOf({ ...pct, increment: { type: 'percentage_points', value: 0 } })).toEqual([])
  })

  it('accepts a starting load above the target cap', () => {
    expect(errorsOf(withParams(rule('linear'), { load: { mode: 'absolute', value: 120, unit: 'kg' } }))).toEqual([])
  })
})

describe('fixed or ranged fields', () => {
  const abs = value => ({ mode: 'absolute', value, unit: 'kg' })

  it('declares, per preset, which fields may be ranges', () => {
    const all = v => ({ sets: v, reps: v, durationSeconds: v, load: v })
    expect(Object.fromEntries(PRESET_IDS.map(id => [id, PRESETS[id].ranges]))).toEqual({
      manual: all('either'), autoregulated: all('either'), linear: all('fixed'), greyskull: all('fixed'),
      double: { sets: 'fixed', reps: 'range', durationSeconds: 'range', load: 'fixed' },
      triple: { sets: 'range', reps: 'range', durationSeconds: 'range', load: 'fixed' },
      duration: { sets: 'either', reps: 'fixed', durationSeconds: 'either', load: 'fixed' },
      hold_seconds: { sets: 'either', reps: 'fixed', durationSeconds: 'either', load: 'fixed' },
      bodyweight_ladder: { sets: 'range', reps: 'range', durationSeconds: 'fixed', load: 'fixed' },
      pyramid: { sets: 'either', reps: 'fixed', durationSeconds: 'fixed', load: 'fixed' },
      reverse_pyramid: { sets: 'either', reps: 'fixed', durationSeconds: 'fixed', load: 'fixed' },
      five_three_one: all('fixed')
    })
  })

  it('rejects ranges only where the preset allows a fixed value', () => {
    expect(errorsOf(withParams(rule('linear'), { reps: { min: 5, max: 8 } }))).toContain('parameters.reps must be a fixed value for linear')
    expect(errorsOf(withParams(rule('greyskull'), { sets: { min: 3, max: 5 } }))).toContain('parameters.sets must be a fixed value for greyskull')
    expect(errorsOf(withParams(rule('double'), { sets: { min: 3, max: 5 } }))).toContain('parameters.sets must be a fixed value for double')
    expect(errorsOf(withParams(rule('double'), { durationSeconds: { min: 30, max: 60 } }))).toEqual([])
    expect(errorsOf(withParams(rule('double'), { sets: { min: 3, max: 3 } }))).toEqual([])
    expect(errorsOf(withParams(rule('manual'), { sets: { min: 3, max: 5 }, reps: { min: 8, max: 12 } }))).toEqual([])
  })

  it('reports min above max, not "fixed", for an inverted range', () => {
    expect(errorsOf(withParams(rule('linear'), { reps: { min: 8, max: 5 } }))).toEqual(['parameters.reps: min is above max'])
  })

  it('accepts a load range of the same mode where the preset allows one', () => {
    expect(errorsOf(withParams(rule('autoregulated'), { load: abs(60), loadTo: abs(80) }))).toEqual([])
    expect(errorsOf(withParams(rule('manual'), { load: abs(60), loadTo: abs(60) }))).toEqual([])
    expect(errorsOf(withParams(rule('autoregulated'), { load: { mode: 'percent_1rm', percent: 60 }, loadTo: { mode: 'percent_1rm', percent: 75 } }))).toEqual([])
  })

  it('rejects a load range the preset or the low end does not allow', () => {
    expect(errorsOf(withParams(rule('linear'), { loadTo: abs(40) }))).toContain('parameters.loadTo is not allowed for linear')
    const auto = (load, loadTo) => errorsOf(withParams(rule('autoregulated'), { load, loadTo }))
    expect(auto({ mode: 'empty' }, abs(80))).toContain('parameters.loadTo needs a load of the same mode')
    expect(auto(abs(60), { mode: 'percent_1rm', percent: 80 })).toContain('parameters.loadTo needs a load of the same mode')
    expect(auto(abs(60), { mode: 'absolute', value: 80, unit: 'lb' })).toContain('parameters.loadTo.unit must match parameters.load.unit')
    expect(auto(abs(60), abs(50))).toContain('parameters.loadTo must not be below parameters.load')
    expect(auto({ mode: 'percent_1rm', percent: 70 }, { mode: 'percent_1rm', percent: 65 })).toContain('parameters.loadTo must not be below parameters.load')
    expect(auto(abs(60), { mode: 'empty' })).toContain('parameters.loadTo.mode must be one of absolute, percent_1rm')
    expect(auto(abs(60), abs(NaN))).toContain('parameters.loadTo.value must be a finite number ≥ 0')
  })
})

describe('needsOneRm', () => {
  it('is true for percent loads and targets, 1RM increments, and a 90%-of-1RM training max', () => {
    expect(needsOneRm(rule('linear'))).toBe(false)
    expect(needsOneRm({ ...withParams(rule('linear'), { load: { mode: 'percent_1rm', percent: 60 } }), increment: { type: 'percentage_points', value: 5 } })).toBe(true)
    expect(needsOneRm({ ...rule('linear'), target: { mode: 'percent_1rm', percent: 90 } })).toBe(true)
    expect(needsOneRm({ ...rule('linear'), increment: { type: 'snapshot_1rm_percent', value: 2.5 } })).toBe(true)
    expect(needsOneRm(rule('five_three_one'))).toBe(true)
    // A load range shares its low end's mode, so the low end already decides.
    expect(needsOneRm(withParams(rule('autoregulated'), { load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } }))).toBe(false)
  })
})

describe('supports', () => {
  it('hides extras a rule cannot use', () => {
    expect(supports(rule('linear'))).toEqual({ warmup: true, dropset: true, restpause: true })
    expect(supports(withParams(rule('linear'), { durationSeconds: { min: 30, max: 30 } }))).toEqual({ warmup: false, dropset: false, restpause: false })
    expect(supports(rule('duration'))).toMatchObject({ warmup: false, dropset: false })
    expect(supports(rule('bodyweight_ladder'))).toEqual({ warmup: false, dropset: false, restpause: false })
    expect(supports(rule('pyramid'))).toEqual({ warmup: true, dropset: true, restpause: false })
    expect(supports(rule('five_three_one'))).toEqual({ warmup: true, dropset: true, restpause: false })
  })
  it('validates an intensifier against its rule', () => {
    const drop = { type: 'dropset', count: 2, pct: 20 }
    expect(validateIntensifier(undefined)).toBe(true)
    expect(validateIntensifier(drop)).toBe(true)
    expect(validateIntensifier(drop, rule('duration'))).toBe(false)
    expect(validateIntensifier({ type: 'restpause', totalReps: 8, restSec: 15 }, rule('pyramid'))).toBe(false)
    expect(validateIntensifier({ type: 'dropset', count: 0, pct: 20 })).toBe(false)
    expect(validateIntensifier({ ...drop, extra: 1 })).toBe(false)
  })
})

describe('v1 policy ↔ preset', () => {
  it('maps each v1 policy to its exact preset, anything else to manual', () => {
    expect(presetForPolicy('linear', 'reps', false)).toBe('linear')
    expect(presetForPolicy('linear', 'reps', true)).toBe('bodyweight_ladder')
    expect(presetForPolicy('greyskull', 'reps', false)).toBe('greyskull')
    expect(presetForPolicy('double', 'reps', false)).toBe('double')
    expect(presetForPolicy('time', 'time', false)).toBe('duration')
    expect(presetForPolicy('time', 'reps', false)).toBe('manual')
    expect(presetForPolicy('off', 'reps', false)).toBe('manual')
    expect(presetForPolicy(undefined, 'cardio', false)).toBe('manual')
  })
  it('reads a preset back as the policy the Coach knows, null when there is none', () => {
    expect(['linear', 'greyskull', 'double'].map(policyOfPreset)).toEqual(['linear', 'greyskull', 'double'])
    expect(policyOfPreset('bodyweight_ladder')).toBe('linear')
    expect(policyOfPreset('duration')).toBe('time')
    expect(policyOfPreset('manual')).toBe('off')
    for (const p of ['triple', 'pyramid', 'reverse_pyramid', 'five_three_one', 'autoregulated', 'hold_seconds']) expect(policyOfPreset(p)).toBe(null)
  })
})

describe('per-set reps on pyramids', () => {
  const withOffsets = (preset, offsets, sets) => ({ ...rule(preset), parameters: { ...rule(preset).parameters, sets: { min: sets ?? offsets.length, max: sets ?? offsets.length } }, special: { offsets } })

  it('accepts whole-number reps on the sets that are not the anchor', () => {
    expect(errorsOf(withOffsets('reverse_pyramid', [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }]))).toEqual([])
    expect(errorsOf(withOffsets('pyramid', [{ percentOfAnchor: 70, reps: 12 }, { percentOfAnchor: 85, reps: 10 }, { percentOfAnchor: 100 }]))).toEqual([])
  })

  it('rejects reps that are not whole numbers ≥ 1, and reps on the anchor set', () => {
    const bad = reps => errorsOf(withOffsets('reverse_pyramid', [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps }]))
    expect(bad(0)).toContain('special.offsets[1].reps must be a whole number ≥ 1')
    expect(bad(8.5)).toContain('special.offsets[1].reps must be a whole number ≥ 1')
    expect(bad('8')).toContain('special.offsets[1].reps must be a whole number ≥ 1')
    expect(errorsOf(withOffsets('reverse_pyramid', [{ percentOfAnchor: 100, reps: 6 }, { percentOfAnchor: 90 }]))).toContain('special.offsets: the anchor set takes its reps from parameters.reps')
  })

  it('rptOffsets: each set 10 % lighter and 2 reps higher, floored at 50 %', () => {
    expect(rptOffsets(3, 6)).toEqual([{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }])
    expect(rptOffsets(3)).toEqual(rptOffsets(3, 6))
    expect(rptOffsets(8).map(o => o.percentOfAnchor)).toEqual([100, 90, 80, 70, 60, 50, 50, 50])
    for (const n of [1, 3, 5]) expect(errorsOf(withOffsets('reverse_pyramid', rptOffsets(n)))).toEqual([])
  })
})

describe('hold_seconds', () => {
  it('pairs the seconds increment with this preset only', () => {
    const pair = 'seconds increments pair only with hold_seconds, and hold_seconds needs them'
    expect(errorsOf({ ...rule('hold_seconds'), increment: { type: 'absolute', value: 2.5, unit: 'kg' } })).toContain(pair)
    expect(errorsOf({ ...rule('linear'), increment: { type: 'seconds', value: 5 } })).toContain(pair)
    expect(errorsOf({ ...rule('duration'), increment: { type: 'seconds', value: 5 } })).toContain(pair)
  })

  it('needs a duration and a positive stop time; other presets still accept no stop time', () => {
    const r = rule('hold_seconds')
    const { durationSeconds, ...rest } = r.parameters
    const stop = 'max_duration target must be a number > 0'
    expect(errorsOf({ ...r, parameters: rest })).toContain('hold_seconds needs parameters.durationSeconds')
    expect(errorsOf({ ...r, completion: [{ metric: 'max_duration', target: 0 }] })).toContain(stop)
    expect(errorsOf({ ...r, completion: [{ metric: 'max_duration', target: null }] })).toContain(stop)
    expect(errorsOf({ ...r, completion: [] })).toEqual([])
    expect(errorsOf({ ...rule('duration'), completion: [{ metric: 'max_duration', target: null }] })).toEqual([])
  })

  it('offers no warm-up, drop set or rest-pause', () => {
    expect(supports(rule('hold_seconds'))).toEqual({ warmup: false, dropset: false, restpause: false })
  })
})
