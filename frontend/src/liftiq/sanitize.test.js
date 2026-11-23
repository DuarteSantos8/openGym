// LIFTIQ-FORK
import { describe, expect, it } from 'vitest'
import { sanitizeVbt, buildVbt, vbtLabel, VBT_MAX_REPS } from './sanitize.js'

const good = {
  src: 'liftiq', alg: 'pulses-1', repsWithSetup: 6, repsNoSetup: 5, setupIncluded: false,
  mpv: 0.7234, vlPct: 12.34, pv: [0.7312, 0.8, 0.66, 0.6049, 0.59], upCm: 33.4, fw: 'sim-0.1', pkg: '0.1.0', at: 1790000000000,
}

describe('sanitizeVbt', () => {
  it('keeps a good object, rounded, within about 300 bytes', () => {
    const v = sanitizeVbt(good)
    expect(v).toMatchObject({ v: 1, src: 'liftiq', repsWithSetup: 6, repsNoSetup: 5, setupIncluded: false, mpv: 0.72, vlPct: 12.3, upCm: 33, fw: 'sim-0.1', pkg: '0.1.0' })
    expect(v.pv).toEqual([0.73, 0.8, 0.66, 0.6, 0.59])
    expect(JSON.stringify(v).length).toBeLessThanOrEqual(300)
  })

  it('is idempotent', () => {
    const once = sanitizeVbt(good)
    expect(sanitizeVbt(once)).toEqual(once)
  })

  it('rejects anything that is not a liftiq object', () => {
    for (const bad of [null, undefined, 3, 'x', [], {}, { src: 'other', pv: [1] }, { src: 'liftiq' }]) expect(sanitizeVbt(bad)).toBeNull()
  })

  it('clamps types and lengths and drops unknown keys and raw traces', () => {
    const v = sanitizeVbt({
      ...good, pv: Array.from({ length: 500 }, () => 99), mpv: 'abc', vlPct: -5000, upCm: 1e9, fw: 'x'.repeat(200) + '\u0000é',
      samples: [[0, 1, 2, 3]], trace: new Array(1000).fill(1), evil: { a: 1 }, repsWithSetup: 1e6,
    })
    expect(v.pv).toHaveLength(VBT_MAX_REPS)
    expect(v.pv.every(x => x === 10)).toBe(true)
    expect(v.mpv).toBeUndefined()
    expect(v.vlPct).toBe(-100)
    expect(v.upCm).toBe(500)
    expect(v.fw.length).toBeLessThanOrEqual(16)
    expect(v.repsWithSetup).toBe(VBT_MAX_REPS)
    expect(Object.keys(v).sort()).not.toContain('samples')
    expect(Object.keys(v).sort()).not.toContain('trace')
    expect(Object.keys(v).sort()).not.toContain('evil')
  })

  it('drops non-numbers from the velocity list and never throws on hostile input', () => {
    const v = sanitizeVbt({ ...good, pv: [0.5, null, 'a', NaN, Infinity, {}, '0.7', 0.6] })
    expect(v.pv).toEqual([0.5, 0.7, 0.6])
    const cyc = { src: 'liftiq', pv: [1] }
    cyc.self = cyc
    expect(() => sanitizeVbt(cyc)).not.toThrow()
  })
})

describe('buildVbt and vbtLabel', () => {
  it('builds from a review analysis', () => {
    const v = buildVbt({
      reps: [{ vPeak: 0.8 }, { vPeak: 0.7 }], metrics: { meanPeakVelocity: 0.75, velocityLossPct: null, meanUpstrokeCm: 33 },
      repsWithSetup: 3, repsNoSetup: 2, setupIncluded: false, fw: 'f', pkg: '0.1.0', capturedAt: 1,
    })
    expect(v).toMatchObject({ pv: [0.8, 0.7], mpv: 0.75, upCm: 33, repsNoSetup: 2 })
    expect(v.vlPct).toBeUndefined()
  })

  it('labels a set row', () => {
    expect(vbtLabel(sanitizeVbt(good))).toBe('0.72 m/s, -12%')
    expect(vbtLabel(null)).toBe('')
    expect(vbtLabel({ src: 'liftiq', pv: [0.5] })).toBe('')
  })
})
