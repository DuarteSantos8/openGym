// @vitest-environment happy-dom
// The workout's note from the watch's Overview ("Add note"): applied once, to the running workout
// only, and only when the phone's note is still the one the watch last saw (the phone wins).
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSnapshot, applyEvents, bindWatchAppActions, setWatchNote, watchExtras, WATCH_NOTE_MAX, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const mk = note => ({ active: { id: 'w-1', name: 'Push', cur: 0, start: 1, ...(note ? { note } : {}), entries: [{ id: '0025', target: { sets: 1, reps: 8 }, sets: [{ w: 80, r: 8, done: false }] }] } })
const ev = (o = {}) => ({ id: 'n1', type: 'workoutNote', wid: 'w-1', note: 'Left shoulder tight', was: '', at: 1000, ...o })

describe('setWatchNote', () => {
  it('sets the note, cleaned like the phone\'s own', () => {
    const s = mk()
    expect(setWatchNote(s, ev({ note: '  tight\u0007shoulder  ' }))).toBe(true)
    expect(s.active.note).toBe('tight shoulder')
  })
  it('an emptied note clears it', () => {
    const s = mk('old')
    expect(setWatchNote(s, ev({ note: '  ', was: 'old' }))).toBe(true)
    expect('note' in s.active).toBe(false)
  })
  it('the phone wins: a note changed on the phone since the watch saw it is kept', () => {
    const s = mk('typed on the phone')
    expect(setWatchNote(s, ev({ was: 'what the watch saw' }))).toBe(false)
    expect(s.active.note).toBe('typed on the phone')
  })
  it('a note longer than the snapshot carries is never overwritten from the wrist', () => {
    const long = 'x'.repeat(WATCH_NOTE_MAX + 50)
    const s = mk(long)
    expect(setWatchNote(s, ev({ was: long.slice(0, WATCH_NOTE_MAX) }))).toBe(false)
    expect(s.active.note).toBe(long)
  })
  it('another workout, a workout being edited, a missing workout: nothing', () => {
    expect(setWatchNote(mk(), ev({ wid: 'other' }))).toBe(false)
    const e = mk(); e.active.editingWorkoutId = 'x'
    expect(setWatchNote(e, ev())).toBe(false)
    expect(setWatchNote({ active: null }, ev())).toBe(false)
  })
  it('the watch\'s own text is cut at its limit and a non-text note is no note', () => {
    const s = mk()
    expect(setWatchNote(s, ev({ note: 'y'.repeat(WATCH_NOTE_MAX + 40) }))).toBe(true)
    expect(s.active.note.length).toBe(WATCH_NOTE_MAX)
    expect(setWatchNote(mk(), ev({ note: 5 }))).toBe(false)
  })
})

describe('the event through the queue', () => {
  const run = (s, events) => {
    const calls = []
    bindWatchAppActions({ start: () => {}, patchSet: () => {}, edit: fn => { calls.push(fn(s.active ? s : s)); return true } })
    const done = applyEvents(events, () => ({ S: s, A: s.active }), 2000)
    return { done, calls }
  }
  it('applies once, in the running workout, and is acknowledged', () => {
    const s = mk()
    const r = run(s, [ev(), ev()])
    expect(s.active.note).toBe('Left shoulder tight')
    expect(r.done).toContain('n1')
    expect(r.calls).toEqual([true])
  })
  it('a conflict is still acknowledged (nothing to retry) and keeps the phone\'s text', () => {
    const s = mk('phone')
    const r = run(s, [ev({ was: 'stale' })])
    expect(s.active.note).toBe('phone')
    expect(r.done).toContain('n1')
  })
})

describe('what the watch is told', () => {
  it('the snapshot carries the running workout\'s note (cut) and the flag that shows the button', () => {
    expect(buildSnapshot(mk('left shoulder')).active.note).toBe('left shoulder')
    expect(buildSnapshot(mk('z'.repeat(WATCH_NOTE_MAX + 9))).active.note.length).toBe(WATCH_NOTE_MAX)
    expect('note' in buildSnapshot(mk()).active).toBe(false)
    expect(watchExtras({}, {}).workoutNote).toBe(true)
  })
})
