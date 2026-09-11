import { describe, it, expect } from 'vitest'
import { queueDone, queueRemaining, queueNext, queueView, weekTally, pinState } from './queue.js'

// The DONE RULE is shared with the api's reminder copy (and any planner writing S.queue); these
// cases are the ones every copy must agree on. Dates are plain strings so nothing here reads the clock.
const routines = [{ id: 'd1', name: 'US W1 D1' }, { id: 'd2', name: 'US W1 D2' }, { id: 'd3', name: 'US W1 D3' }, { id: 'own', name: 'Core' }]
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

describe('pins — a session given a day (S.dayPlan[iso] = queue routine id)', () => {
  const FRI = '2026-09-11'
  it('a session pinned to another day is skipped by the floating rule until that day', () => {
    expect(queueNext(S({ dayPlan: { [FRI]: 'd1' } }), TODAY, TODAY)).toBe('d2')
    // …and on its day it is the day's session, ahead of the floating order.
    expect(queueNext(S({ dayPlan: { [TODAY]: 'd3' } }), TODAY, TODAY)).toBe('d3')
    // Every remaining session pinned elsewhere: nothing floats today.
    expect(queueNext(S({ dayPlan: { [FRI]: 'd1', '2026-09-12': 'd2', '2026-09-13': 'd3' } }), TODAY, TODAY)).toBeNull()
  })

  it('a pin on a past day is stale, and a pin on a done session is fulfilled: both let the session float', () => {
    expect(queueNext(S({ dayPlan: { '2026-09-08': 'd1' } }), TODAY, TODAY)).toBe('d1')
    const done = S({ dayPlan: { [FRI]: 'd1' }, workouts: [w({ routineIds: ['d1'] })] })
    expect(queueNext(done, TODAY, TODAY)).toBe('d2')
    expect(pinState(done, 'd1')).toBe('done')
  })

  it('pinState: open for a session still to do, done once logged, null for anything else', () => {
    expect(pinState(S(), 'd2')).toBe('open')
    expect(pinState(S({ workouts: [w({ routineIds: ['d2'] })] }), 'd2')).toBe('done')
    expect(pinState(S(), 'own')).toBeNull()
    expect(pinState(S(), 'rest')).toBeNull()
    expect(pinState(S(), undefined)).toBeNull()
    expect(pinState(S({ queue: null }), 'd1')).toBeNull()
    // A pinned session whose routine the planner deleted is not a pin any more.
    expect(pinState(S({ routines: routines.filter(r => r.id !== 'd1') }), 'd1')).toBeNull()
  })

  it('a pin dated between today and a future startsOn is honoured on its day, and skipped on the start day', () => {
    const s = S({ queue: { ...S().queue, startsOn: '2026-09-14' }, dayPlan: { '2026-09-12': 'd1' } })
    expect(queueNext(s, '2026-09-14', TODAY)).toBe('d2')
    expect(queueNext(s, TODAY, TODAY)).toBeNull()
    expect(pinState(s, 'd1')).toBe('open')
  })

  it('queueView lights the floating session and shows a pinned one with its day', () => {
    const v = queueView(S({ dayPlan: { [FRI]: 'd1', '2026-09-13': 'd1' } }), TODAY)
    expect(v.items).toEqual([
      { id: 'd1', name: 'US W1 D1', state: 'pinned', on: FRI },
      { id: 'd2', name: 'US W1 D2', state: 'next' },
      { id: 'd3', name: 'US W1 D3', state: 'later' },
    ])
    // Pinned to today: it is 'next', and the would-be first session is 'later'.
    const today = queueView(S({ dayPlan: { [TODAY]: 'd3' } }), TODAY)
    expect(today.items.map(i => i.state)).toEqual(['later', 'later', 'next'])
    // All pinned elsewhere: no 'next' at all today.
    const all = queueView(S({ dayPlan: { [FRI]: 'd1', '2026-09-12': 'd2', '2026-09-13': 'd3' } }), TODAY)
    expect(all.items.map(i => i.state)).toEqual(['pinned', 'pinned', 'pinned'])
    expect(all.items.map(i => i.on)).toEqual([FRI, '2026-09-12', '2026-09-13'])
    // A fulfilled pin is just done.
    const done = queueView(S({ dayPlan: { [FRI]: 'd1' }, workouts: [w({ routineIds: ['d1'] })] }), TODAY)
    expect(done.items[0]).toEqual({ id: 'd1', name: 'US W1 D1', state: 'done' })
  })

  it('pins never change the tally', () => {
    expect(weekTally(S({ dayPlan: { [FRI]: 'd1' } }), TODAY)).toEqual({ done: 0, planned: 3 })
    expect(queueRemaining(S({ dayPlan: { [FRI]: 'd1' } }))).toEqual(['d1', 'd2', 'd3'])
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

describe('weekTally — the streak card fraction', () => {
  // Monday-start weeks (no S.weekStart); TODAY is Wednesday 2026-09-09, the queue applied Monday.
  const own = (d, over = {}) => w({ id: 'own-' + d, d, start: Date.parse(d + 'T18:00:00'), routineIds: ['own'], name: 'Core', ...over })

  it('without a queue: this calendar week\'s workouts over the weekdays with a plan, as before', () => {
    const s = S({ queue: null, week: { 1: ['own'], 3: ['own', 'd1'], 5: [] }, workouts: [own('2026-09-07'), own('2026-09-05')] })
    expect(weekTally(s, TODAY)).toEqual({ done: 1, planned: 2 })
    expect(weekTally(S({ queue: null }), TODAY)).toEqual({ done: 0, planned: 0 })
  })

  it('a coach week alone: the queue\'s sessions, done by the DONE RULE, whatever calendar week they fell in', () => {
    expect(weekTally(S(), TODAY)).toEqual({ done: 0, planned: 3 })
    expect(weekTally(S({ workouts: [w({ routineIds: ['d1'] })] }), TODAY)).toEqual({ done: 1, planned: 3 })
    // Ran long: a session logged last week still counts — the coach week is the unit.
    const s = S({ queue: { ...S().queue, since: SINCE - 7 * 86400000, startsOn: '2026-08-31' }, workouts: [w({ routineIds: ['d1'], d: '2026-09-04', start: SINCE - 5 * 86400000 })] })
    expect(weekTally(s, TODAY)).toEqual({ done: 1, planned: 3 })
  })

  it('your own weekday rides along: one more planned, and its workout this week one more done', () => {
    const s = S({ week: { 3: ['own'] }, workouts: [w({ routineIds: ['d1'] }), own('2026-09-09')] })
    expect(weekTally(s, TODAY)).toEqual({ done: 2, planned: 4 })
    // …but last week's Core is last week's.
    expect(weekTally(S({ week: { 3: ['own'] }, workouts: [own('2026-09-02')] }), TODAY)).toEqual({ done: 0, planned: 4 })
  })

  it('a weekday that holds only queue routines (the planner\'s old pointers) adds no day', () => {
    expect(weekTally(S({ week: { 1: ['d1'], 3: ['d2'], 5: ['d3'] } }), TODAY)).toEqual({ done: 0, planned: 3 })
    expect(weekTally(S({ week: { 1: ['d1', 'own'] } }), TODAY)).toEqual({ done: 0, planned: 4 })
    // …even when the planner has since deleted that routine: the pointer is still not your day.
    expect(weekTally(S({ queue: { ...S().queue, ids: ['d1', 'd2', 'gone'] }, week: { 5: ['gone'] } }), TODAY)).toEqual({ done: 0, planned: 2 })
  })

  it('a merged session counts for both sides — following the app\'s own daily proposal all week ends at 4 / 4', () => {
    // Wednesday's today row is 'US W1 D2 + Core' (the queue session with the weekday's own
    // routine riding along) and Start logs it as ONE workout: the coach session is credited
    // through the queue, the Core day as training on top — the two units `planned` counted.
    const merged = w({ routineIds: ['d1', 'own'], name: 'US W1 D1 + Core' })
    expect(weekTally(S({ week: { 3: ['own'] }, workouts: [merged] }), TODAY)).toEqual({ done: 2, planned: 4 })
    const week = [
      w({ id: 'mon', d: '2026-09-07', start: SINCE + 3600000, routineIds: ['d1'], name: 'US W1 D1' }),
      w({ id: 'wed', d: '2026-09-09', start: SINCE + 2 * 86400000, routineIds: ['d2', 'own'], name: 'US W1 D2 + Core' }),
      w({ id: 'fri', d: '2026-09-11', start: SINCE + 4 * 86400000, routineIds: ['d3'], name: 'US W1 D3' }),
    ]
    expect(weekTally(S({ week: { 3: ['own'] }, workouts: week }), '2026-09-13')).toEqual({ done: 4, planned: 4 })
    expect(queueDone(S({ workouts: week }))).toEqual(['d1', 'd2', 'd3'])
  })

  it('every other workout is training on top: freestyle, a redo of a done session, a pre-apply coach-routine one', () => {
    // A second D1 this week is not a second credit, but it is a workout done — never invisible.
    const redo = w({ id: 'w2', d: '2026-09-09', start: SINCE + 2 * 86400000, routineIds: ['d1'], name: 'US W1 D1' })
    expect(weekTally(S({ workouts: [w({ routineIds: ['d1'] }), redo] }), TODAY)).toEqual({ done: 2, planned: 3 })
    expect(queueDone(S({ workouts: [w({ routineIds: ['d1'] }), redo] }))).toEqual(['d1'])
    // The credit goes to the EARLIEST qualifying workout whatever the array order: D1 done last
    // week (the week ran long) and again this week is one credit plus one workout on top.
    const long = { ...S().queue, since: SINCE - 7 * 86400000, startsOn: '2026-08-31' }
    const sat = w({ id: 'sat', d: '2026-09-05', start: SINCE - 2 * 86400000, routineIds: ['d1'], name: 'US W1 D1' })
    expect(weekTally(S({ queue: long, workouts: [sat, redo] }), TODAY)).toEqual({ done: 2, planned: 3 })
    expect(weekTally(S({ queue: long, workouts: [redo, sat] }), TODAY)).toEqual({ done: 2, planned: 3 })
    const freestyle = w({ routineIds: [], name: 'Freestyle', d: '2026-09-08' })
    expect(weekTally(S({ workouts: [freestyle] }), TODAY)).toEqual({ done: 1, planned: 3 })
    // Monday morning's session on a coach routine, before Monday noon's apply: not this week's
    // D1 (the row stays at 0 / 3), but training done this week all the same.
    const before = w({ routineIds: ['d1'], name: 'US W3 D1', d: '2026-09-07', start: SINCE - 3600000 })
    expect(weekTally(S({ workouts: [before] }), TODAY)).toEqual({ done: 1, planned: 3 })
    expect(queueDone(S({ workouts: [before] }))).toEqual([])
  })

  it('a queue waiting on a future startsOn is next week\'s plan: the card counts this calendar week alone', () => {
    // W1 finished Thursday; the planner applied W2 (four sessions) Thursday night for Monday.
    // Friday's card says what this week did — 3 of the 0 own days planned — not 3 / 4 or 3 / 7.
    const w1 = ['2026-09-07', '2026-09-08', '2026-09-10'].map((d, i) => w({ id: 'w' + i, d, start: Date.parse(d + 'T18:00:00'), routineIds: ['d' + (i + 1)], name: 'US W1 D' + (i + 1) }))
    const w2 = { ids: ['d1', 'd2', 'd3', 'own'], since: Date.parse('2026-09-10T21:00:00'), startsOn: '2026-09-14', label: 'US W2' }
    expect(weekTally(S({ queue: w2, workouts: w1 }), '2026-09-11')).toEqual({ done: 3, planned: 0 })
    // Your own weekday is still this week's, and the waiting queue does not hide it.
    expect(weekTally(S({ queue: w2, week: { 5: ['own'] }, workouts: w1 }), '2026-09-11')).toEqual({ done: 3, planned: 1 })
    // Monday it is active: four sessions, and 'own' is now the queue's, so the weekday adds nothing.
    expect(weekTally(S({ queue: w2, week: { 5: ['own'] }, workouts: w1 }), '2026-09-14')).toEqual({ done: 0, planned: 4 })
  })

  it('follows the week-start setting: a Sunday workout is this week\'s for a Sunday start, last week\'s for Monday', () => {
    const s = S({ queue: null, week: { 0: ['own'] }, workouts: [own('2026-09-06')] })
    expect(weekTally({ ...s, weekStart: 0 }, TODAY)).toEqual({ done: 1, planned: 1 })
    expect(weekTally({ ...s, weekStart: 1 }, TODAY)).toEqual({ done: 0, planned: 1 })
  })
})
