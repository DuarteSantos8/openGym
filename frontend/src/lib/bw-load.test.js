// "Count body weight in bodyweight lifts" (#794): off, a pull-up session reads its belt and
// nothing else, as before; on, volume adds the nearest weigh-in times the lift's share, and an
// assistance machine takes its help off it. The saved `vol`, records and progression stay as
// logged, so the switch can be flipped back without touching history.
import { describe, expect, it } from 'vitest'
import { bodyLoadOf, bodyweightFor, countsBodyweight } from './bw-load.js'
import { workoutVolume, sessionVolume, lifetimeVolume } from './history.js'
import { exerciseHistory } from './exercise-history.js'

const PULLUP = '0652', DIP = '0251', PUSHUP = '0662', KNEE_PUSHUP = '1182', INCLINE = '0493', DECLINE = '0279'
const ASSISTED_PULLUP = '0017', WEIGHTED_PULLUP = '0841', BENCH_DIP = '0129', BAND_PULLUP = '0970', BENCH = '0025'
const done = (w, r) => ({ w, r, done: true })
const session = (d, entries, extra = {}) => ({
  id: d, d, name: 'Pull', start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), entries, vol: 0, prs: [], ...extra,
})
const profile = (on, workouts, bodyweight = [{ d: '2026-10-01', w: 80 }]) =>
  ({ unit: 'kg', volumeBodyweight: on, workouts, bodyweight, routines: [], exWeights: {} })

describe('bodyLoadOf: the share of body weight a rep moves', () => {
  it('hanging and dipping carry all of it, push-ups what Ebben et al. measured', () => {
    expect(bodyLoadOf(PULLUP)).toEqual({ share: 1, assisted: false })
    expect(bodyLoadOf(DIP)).toEqual({ share: 1, assisted: false })
    expect(bodyLoadOf(PUSHUP).share).toBe(0.64)
    expect(bodyLoadOf(KNEE_PUSHUP).share).toBe(0.49)
    expect(bodyLoadOf(INCLINE).share).toBe(0.41)
    expect(bodyLoadOf(DECLINE).share).toBe(0.74)
  })

  it('a belt or vest variant adds to it, an assistance machine takes off', () => {
    expect(bodyLoadOf(WEIGHTED_PULLUP)).toEqual({ share: 1, assisted: false })
    expect(bodyLoadOf(ASSISTED_PULLUP)).toEqual({ share: 1, assisted: true })
  })

  it('leaves out what nobody can put a number on, and every loaded lift', () => {
    expect(bodyLoadOf(BENCH_DIP)).toBeNull()
    expect(bodyLoadOf(BAND_PULLUP)).toBeNull()
    expect(bodyLoadOf(BENCH)).toBeNull()
    expect(bodyLoadOf('nope')).toBeNull()
  })
})

describe('bodyweightFor: the weigh-in a session was done at', () => {
  const S = { bodyweight: [{ d: '2026-10-10', w: 82 }, { d: '2026-10-01', w: 80 }, { d: '2026-10-20', w: 84 }] }
  it('takes the check-in of the session first', () => {
    expect(bodyweightFor(session('2026-10-02', [], { bw: 79 }), S)).toBe(79)
  })
  it('else the nearest weigh-in, before or after, whatever the stored order', () => {
    expect(bodyweightFor(session('2026-10-04', []), S)).toBe(80)
    expect(bodyweightFor(session('2026-10-07', []), S)).toBe(82)
    expect(bodyweightFor(session('2026-09-01', []), S)).toBe(80)
    expect(bodyweightFor(session('2026-12-01', []), S)).toBe(84)
    expect(bodyweightFor({ d: '2026-10-19', entries: [] }, S)).toBe(84)
  })
  it('0 with no weigh-ins at all', () => {
    expect(bodyweightFor(session('2026-10-04', []), { bodyweight: [] })).toBe(0)
    expect(bodyweightFor(session('2026-10-04', []), {})).toBe(0)
  })
})

describe('volume with the switch', () => {
  const pullups = session('2026-10-01', [{ id: PULLUP, target: { sets: 2, reps: 8 }, sets: [done(0, 8), done(10, 5), { w: 0, r: 8, done: false }] }])

  it('is off unless chosen, and off changes nothing', () => {
    expect(countsBodyweight({})).toBe(false)
    expect(sessionVolume(pullups, profile(false, [pullups]))).toBe(50)
  })

  it('adds body weight to every done rep, on top of a belt', () => {
    // 8 × 80 + 5 × (80 + 10)
    expect(sessionVolume(pullups, profile(true, [pullups]))).toBe(1090)
  })

  it('a push-up moves its share, a loaded lift in the same session only its load', () => {
    const w = session('2026-10-01', [
      { id: PUSHUP, target: { sets: 1, reps: 10 }, sets: [done(0, 10)] },
      { id: BENCH, target: { sets: 1, reps: 5 }, sets: [done(60, 5)] },
    ])
    expect(sessionVolume(w, profile(true, [w]))).toBeCloseTo(10 * 80 * 0.64 + 300)
  })

  it('an assistance machine counts body weight less its help, never below 0', () => {
    const w = session('2026-10-01', [{ id: ASSISTED_PULLUP, target: { sets: 2, reps: 8 }, sets: [done(30, 8), done(100, 5)] }])
    expect(sessionVolume(w, profile(false, [w]))).toBe(740)
    expect(sessionVolume(w, profile(true, [w]))).toBe(8 * 50)
  })

  it('warm-ups still follow their own switch, and a hold gets nothing', () => {
    const w = session('2026-10-01', [{ id: DIP, target: { sets: 1, reps: 5 }, sets: [{ ...done(0, 5), phase: 'warmup', warmup: true }, done(0, 5), { w: 0, r: 0, sec: 30, mode: 'time', done: true }] }])
    expect(sessionVolume(w, profile(true, [w]))).toBe(400)
    expect(sessionVolume(w, { ...profile(true, [w]), volumeWarmups: true })).toBe(800)
  })

  it('a drop on a weighted set drops to the body weight plus what is left', () => {
    const w = session('2026-10-01', [{ id: WEIGHTED_PULLUP, target: { sets: 1, reps: 5 }, sets: [{ ...done(20, 5), type: 'dropset', drops: [{ w: 0, r: 4 }] }] }])
    expect(sessionVolume(w, profile(true, [w]))).toBe(5 * 100 + 4 * 80)
  })

  it('without a weigh-in there is nothing to add', () => {
    expect(sessionVolume(pullups, profile(true, [pullups], []))).toBe(50)
  })

  it('the lifetime total follows, the saved vol and the records do not', () => {
    const S = profile(true, [pullups])
    expect(lifetimeVolume(S)).toBe(1090)
    expect(workoutVolume(pullups)).toBe(50)
    expect(pullups.vol).toBe(0)
    expect(exerciseHistory(S, PULLUP).best).toBe(exerciseHistory(profile(false, [pullups]), PULLUP).best)
  })
})
