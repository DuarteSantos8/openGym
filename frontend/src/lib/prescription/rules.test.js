import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS, defaultPlanRule, editPlan, isTemplateRule, needsOneRm, planOptions, planPhase, policyOfPreset, presetForPolicy, pyramidDirection, rptOffsets, supports, validateIntensifier, validatePlanRule, withRest } from '../../../../api/engine/rules.js'

const rule = (preset, options = {}) => defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg', ...options })
const errorsOf = r => validatePlanRule(r).errors
// One phase of a rule, edited in place: what an advanced (non-template) change looks like.
const withPhase = (r, patch, i = 0) => ({ ...r, program: { ...r.program, phases: r.program.phases.map((ph, j) => (j === i ? { ...ph, ...patch(ph) } : ph)) } })
const withParams = (r, params) => withPhase(r, ph => ({ parameters: { ...ph.parameters, ...params } }))
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })

describe('template catalogue', () => {
  it('has the ten v1-era presets and the three configurable templates', () => {
    expect(PRESET_IDS).toEqual(['autoregulated', 'linear', 'greyskull', 'double', 'triple', 'hold_seconds', 'bodyweight_ladder', 'pyramid_reps', 'pyramid', 'five_three_one',
      'top_set_backoff', 'accumulation_intensification', 'density'])
  })

  it.each(PRESET_IDS)('%s builds a valid program in kg and lb, and reads back as the same numbers', preset => {
    for (const unit of ['kg', 'lb']) {
      const r = defaultPlanRule(preset, { id: 'r', exerciseId: 'e', unit })
      expect(errorsOf(r)).toEqual([])
      expect(isTemplateRule(r)).toBe(true)
      expect(defaultPlanRule(preset, { id: 'r', exerciseId: 'e', unit, ...planOptions(r) })).toEqual(r)
    }
  })

  it('reads back the less common shapes too', () => {
    for (const r of [
      rule('bodyweight_ladder', { loadedPreset: 'double', loadedReps: { min: 6, max: 10 }, rungs: [] }),
      rule('bodyweight_ladder', { rungs: ['knee', 'full'] }),
      rule('linear', { unloadedLadder: true, repCeiling: 15, load: abs(0) }),
      rule('pyramid_reps', { setReps: [12, 'max', 8], setRest: [60, 0, 90], sets: { min: 3, max: 3 }, reps: { min: 12, max: 12 } }),
      rule('pyramid', { offsets: rptOffsets(3), reps: { min: 6, max: 6 } }),
      rule('autoregulated', { durationSeconds: { min: 30, max: 60 }, reps: { min: 1, max: 1 } }),
      rule('top_set_backoff', { scope: 'all', backoff: { sets: 2, reps: 10, percent: 80, restSeconds: 90 } }),
      rule('accumulation_intensification', { end: 'complete', trainingMax: { mode: 'direct', value: 120, unit: 'kg' } })
    ]) {
      expect(errorsOf(r)).toEqual([])
      expect(isTemplateRule(r)).toBe(true)
    }
  })

  it('a top set and back-off is one heavy set of 6 and three of 8 at 90 %, judged on the top set', () => {
    const ph = planPhase(rule('top_set_backoff', { load: abs(100) }))
    expect(ph.groups.map(g => [g.id, g.count, g.reps, g.load, g.restSeconds])).toEqual([
      ['top', { min: 1, max: 1 }, 'parameters', { basis: 'anchor', percent: 100 }, 180],
      ['backoff', { min: 3, max: 3 }, { min: 8, max: 8 }, { basis: 'anchor', percent: 90 }, 120]
    ])
    expect(ph.parameters.reps).toEqual({ min: 6, max: 6 })
    expect(ph.success).toEqual({ scope: 'groups', groupIds: ['top'], load: 'prescribed', effort: 'rir_floor' })
    expect(ph.progression).toEqual([{ id: 'load', metric: 'load', when: 'success', basis: 'current', step: { type: 'absolute', value: 2.5, unit: 'kg' } }])
    expect(planPhase(rule('top_set_backoff', { scope: 'all' })).success.scope).toBe('all')
  })

  it('density takes 5 s of rest off after every clean session, down to 45 s', () => {
    expect(planPhase(rule('density')).progression).toEqual([{ id: 'rest', metric: 'restSeconds', when: 'success', step: 5, direction: 'down', min: 45, max: 90 }])
    expect(errorsOf(rule('density', { completion: [{ metric: 'rest_floor', target: 45 }] }))).toEqual([])
  })

  it('accumulation then intensification: reps climb at 65 % of the training max, then four clean sessions at 80 %', () => {
    const { phases, end } = rule('accumulation_intensification').program
    expect(end).toBe('repeat')
    expect(phases.map(ph => [ph.id, ph.parameters.sets, ph.parameters.reps, ph.groups[0].load, ph.exit])).toEqual([
      ['accumulation', { min: 3, max: 3 }, { min: 8, max: 12 }, { basis: 'training_max', percent: 65 }, { type: 'goal', metric: 'reps', target: 12 }],
      ['intensification', { min: 3, max: 3 }, { min: 4, max: 4 }, { basis: 'training_max', percent: 80 }, { type: 'successes', count: 4 }]
    ])
  })

  it('a pyramid starts from the offsets of its direction and reads the direction back from them', () => {
    const offsets = d => planOptions(rule('pyramid', { direction: d })).offsets.map(o => o.percentOfAnchor)
    expect(offsets('ascending')).toEqual([70, 85, 100])
    expect(offsets('descending')).toEqual([100, 90, 80])
    expect(offsets(undefined)).toEqual([70, 85, 100])
    expect(pyramidDirection(planOptions(rule('pyramid', { direction: 'descending' })).offsets)).toBe('descending')
    expect(pyramidDirection(planOptions(rule('pyramid')).offsets)).toBe('ascending')
    expect(pyramidDirection([{ percentOfAnchor: 100 }])).toBe('ascending')
  })

  it('editPlan rebuilds through the template; an advanced change is no longer a template rule', () => {
    const r = rule('linear', { load: abs(60) })
    expect(planPhase(editPlan(r, { reps: { min: 8, max: 8 } })).parameters.reps).toEqual({ min: 8, max: 8 })
    expect(isTemplateRule(withPhase(r, ph => ({ success: { ...ph.success, effort: 'ignore' } })))).toBe(false)
  })

  it('withRest sets every phase\'s rest and leaves group rests and a progressed rest alone', () => {
    const r = withRest(rule('five_three_one'), 120)
    expect(r.program.phases.map(ph => ph.parameters.restSeconds)).toEqual([120, 120, 120, 120])
    expect(planPhase(withRest(rule('top_set_backoff'), 200)).groups.map(g => g.restSeconds)).toEqual([180, 120])
  })
})

