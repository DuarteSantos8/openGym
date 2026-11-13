// The calendar's words for each week (lib/streak-explain.js) come from the streak's own walk, so
// they can never disagree with the number. The case from Discord (dimarei, 11-04): 5 weeks, a
// gap in September a freeze covered, then 6 more: 11.
import { describe, expect, it } from 'vitest'
import { streakInfo } from './streak.js'
import { isoOf } from './format.js'
import { streakWeeks, explainWeek, freezeLine } from './streak-explain.js'

const day = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const wk = k => day('2026-08-17', 7 * k)
const S = { workouts: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11].map(k => ({ d: day('2026-08-18', 7 * k), entries: [] })), weekStart: 1 }

describe('the walk, week by week', () => {
  it('records what streakInfo decided and changes none of its numbers', () => {
    const { info, log } = streakWeeks(S, '2026-11-03')
    expect(info).toEqual(streakInfo(S, '2026-11-03'))
    expect(info.current).toBe(11)
    expect(log.get(wk(0))).toMatchObject({ s: 'on', run: 1, bank: 0, earned: false })
    expect(log.get(wk(3))).toMatchObject({ s: 'on', run: 4, bank: 1, earned: true })
    expect(log.get(wk(5))).toMatchObject({ s: 'frozen', run: 5, bank: 0, earned: false })
    expect(log.get(wk(6)).run).toBe(6)
    expect(log.get(wk(11)).run).toBe(11)
    // Before the first workout and after this week: no mark.
    expect(log.has(wk(-1))).toBe(false)
    expect(log.has(wk(12))).toBe(false)
  })

  it('tells a week that broke the streak from one with nothing to break, and leaves this week open', () => {
    const two = { ...S, workouts: S.workouts.filter(w => w.d !== day('2026-08-18', 42)) }
    const { log } = streakWeeks(two, '2026-11-17')
    expect(log.get(wk(5)).s).toBe('frozen')
    expect(log.get(wk(6)).s).toBe('broke')
    expect(log.get(wk(6)).run).toBe(0)
    expect(log.get(wk(13)).s).toBe('open')
    const gaps = { workouts: [{ d: '2026-08-18' }], weekStart: 1 }
    const { log: l2 } = streakWeeks(gaps, '2026-09-08')
    expect(l2.get(wk(1)).s).toBe('broke')
    expect(l2.get(wk(2)).s).toBe('missed')
  })
})

describe('the words', () => {
  it('says why each kind of week counted', () => {
    expect(explainWeek({ s: 'on', run: 7 })).toBe('You trained, so this week counts. Streak: 7.')
    expect(explainWeek({ s: 'on', run: 4, earned: true })).toBe('You trained, so this week counts. Streak: 4. It also earned a freeze.')
    expect(explainWeek({ s: 'frozen' })).toMatch(/freeze covered it.*adds nothing to the count/)
    expect(explainWeek({ s: 'broke' })).toMatch(/started over/)
    expect(explainWeek({ s: 'missed' })).toBe('No workout this week.')
    expect(explainWeek({ s: 'open' })).toMatch(/One workout and it counts/)
    expect(explainWeek(null)).toBe('')
  })

  it('says how the next freeze is earned, or that the bank is full', () => {
    expect(freezeLine({ freezes: 2, toNextFreeze: 0 })).toMatch(/Freezes full/)
    expect(freezeLine({ freezes: 0, toNextFreeze: 1 })).toBe('One more week with a workout earns a freeze.')
    expect(freezeLine({ freezes: 1, toNextFreeze: 3 })).toBe('3 more weeks with a workout earn a freeze.')
  })
})

describe('a missed planned day', () => {
  it('says what its week made of it', async () => {
    const { explainMissedDay } = await import('./streak-explain.js')
    expect(explainMissedDay({ s: 'on' })).toMatch(/^Planned, not trained\. No harm done: you trained another day/)
    expect(explainMissedDay({ s: 'open' })).toBe('Planned, not trained. Any other day this week still counts.')
    expect(explainMissedDay({ s: 'frozen' })).toBe('Planned, not trained. Any workout that week would have counted.')
    expect(explainMissedDay(null)).toMatch(/would have counted/)
  })
})
