import { describe, expect, it } from 'vitest'
import { workoutsOn, backfillStart, backfillEnd, insertChronological, completeBackfill, markAllSetsDone, historyAsOf, sessionHistory } from './backfill.js'

const w = (id, d, start = 0) => ({ id, d, start })

describe('workoutsOn', () => {
  it('returns every workout of that day and nothing else', () => {
    const S = { workouts: [w('a', '2026-01-01'), w('b', '2026-01-02'), w('c', '2026-01-02')] }
    expect(workoutsOn(S, '2026-01-02').map(x => x.id)).toEqual(['b', 'c'])
    expect(workoutsOn(S, '2026-01-03')).toEqual([])
    expect(workoutsOn({}, '2026-01-03')).toEqual([])
  })
})

describe('backfillStart / backfillEnd', () => {
  it('lands on the chosen day at the chosen time in local zone', () => {
    const t = new Date(backfillStart('2026-03-10', '07:45'))
    expect([t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes()]).toEqual([2026, 3, 10, 7, 45])
  })
  it('defaults to 18:00 and ends after the given duration', () => {
    const start = backfillStart('2026-03-10')
    expect(new Date(start).getHours()).toBe(18)
    expect(backfillEnd({ start, backfill: { durationMin: 45 } })).toBe(start + 45 * 60000)
    expect(backfillEnd({ start, backfill: {} })).toBe(start + 60 * 60000)
    expect(backfillEnd({ start, backfill: { durationMin: 0 } })).toBe(start + 60 * 60000)
  })
})

describe('insertChronological', () => {
  const list = [w('a', '2026-01-01', 10), w('b', '2026-01-05', 10), w('c', '2026-01-05', 20), w('d', '2026-01-09', 10)]
  it('places by date, then by start time, after equal keys', () => {
    expect(insertChronological(list, w('x', '2026-01-03')).map(x => x.id)).toEqual(['a', 'x', 'b', 'c', 'd'])
    expect(insertChronological(list, w('x', '2026-01-05', 15)).map(x => x.id)).toEqual(['a', 'b', 'x', 'c', 'd'])
    expect(insertChronological(list, w('x', '2026-01-05', 20)).map(x => x.id)).toEqual(['a', 'b', 'c', 'x', 'd'])
  })
  it('appends at the end and inserts at the front', () => {
    expect(insertChronological(list, w('x', '2026-02-01')).at(-1).id).toBe('x')
    expect(insertChronological(list, w('x', '2025-12-31'))[0].id).toBe('x')
    expect(insertChronological([], w('x', '2026-01-01')).map(x => x.id)).toEqual(['x'])
  })
  it('does not mutate the input', () => {
    const copy = [...list]
    insertChronological(list, w('x', '2026-01-03'))
    expect(list).toEqual(copy)
  })
})

describe('completeBackfill', () => {
  const list = [w('a', '2026-01-01', 10), w('b', '2026-01-05', 10), w('d', '2026-01-09', 10)]
  it('adds a second workout on a day in order', () => {
    const out = completeBackfill(list, { backfill: { durationMin: 60, replaceId: null } }, w('x', '2026-01-05', 5))
    expect(out.map(x => x.id)).toEqual(['a', 'x', 'b', 'd'])
  })
  it('replaces the chosen workout', () => {
    const out = completeBackfill(list, { backfill: { durationMin: 60, replaceId: 'b' } }, w('x', '2026-01-05', 30))
    expect(out.map(x => x.id)).toEqual(['a', 'x', 'd'])
    expect(list).toHaveLength(3)
  })
  it('carries the replaced workout\'s photos and videos onto the new record, stamped', () => {
    const ref = n => ({ kind: 'image', hash: String(n).repeat(64), mime: 'image/webp', size: 10, width: 8, height: 6, at: 1 })
    const withMedia = [list[0], { ...list[1], media: [ref(1), ref(2)] }, list[2]]
    const x = w('x', '2026-01-05', 30)
    const out = completeBackfill(withMedia, { backfill: { durationMin: 60, replaceId: 'b' } }, x, 777)
    expect(out.map(y => y.id)).toEqual(['a', 'x', 'd'])
    expect(out[1].media).toEqual([ref(1), ref(2)])
    expect(out[1]._ts).toBe(777)
    // Nothing to carry: no stamp, no empty list.
    const plain = completeBackfill(list, { backfill: { durationMin: 60, replaceId: 'b' } }, w('y', '2026-01-05', 30), 777)
    expect('media' in plain[1] || '_ts' in plain[1]).toBe(false)
  })
  // QA 1.3.9: the sets were logged again and the day's note went with the old record.
  it('carries the replaced workout\'s note, ahead of one written now, stamped', () => {
    const noted = [list[0], { ...list[1], note: 'knee felt off' }, list[2]]
    const kept = completeBackfill(noted, { backfill: { durationMin: 60, replaceId: 'b' } }, w('x', '2026-01-05', 30), 777)
    expect(kept[1]).toMatchObject({ id: 'x', note: 'knee felt off', _ts: 777 })
    const both = completeBackfill(noted, { backfill: { durationMin: 60, replaceId: 'b' } }, { ...w('y', '2026-01-05', 30), note: 'redid it' }, 778)
    expect(both[1].note).toBe('knee felt off\nredid it')
    // The same note typed again is not doubled, and needs no stamp.
    const same = completeBackfill(noted, { backfill: { durationMin: 60, replaceId: 'b' } }, { ...w('z', '2026-01-05', 30), note: 'knee felt off' }, 779)
    expect(same[1].note).toBe('knee felt off')
    expect('_ts' in same[1]).toBe(false)
  })
})

