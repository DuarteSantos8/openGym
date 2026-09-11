import { describe, it, expect } from 'vitest'
import { queueDone, queueRemaining, queueNext, queueView } from './queue.js'

// The DONE RULE is shared with the api's reminder copy (and any planner writing S.queue); these
// cases are the ones every copy must agree on. Dates are plain strings so nothing here reads the clock.
const routines = [{ id: 'd1', name: 'US W1 D1' }, { id: 'd2', name: 'US W1 D2' }, { id: 'd3', name: 'US W1 D3' }]
const SINCE = Date.parse('2026-09-07T08:00:00')
const TODAY = '2026-09-09'
const S = (over = {}) => ({
  routines, workouts: [],
  queue: { ids: ['d1', 'd2', 'd3'], since: SINCE, startsOn: '2026-09-07', label: 'US W1' },
  ...over,
})
const w = (over = {}) => ({ id: 'w', d: '2026-09-08', start: SINCE + 3600000, routineIds: [], routineId: null, name: '', ...over })

describe('DONE RULE', () => {
  it('a finished workout on the routine, started at or after the apply, marks it done', () => {
    expect(queueDone(S({ workouts: [w({ routineIds: ['d1'], start: SINCE, name: 'US W1 D1' })] }))).toEqual(['d1'])
    expect(queueRemaining(S({ workouts: [w({ routineIds: ['d1'], start: SINCE })] }))).toEqual(['d2', 'd3'])
  })

  it('a workout from before the apply is last week\'s, unless its name says otherwise', () => {
    const old = w({ routineIds: ['d1'], start: SINCE - 1, name: 'Push' })
    expect(queueDone(S({ workouts: [old] }))).toEqual([])
    // Adopted weeks: the workout predates `since`, but the merged session name carries the
    // routine's current name — that is the planner's own record of what was done.
    const adopted = w({ routineIds: ['d1'], start: SINCE - 86400000, name: 'US W1 D1 + Core' })
    expect(queueDone(S({ workouts: [adopted] }))).toEqual(['d1'])
  })

  it('a past week\'s workout that carries this week\'s name does not count — the name clause is bounded to the week', () => {
    // A planner may reuse its routine ids and names (W1 again after a restart): the sessions
    // trained under the ORIGINAL W1 must not tick the NEW W1 done on the day it is applied.
    const lastMonth = w({ routineIds: ['d2'], start: SINCE - 8 * 86400000, d: '2026-08-30', name: 'US W1 D2' })
    expect(queueDone(S({ workouts: [lastMonth] }))).toEqual([])
    // …whereas a "past workout" dated inside the week, logged with an early clock, does.
    const backfilled = w({ routineIds: ['d2'], start: SINCE - 86400000, d: '2026-09-07', name: 'US W1 D2' })
    expect(queueDone(S({ workouts: [backfilled] }))).toEqual(['d2'])
  })

  it('the routine id has to be on the workout — a name alone is not enough', () => {
    expect(queueDone(S({ workouts: [w({ routineIds: ['x'], name: 'US W1 D1' })] }))).toEqual([])
    expect(queueDone(S({ workouts: [w({ routineIds: [], name: 'US W1 D1' })] }))).toEqual([])
  })

  it('reads the legacy scalar routineId on a workout from before routineIds existed', () => {
    // No `routineIds` key at all — an empty array would be a real (freestyle) answer and wins.
    expect(queueDone(S({ workouts: [w({ routineIds: undefined, routineId: 'd2' })] }))).toEqual(['d2'])
    expect(queueDone(S({ workouts: [w({ routineIds: [], routineId: 'd2' })] }))).toEqual([])
  })

  it('a merged session counts for every routine in it', () => {
    expect(queueDone(S({ workouts: [w({ routineIds: ['d1', 'd3'] })] }))).toEqual(['d1', 'd3'])
    expect(queueRemaining(S({ workouts: [w({ routineIds: ['d1', 'd3'] })] }))).toEqual(['d2'])
  })

  it('a workout with no start (imported history) counts only through its name', () => {
    expect(queueDone(S({ workouts: [w({ routineIds: ['d1'], start: undefined, name: 'Push' })] }))).toEqual([])
    expect(queueDone(S({ workouts: [w({ routineIds: ['d1'], start: undefined, name: 'US W1 D1' })] }))).toEqual(['d1'])
  })

  it('the session in progress never counts — only finished workouts do', () => {
    const s = S({ active: { id: 'a', routineIds: ['d1'], start: SINCE + 1, name: 'US W1 D1' } })
    expect(queueDone(s)).toEqual([])
    expect(queueRemaining(s)).toEqual(['d1', 'd2', 'd3'])
  })

  it('without a queue nothing is done, nothing remains, and there is no view', () => {
    const s = S({ queue: null, workouts: [w({ routineIds: ['d1'] })] })
    expect(queueDone(s)).toEqual([])
    expect(queueRemaining(s)).toEqual([])
    expect(queueNext(s, TODAY, TODAY)).toBeNull()
    expect(queueView(s, TODAY)).toBeNull()
  })

  it('a queue of the wrong shape reads as no queue instead of throwing', () => {
    for (const queue of [{}, { ids: 'd1' }, 'd1', 7]) {
      expect(queueRemaining(S({ queue }))).toEqual([])
      expect(queueNext(S({ queue }), TODAY, TODAY)).toBeNull()
      expect(queueView(S({ queue }), TODAY)).toBeNull()
    }
  })
})

