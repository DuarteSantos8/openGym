// Your month in openGym (lib/month-story.js): the year's story engine for one month.
import { describe, it, expect } from 'vitest'
import { monthStats, monthCards, storyMonths, offeredMonth, prevMonth, funLine } from './month-story.js'

const BENCH = '0025', SQUAT = '0043', CURL = '0294'
const w = (id, d, entries, extra = {}) => ({
  id, d, start: new Date(d + 'T18:00:00').getTime(), end: new Date(d + 'T19:00:00').getTime(),
  entries: entries.map(([ex, kg, reps = 5]) => ({ id: ex, sets: [{ w: kg, r: reps, done: true }, { w: kg, r: reps, done: true }] })),
  ...extra,
})
const S = () => ({
  unit: 'kg', weekStart: 1,
  workouts: [
    w('a', '2026-09-28', [[BENCH, 80]], { prs: [BENCH] }),
    w('b', '2026-10-01', [[BENCH, 85], [SQUAT, 100]], { prs: [BENCH] }),
    w('c', '2026-10-08', [[BENCH, 85], [SQUAT, 110]], { prs: [SQUAT] }),
    // Imported without `prs`: judged by sessionPrs against the history before it.
    w('d', '2026-10-15', [[BENCH, 90], [CURL, 14, 10]]),
    w('e', '2026-10-22', [[SQUAT, 105]], { prs: [] }),
    w('f', '2026-11-02', [[BENCH, 90]], { prs: [] }),
  ],
})

describe('the month in numbers', () => {
  it('counts the month by its local days and compares it with the month before', () => {
    const st = monthStats(S(), '2026-10')
    expect(st.workouts).toBe(4)
    expect(st.prev).toMatchObject({ ym: '2026-09', workouts: 1 })
    expect(st.sets).toBe(14)
    expect(st.topExercise.id).toBe(BENCH)
    expect(st.ms).toBe(4 * 3600000)
  })
  it('takes the saved records, and asks sessionPrs for a workout that came without them', () => {
    const st = monthStats(S(), '2026-10')
    // The curl's first time counts, as it does when a workout is finished (sessionPrs).
    expect(st.records.map(r => r.id).sort()).toEqual([BENCH, SQUAT, CURL].sort())
    const bench = st.records.find(r => r.id === BENCH)
    expect(bench).toMatchObject({ w: 90, gain: 10 })
  })
  it('counts the weeks with a workout out of the weeks of the month, and what was new', () => {
    const st = monthStats(S(), '2026-10')
    expect(st.weeks.trained).toBe(4)
    expect(st.weeks.of).toBe(5)
    expect(st.newExercises.sort()).toEqual([SQUAT, CURL].sort())
  })
  it('counts a running month only up to this week', () => {
    const st = monthStats(S(), '2026-11', '2026-11-06')
    expect(st.running).toBe(true)
    expect(st.weeks.of).toBe(2)
    expect(monthStats(S(), '2026-12')).toBeNull()
    expect(monthStats(S(), 'nope')).toBeNull()
  })
})

describe('which month', () => {
  it('lists months newest first and offers last month once it is over', () => {
    expect(storyMonths(S())).toEqual(['2026-11', '2026-10', '2026-09'])
    expect(offeredMonth(S(), '2026-11-06')).toBe('2026-10')
    expect(offeredMonth(S(), '2026-12-06')).toBe('2026-11')
    expect(offeredMonth({ workouts: [] }, '2026-12-06')).toBeNull()
    expect(prevMonth('2026-01')).toBe('2025-12')
  })
})

describe('the cards', () => {
  it('runs from the intro to a summary, leaving out what has nothing to say', () => {
    const cards = monthCards(monthStats(S(), '2026-10'), S())
    const ids = cards.map(c => c.id)
    expect(ids[0]).toBe('intro')
    expect(ids.at(-1)).toBe('summary')
    expect(ids).toEqual(expect.arrayContaining(['workouts', 'time', 'volume', 'streak', 'records', 'top', 'new']))
    const records = cards.find(c => c.id === 'records')
    expect(records.big).toBe('3')
    expect(cards.find(c => c.id === 'top').map).toBeTruthy()
    for (const c of cards) for (const line of [c.title, ...(c.lines || [])]) expect(line).not.toMatch(/—/)
  })
  it('goes out on a kind line', () => {
    const st = monthStats(S(), '2026-10')
    expect(funLine(st)).toMatch(/More than last month/)
    expect(funLine({ ...st, prev: null, newExercises: [], workouts: 2 })).toMatch(/Showing up/)
    expect(monthCards(null, S())).toEqual([])
  })
})
