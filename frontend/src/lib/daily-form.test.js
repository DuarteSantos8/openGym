// The daily-form check-in (lib/daily-form.js): what it stores, when it asks, and going lighter.
import { describe, it, expect } from 'vitest'
import { offerCheckin, readForm, formOf, formDays, formScore, isRough, checkinMode, withForm, sleepRatingOf, lighterChanges, goLighter, canGoLighter, LIGHTER_PCT } from './daily-form.js'
import { isWarmupRow } from './workout-model.js'
import { STAMPED_MAPS, mergeStates } from './sync-merge.js'

const BENCH = '0025', CURL = '0294', PLANK = '0464'
const row = (w, r, done = false) => ({ w, r, done })
const session = () => ({
  unit: 'kg', exWeights: {}, workouts: [], week: {}, dayPlan: {}, routines: [],
  active: {
    id: 'a1', d: '2026-11-06', cur: 0, entries: [
      { id: BENCH, target: { sets: 3, reps: 5, weight: 80 }, sets: [{ w: 40, r: 5, done: true, phase: 'warmup', warmup: true }, row(80, 5, true), row(80, 5), row(80, 5)] },
      { id: CURL, target: { sets: 3, reps: 10, weight: 14 }, sets: [row(14, 10), row(14, 10), row(14, 10)] },
      { id: PLANK, target: { sets: 1, sec: 60 }, sets: [{ sec: 60, w: 0, done: false }] },
    ],
  },
})

describe('reading and storing a check-in', () => {
  it('keeps 1 to 5 answers and drops anything else', () => {
    expect(readForm({ sleep: 3, energy: 9, sore: 0, stress: '2', lighter: 'nap' })).toEqual({ sleep: 3, energy: null, sore: null, stress: null, lighter: null })
    expect(readForm({ _ts: 5 })).toBeNull()
    expect(readForm(null)).toBeNull()
  })
  it('writes a stamped entry per day, and an empty answer clears the day', () => {
    let map = withForm({}, '2026-11-06', { sleep: 2, energy: 2, lighter: 'load' }, 100)
    expect(map['2026-11-06']).toEqual({ sleep: 2, energy: 2, lighter: 'load', _ts: 100 })
    map = withForm(map, '2026-11-06', {}, 200)
    expect(map['2026-11-06']).toEqual({ _ts: 200 })
    expect(formOf({ dayForm: map }, '2026-11-06')).toBeNull()
  })
  it('lists the answered days oldest first', () => {
    const S = { dayForm: { '2026-11-02': { energy: 4, _ts: 1 }, '2026-11-01': { sleep: 5, _ts: 1 }, '2026-11-03': { _ts: 1 } } }
    expect(formDays(S).map(d => d.d)).toEqual(['2026-11-01', '2026-11-02'])
  })
  it('is a stamped map, so each device keeps its own days and the later answer of a day wins', () => {
    expect(STAMPED_MAPS).toContain('dayForm')
    const a = { _ts: 10, dayForm: { '2026-11-05': { sleep: 2, _ts: 10 } } }
    const b = { _ts: 20, dayForm: { '2026-11-06': { energy: 4, _ts: 20 }, '2026-11-05': { sleep: 4, _ts: 5 } } }
    const m = mergeStates(a, b)
    expect(m.dayForm['2026-11-05'].sleep).toBe(2)
    expect(m.dayForm['2026-11-06'].energy).toBe(4)
  })
})

describe('how good a day looks', () => {
  it('turns soreness and stress round, and averages what was answered', () => {
    expect(formScore({ sleep: 5, energy: 5, sore: 1, stress: 1 })).toBe(5)
    expect(formScore({ sleep: 1, energy: null, sore: 5, stress: null })).toBe(1)
    expect(formScore({ sleep: 3, energy: 4, sore: null, stress: null })).toBe(3.5)
    expect(formScore({})).toBeNull()
  })
  it('calls a day rough only with two answers or more', () => {
    expect(isRough({ sleep: 1 })).toBe(false)
    expect(isRough({ sleep: 2, energy: 2 })).toBe(true)
    expect(isRough({ sleep: 2, energy: 4, sore: 4, stress: 3 })).toBe(false)
  })
  it('turns hours of sleep into the scale', () => {
    expect([4, 5.5, 6.2, 7.4, 8, 9].map(sleepRatingOf)).toEqual([1, 2, 3, 4, 5, 5])
    expect(sleepRatingOf(null)).toBeNull()
  })
})

