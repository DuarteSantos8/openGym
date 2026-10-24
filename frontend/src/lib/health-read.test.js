import { describe, expect, it } from 'vitest'
import { mergeHealthWeights, planWeightImport, readSince, WINDOW } from './health-read.js'
import { logWeighIn } from './bodyweight.js'

// #544: weigh-ins read back from Health Connect (a smart scale, another app) into the log.
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime()
const now = at(20, 12)
const rec = (id, d, h, kg) => ({ id, time: at(d, h), kg })
const day = d => `2026-09-${d}`

describe('readSince', () => {
  it('reads everything the first time, then a window before the last read', () => {
    expect(readSince(0)).toBe(0)
    expect(readSince(undefined)).toBe(0)
    expect(readSince(now)).toBe(now - WINDOW)
  })
})

describe('planWeightImport', () => {
  it('brings a day the log does not have, marked as read from Health Connect', () => {
    const { add } = planWeightImport({ unit: 'kg', bodyweight: [] }, [rec('a', 18, 7, 80.04)], {}, now)
    expect(add).toEqual([{ d: day(18), w: 80, t: at(18, 7), src: 'hc', at: at(18, 7) }])
  })
  it('converts to a profile in pounds', () => {
    const { add } = planWeightImport({ unit: 'lb', bodyweight: [] }, [rec('a', 18, 7, 80)], {}, now)
    expect(add[0].w).toBe(176.4)
  })
  it('keeps the latest measurement of a day', () => {
    const { add } = planWeightImport({ unit: 'kg' }, [rec('b', 18, 21, 81), rec('a', 18, 7, 80)], {}, now)
    expect(add.map(b => [b.d, b.w])).toEqual([[day(18), 81]])
  })
  it('takes a day over only with a measurement newer than its weigh-in', () => {
    const S = { unit: 'kg', bodyweight: [{ d: day(18), w: 79, t: at(18, 9) }] }
    expect(planWeightImport(S, [rec('a', 18, 7, 80)], {}, now).add).toEqual([])
    expect(planWeightImport(S, [rec('a', 18, 10, 80)], {}, now).add.map(b => b.w)).toEqual([80])
  })
  it('compares with when an earlier read was measured, not when it landed in the log', () => {
    // Read at 09:00 (restamped then), measured at 07:00; a reading from 08:00 that the scale
    // handed over later is the newer measurement.
    const S = { unit: 'kg', bodyweight: [{ d: day(18), w: 79, t: at(18, 9), src: 'hc', at: at(18, 7) }] }
    expect(planWeightImport(S, [rec('b', 18, 8, 80)], { a: at(18, 7) }, now).add.map(b => b.w)).toEqual([80])
  })
  it('does not bring back a day deleted after it was measured', () => {
    const S = { unit: 'kg', bodyweight: [], deleted: { bodyweight: { [day(18)]: at(18, 12) } } }
    expect(planWeightImport(S, [rec('a', 18, 7, 80)], {}, now).add).toEqual([])
    expect(planWeightImport(S, [rec('b', 18, 13, 80)], {}, now).add.map(b => b.d)).toEqual([day(18)])
  })
  it('skips a record taken into account before, and one with nothing usable', () => {
    const { add, seen } = planWeightImport({ unit: 'kg' },
      [rec('a', 18, 7, 80), rec('b', 19, 7, 0), { id: 'c', kg: 80 }, { time: at(19, 8), kg: 80 }], { a: at(18, 7) }, now)
    expect(add).toEqual([])
    expect(seen).toEqual({ a: at(18, 7), b: at(19, 7) })
  })
  it('remembers only what the next read can still return', () => {
    const old = now - WINDOW - 1
    const { add, seen } = planWeightImport({ unit: 'kg' }, [{ id: 'x', time: old, kg: 70 }, rec('y', 19, 7, 80)], { z: old }, now)
    expect(add.map(b => b.w)).toEqual([70, 80])
    expect(seen).toEqual({ y: at(19, 7) })
  })
})

describe('mergeHealthWeights', () => {
  it('puts each weigh-in on its day, replacing the one there, in order', () => {
    const s = { bodyweight: [{ d: day(17), w: 79, t: 1 }, { d: day(19), w: 78, t: 2 }] }
    const { add } = planWeightImport({ unit: 'kg', bodyweight: s.bodyweight }, [rec('a', 18, 7, 80), rec('b', 19, 7, 81)], {}, now)
    expect(mergeHealthWeights(s, add)).toBe(true)
    expect(s.bodyweight.map(b => [b.d, b.w, b.src])).toEqual([[day(17), 79, undefined], [day(18), 80, 'hc'], [day(19), 81, 'hc']])
    expect(mergeHealthWeights(s, [])).toBe(false)
  })
  it('a weigh-in typed over it afterwards is openGym\'s own again', () => {
    const s = { bodyweight: [] }
    mergeHealthWeights(s, [{ d: day(18), w: 80, t: at(18, 7), src: 'hc', at: at(18, 7) }])
    logWeighIn(s, 79.5, at(18, 10))
    expect(s.bodyweight).toEqual([{ d: day(18), w: 79.5, t: at(18, 10) }])
  })
})
