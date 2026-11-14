// "Count warm-ups in volume" (#719): off is the app's own rule, work sets only; on, every number
// that says "volume" counts the done warm-ups too. The saved `vol` never changes, so the switch
// can go back and forth without touching history. Records and progression never read warm-ups.
import { describe, expect, it } from 'vitest'
import { workoutVolume, sessionVolume, lifetimeVolume, countsWarmups } from './history.js'
import { totalsOf, reportData } from './report.js'
import { exerciseHistory } from './exercise-history.js'
import { insightsFor, sessionInsights } from './coach-insights.js'
import { workoutCardModel } from './workout-card.js'
import { workoutText } from './workout-text.js'

const BENCH = '0025'
const warm = (w, r, done = true) => ({ w, r, done, phase: 'warmup', warmup: true })
const work = (w, r, done = true) => ({ w, r, done })
// 2 done warm-ups (20×10 + 40×5 = 400), 1 skipped (60×3), 2 work sets (60×5 ×2 = 600).
const session = (d, extra = {}) => ({
  id: d, d, name: 'Push', start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
  entries: [{ id: BENCH, target: { sets: 2, reps: 5 }, sets: [warm(20, 10), warm(40, 5), warm(60, 3, false), work(60, 5), work(60, 5)] }],
  vol: 600, prs: [], ...extra,
})
const profile = (on, workouts = [session('2026-10-01'), session('2026-10-08')]) =>
  ({ unit: 'kg', volumeWarmups: on, workouts, bodyweight: [], routines: [], exWeights: {} })

describe('workoutVolume and the warm-up switch', () => {
  it('leaves warm-ups out unless asked, and never counts one that was not done', () => {
    const w = session('2026-10-01')
    expect(workoutVolume(w)).toBe(600)
    expect(workoutVolume(w, { warmups: true })).toBe(1000)
  })

  it('reads the profile: off unless switched on', () => {
    expect(countsWarmups({})).toBe(false)
    expect(countsWarmups({ volumeWarmups: true })).toBe(true)
    expect(sessionVolume(session('2026-10-01'), profile(false))).toBe(600)
    expect(sessionVolume(session('2026-10-01'), profile(true))).toBe(1000)
  })

  it('a legacy record without entries keeps its cached number either way', () => {
    expect(sessionVolume({ vol: 1234 }, profile(true))).toBe(1234)
    expect(sessionVolume({}, profile(true))).toBe(0)
  })

  it('a per-side warm-up counts each side, as a work set does', () => {
    const w = { entries: [{ id: BENCH, sets: [{ ...warm(0, 0), sides: { L: { w: 10, r: 5, done: true }, R: { w: 12, r: 5, done: true } } }] }] }
    expect(workoutVolume(w, { warmups: true })).toBe(110)
    expect(workoutVolume(w)).toBe(0)
  })

  it('adds up a lifetime the same way', () => {
    expect(lifetimeVolume(profile(false))).toBe(1200)
    expect(lifetimeVolume(profile(true))).toBe(2000)
    expect(lifetimeVolume(profile(false, [session('2026-10-01'), { d: '2020-01-01', vol: 5000 }]))).toBe(5600)
    expect(lifetimeVolume({})).toBe(0)
  })
})

describe('every reader follows it', () => {
  it('the performance report', () => {
    const S = profile(true)
    expect(totalsOf(S.workouts).volume).toBe(1200)
    expect(totalsOf(S.workouts, [], S).volume).toBe(2000)
    const R = reportData(S, { range: 'custom', from: '2026-09-28', to: '2026-10-10', today: '2026-10-10' })
    expect(R.totals.volume).toBe(2000)
    expect(R.buckets.buckets.reduce((n, b) => n + b.volume, 0)).toBe(2000)
    expect(R.calendar.reduce((n, c) => n + c.volume, 0)).toBe(2000)
    expect(reportData(profile(false), { range: 'custom', from: '2026-09-28', to: '2026-10-10', today: '2026-10-10' }).totals.volume).toBe(1200)
  })

  it('the exercise history: the session volume, never the best or the sets', () => {
    const on = exerciseHistory(profile(true), BENCH)
    const off = exerciseHistory(profile(false), BENCH)
    expect(off.sessions[0].volume).toBe(600)
    expect(on.sessions[0].volume).toBe(1000)
    expect(on.best).toBe(off.best)
    expect(on.sessions[0].sets).toEqual(off.sessions[0].sets)
  })

  it('the coach quotes the number the app shows', () => {
    expect(insightsFor(profile(false)).volume).toBe(1200)
    expect(insightsFor(profile(true)).volume).toBe(2000)
    const S = profile(true)
    expect(sessionInsights(S, S.workouts[1]).now.volume).toBe(1000)
  })

  it('the share card and Copy as text', () => {
    const w = session('2026-10-01')
    const vol = m => m.stats.find(s => s.label === 'Volume').value
    expect(vol(workoutCardModel(w, { unit: 'kg', nameOf: () => 'Bench' }))).toBe('600 kg')
    expect(vol(workoutCardModel(w, { unit: 'kg', nameOf: () => 'Bench', warmups: true }))).toBe('1,000 kg')
    expect(workoutText(w, { unit: 'kg', nameOf: () => 'Bench' })).toContain('600 kg')
    expect(workoutText(w, { unit: 'kg', nameOf: () => 'Bench', warmups: true })).toContain('1,000 kg')
  })
})