describe('queueNext', () => {
  it('answers on today once the week is active, and on no other day', () => {
    expect(queueNext(S(), TODAY, TODAY)).toBe('d1')
    expect(queueNext(S(), '2026-09-08', TODAY)).toBeNull()
    expect(queueNext(S(), '2026-09-10', TODAY)).toBeNull()
  })

  it('moves on to the next undone session in slot order', () => {
    expect(queueNext(S({ workouts: [w({ routineIds: ['d1'] })] }), TODAY, TODAY)).toBe('d2')
    expect(queueNext(S({ workouts: [w({ routineIds: ['d2'] })] }), TODAY, TODAY)).toBe('d1')
  })

  it('while the week waits on a future startsOn, the session sits on that day, not on today', () => {
    const s = S({ queue: { ...S().queue, startsOn: '2026-09-14' } })
    expect(queueNext(s, TODAY, TODAY)).toBeNull()
    expect(queueNext(s, '2026-09-14', TODAY)).toBe('d1')
    expect(queueNext(s, '2026-09-15', TODAY)).toBeNull()
  })

  it('is null once the week is complete', () => {
    const s = S({ workouts: [w({ routineIds: ['d1', 'd2', 'd3'] })] })
    expect(queueNext(s, TODAY, TODAY)).toBeNull()
  })
})

describe('queueView', () => {
  it('lists the sessions in slot order with one lit as next', () => {
    const v = queueView(S({ workouts: [w({ routineIds: ['d1'] })] }), TODAY)
    expect(v.label).toBe('US W1')
    expect(v.items).toEqual([
      { id: 'd1', name: 'US W1 D1', state: 'done' },
      { id: 'd2', name: 'US W1 D2', state: 'next' },
      { id: 'd3', name: 'US W1 D3', state: 'later' },
    ])
    expect(v.remaining).toEqual(['d2', 'd3'])
    expect(v).toMatchObject({ complete: false, startsOn: '2026-09-07', waiting: false })
  })

  it('says the week is waiting before startsOn, and still names the next session', () => {
    const v = queueView(S({ queue: { ...S().queue, startsOn: '2026-09-14' } }), TODAY)
    expect(v.waiting).toBe(true)
    expect(v.items[0].state).toBe('next')
    expect(v.startsOn).toBe('2026-09-14')
  })

  it('a complete week has every chip done and nothing remaining', () => {
    const v = queueView(S({ workouts: [w({ routineIds: ['d1', 'd2', 'd3'] })] }), TODAY)
    expect(v.items.map(i => i.state)).toEqual(['done', 'done', 'done'])
    expect(v).toMatchObject({ remaining: [], complete: true })
  })

  it('a session whose routine no longer exists is dropped from the week, not pinned as next forever', () => {
    // Deleted in the editor (the app never rewrites S.queue): it can never be started or logged.
    const v = queueView(S({ queue: { ...S().queue, ids: ['gone', 'd1', 'd2'] } }), TODAY)
    expect(v.items.map(i => i.id)).toEqual(['d1', 'd2'])
    expect(v.items[0].state).toBe('next')
    expect(queueRemaining(S({ queue: { ...S().queue, ids: ['gone', 'd1'] } }))).toEqual(['d1'])
    expect(queueNext(S({ queue: { ...S().queue, ids: ['gone', 'd1'] } }), TODAY, TODAY)).toBe('d1')
    // …and a week of nothing but deleted routines reads as no queue at all, so Home shows the plan.
    expect(queueView(S({ queue: { ...S().queue, ids: ['gone'] } }), TODAY)).toBeNull()
    expect(queueNext(S({ queue: { ...S().queue, ids: ['gone'] } }), TODAY, TODAY)).toBeNull()
  })

  it('a queue without a startsOn is active since the day of the apply, not silently dead', () => {
    const noStart = S({ queue: { ids: ['d1', 'd2'], since: SINCE, label: 'US W1' } })
    expect(queueNext(noStart, TODAY, TODAY)).toBe('d1')
    expect(queueView(noStart, TODAY)).toMatchObject({ waiting: false, startsOn: '2026-09-07' })
    const nullStart = S({ queue: { ids: ['d1'], since: SINCE, startsOn: null, label: 'US W1' } })
    expect(queueNext(nullStart, TODAY, TODAY)).toBe('d1')
  })
})
