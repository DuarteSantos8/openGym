import { describe, it, expect } from 'vitest'
import { evaluateLiftoscript } from './liftosaur-eval.js'

const ctx = { weight: 100, reps: 5, completedReps: 5, rpe: 8 }

describe('evaluateLiftoscript (isolated, deterministic)', () => {
  it('adds load on success and keeps it on failure', () => {
    const script = 'if (completedReps >= reps) { weight += 2.5 }'
    expect(evaluateLiftoscript(script, ctx).weight).toBe(102.5)
    expect(evaluateLiftoscript(script, { ...ctx, completedReps: 3 }).weight).toBe(100)
  })

  it('supports else branches, percentages and roundWeight', () => {
    const script = 'if (completedReps >= reps) { weight = roundWeight(weight * 1.05, 2.5) } else { weight -= 5 }'
    expect(evaluateLiftoscript(script, ctx).weight).toBe(105)
    expect(evaluateLiftoscript(script, { ...ctx, completedReps: 0 }).weight).toBe(95)
  })

  it('handles unit suffixes and comments as plain numbers in the active unit', () => {
    const out = evaluateLiftoscript('// weekly bump\nweight += 2.5kg', ctx)
    expect(out.weight).toBe(102.5)
    expect(out.unitNote).toBe('kg')
  })

  it('is deterministic and does not mutate the input context', () => {
    const a = evaluateLiftoscript('weight += 2.5', ctx)
    const b = evaluateLiftoscript('weight += 2.5', ctx)
    expect(a).toEqual(b)
    expect(ctx.weight).toBe(100)
  })

  it('rejects unsafe or unknown scripts instead of guessing', () => {
    expect(() => evaluateLiftoscript('weight = fetch("https://x")', ctx)).toThrow(/unknown/i)
    expect(() => evaluateLiftoscript('foo += 1', ctx)).toThrow(/unknown/i)
    expect(() => evaluateLiftoscript('if (completedReps >= reps) { weight += 2.5', ctx)).toThrow(/brace|block/i)
    expect(() => evaluateLiftoscript('weight += ' + '1'.repeat(5000), ctx)).toThrow(/long/i)
  })

  it('rejects malformed or impossible context values without coercion', () => {
    for (const value of [Infinity, NaN, -1, '100', true, null]) {
      expect(() => evaluateLiftoscript('', { ...ctx, weight: value })).toThrow(/context/i)
    }
    expect(() => evaluateLiftoscript('', { ...ctx, reps: 2.5 })).toThrow(/context/i)
    expect(() => evaluateLiftoscript('', null)).toThrow(/context/i)
    expect(evaluateLiftoscript('')).toEqual({ weight: 0, reps: 0, unitNote: null })
  })

  it('rejects nonfinite arithmetic and impossible assigned targets', () => {
    for (const script of ['weight = 1 / 0', 'reps = 0 / 0', 'weight -= 101', 'reps = -1', 'reps = 2.5', 'weight = ' + '9'.repeat(310)]) {
      expect(() => evaluateLiftoscript(script, ctx)).toThrow(/finite|nonnegative|integer/i)
    }
  })

  it('rejects nonfinite conditions instead of increasing load on invalid arithmetic', () => {
    for (const condition of ['0 / 0', '1 / 0', '1 < 1 / 0', '0 / 0 != 0']) {
      expect(() => evaluateLiftoscript(`if (${condition}) { weight += 2.5 }`, ctx)).toThrow(/finite/i)
    }
  })
})
