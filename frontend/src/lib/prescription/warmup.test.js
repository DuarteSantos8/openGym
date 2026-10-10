// frontend/src/lib/prescription/warmup.test.js
import { describe, expect, it } from 'vitest'
import { warmupMaxCount, migrateOccurrence, migrateWarmups, planWarmupRows, validateWarmup, warmupClass, warmupSteps } from '../../../../api/engine/warmup.js'

const kg = value => ({ value, unit: 'kg' })
const STEP = { mode: 'nearest', step: 2.5 }
const plan = (rows, warmup, eq = 'barbell', rounding = STEP) => planWarmupRows({ rows, warmup, eq, rounding })
const loads = out => out.map(r => r.load.value)

describe('warmupClass', () => {
  it('maps equipment to the documented classes', () => {
    expect(['barbell', 'smith machine'].map(warmupClass)).toEqual(['heavy', 'heavy'])
    expect(['dumbbell', 'machine', 'leverage machine', 'cable', 'leverage', 'body weight'].map(warmupClass)).toEqual(Array(6).fill('standard'))
    expect(['kettlebell', 'band', 'medicine ball'].map(warmupClass)).toEqual(['light', 'light', 'light'])
    expect([null, undefined, ''].map(warmupClass)).toEqual(['standard', 'standard', 'standard'])
  })
})

describe('warmupSteps', () => {
  it('smart keeps the last count steps of the class recipe', () => {
    expect(warmupSteps({ mode: 'smart', count: 2 }, 'barbell')).toEqual([{ percent: 75, reps: 1 }, { percent: 85, reps: 1 }])
    expect(warmupSteps({ mode: 'smart', count: 5 }, 'kettlebell')).toHaveLength(3)
  })
  it('template is used as written; off and missing give nothing', () => {
    const steps = [{ percent: 70, reps: 3 }, { percent: 50, reps: 5 }]
    expect(warmupSteps({ mode: 'template', steps }, 'barbell')).toEqual(steps)
    expect(warmupSteps({ mode: 'off' }, 'barbell')).toEqual([])
    expect(warmupSteps(undefined, 'barbell')).toEqual([])
  })
})

describe('warmupMaxCount', () => {
  it('is the recipe length of the equipment class', () => {
    expect(['barbell', 'dumbbell', 'kettlebell'].map(warmupMaxCount)).toEqual([5, 4, 3])
  })
})

describe('planWarmupRows', () => {
  it('smart heavy ramp against the first positive work row, rounded down', () => {
    const out = plan([{ load: kg(100) }, { load: kg(120) }], { mode: 'smart', count: 5 })
    expect(loads(out)).toEqual([25, 40, 60, 75, 85])
    expect(out.map(r => r.reps)).toEqual([8, 5, 3, 1, 1])
    expect(out.every(r => r.phase === 'warmup' && r.load.unit === 'kg')).toBe(true)
  })
  it('skips null/zero rows and never reads loadTo or later rows', () => {
    const out = plan([{ load: null }, { load: kg(0) }, { load: kg(60), loadTo: kg(80) }, { load: kg(200) }], { mode: 'smart', count: 1 })
    expect(loads(out)).toEqual([50])            // 85 % of 60 = 51 → 50
  })
  it('template percentages apply to the first work load', () => {
    expect(loads(plan([{ load: kg(80) }], { mode: 'template', steps: [{ percent: 50, reps: 5 }, { percent: 62.5, reps: 3 }] }))).toEqual([40, 50])
  })
  it('drops zero, duplicate and at-or-above-work rows', () => {
    const steps = [{ percent: 1, reps: 5 }, { percent: 50, reps: 5 }, { percent: 51, reps: 5 }, { percent: 100, reps: 1 }]
    expect(loads(plan([{ load: kg(20) }], { mode: 'template', steps }))).toEqual([10])
  })
  it('uses the rule step, and the unit fallback when rounding has no step', () => {
    expect(loads(plan([{ load: kg(100) }], { mode: 'smart', count: 1 }, 'barbell', { mode: 'nearest', step: 5 }))).toEqual([85])
    expect(loads(plan([{ load: kg(101) }], { mode: 'smart', count: 1 }, 'barbell', { mode: 'allowed_values', allowedValues: [100, 110] }))).toEqual([85])
    expect(loads(plan([{ load: { value: 200, unit: 'lb' } }], { mode: 'smart', count: 1 }, 'barbell', { mode: 'allowed_values', allowedValues: [200] }))).toEqual([170])
  })
  it('nothing for off, missing load or bodyweight rows', () => {
    expect(plan([{ load: kg(100) }], { mode: 'off' })).toEqual([])
    expect(plan([{ load: kg(100) }], undefined)).toEqual([])
    expect(plan([{ load: null }, { load: kg(0) }], { mode: 'smart', count: 3 })).toEqual([])
    expect(plan([], { mode: 'smart', count: 3 })).toEqual([])
  })
})

