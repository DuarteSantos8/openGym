import { describe, expect, it } from 'vitest'
import { bodyweightAt, effectiveLoad, relativeSeries, BW_MAX_GAP_DAYS } from './relative-strength.js'

const DAY = 86400000
const LIFT = '0025'
const done = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const workout = (t, entries, bw) => ({ start: t, d: new Date(t).toISOString().slice(0, 10), entries, ...(bw ? { bw } : {}) })
const entry = (sets, extra = {}) => ({ id: LIFT, sets, ...extra })
const state = (workouts, bodyweight = []) => ({ workouts, bodyweight, unit: 'kg' })

describe('bodyweightAt', () => {
  const T0 = 100 * DAY
  const log = [{ t: T0, w: 90 }, { t: T0 + 10 * DAY, w: 80 }]

  it('interpolates between the weigh-ins around a time', () => {
    expect(bodyweightAt(log, T0 + 5 * DAY)).toBeCloseTo(85)
  })

  it('uses the nearest weigh-in outside the log', () => {
    expect(bodyweightAt(log, T0 + 15 * DAY)).toBe(80)
    expect(bodyweightAt(log, T0 - 5 * DAY)).toBe(90)
  })

  it('gives up when the nearest weigh-in is too far away', () => {
    expect(bodyweightAt(log, T0 + (10 + BW_MAX_GAP_DAYS + 1) * DAY)).toBeNull()
  })

  it('is null for an empty log', () => {
    expect(bodyweightAt([], 0)).toBeNull()
    expect(bodyweightAt(undefined, 0)).toBeNull()
  })

  it('reads a weigh-in with no timestamp from its date', () => {
    expect(bodyweightAt([{ d: '2026-01-01', w: 70 }], new Date('2026-01-02').getTime())).toBe(70)
  })
})

describe('effectiveLoad', () => {
  it('is the logged weight for a normal lift', () => {
    expect(effectiveLoad({}, 100, 80)).toBe(100)
  })
  it('adds the logged weight to body weight for a bodyweight exercise', () => {
    expect(effectiveLoad({ bodyweight: true }, 0, 80)).toBe(80)
    expect(effectiveLoad({ bodyweight: true }, 10, 80)).toBe(90)
  })
  it('takes the assistance off body weight', () => {
    expect(effectiveLoad({ assisted: true }, 30, 80)).toBe(50)
    expect(effectiveLoad({ assisted: true }, 200, 80)).toBe(0)
  })
})

describe('relativeSeries', () => {
  it('divides the best set\'s estimated 1RM by body weight', () => {
    const S = state([workout(1000, [entry([done(100, 1), done(60, 5)])], 80)])
    const [p] = relativeSeries(S, LIFT, { formula: 'epley' })
    expect(p.y).toBeCloseTo(100 / 80)
    expect(p.bw).toBe(80)
  })

  it('on the top-set basis uses the heaviest set', () => {
    const S = state([workout(1000, [entry([done(100, 5), done(90, 8)])], 80)])
    expect(relativeSeries(S, LIFT, { basis: 'top' })[0].y).toBeCloseTo(100 / 80)
  })

  it('falls back to the weigh-in log for a workout without its own', () => {
    const T0 = 100 * DAY
    const S = state([workout(T0 + 5 * DAY, [entry([done(85, 1)])])], [{ t: T0, w: 90 }, { t: T0 + 10 * DAY, w: 80 }])
    expect(relativeSeries(S, LIFT)[0].bw).toBeCloseTo(85)
  })

  it('skips a workout with no usable body weight', () => {
    expect(relativeSeries(state([workout(1000, [entry([done(100, 1)])])]), LIFT)).toEqual([])
  })

  it('bare bodyweight reps: the ratio follows reps, not body weight', () => {
    const S = state([
      workout(1000, [entry([done(0, 10)], { bodyweight: true })], 90),
      workout(2000, [entry([done(0, 11)], { bodyweight: true })], 80),
    ])
    const [a, b] = relativeSeries(S, LIFT, { formula: 'epley' })
    expect(a.y).toBeCloseTo(1 + 10 / 30)
    expect(b.y).toBeCloseTo(1 + 11 / 30)
    expect(b.y).toBeGreaterThan(a.y)
  })

  it('a weighted bodyweight set counts the body weight as load', () => {
    const S = state([workout(1000, [entry([done(10, 1)], { bodyweight: true })], 80)])
    expect(relativeSeries(S, LIFT)[0].y).toBeCloseTo(90 / 80)
  })

  it('assisted: less assistance gives a higher ratio', () => {
    const S = state([
      workout(1000, [entry([done(40, 1)], { assisted: true })], 80),
      workout(2000, [entry([done(20, 1)], { assisted: true })], 80),
    ])
    const [a, b] = relativeSeries(S, LIFT)
    expect(a.y).toBeCloseTo(40 / 80)
    expect(b.y).toBeCloseTo(60 / 80)
  })

  it('ignores warm-ups and sets that were not done', () => {
    const S = state([workout(1000, [entry([done(200, 1, { warmup: true }), { w: 150, r: 1, done: false }, done(100, 1)])], 100)])
    expect(relativeSeries(S, LIFT)[0].y).toBeCloseTo(1)
  })

  it('reads a per-side set from its done sides', () => {
    const S = state([workout(1000, [entry([{ sides: { L: done(40, 1), R: done(50, 1) } }])], 100)])
    expect(relativeSeries(S, LIFT)[0].y).toBeCloseTo(0.5)
  })
})

