import { describe, expect, it } from 'vitest'
import { isPreparing, startPreparedSession, restPreview } from './workout-preparation.js'
import { isoOf } from './format.js'

const entry = (id, done, sg) => ({ id, sg, sets: done.map(done => ({ done, r: 8, w: 20 })) })
const active = entries => ({ id: 'session', cur: 0, start: 0, preparing: true, d: '2026-10-01', entries })

describe('workout preparation', () => {
  it('survives persistence and starts on the actual day, excluding all preparation time', () => {
    const waiting = JSON.parse(JSON.stringify(active([entry('a', [false])])))
    expect(isPreparing(waiting)).toBe(true)
    expect(waiting.start).toBe(0)
    const now = new Date(2026, 9, 13, 0, 5).getTime()
    const started = startPreparedSession(waiting, now)
    expect(started.start).toBe(now)
    expect(started.d).toBe(isoOf(new Date(now)))
    expect(started.preparing).toBeUndefined()
    expect(started.entries).toBe(waiting.entries)
    expect(startPreparedSession(started, now + 60000)).toBe(started)
  })
  it('does not reset old sessions, history edits or a past workout', () => {
    for (const extra of [{ preparing: false, start: 100 }, { backfill: {} }, { editingWorkoutId: 'saved' }]) {
      const w = { ...active([entry('a', [false])]), ...extra }
      expect(startPreparedSession(w, 1000)).toBe(w)
    }
    const empty = active([])
    expect(startPreparedSession(empty, 1000)).toBe(empty)
  })
})

describe('rest preview follows workout order', () => {
  const session = entries => ({ ...active(entries), preparing: false, start: 100 })
  it('shows the next set of the same exercise, independent of the browsed card', () => {
    const w = { ...session([entry('a', [true, false]), entry('b', [false])]), cur: 1 }
    expect(restPreview(w, { forIdx: 0 })).toMatchObject({ idx: 0, i: 1 })
  })
  it('shows the next movement and wraps to skipped work; returns nothing after the final set', () => {
    const w = session([entry('a', [true]), entry('b', [false])])
    expect(restPreview(w, { forIdx: 0 })).toMatchObject({ idx: 1, i: 0 })
    w.entries[0].sets[0].done = false
    w.entries[1].sets[0].done = true
    expect(restPreview(w, { forIdx: 1 })).toMatchObject({ idx: 0, i: 0 })
    w.entries[0].sets[0].done = true
    expect(restPreview(w, { forIdx: 1 })).toBeNull()
  })
  it('previews the first unfinished superset member after a round, skipping exhausted members', () => {
    const w = session([entry('a', [true, false], 'pair'), entry('b', [true, false], 'pair'), entry('c', [false])])
    expect(restPreview(w, { forIdx: 1 })).toMatchObject({ idx: 0, i: 1 })
    w.entries[0].sets[1].done = true
    expect(restPreview(w, { forIdx: 1 })).toMatchObject({ idx: 1, i: 1 })
    w.entries[1].sets[1].done = true
    expect(restPreview(w, { forIdx: 1 })).toMatchObject({ idx: 2, i: 0 })
  })
  it('does not invent a preview for an unrelated timer, history entry, or preparation', () => {
    const w = session([entry('a', [false])])
    for (const tm of [null, {}, { forIdx: -1 }, { forIdx: 5 }]) expect(restPreview(w, tm)).toBeNull()
    expect(restPreview({ ...w, backfill: {} }, { forIdx: 0 })).toBeNull()
    expect(restPreview({ ...w, preparing: true }, { forIdx: 0 })).toBeNull()
  })
  it('keeps the same exercise during a side switch, including paused and expired rests', () => {
    const w = session([entry('a', [true, false], 'pair'), entry('b', [false], 'pair')])
    expect(restPreview(w, { forIdx: 0, kind: 'switch' })).toMatchObject({ idx: 0, i: 1 })
    for (const extra of [{ paused: true }, { ready: true }]) {
      expect(restPreview(w, { forIdx: 1, ...extra })).toMatchObject({ idx: 0, i: 1 })
    }
  })
})