describe('validateWarmup', () => {
  it('accepts the three exclusive shapes and missing', () => {
    expect(validateWarmup(undefined)).toBe(true)
    expect(validateWarmup({ mode: 'off' })).toBe(true)
    expect(validateWarmup({ mode: 'smart', count: 3 })).toBe(true)
    expect(validateWarmup({ mode: 'template', steps: [{ percent: 62.5, reps: 3 }] })).toBe(true)
  })
  it('rejects mixed or out-of-range shapes', () => {
    for (const bad of [null, [], {}, { mode: 'x' }, { mode: 'off', count: 1 }, { mode: 'smart', count: 0 }, { mode: 'smart', count: 6 },
      { mode: 'smart', count: 2.5 }, { mode: 'smart', count: 2, steps: [] }, { mode: 'template', steps: [] }, { mode: 'template', count: 1, steps: [{ percent: 50, reps: 5 }] },
      { mode: 'template', steps: Array(6).fill({ percent: 50, reps: 5 }) }, { mode: 'template', steps: [{ percent: 0, reps: 5 }] },
      { mode: 'template', steps: [{ percent: 101, reps: 5 }] }, { mode: 'template', steps: [{ percent: 50, reps: 31 }] },
      { mode: 'template', steps: [{ percent: 50, reps: 1.5 }] }, { mode: 'template', steps: [{ percent: NaN, reps: 5 }] },
      { mode: 'template', steps: [{ percent: 50, reps: 5, x: 1 }] }]) {
      expect(validateWarmup(bad), JSON.stringify(bad)).toBe(false)
    }
  })
  it('percent precision follows the Config decimals', () => {
    const w = { mode: 'template', steps: [{ percent: 62.25, reps: 3 }] }
    expect(validateWarmup(w, 1)).toBe(false)
    expect(validateWarmup(w, 2)).toBe(true)
  })
})

describe('migration', () => {
  it('converts a legacy count once and removes warmupSets', () => {
    expect(migrateOccurrence({ occurrenceId: 'o', warmupSets: 3 })).toEqual({ occurrenceId: 'o', warmup: { mode: 'smart', count: 3 } })
    expect(migrateOccurrence({ occurrenceId: 'o', warmupSets: 9 }).warmup).toEqual({ mode: 'smart', count: 5 })
    expect(migrateOccurrence({ occurrenceId: 'o', warmupSets: 0 })).toEqual({ occurrenceId: 'o' })
    expect(migrateOccurrence({ occurrenceId: 'o', warmupSets: -2 })).toEqual({ occurrenceId: 'o' })
  })
  it('is idempotent, touches only routines, and returns the same object when clean', () => {
    const active = { exposures: [{ warmupSets: 2 }] }
    const s = { routines: [{ id: 'r', ex: [{ occurrenceId: 'o', warmupSets: 2 }] }], workouts: [{ exposures: [] }], prescriptions: {} }
    const once = migrateWarmups(s)
    expect(once.routines[0].ex[0]).toEqual({ occurrenceId: 'o', warmup: { mode: 'smart', count: 2 } })
    expect(once.workouts).toBe(s.workouts)
    expect(once.prescriptions).toBe(s.prescriptions)
    expect(migrateWarmups(once)).toBe(once)
    expect(once.routines[0].ex.every(o => validateWarmup(o.warmup))).toBe(true)
    expect(active.exposures[0].warmupSets).toBe(2)
  })
})