// #284: a missed Monday logged on Saturday opened at Friday's progression and saved it as Monday's.
// What a session logged into the past is built from is the history filed ahead of it.
describe('historyAsOf', () => {
  const list = [w('a', '2026-01-01', 10), w('b', '2026-01-05', 10), w('c', '2026-01-05', 20), w('d', '2026-01-09', 10)]
  const S = { unit: 'kg', workouts: list, exWeights: { bench: { w: 100, d: '2026-01-09' }, row: { w: 60, d: '2026-01-02' }, curl: { w: 12 } } }

  it('keeps what is filed ahead of the session: earlier days, and earlier the same day', () => {
    expect(historyAsOf(S, { d: '2026-01-05', start: 15 }).workouts.map(x => x.id)).toEqual(['a', 'b'])
    expect(historyAsOf(S, { d: '2026-01-05', start: 20 }).workouts.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(historyAsOf(S, { d: '2026-01-03' }).workouts.map(x => x.id)).toEqual(['a'])
    expect(historyAsOf(S, { d: '2025-12-31' }).workouts).toEqual([])
  })

  it('leaves out the workout being replaced', () => {
    expect(historyAsOf(S, { d: '2026-01-05', start: 30, replaceId: 'b' }).workouts.map(x => x.id)).toEqual(['a', 'c'])
  })

  it('drops a working weight confirmed after the day, and keeps one that carries no date', () => {
    expect(historyAsOf(S, { d: '2026-01-05', start: 15 }).exWeights).toEqual({ row: { w: 60, d: '2026-01-02' }, curl: { w: 12 } })
  })

  it('reads without writing: S keeps its history, and everything else comes through', () => {
    const view = historyAsOf(S, { d: '2026-01-03' })
    expect(S.workouts).toHaveLength(4)
    expect(Object.keys(S.exWeights)).toHaveLength(3)
    expect(view.unit).toBe('kg')
    expect(historyAsOf({}, { d: '2026-01-03' })).toMatchObject({ workouts: [], exWeights: {} })
  })
})

describe('sessionHistory', () => {
  const list = [w('a', '2026-01-01', 10), w('b', '2026-01-05', 10), w('d', '2026-01-09', 10)]

  it('is the whole state for a live session, and the history before the day for a logged one', () => {
    const live = { workouts: list, exWeights: {}, active: { d: '2026-01-10', start: 99 } }
    expect(sessionHistory(live)).toBe(live)
    const past = { workouts: list, exWeights: {}, active: { d: '2026-01-05', start: 50, backfill: { durationMin: 60, replaceId: 'b' } } }
    expect(sessionHistory(past).workouts.map(x => x.id)).toEqual(['a'])
    expect(sessionHistory({ workouts: list })).toEqual({ workouts: list })
  })

  // QA 1.3.9: the editor read the whole log, so "Last time" and the Best chip on a workout being
  // corrected were itself or a later session.
  it('is the history before the edited workout, without it, while a saved workout is in the editor', () => {
    const editing = { workouts: list, exWeights: {}, active: { d: '2026-01-05', start: 10, editingWorkoutId: 'b' } }
    expect(sessionHistory(editing).workouts.map(x => x.id)).toEqual(['a'])
    // One from before ids, keyed by its day and start, is left out by its start.
    const legacy = [w('a', '2026-01-01', 10), { ...w(undefined, '2026-01-05', 10), id: undefined }, w('d', '2026-01-09', 10)]
    const old = { workouts: legacy, exWeights: {}, active: { d: '2026-01-05', start: 10, editingWorkoutId: '2026-01-05|10' } }
    expect(sessionHistory(old).workouts.map(x => x.d)).toEqual(['2026-01-01'])
  })
})

// #284: a past session that went as planned is logged with one tap instead of one per set.
describe('markAllSetsDone', () => {
  it('ticks every row, warm-ups and both sides of a unilateral set included, and stamps the top weight', () => {
    const side = (w, r) => ({ w, r, done: false })
    const entries = [
      { id: 'bench', target: { reps: 5 }, sets: [{ w: 40, r: 8, done: false, phase: 'warmup' }, { w: 60, r: 5, done: false }, { w: 62.5, r: 5, done: true }] },
      { id: 'curl', target: { reps: 16, side: true }, sets: [{ w: 12, r: 16, done: false, sides: { L: side(12, 8), R: side(10, 8) } }] },
      { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 30, speed: 10, done: false }] },
    ]
    const out = markAllSetsDone(entries)
    expect(out.every(e => e.sets.every(s => s.done === true))).toBe(true)
    expect(out[1].sets[0].sides.L.done && out[1].sets[0].sides.R.done).toBe(true)
    expect(out.map(e => e.topW)).toEqual([62.5, 12, null])
    // new entries: the ones passed in are left as they were
    expect(entries[0].sets[1].done).toBe(false)
    expect(entries[1].sets[0].sides.L.done).toBe(false)
  })

  it('keeps everything else on the entry, the plan stamps included', () => {
    const entry = { id: 'bench', rid: 'r1', planned: { sets: 1, reps: 5 }, sg: 'sg1', target: { reps: 5 }, sets: [{ w: 60, r: 5, done: false, rir: 2 }] }
    expect(markAllSetsDone([entry])[0]).toEqual({ ...entry, sets: [{ w: 60, r: 5, done: true, rir: 2 }], topW: 60 })
    expect(markAllSetsDone(undefined)).toEqual([])
  })
})
