import { describe, expect, it } from 'vitest'
import { weightRate, rateCorridor, rateStatus } from './bodyweight.js'
import { convertStateUnit } from './units.js'

// #759: the weekly rate of change over the last three weeks, and a corridor to hold it against.
const NOW = new Date('2026-10-21T09:00:00').getTime()
const day = i => { const d = new Date(NOW - i * 86400000); return d.toISOString().slice(0, 10) }
// Every other day for three weeks, losing 0.1 kg a day, with a water swing on top.
const log = (perDay = -0.1, start = 85) => Array.from({ length: 11 }, (_, k) => {
  const i = 20 - k * 2
  return { d: day(i), w: start + perDay * (20 - i) + (k % 2 ? 0.4 : -0.4), t: 1 }
})

describe('weekly rate', () => {
  it('is the slope over the window, per week and in percent of body weight', () => {
    const r = weightRate(log(), { now: NOW })
    expect(r.enough).toBe(true)
    expect(r.n).toBe(11)
    expect(r.perWeek).toBeCloseTo(-0.7, 0)
    expect(r.pct).toBeCloseTo(r.perWeek / r.mean * 100, 6)
  })

  it('lets no single morning flip it', () => {
    const calm = weightRate(log(0.05), { now: NOW })
    const spiky = log(0.05)
    spiky[spiky.length - 1].w += 2.5
    expect(Math.sign(weightRate(spiky, { now: NOW }).perWeek)).toBe(Math.sign(calm.perWeek))
  })

  it('needs enough weigh-ins, far enough apart, inside the window', () => {
    expect(weightRate(log().slice(0, 5), { now: NOW })).toEqual({ enough: false, n: 5 })
    const crowded = Array.from({ length: 8 }, (_, i) => ({ d: day(i), w: 80 + i / 10 }))
    expect(weightRate(crowded, { now: NOW }).enough).toBe(false)
    const old = log().map(b => ({ ...b, d: day(40 + Number(b.d.slice(8)) % 20) }))
    expect(weightRate(old, { now: NOW }).n).toBe(0)
    expect(weightRate(undefined, { now: NOW })).toEqual({ enough: false, n: 0 })
  })
})

describe('target corridor', () => {
  const rate = (pct, perWeek = pct) => ({ enough: true, pct, perWeek })
  it('reads sizes, in any order, into a signed range', () => {
    expect(rateCorridor({ dir: 'lose', by: '%', lo: 1, hi: 0.5 })).toEqual({ dir: 'lose', by: '%', min: -1, max: -0.5 })
    expect(rateCorridor({ dir: 'gain', by: 'w', lo: 0.1, hi: 0.25 })).toEqual({ dir: 'gain', by: 'w', min: 0.1, max: 0.25 })
    expect(rateCorridor({ dir: 'hold', by: '%', lo: 0, hi: 0.2 })).toEqual({ dir: 'hold', by: '%', min: -0.2, max: 0.2 })
    expect(rateCorridor({ dir: 'gain', lo: 0, hi: 0 })).toBeNull()
    expect(rateCorridor(null)).toBeNull()
  })

  it('says in, too fast or too slow for a cut and a bulk', () => {
    const cut = { dir: 'lose', by: '%', lo: 0.5, hi: 1 }
    expect(rateStatus(rate(-0.7), cut)).toBe('in')
    expect(rateStatus(rate(-1.3), cut)).toBe('fast')
    expect(rateStatus(rate(-0.2), cut)).toBe('slow')
    expect(rateStatus(rate(0.3), cut)).toBe('slow')
    const bulk = { dir: 'gain', by: '%', lo: 0.25, hi: 0.5 }
    expect(rateStatus(rate(0.41), bulk)).toBe('in')
    expect(rateStatus(rate(0.8), bulk)).toBe('fast')
    expect(rateStatus(rate(0.1), bulk)).toBe('slow')
    expect(rateStatus(rate(-0.1), { dir: 'hold', by: '%', hi: 0.25 })).toBe('in')
    expect(rateStatus(rate(0.4), { dir: 'hold', by: '%', hi: 0.25 })).toBe('off')
  })

  it('goes by the weight per week for a corridor in kg or lb, and by nothing without enough data', () => {
    const cut = { dir: 'lose', by: 'w', lo: 0.25, hi: 0.5 }
    expect(rateStatus(rate(-5, -0.3), cut)).toBe('in')
    expect(rateStatus({ enough: false, n: 2 }, cut)).toBeNull()
  })

  it('a corridor in the profile unit moves with a kg/lb switch, one in % does not', () => {
    const S = { unit: 'kg', bodyweight: [], rateGoal: { dir: 'lose', by: 'w', lo: 0.5, hi: 1 } }
    const lb = convertStateUnit(S, 'lb')
    expect(lb.rateGoal).toMatchObject({ dir: 'lose', by: 'w', lo: 1.1, hi: 2.2 })
    expect(convertStateUnit(lb, 'kg').rateGoal).toMatchObject({ lo: 0.5, hi: 1 })
    const pct = { unit: 'kg', bodyweight: [], rateGoal: { dir: 'lose', by: '%', lo: 0.5, hi: 1 } }
    expect(convertStateUnit(pct, 'lb').rateGoal).toEqual(pct.rateGoal)
  })
})