describe('validatePlanRule', () => {
  it('rejects an unknown preset, min above max, non-finite numbers and a missing rest', () => {
    expect(errorsOf({ ...rule('linear'), preset: 'nope' })).toEqual(['preset "nope" is not a preset'])
    expect(errorsOf(withParams(rule('double'), { reps: { min: 12, max: 8 } }))).toContain('program.phases[0].parameters.reps: min is above max')
    expect(errorsOf(withParams(rule('linear'), { load: { mode: 'absolute', value: NaN, unit: 'kg' } }))).toContain('program.phases[0].parameters.load.value must be a finite number ≥ 0')
    const { restSeconds, ...rest } = planPhase(rule('linear')).parameters
    expect(errorsOf(withPhase(rule('linear'), () => ({ parameters: rest })))).toContain('program.phases[0].parameters.restSeconds is required and must be ≥ 0')
  })

  it('phase ids are unique and an exit leads to a phase that exists', () => {
    const r = rule('five_three_one')
    expect(errorsOf(withPhase(r, () => ({ id: 'w2' })))).toContain('program.phases[1].id "w2" is duplicated')
    expect(errorsOf(withPhase(r, ph => ({ exit: { ...ph.exit, to: 'w9' } })))).toContain('program.phases[0].exit.to must name a phase')
  })

  it('a phase before the last must end', () => {
    expect(errorsOf(withPhase(rule('five_three_one'), () => ({ exit: null })))).toContain('program.phases[0].exit is required: a phase before the last must end')
    expect(errorsOf(withPhase(rule('five_three_one'), () => ({ exit: null }), 3))).toEqual([])
  })

  it('rejects an unknown operator, a metric stepped twice, and a rest or rung step without bounds', () => {
    expect(errorsOf(withPhase(rule('linear'), ph => ({ progression: [...ph.progression, { metric: 'tempo', when: 'success', step: 1 }] })))).toContain('program.phases[0].progression[1].metric must be one of load, reps, sets, durationSeconds, restSeconds, difficulty')
    expect(errorsOf(withPhase(rule('linear'), ph => ({ progression: [...ph.progression, ph.progression[0]] })))).toContain('program.phases[0].progression[1]: load is progressed twice')
    expect(errorsOf(withPhase(rule('density'), ph => ({ progression: [{ ...ph.progression[0], min: undefined }] })))).toContain('program.phases[0].progression[0]: restSeconds needs min and max')
  })

  it('rejects non-finite and negative steps, and allows zero', () => {
    const step = value => errorsOf(editPlan(rule('linear'), { step: { type: 'absolute', value, unit: 'kg' } }))
    expect(step(-2.5)).toContain('program.phases[0].progression[0].step.value must be a finite number ≥ 0')
    expect(step(NaN)).toContain('program.phases[0].progression[0].step.value must be a finite number ≥ 0')
    expect(step(0)).toEqual([])
    expect(errorsOf(withPhase(rule('density'), ph => ({ progression: [{ ...ph.progression[0], step: -5 }] })))).toContain('program.phases[0].progression[0].step must be a finite number ≥ 0')
  })

  it('a group reference must resolve: the success scope names this phase\'s groups, a training-max load needs a training max', () => {
    expect(errorsOf(withPhase(rule('top_set_backoff'), ph => ({ success: { ...ph.success, groupIds: ['heavy'] } })))).toContain('program.phases[0].success.groupIds must name groups of this phase')
    expect(errorsOf(withPhase(rule('linear'), ph => ({ groups: [{ ...ph.groups[0], load: { basis: 'training_max', percent: 80 } }] })))).toContain('program.phases[0].groups[0].load needs program.trainingMax')
  })

  it('a load range cannot be stepped automatically, and a load step needs a starting load', () => {
    expect(errorsOf(withParams(rule('linear'), { load: abs(60), loadTo: abs(80) }))).toContain('program.phases[0].parameters.loadTo: a load range cannot be stepped automatically')
    expect(errorsOf(withParams(rule('autoregulated'), { load: abs(60), loadTo: abs(80) }))).toEqual([])
    expect(errorsOf(withParams(rule('linear'), { load: { mode: 'empty' } }))).toContain('program.phases[0]: a load step needs a starting load')
  })

  it('checks a load range\'s high end against its low end', () => {
    const auto = (load, loadTo) => errorsOf(withParams(rule('autoregulated'), { load, loadTo }))
    expect(auto(abs(60), abs(80))).toEqual([])
    expect(auto({ mode: 'empty' }, abs(80))).toContain('program.phases[0].parameters.loadTo needs a load of the same mode')
    expect(auto(abs(60), { mode: 'absolute', value: 80, unit: 'lb' })).toContain('program.phases[0].parameters.loadTo.unit must match parameters.load.unit')
    expect(auto(abs(60), abs(50))).toContain('program.phases[0].parameters.loadTo must not be below parameters.load')
  })

  it('pairs percentage_points with a percent_1rm load, both ways', () => {
    const msg = 'a percent_1rm load progresses in percentage_points, and only it'
    expect(errorsOf(editPlan(rule('linear'), { step: { type: 'percentage_points', value: 5 } }))).toContain(msg)
    const pct = editPlan(rule('linear'), { load: { mode: 'percent_1rm', percent: 60 }, step: { type: 'percentage_points', value: 5 } })
    expect(errorsOf(pct)).toEqual([])
    expect(errorsOf(editPlan(pct, { step: { type: 'absolute', value: 2.5, unit: 'kg' } }))).toContain(msg)
  })

  it('rejects duplicate, unknown and unsatisfiable completion conditions', () => {
    const completion = list => errorsOf(editPlan(rule('linear'), { completion: list }))
    expect(completion([{ metric: 'target_load', target: null }, { metric: 'target_load', target: null }])).toContain('completion metric "target_load" is listed twice')
    expect(completion([{ metric: 'wins', target: 1 }])).toContain('completion metric "wins" is not supported')
    expect(errorsOf(editPlan(rule('linear'), { target: { mode: 'none' } }))).toContain('target_load needs a target')
    expect(errorsOf(editPlan(rule('bodyweight_ladder'), { completion: [{ metric: 'difficulty_rung', target: null }] }))).toContain('difficulty_rung needs named rungs')
    expect(errorsOf(editPlan(rule('linear'), { completion: [{ metric: 'rest_floor', target: 45 }] }))).toContain('rest_floor needs a rest step and a target ≥ 0')
    expect(errorsOf(editPlan(rule('hold_seconds'), { completion: [{ metric: 'max_duration', target: null }] }))).toContain('max_duration target must be a number > 0')
    expect(errorsOf(editPlan(rule('autoregulated', { durationSeconds: { min: 30, max: 60 } }), { completion: [{ metric: 'max_duration', target: null }] }))).toEqual([])
  })

  it('checks the training max and the cycle increment', () => {
    const r = rule('five_three_one')
    expect(errorsOf({ ...r, program: { ...r.program, trainingMax: { mode: 'direct', value: -5, unit: 'kg' } } })).toContain('program.trainingMax must be direct {value, unit} or ninety_percent_1rm')
    expect(errorsOf({ ...r, program: { ...r.program, cycleIncrement: { value: -1, unit: 'kg' } } })).toContain('program.cycleIncrement must be {value ≥ 0, unit}')
  })

  it('only a phase that steps load or seconds can back off', () => {
    expect(errorsOf(withPhase(rule('autoregulated'), () => ({ stall: { after: 3, count: 'misses', recovery: { method: 'factor', factor: 0.9 } } })))).toContain('program.phases[0]: only a phase that steps load or seconds can back off')
    expect(errorsOf(editPlan(rule('linear'), { deload: { after: 11, factor: 0.9 } }))).toContain('program.phases[0].stall.after must be a whole number of sessions from 1 to 10')
    expect(errorsOf(editPlan(rule('linear'), { deload: { after: 3, factor: 0.3 } }))).toContain('program.phases[0].stall.recovery.factor must be between 0.5 and 0.95')
  })

  it('holds a program to 32 phases, 50 groups and 50 rows a phase, and 8 operators', () => {
    const r = rule('linear')
    const ph = planPhase(r)
    expect(errorsOf({ ...r, program: { ...r.program, phases: Array.from({ length: 33 }, (_, i) => ({ ...ph, id: 'p' + i, exit: { type: 'exposures', count: 1 } })) } })).toContain('program.phases must hold 1 to 32 phases')
    expect(errorsOf(withPhase(r, () => ({ groups: Array.from({ length: 51 }, (_, i) => ({ ...ph.groups[0], id: 'g' + i, count: { min: 1, max: 1 } })) })))).toContain('program.phases[0].groups must hold 1 to 50 groups')
    expect(errorsOf(withParams(r, { sets: { min: 51, max: 51 } }))).toContain('program.phases[0].groups must resolve to 1 to 50 rows')
    expect(errorsOf(withPhase(r, () => ({ progression: Array.from({ length: 9 }, () => ph.progression[0]) })))).toContain('program.phases[0].progression must hold at most 8 operators')
  })

  it('accepts a starting load above the target cap', () => {
    expect(errorsOf(editPlan(rule('linear'), { load: abs(120) }))).toEqual([])
  })
})

