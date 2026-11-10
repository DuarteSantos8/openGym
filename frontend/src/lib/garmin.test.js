import { describe, it, expect, vi } from 'vitest'
vi.mock('./api.js', () => ({ api: vi.fn() }))
import { foodGoal, bedtimes, fmtClock, zoneWeek, realTdee, sickSigns, fitnessLevers, matchWorkout, weekSummary, activityKcal, readiness, meanBefore, fmtDuration, fmtPace, activityLine, activityType, keyDaysLeft } from './garmin.js'

const week = (restHr, today) => ({
  days: [...['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map(date => ({ date, restHr })),
    { date: '2026-11-10', ...today }],
})

describe('garmin readiness', () => {
  it('two bad signs make an easy day', () => {
    const r = readiness(week(50, { restHr: 57, sleepScore: 52, bbMax: 70 }), '2026-11-10')
    expect(r.level).toBe('easy')
    expect(r.bad).toEqual(['Sleep score 52', 'Resting heart rate 57, usually 50'])
  })
  it('good signs and no bad ones make a day to push', () => {
    expect(readiness(week(50, { sleepScore: 85, bbMax: 90, hrvStatus: 'BALANCED' }), '2026-11-10').level).toBe('push')
  })
  it('one bad sign is a normal day, no data is no answer', () => {
    expect(readiness(week(50, { sleepScore: 85, hrvStatus: 'UNBALANCED' }), '2026-11-10').level).toBe('normal')
    expect(readiness(week(50, {}), '2026-11-10')).toBe(null)
    expect(readiness(null, '2026-11-10')).toBe(null)
  })
  it('falls back to sleep time without a score', () => {
    expect(readiness({ days: [{ date: '2026-11-10', sleepSec: 5 * 3600, bbMax: 30 }] }, '2026-11-10').level).toBe('easy')
  })
  it('averages only the days before', () => {
    expect(meanBefore(week(50, { restHr: 70 }), 'restHr', '2026-11-10')).toBe(50)
  })
})

describe('garmin formatting', () => {
  it('durations, paces and lines', () => {
    expect(fmtDuration(27000)).toBe('7 h 30 min')
    expect(fmtDuration(300)).toBe('5 min')
    expect(fmtPace(1000 / 312)).toBe('5:12 /km')
    expect(fmtPace(0)).toBe('')
    expect(activityLine({ type: 'running', dur: 1560, dist: 5000, speed: 5000 / 1560, hr: 151.4 })).toBe('26 min · 5.00 km · 5:12 /km · 151 bpm')
    expect(activityLine({ type: 'strength_training', dur: 3600, sets: 18 })).toBe('1 h 00 min · 18 sets')
    expect(activityType('trail_running')).toBe('Trail running')
    expect(keyDaysLeft({ keyExp: 10 * 86400e3 }, 0)).toBe(10)
    expect(keyDaysLeft({}, 0)).toBe(null)
  })
})

describe('garmin activity calories', () => {
  it('sums the active share of that day only', () => {
    const g = { acts: [{ start: '2026-11-10 07:00:00', kcal: 400, bmr: 80 }, { start: '2026-11-10 18:00:00', kcal: 200 }, { start: '2026-11-09 07:00:00', kcal: 999 }] }
    expect(activityKcal(g, '2026-11-10')).toBe(520)
    expect(activityKcal(g, '2026-11-08')).toBe(null)
    expect(activityKcal(null, '2026-11-10')).toBe(null)
  })
})

describe('garmin and the log', () => {
  const at = h => new Date(`2026-11-10T${h}:00`).getTime()
  const g = { acts: [
    { id: 1, start: '2026-11-10 06:00:00', dur: 1800, type: 'running' },
    { id: 2, start: '2026-11-10 17:55:00', dur: 3900, type: 'strength_training' },
  ] }
  it('finds the activity recorded during a workout', () => {
    expect(matchWorkout(g, { start: at('18:00'), end: at('19:00') }).id).toBe(2)
    expect(matchWorkout(g, { start: at('12:00'), end: at('13:00') })).toBe(null)
    expect(matchWorkout(g, { start: at('18:00') })).toBe(null)
  })
  it('sums a week and compares it with the one before', () => {
    const days = [{ date: '2026-11-02', hrv: 40 }, { date: '2026-11-09', hrv: 50, imMod: 30, imVig: 20, sleepSec: 25200 }, { date: '2026-11-10', hrv: 46, imMod: 10 }]
    const w = weekSummary({ days, acts: [...g.acts, { start: '2026-11-08 09:00:00', dist: 10000, kcal: 700, type: 'cycling' }] }, [{ d: '2026-11-10' }, { d: '2026-11-01' }], '2026-11-10')
    expect(w).toMatchObject({ gym: 1, other: 2, km: 10, otherKcal: 700, im: 80, sleep: 25200, hrv: 48, hrvPrev: 40, rhr: null })
  })
})

describe('garmin batch 1', () => {
  const days = (n, f) => Array.from({ length: n }, (_, i) => { const d = new Date('2026-11-10T12:00:00'); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toISOString().slice(0, 10), ...f(i) } })
  it('bedtimes count after midnight as late and aim for the usual wake-up', () => {
    const g = { days: days(6, i => ({ bed: i % 2 ? 30 : 1410, wake: 420, awakeSec: 1800 })) }
    const b = bedtimes(g, '2026-11-10')
    expect(fmtClock(b.bed)).toBe('00:00')
    expect(Math.round(b.bedSpread)).toBe(30)
    expect(fmtClock(b.aim)).toBe('23:00')   // 07:00 wake - 7.5 h sleep - 30 min awake
    expect(bedtimes({ days: days(3, () => ({ bed: 1400, wake: 400 })) }, '2026-11-10')).toBe(null)
  })
  it('zone minutes over the week', () => {
    const g = { acts: [{ start: '2026-11-09 07:00:00', zones: [60, 1200, 300, 0, 0] }, { start: '2026-11-01 07:00:00', zones: [0, 6000, 0, 0, 0] }] }
    expect(zoneWeek(g, '2026-11-10')).toEqual([1, 20, 5, 0, 0])
  })
  it('real burn skips today and watch-off days', () => {
    const g = { days: [...days(10, () => ({ kcal: 2500 })), { date: '2026-11-03', kcal: 300 }].sort((a, b) => a.date.localeCompare(b.date)) }
    g.days.find(d => d.date === '2026-11-10').kcal = 900
    expect(realTdee(g, '2026-11-10')).toBe(2500)
    expect(realTdee({ days: days(5, () => ({ kcal: 2500 })) }, '2026-11-10')).toBe(null)
  })
  it('two signs together raise the getting-sick flag and make it an easy day', () => {
    const g = { days: days(15, i => (i < 14 ? { restHr: 50, hrv: 50, sleepResp: 14 } : { restHr: 57, hrv: 38, hrvLow: 42, sleepResp: 14.2, sleepScore: 85, bbMax: 90 })) }
    const s = sickSigns(g, '2026-11-10')
    expect(s.sick).toBe(true)
    expect(s.signs).toHaveLength(2)
    expect(readiness(g, '2026-11-10')).toMatchObject({ level: 'easy', sick: true })
  })
  it('fitness levers in Garmin priority order', () => {
    expect(fitnessLevers({ levers: { rhr: { value: 52 }, vigMin: { value: 40, target: 75, priority: 1 } } }).map(l => l.key)).toEqual(['vigMin', 'rhr'])
  })
})

describe('garmin in the food goal', () => {
  it('a typed goal eats back measured activity calories; no Garmin burn without a plan', () => {
    const g = { acts: [{ start: '2026-11-10 07:00:00', kcal: 400, bmr: 100 }], days: [] }
    expect(foodGoal({ foodGoal: 2000, foodEatBack: true, foodGarminTdee: true }, g, '2026-11-10')).toMatchObject({ goal: { kcal: 2300 }, burn: null, burned: 300, measured: 300 })
    expect(foodGoal({ foodGoal: 2000 }, g, '2026-11-10')).toMatchObject({ goal: { kcal: 2000 }, burned: 0 })
  })
})