// Body weight is one number, so a dumbbell lift is measured by both bells together.
describe('relativeSeries: dumbbells', () => {
  const DB = '1175'          // dumbbell forward leaning lunge: two bells
  const ONE_ARM = '1048'     // dumbbell lying one arm rear lateral raise: one bell
  const bell = (id, w, dbLoad) => ({ id, sets: [done(w, 1)], ...(dbLoad ? { target: { dbLoad } } : {}) })
  const y = (S, id) => relativeSeries(S, id, { formula: 'epley' })[0].y

  it('counts "each" as both bells', () => {
    expect(y(state([workout(1000, [bell(DB, 20, 'each')], 80)]), DB)).toBeCloseTo(40 / 80)
  })

  it('takes "total" as it stands', () => {
    expect(y(state([workout(1000, [bell(DB, 40, 'total')], 80)]), DB)).toBeCloseTo(40 / 80)
  })

  it('gives the same ratio whichever meaning the exercise is set to now', () => {
    const w = [workout(1000, [bell(DB, 20, 'each')], 80)]
    for (const mode of ['each', 'total']) {
      expect(y({ ...state(w), dbLoad: { [DB]: { mode, _ts: 1 } } }, DB)).toBeCloseTo(0.5)
    }
  })

  it('leaves a set logged as entered at face value', () => {
    expect(y(state([workout(1000, [bell(DB, 20)], 80)]), DB)).toBeCloseTo(20 / 80)
  })

  it('counts one bell for one-arm work', () => {
    expect(y(state([workout(1000, [bell(ONE_ARM, 20, 'each')], 80)]), ONE_ARM)).toBeCloseTo(20 / 80)
  })
})

describe('relativeSeries: weighted pull-ups and dips', () => {
  const BELT = '2987' // weighted close grip chin-up: 'weighted' equipment, the belt plate is what is logged
  const PULLUP = '0652' // pull-up: a body weight exercise by the catalogue

  it('counts body weight under the plate on a belt chin-up, not the plate alone', () => {
    const S = state([workout(1000, [{ id: BELT, sets: [done(20, 1)] }], 80)])
    expect(relativeSeries(S, BELT)[0].y).toBeCloseTo(100 / 80)
  })

  it('reads a catalogue bodyweight exercise as one when its target carries no flag of its own', () => {
    const S = state([workout(1000, [{ id: PULLUP, target: { mode: 'reps' }, sets: [done(10, 1)] }], 80)])
    expect(relativeSeries(S, PULLUP)[0].y).toBeCloseTo(90 / 80)
  })

  it('lets the entry turn it off', () => {
    const S = state([workout(1000, [{ id: PULLUP, target: { bodyweight: false }, sets: [done(60, 1)] }], 80)])
    expect(relativeSeries(S, PULLUP)[0].y).toBeCloseTo(60 / 80)
  })
})

describe('relativeSeries: assisted machines', () => {
  const ASSISTED = '1431' // assisted standing chin-up
  it('reads the catalogue flag: body weight minus the assistance, and less help ranks higher', () => {
    const S = state([
      workout(1000, [{ id: ASSISTED, sets: [done(30, 1)] }], 80),
      workout(2000, [{ id: ASSISTED, sets: [done(10, 1)] }], 80),
    ])
    const [a, b] = relativeSeries(S, ASSISTED, { formula: 'epley' })
    expect(a.y).toBeCloseTo(50 / 80)
    expect(b.y).toBeCloseTo(70 / 80)
  })
  it('never extrapolates a 1RM: 9 reps with 11.4 kg of help at 90 kg stays under body weight', () => {
    // The reported case. Epley on the 78.6 kg actually moved gave a 102 kg "1RM", 113 % of body weight.
    const sets = [done(40.8, 12), done(11.4, 9), done(11.4, 9, { rir: 1 }), done(11.4, 8, { rir: 0.5 })]
    const S = state([workout(1000, [{ id: ASSISTED, sets, target: { bodyweight: true } }], 90)])
    for (const basis of ['e1rm', 'top']) {
      const [p] = relativeSeries(S, ASSISTED, { basis })
      expect(p.y).toBeCloseTo(78.6 / 90)
      expect(p.y).toBeLessThan(1)
    }
  })
  it('follows an assisted setting made on the routine, not only the catalogue', () => {
    // LIFT is a plain barbell lift; the entry's own target says it was done with help.
    const sets = [done(10, 9)]
    const S = state([workout(1000, [{ id: LIFT, sets, target: { assisted: true } }], 80)])
    const [p] = relativeSeries(S, LIFT, { basis: 'e1rm' })
    expect(p.assisted).toBe(true)
    expect(p.y).toBeCloseTo(70 / 80)
  })
  it('marks a normal lift as not assisted', () => {
    expect(relativeSeries(state([workout(1000, [entry([done(100, 1)])], 80)]), LIFT)[0].assisted).toBe(false)
  })
  it('has no point when the assistance is at or above body weight', () => {
    expect(relativeSeries(state([workout(1000, [{ id: ASSISTED, sets: [done(90, 1)] }], 80)]), ASSISTED)).toEqual([])
  })
})