describe('editor metadata', () => {
  it('declares, per template, which fields the editor offers as ranges', () => {
    const all = v => ({ sets: v, reps: v, durationSeconds: v, load: v })
    expect(Object.fromEntries(PRESET_IDS.map(id => [id, PRESETS[id].ranges]))).toEqual({
      autoregulated: all('either'), linear: all('fixed'), greyskull: all('fixed'),
      double: { sets: 'fixed', reps: 'range', durationSeconds: 'range', load: 'fixed' },
      triple: { sets: 'range', reps: 'range', durationSeconds: 'range', load: 'fixed' },
      hold_seconds: { sets: 'either', reps: 'fixed', durationSeconds: 'either', load: 'fixed' },
      bodyweight_ladder: { sets: 'range', reps: 'range', durationSeconds: 'fixed', load: 'fixed' },
      pyramid_reps: all('fixed'),
      pyramid: { sets: 'either', reps: 'fixed', durationSeconds: 'fixed', load: 'fixed' },
      five_three_one: all('fixed'), top_set_backoff: all('fixed'), accumulation_intensification: all('fixed'), density: all('fixed')
    })
  })
})

describe('needsOneRm', () => {
  it('is true for percent loads and targets, 1RM steps, and a 90%-of-1RM training max', () => {
    expect(needsOneRm(rule('linear'))).toBe(false)
    expect(needsOneRm(editPlan(rule('linear'), { load: { mode: 'percent_1rm', percent: 60 }, step: { type: 'percentage_points', value: 5 } }))).toBe(true)
    expect(needsOneRm(editPlan(rule('linear'), { target: { mode: 'percent_1rm', percent: 90 } }))).toBe(true)
    expect(needsOneRm(editPlan(rule('linear'), { step: { type: 'snapshot_1rm_percent', value: 2.5 } }))).toBe(true)
    expect(needsOneRm(rule('five_three_one'))).toBe(true)
    expect(needsOneRm(rule('accumulation_intensification'))).toBe(true)
    expect(needsOneRm(rule('autoregulated', { load: abs(60), loadTo: abs(80) }))).toBe(false)
  })
})

