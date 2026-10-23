import { describe, expect, it } from 'vitest'
import { applyIncrement, resolveExpression, resolveLoad, roundLoad } from '../../../../api/engine/load.js'

const kg25 = { mode: 'nearest', step: 2.5 }
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })
const orm = value => ({ value, unit: 'kg' })

describe('rounding', () => {
  it('rounds nearest, up and down on a step, and to the closest allowed value', () => {
    expect(roundLoad(61, kg25)).toBe(60)
    expect(roundLoad(61, { mode: 'up', step: 2.5 })).toBe(62.5)
    expect(roundLoad(61, { mode: 'down', step: 2.5 })).toBe(60)
    expect(roundLoad(61, { mode: 'allowed_values', allowedValues: [60, 61.25, 62.5] })).toBe(61.25)
  })

  it('absorbs float noise on small steps', () => {
    expect(roundLoad(0.3, { mode: 'up', step: 0.1 })).toBe(0.3)
    expect(roundLoad(82.5, kg25)).toBe(82.5)
  })
})

describe('resolving an expression', () => {
  it('resolves absolute, percent of the frozen 1RM, and empty', () => {
    expect(resolveExpression(abs(60), null)).toBe(60)
    expect(resolveExpression({ mode: 'percent_1rm', percent: 65 }, orm(100))).toBe(65)
    expect(resolveExpression({ mode: 'percent_1rm', percent: 65 }, null)).toBe(null)
    expect(resolveExpression({ mode: 'empty' }, orm(100))).toBe(null)
  })

  it('caps an automated suggestion at the rounded target after rounding', () => {
    expect(resolveLoad(abs(102.6), { rounding: kg25, cap: 100 })).toEqual({ value: 100, unit: 'kg' })
    expect(resolveLoad(abs(98.9), { rounding: kg25, cap: 100 })).toEqual({ value: 100, unit: 'kg' })
    expect(resolveLoad({ mode: 'percent_1rm', percent: 70 }, { snapshot1RM: orm(100), rounding: kg25 })).toEqual({ value: 70, unit: 'kg' })
  })
})

describe('increments', () => {
  it('moves percentage points 60 → 65 → 70 without multiplicative drift', () => {
    const step = { type: 'percentage_points', value: 5 }
    const once = applyIncrement({ mode: 'percent_1rm', percent: 60 }, step)
    const twice = applyIncrement(once, step)
    expect([once.percent, twice.percent]).toEqual([65, 70])
    expect(resolveLoad(twice, { snapshot1RM: orm(100), rounding: kg25 })).toEqual({ value: 70, unit: 'kg' })
  })

  it('applies every absolute-value basis at full precision', () => {
    expect(applyIncrement(abs(60), { type: 'absolute', value: 2.5, unit: 'kg' }).value).toBe(62.5)
    expect(applyIncrement(abs(60), { type: 'current_load_percent', value: 5 }).value).toBe(63)
    expect(applyIncrement(abs(60), { type: 'snapshot_1rm_percent', value: 2.5 }, { snapshot1RM: orm(100) }).value).toBe(62.5)
    expect(applyIncrement(abs(60), { type: 'target_load_percent', value: 2 }, { resolvedTarget: 120 }).value).toBe(62.4)
  })

  it('holds when the basis a percentage needs is missing', () => {
    expect(applyIncrement(abs(60), { type: 'snapshot_1rm_percent', value: 2.5 }).value).toBe(60)
    expect(applyIncrement(abs(60), { type: 'target_load_percent', value: 2 }).value).toBe(60)
  })

  it('rounds only the final kg/lb value, never the running expression', () => {
    const step = { type: 'current_load_percent', value: 3 }
    const twice = applyIncrement(applyIncrement(abs(50), step), step)
    expect(twice.value).toBe(53.045)
    // Rounding after each step would give 52.5 → 55; rounding once gives 52.5.
    expect(resolveLoad(twice, { rounding: kg25 })).toEqual({ value: 52.5, unit: 'kg' })
  })
})
