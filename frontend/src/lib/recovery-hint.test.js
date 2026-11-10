// The recovery hint on Home: one kind line about what has rested and what is still recovering.
import { describe, expect, it } from 'vitest'
import { recoveryHint, lastWorked, HINT_NEGLECT_DAYS, hintText, hintDay } from './recovery-hint.js'
import { fatigueOf } from './recovery.js'

const SQUAT = '0043', BENCH = '0025', ROW = '0027', RDL = '0085', OHP = '0091'
// Wednesday 28 Oct 2026, 09:00.
const TODAY = '2026-10-28'
const NOW = new Date(2026, 9, 28, 9).getTime()
const daysAgo = n => { const x = new Date(2026, 9, 28 - n, 18); return { d: `2026-10-${String(28 - n).padStart(2, '0')}`, start: x.getTime(), end: x.getTime() + 3600e3 } }
const sets = (n, w = 60) => Array.from({ length: n }, () => ({ w, r: 8, done: true }))
const workout = (n, ids, k = 5) => ({ id: 'w' + n + ids.join(''), ...daysAgo(n), entries: ids.map(id => ({ id, sets: sets(k) })) })
const legs = n => workout(n, [SQUAT, RDL])
const upper = n => workout(n, [BENCH, ROW, OHP])
const routine = (id, ids, k = 4) => ({ id, name: id, ex: ids.map(x => ({ id: x, sets: k, reps: 8, weight: 60 })) })

function state(workouts, extra = {}) {
  return { unit: 'kg', workouts, routines: [routine('Legs', [SQUAT, RDL]), routine('Push', [BENCH, OHP]), routine('Arms', ['0294'])], week: {}, dayPlan: {}, ...extra }
}
const hint = (S, now = NOW) => recoveryHint(S, { now, today: TODAY, fatigue: fatigueOf(S.workouts, now, { unit: 'kg' }) })

// A history long enough to count as training: legs on Monday (yesterday's yesterday), upper 4 days ago.
const HISTORY = [legs(12), upper(10), legs(6), upper(4), legs(1)]

describe('recoveryHint', () => {
  it('freestyle: the region still recovering, and the other one as the idea for today', () => {
    const h = hint(state(HISTORY))
    expect(h).toEqual({ kind: 'split', region: 'legs', day: '2026-10-27' })
    expect(hintText(h, TODAY)).toEqual(['Your legs are still recovering from yesterday.', 'Upper body today?'])
  })

  it('a planned day leaning on a recovering region: lighter, or swap', () => {
    const S = state(HISTORY, { week: { 3: ['Legs'], 5: ['Push'] } })
    const h = hint(S)
    expect(h).toMatchObject({ kind: 'lighter', region: 'legs', routine: 'Legs' })
    expect(hintText(h, TODAY)[1]).toBe('Go a bit lighter today, or swap the session.')
  })

  it('a planned day that does not lean on it says nothing about it', () => {
    expect(hint(state(HISTORY, { week: { 3: ['Arms'], 5: ['Push'] } }))).toBeNull()
  })

  it('a planned rest day stays calm: only that the rest comes at a good time', () => {
    const h = hint(state(HISTORY, { week: { 1: ['Legs'], 5: ['Push'] } }))
    expect(h).toEqual({ kind: 'rest', region: 'legs', day: '2026-10-27' })
    expect(hintText(h, TODAY)).toEqual(['Rest day, good timing.', 'Your legs are still recovering from yesterday.'])
    // Rested everywhere: a rest day says nothing at all, never "go train".
    expect(hint(state([legs(12), upper(10), legs(9)], { week: { 1: ['Legs'] } }), NOW)).toBeNull()
  })

  it('freestyle with everything rested: the group left alone longest, once it is a week', () => {
    const h = hint(state([upper(20), legs(12), upper(10), legs(9), upper(3)]))
    expect(h).toEqual({ kind: 'neglect', group: 'legs', days: 9 })
    expect(hintText(h, TODAY)).toEqual(['Your legs haven’t had any work in 9 days.', 'A few sets today would be nice.'])
    expect(hint(state([upper(20), legs(12), upper(10), legs(HINT_NEGLECT_DAYS - 1), upper(3)]))).toBeNull()
  })

  it('a planned day that brings a left-alone group back gets a nod', () => {
    const h = hint(state([upper(20), legs(12), upper(10), legs(9), upper(3)], { week: { 3: ['Legs'] } }))
    expect(h).toEqual({ kind: 'covered', group: 'legs', days: 9 })
    expect(hintText(h, TODAY)[1]).toBe('Today’s plan takes care of that.')
  })

  it('never for a group given up long ago, nor for a profile that is just starting', () => {
    expect(hint(state([legs(70), upper(10), upper(5), upper(3)]))).toBeNull()
    expect(hint(state([legs(1), upper(3)]))).toBeNull()
  })

  it('nothing while a session runs, once today is logged, when put away for today, or switched off', () => {
    expect(hint(state(HISTORY, { active: { name: 'x' } }))).toBeNull()
    expect(hint(state([...HISTORY, { ...upper(0), d: TODAY }]))).toBeNull()
    expect(hint(state(HISTORY, { recoveryHintDay: TODAY }))).toBeNull()
    expect(hint(state(HISTORY, { recoveryHintDay: '2026-10-27' }))).not.toBeNull()
    expect(hint(state(HISTORY, { recoveryHint: false }))).toBeNull()
  })

  it('both regions recovering in freestyle: no idea to offer, so nothing', () => {
    expect(hint(state([legs(12), upper(10), upper(1), legs(1)]))).toBeNull()
  })

  it('reads when each muscle had real work', () => {
    const last = lastWorked([legs(3), upper(1)])
    expect(last.quadriceps).toBe(daysAgo(3).start)
    expect(last.chest).toBe(daysAgo(1).start)
  })
})

describe('hint words', () => {
  it('names the day: yesterday, a weekday within the week, else a date', () => {
    expect(hintDay('2026-10-27', TODAY)).toBe('yesterday')
    expect(hintDay('2026-10-24', TODAY)).toBe('Saturday')
    expect(hintDay('2026-10-14', TODAY)).toMatch(/14/)
  })

  it('has no dash in any line (copy tone)', () => {
    const all = [
      { kind: 'rest', region: 'upper', day: '2026-10-26' }, { kind: 'lighter', region: 'upper', day: '2026-10-26' },
      { kind: 'split', region: 'upper', day: '2026-10-26' }, ...['legs', 'back', 'chest', 'shoulders'].flatMap(group => [{ kind: 'covered', group, days: 8 }, { kind: 'neglect', group, days: 8 }]),
    ]
    for (const h of all) for (const line of hintText(h, TODAY)) expect(line).not.toMatch(/—|–/)
  })
})