describe('supports', () => {
  it('hides extras a rule cannot use', () => {
    expect(supports(rule('linear'))).toEqual({ warmup: true, dropset: true, restpause: true })
    expect(supports(rule('linear', { durationSeconds: { min: 30, max: 30 } }))).toEqual({ warmup: false, dropset: false, restpause: false })
    expect(supports(rule('autoregulated', { durationSeconds: { min: 30, max: 60 } }))).toMatchObject({ warmup: false, dropset: false })
    expect(supports(rule('bodyweight_ladder'))).toEqual({ warmup: false, dropset: false, restpause: false })
    expect(supports(rule('pyramid'))).toEqual({ warmup: true, dropset: true, restpause: false })
    expect(supports(rule('five_three_one'))).toEqual({ warmup: true, dropset: true, restpause: false })
    expect(supports(rule('top_set_backoff'))).toEqual({ warmup: true, dropset: true, restpause: false })
    expect(supports(rule('hold_seconds'))).toEqual({ warmup: false, dropset: false, restpause: false })
    expect(supports(rule('pyramid_reps', { load: abs(20) }))).toEqual({ warmup: true, dropset: false, restpause: false })
  })
  it('validates an intensifier against its rule', () => {
    const drop = { type: 'dropset', count: 2, pct: 20 }
    expect(validateIntensifier(undefined)).toBe(true)
    expect(validateIntensifier(drop)).toBe(true)
    expect(validateIntensifier(drop, rule('autoregulated', { durationSeconds: { min: 30, max: 60 } }))).toBe(false)
    expect(validateIntensifier({ type: 'restpause', totalReps: 8, restSec: 15 }, rule('pyramid'))).toBe(false)
    expect(validateIntensifier({ type: 'dropset', count: 0, pct: 20 })).toBe(false)
    expect(validateIntensifier({ ...drop, extra: 1 })).toBe(false)
  })
})

