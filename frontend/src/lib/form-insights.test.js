// Daily form insights (lib/form-insights.js): only with enough data, with counts on both sides,
// a word on how sure, and lighter days left out.
import { describe, it, expect } from 'vitest'
import { workoutPerformance, formInsights, insightProgress, MIN_GROUP, MIN_TOTAL } from './form-insights.js'

const BENCH = '0025'
const day = i => { const d = new Date(2026, 8, 1 + i * 2, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const workout = (i, w) => ({
  id: 'w' + i, d: day(i), start: new Date(day(i) + 'T18:00:00').getTime(), end: new Date(day(i) + 'T19:00:00').getTime(),
  routineIds: ['push'], entries: [{ id: BENCH, sets: [{ w, r: 5, done: true }, { w, r: 5, done: true, rir: w >= 100 ? 2 : 1 }] }],
})
// Twenty sessions: on good-energy days 100 kg, on tired ones 90.
function profile(n = 20, { lighter = false } = {}) {
  const workouts = [], dayForm = {}
  for (let i = 0; i < n; i++) {
    const good = i % 2 === 0
    workouts.push(workout(i, good ? 100 : 90))
    dayForm[day(i)] = { energy: good ? 5 : 2, _ts: 1, ...(lighter && !good ? { lighter: 'load' } : {}) }
  }
  return { unit: 'kg', workouts, dayForm }
}

describe('how a workout went', () => {
  it('compares each lift with its own recent sessions, from the third one on', () => {
    const perf = workoutPerformance(profile(4))
    expect(perf.map(p => p.strength == null)).toEqual([true, true, false, false])
    expect(perf[2].strength).toBeGreaterThan(1)   // 100 against a median of 95
    expect(perf[3].strength).toBeLessThan(1)
    expect(perf[3].effort).toBe(1)
  })
})

describe('the insights', () => {
  it('finds that good-energy days lift more, says how many on each side and how sure', () => {
    const ins = formInsights(profile())
    const x = ins.find(i => i.factor === 'energy' && i.metric === 'strength')
    expect(x.diff).toBeGreaterThan(5)
    expect(x.good.n + x.other.n).toBeGreaterThanOrEqual(MIN_TOTAL)
    expect(x.confidence).toBe('consistent')
    expect(x.flat).toBe(false)
    expect(ins[0].flat).toBe(false)
  })
  it('stays quiet until there is enough on both sides', () => {
    expect(formInsights(profile(MIN_GROUP + 2))).toEqual([])
    const p = insightProgress(profile(8))
    expect(p.need).toBe(MIN_TOTAL)
    expect(p.have).toBeLessThan(p.need)
  })
  it('leaves the days made lighter on purpose out of it', () => {
    expect(formInsights(profile(20, { lighter: true })).filter(i => i.factor === 'energy')).toEqual([])
  })
  it('reads the hours slept from the phone’s vitals', () => {
    const S = profile()
    const vitals = { days: Object.fromEntries(S.workouts.map((w, i) => [w.d, { sleepMin: i % 2 === 0 ? 480 : 330 }])) }
    const x = formInsights({ ...S, dayForm: {} }, { vitals }).find(i => i.factor === 'sleepHours' && i.metric === 'strength')
    expect(x.diff).toBeGreaterThan(0)
  })
  it('calls a gap within the noise what it is', () => {
    const S = profile()
    // The same lifts whatever the energy: every comparison is flat.
    S.workouts.forEach(w => { w.entries[0].sets.forEach(s => { s.w = 95; if (s.rir != null) s.rir = 1 }) })
    const ins = formInsights(S)
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.filter(i => !i.flat).map(i => [i.factor, i.metric, i.diff])).toEqual([])
  })
})