describe('when the check-in shows', () => {
  const today = '2026-11-06'
  it('only when switched on: off and never asked start the workout straight away', () => {
    expect(checkinMode({}, today)).toBeNull()
    expect(checkinMode({ dailyForm: true }, today)).toBe('ask')
    expect(checkinMode({ dailyForm: false }, today)).toBeNull()
  })
  it('is offered once on the Stats card, to people who train', () => {
    const three = [{}, {}, {}]
    expect(offerCheckin({ workouts: three })).toBe(true)
    expect(offerCheckin({ workouts: three, dailyForm: false })).toBe(false)
    expect(offerCheckin({ workouts: three, dailyForm: true })).toBe(false)
    expect(offerCheckin({ workouts: [{}] })).toBe(false)
    expect(offerCheckin({ workouts: three, modules: { health: false } })).toBe(false)
  })
  it('never with the Health module off, and not twice a day', () => {
    expect(checkinMode({ dailyForm: true, modules: { health: false } }, today)).toBeNull()
    expect(checkinMode({ dailyForm: true, dayForm: { [today]: { energy: 3, _ts: 1 } } }, today)).toBeNull()
  })
})

describe('going lighter', () => {
  it('takes 10% off the open work sets only, rounded down to the plates', () => {
    const S = session()
    expect(goLighter(S, 'load')).toBe(2)
    const bench = S.active.entries[0].sets
    expect(bench[0].w).toBe(40)                 // the logged warm-up stays
    expect(bench.filter(r => !isWarmupRow(r)).map(r => r.w)).toEqual([80, 70, 70])   // 72 rounds down to the 2.5 kg plates
    expect(S.active.entries[1].sets.every(r => r.w <= 14 * (1 - LIGHTER_PCT / 100) + 0.01)).toBe(true)
    expect(S.active.entries[2].sets[0].sec).toBe(60)   // no weight, nothing to take off
  })
  it('or one open work set fewer where there are two or more', () => {
    const S = session()
    goLighter(S, 'sets')
    expect(S.active.entries[0].sets.filter(r => !isWarmupRow(r))).toHaveLength(2)
    expect(S.active.entries[1].sets).toHaveLength(2)
    expect(S.active.entries[2].sets).toHaveLength(1)
  })
  it('keeps the lighter session out of progression, said on the session', () => {
    const S = session()
    goLighter(S, 'load')
    expect(S.active.noProg).toBe(true)
    expect(S.active.entries.every(e => e.noProg === true)).toBe(true)
    expect(S.active.lighter).toBe('load')
  })
  it('changes nothing for a session it cannot make lighter', () => {
    const S = { ...session(), active: { id: 'x', cur: 0, entries: [{ id: PLANK, sets: [{ sec: 60, w: 0, done: false }] }] } }
    expect(canGoLighter(S.active, 'load')).toBe(false)
    expect(canGoLighter(S.active, 'sets')).toBe(false)
    expect(goLighter(S, 'load')).toBe(0)
    expect(S.active.noProg).toBeUndefined()
    expect(lighterChanges(null, 'load')).toEqual([])
  })
})

describe('the deload suggestion reads the check-ins', () => {
  it('turns each answered day into a 0 to 1 score, only inside the window', async () => {
    const { dailyFormSource } = await import('./daily-form.js')
    const S = { dayForm: { '2026-10-20': { sleep: 5, energy: 5, _ts: 1 }, '2026-10-28': { sleep: 1, energy: 2, sore: 5, _ts: 1 }, '2026-11-05': { _ts: 1 } } }
    expect(dailyFormSource(S, '2026-10-22', '2026-11-04')).toEqual([{ d: '2026-10-28', score: 0.08 }])
    expect(dailyFormSource(S, '2026-10-01', '2026-11-04')[0]).toEqual({ d: '2026-10-20', score: 1 })
    expect(dailyFormSource({ ...S, modules: { health: false } }, '2026-10-01', '2026-11-04')).toEqual([])
  })
  it('once registered, a run of rough check-ins and falling numbers suggest a deload for both reasons', async () => {
    const { registerDailyFormSource } = await import('./daily-form.js')
    const { deloadSuggestion, formTrend, setDailyFormSource } = await import('./deload-cycle.js')
    const sess = (d, id, w) => ({ id: d + id, d, entries: [{ id, sets: [{ w, r: 5, done: true }, { w, r: 5, done: true }] }] })
    const rough = { sleep: 1, energy: 2, sore: 4, stress: 4, _ts: 1 }
    const S = {
      weekStart: 1,
      workouts: [sess('2026-10-12', '0025', 100), sess('2026-10-14', '0043', 120), sess('2026-10-27', '0025', 90), sess('2026-10-29', '0043', 105)],
      dayForm: Object.fromEntries(['2026-10-25', '2026-10-27', '2026-10-30', '2026-11-01', '2026-11-03'].map(d => [d, rough])),
    }
    registerDailyFormSource()
    try {
      expect(formTrend(S, '2026-11-04')).toMatchObject({ low: true, n: 5 })
      expect(deloadSuggestion(S, '2026-11-04')).toMatchObject({ reason: 'both' })
    } finally { setDailyFormSource(null) }
  })
})