describe('v1 policy ↔ preset', () => {
  it('maps each v1 policy to its exact preset, anything else to autoregulated', () => {
    expect(presetForPolicy('linear', 'reps', false)).toBe('linear')
    expect(presetForPolicy('linear', 'reps', true)).toBe('bodyweight_ladder')
    expect(presetForPolicy('greyskull', 'reps', false)).toBe('greyskull')
    expect(presetForPolicy('double', 'reps', false)).toBe('double')
    expect(presetForPolicy('time', 'time', false)).toBe('hold_seconds')
    expect(presetForPolicy('time', 'reps', false)).toBe('autoregulated')
    expect(presetForPolicy('off', 'reps', false)).toBe('autoregulated')
    expect(presetForPolicy(undefined, 'cardio', false)).toBe('autoregulated')
  })
  it('reads a preset back as the policy the Coach knows, null when there is none', () => {
    expect(['linear', 'greyskull', 'double'].map(policyOfPreset)).toEqual(['linear', 'greyskull', 'double'])
    expect(policyOfPreset('bodyweight_ladder')).toBe('linear')
    expect(policyOfPreset('hold_seconds')).toBe('time')
    expect(policyOfPreset('autoregulated')).toBe('off')
    expect(policyOfPreset('triple')).toBe('triple')
    for (const p of ['pyramid', 'five_three_one', 'top_set_backoff', 'accumulation_intensification', 'density']) expect(policyOfPreset(p)).toBe(null)
  })
})

describe('rptOffsets', () => {
  it('each set 10 % lighter and 2 reps higher, floored at 50 %', () => {
    expect(rptOffsets(3, 6)).toEqual([{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }])
    expect(rptOffsets(8).map(o => o.percentOfAnchor)).toEqual([100, 90, 80, 70, 60, 50, 50, 50])
    for (const n of [1, 3, 5]) expect(errorsOf(rule('pyramid', { offsets: rptOffsets(n), sets: { min: n, max: n } }))).toEqual([])
  })
})
