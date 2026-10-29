// v1.4.3: the heart rate read back from Health Connect / Apple Health, split over the sets of a
// finished workout (hrFromSamples). Dense samples give each set its own reading; sparse ones only
// the session; ticks that say nothing about when a set was done give nothing.
import { describe, expect, it } from 'vitest'
import { hrFromSamples, cleanSamples } from './heart-rate.js'

const T0 = Date.UTC(2026, 9, 15, 17, 0, 0)
const s = sec => T0 + sec * 1000
// One sample a second from `from` to `to` (seconds), bpm from fn(second).
const dense = (from, to, fn) => { const out = []; for (let x = from; x <= to; x++) out.push([s(x), fn(x)]); return out }
const set = (at, extra = {}) => ({ w: 60, r: 8, done: true, at: s(at), ...extra })
const workout = (sets, extra = {}) => ({ id: 'w1', d: '2026-10-15', start: s(0), end: s(600), entries: [{ id: '0025', target: { mode: 'reps' }, sets }], ...extra })
// Work at 150 for 24 s (8 reps x 3 s) before each tick, rest at 100 in between.
const bpmFor = ticks => x => (ticks.some(t => x > t - 24 && x <= t) ? 150 : 100)

describe('hrFromSamples', () => {
  it('gives each set its work and rest heart rate from dense samples', () => {
    const ticks = [100, 250, 400]
    const r = hrFromSamples(workout(ticks.map(t => set(t))), dense(0, 600, bpmFor(ticks)))
    expect(r.n).toBe(601)
    expect(r.session.max).toBe(150)
    expect(r.sets.get('0:0').hr).toEqual({ avg: 150, max: 150 })
    expect(r.sets.get('0:0').restHr).toEqual({ avg: 100, max: 100 })
    expect(r.sets.get('0:2').hr.avg).toBe(150)
    // The last rest runs to the end of the session at most.
    expect(r.sets.get('0:2').restHr.avg).toBe(100)
  })

  it('gives only the session from sparse samples (one a minute)', () => {
    const samples = []
    for (let x = 0; x <= 600; x += 60) samples.push([s(x), 120 + (x % 120 ? 10 : 0)])
    const r = hrFromSamples(workout([set(100), set(250)]), samples)
    expect(r.session).toEqual({ avg: 125, max: 130 })
    expect(r.sets.size).toBe(0)
  })

  it('leaves a set alone when no sample falls in its window (a gap)', () => {
    const samples = [...dense(0, 60, () => 100), ...dense(200, 600, () => 140)]
    const r = hrFromSamples(workout([set(100), set(300)]), samples)
    expect(r.sets.get('0:0')?.hr).toBeUndefined()
    expect(r.sets.get('0:1').hr.avg).toBe(140)
  })

  it('ignores samples outside the session and implausible rates', () => {
    const samples = [[s(-100), 200], [s(50), 300], [s(60), 10], ...dense(70, 600, () => 110)]
    const r = hrFromSamples(workout([set(100)]), samples)
    expect(r.session).toEqual({ avg: 110, max: 110 })
    expect(cleanSamples([[1, 10], [2, 300], [3, 80], { t: 4, bpm: 90 }])).toEqual([[3, 80], [4, 90]])
  })

  it('gives warm-up and drop sets theirs, a drop set a longer window', () => {
    const w = workout([set(100, { warmup: true }), set(250, { type: 'drop', drops: [{ w: 40, r: 8 }, { w: 30, r: 8 }] })])
    const samples = dense(0, 600, x => (x > 250 - 60 && x <= 250 ? 160 : 100))
    const r = hrFromSamples(w, samples)
    expect(r.sets.get('0:0').hr.avg).toBe(100)
    // 24 reps x 3 s = 72 s window: the last 60 s at 160, the 12 before at 100.
    expect(r.sets.get('0:1').hr.max).toBe(160)
    expect(r.sets.get('0:1').hr.avg).toBeGreaterThan(140)
  })

  it('takes both sides of a per-side set as one', () => {
    const side = { w: 20, r: 8, done: true }
    const w = workout([{ w: 20, r: 16, done: true, sides: { L: { ...side, at: s(80) }, R: { ...side, at: s(110) } } }])
    const r = hrFromSamples(w, dense(0, 600, x => (x > 62 && x <= 110 ? 150 : 100)))
    expect(r.sets.get('0:0').hr.max).toBe(150)
  })

  it('gives only the session to a workout without ticks, or with ticks caught up all at once', () => {
    const samples = dense(0, 600, () => 120)
    const old = workout([{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }])
    expect(hrFromSamples(old, samples).sets.size).toBe(0)
    expect(hrFromSamples(old, samples).session).toEqual({ avg: 120, max: 120 })
    const burst = workout([set(590), { ...set(591), at: s(590) + 800 }, { ...set(592), at: s(590) + 1500 }])
    const r = hrFromSamples(burst, samples)
    expect(r.sets.get('0:1')?.hr).toBeUndefined()
    expect(r.sets.get('0:2')?.hr).toBeUndefined()
  })

  it('gives nothing without a start and an end, or with too few samples', () => {
    expect(hrFromSamples({ ...workout([set(100)]), end: null }, dense(0, 600, () => 120)).session).toBeNull()
    expect(hrFromSamples(workout([set(100)]), [[s(100), 120]]).session).toBeNull()
  })
})
