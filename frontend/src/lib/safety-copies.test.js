import { describe, expect, it } from 'vitest'
import { AUTO_GAP_MS, KEEP_AUTO, KEEP_BEFORE, autoCopyDue, copyToOffer, isEmptyProfile, makeCopy, summarize, withCopy } from './safety-copies.js'

const full = (extra = {}) => ({ workouts: [{ id: 'w1' }, { id: 'w2' }], routines: [{ id: 'r1' }], bodyweight: [], cardioPlans: { a: {} }, ...extra })
const copy = (at, reason = 'auto', state = full()) => ({ id: `${at}-${reason}`, at, reason, summary: summarize(state), state })

describe('what a profile holds', () => {
  it('counts workouts, routines, weigh-ins and plans', () => {
    expect(summarize(full())).toMatchObject({ workouts: 2, routines: 1, weighIns: 0, plans: 1 })
  })
  it('an empty or missing profile holds nothing', () => {
    expect(isEmptyProfile({})).toBe(true)
    expect(isEmptyProfile(null)).toBe(true)
    expect(isEmptyProfile({ workouts: [], routines: [], bodyweight: [], cardioPlans: {} })).toBe(true)
    expect(isEmptyProfile(full())).toBe(false)
  })
})

describe('making a copy', () => {
  it('copies a profile that holds something, without the workout in progress', () => {
    const c = makeCopy(full({ active: { id: 'x' } }), 'reset', 1000)
    expect(c).toMatchObject({ id: '1000-reset', at: 1000, reason: 'reset' })
    expect(c.state.active).toBeUndefined()
    expect(c.state.workouts).toHaveLength(2)
  })
  it('makes nothing from an empty profile', () => {
    expect(makeCopy({}, 'auto')).toBe(null)
    expect(makeCopy(null, 'auto')).toBe(null)
  })
})

describe('when the daily copy is due', () => {
  const now = 10 * AUTO_GAP_MS
  it('not for an empty profile', () => expect(autoCopyDue({}, [], now)).toBe(false))
  it('yes when there is none', () => expect(autoCopyDue(full(), [], now)).toBe(true))
  it('not within the gap, yes after it', () => {
    expect(autoCopyDue(full(), [copy(now - 1000)], now)).toBe(false)
    expect(autoCopyDue(full(), [copy(now - AUTO_GAP_MS)], now)).toBe(true)
  })
  it('a copy taken before a reset does not count as the daily one', () => {
    expect(autoCopyDue(full(), [copy(now - 1000, 'reset')], now)).toBe(true)
  })
})

describe('which copies are kept', () => {
  it('the newest automatic ones, and the newest ones from before a deletion, kept apart', () => {
    let list = [copy(1, 'reset')]
    for (let i = 2; i < 10; i++) list = withCopy(list, copy(i))
    expect(list.filter(c => c.reason === 'auto').map(c => c.at)).toEqual([9, 8, 7].slice(0, KEEP_AUTO))
    expect(list.find(c => c.reason === 'reset')).toBeTruthy()
    for (let i = 20; i < 26; i++) list = withCopy(list, copy(i, i % 2 ? 'import' : 'reset'))
    expect(list.filter(c => c.reason !== 'auto')).toHaveLength(KEEP_BEFORE)
  })
  it('adding the same copy twice keeps one', () => {
    const c = copy(5)
    expect(withCopy(withCopy([], c), c)).toHaveLength(1)
  })
})

describe('offering a restore', () => {
  it('an empty profile and a copy with data: the newest one is offered', () => {
    const c = copyToOffer({}, [copy(1), copy(9)])
    expect(c.at).toBe(9)
  })
  it('not when the profile holds something', () => expect(copyToOffer(full(), [copy(1)])).toBe(null))
  it('not after a deliberate reset', () => expect(copyToOffer({ resetAt: 5 }, [copy(1)])).toBe(null))
  it('not when the copies are empty too', () => expect(copyToOffer({}, [copy(1, 'auto', {})])).toBe(null))
})
