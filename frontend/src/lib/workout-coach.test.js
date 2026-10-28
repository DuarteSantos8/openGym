import { describe, expect, it } from 'vitest'
import { applyWorkoutActions, coachExerciseConfig, markWorkoutActions, needsGroupChoice, workoutCoachSession } from './workout-coach.js'
import * as payload from '../../../api/coach/core/payload.js'

const entry = (key, id, { done = false, sg, rid = 'r1' } = {}) => ({
  key, id, rid, ...(sg ? { sg } : {}), target: { sets: 2, reps: 10, weight: 40 },
  sets: [{ w: 40, r: 10, done }, { w: 40, r: 10, done: false }]
})
const make = (id, after, slot) => ({ id, ...(slot?.rid ? { rid: slot.rid } : {}), target: { sets: after.sets || 2, reps: after.reps || 8 }, sets: Array.from({ length: after.sets || 2 }, () => ({ r: after.reps || 8, done: false })) })
const act = (type, key, id, after = {}) => ({ id: `${type}-${key || after.id}`, type, ...(key ? { target: { entryKey: key, exerciseId: id } } : {}), after, why: 'Because.' })
const ids = active => active.entries.map(e => e.id)

describe('mid-workout Coach changes', () => {
  it('gives every entry a stable key, and the payload builder keeps only the workout fields', () => {
    const active = { id: 'w1', name: 'Upper', d: '2026-10-08', start: Date.now(), cur: 0, entries: [{ ...entry(null, '0001'), note: 'private' }] }
    active.entries[0].sets[0].weightOrigin = 'manual'
    const session = workoutCoachSession(active)
    expect(session.anchorKey).toBe(active.entries[0].key)
    const sent = payload.build({ unit: 'kg' }, { handle: 'h'.repeat(16), kind: 'workout', session }).active
    expect(sent.entries[0].key).toBe(active.entries[0].key)
    expect(sent.entries[0].sets[0]).toEqual({ done: false, w: 40, r: 10 })
    expect(sent.entries[0].note).toBeUndefined()
  })

  it('never relabels completed work during a swap', () => {
    const active = { cur: 0, entries: [entry('press', '0001', { done: true }), entry('row', '0002')] }
    applyWorkoutActions(active, [act('swap-exercise', 'press', '0001', { id: '0003', sets: 1 })], make)
    expect(ids(active)).toEqual(['0001', '0003', '0002'])
    expect(active.entries[0].sets).toEqual([{ w: 40, r: 10, done: true }])
    expect(active.entries[0].noProg).toBe(true)
    expect(active.cur).toBe(1)
  })

  it('a logged superset member keeps its replacement in the group only when asked', () => {
    const session = () => ({ cur: 0, entries: [entry('a', '0001', { done: true, sg: 'g' }), entry('b', '0002', { sg: 'g' }), entry('c', '0004')] })
    const swap = [act('swap-exercise', 'a', '0001', { id: '0003', sets: 1 })]
    expect(needsGroupChoice(swap, session())).toBe(true)
    const kept = session()
    applyWorkoutActions(kept, swap, make, { groupDisposition: 'keep' })
    expect(kept.entries.map(e => [e.id, e.sg || null])).toEqual([['0001', 'g'], ['0003', 'g'], ['0002', 'g'], ['0004', null]])
    const detached = session()
    applyWorkoutActions(detached, swap, make, { groupDisposition: 'detach' })
    expect(detached.entries.map(e => [e.id, e.sg || null])).toEqual([['0001', 'g'], ['0002', 'g'], ['0003', null], ['0004', null]])
  })

  it('moves a superset as one unit, to after the entry it names or to the front', () => {
    const active = { cur: 0, entries: [entry('a', '0001'), entry('b', '0002', { sg: 'g' }), entry('c', '0003', { sg: 'g' }), entry('d', '0004')] }
    applyWorkoutActions(active, [act('move-exercise', 'a', '0001', { afterEntryKey: 'c' })], make)
    expect(ids(active)).toEqual(['0002', '0003', '0001', '0004'])
    expect(active.cur).toBe(0)   // moved later: what slid into its place is next
    applyWorkoutActions(active, [act('move-exercise', 'c', '0003', { afterEntryKey: 'd' })], make)
    expect(ids(active)).toEqual(['0001', '0004', '0002', '0003'])
    applyWorkoutActions(active, [act('move-exercise', 'd', '0004', { afterEntryKey: null })], make)
    expect(ids(active)).toEqual(['0004', '0001', '0002', '0003'])
    expect(active.entries.filter(e => e.sg === 'g').map(e => e.id)).toEqual(['0002', '0003'])
  })

  it('adds after the whole superset it names, or at the end', () => {
    const active = { cur: 0, entries: [entry('a', '0001', { sg: 'g' }), entry('b', '0002', { sg: 'g' }), entry('c', '0003')] }
    applyWorkoutActions(active, [act('add-exercise', null, null, { id: '0009', sets: 2, afterEntryKey: 'a' })], make)
    expect(ids(active)).toEqual(['0001', '0002', '0009', '0003'])
    applyWorkoutActions(active, [act('add-exercise', null, null, { id: '0010', sets: 1, afterEntryKey: null })], make)
    expect(ids(active).at(-1)).toBe('0010')
    expect(active.entries.every(e => e.key)).toBe(true)
  })

  it('throws on one stale selection, so the store keeps none of the batch', () => {
    const active = { cur: 0, entries: [entry('press', '0001'), entry('row', '0002', { done: true })] }
    active.entries[1].sets[1].done = true
    expect(() => applyWorkoutActions(structuredClone(active), [
      act('skip-exercise', 'press', '0001'),
      act('adjust-exercise', 'row', '0002', { reps: 8 })
    ], make)).toThrow()
    expect(() => applyWorkoutActions(structuredClone(active), [act('move-exercise', 'press', '0001', { afterEntryKey: 'gone' })], make)).toThrow()
  })

  it('skipping untouched work removes the exercise; after logged sets it keeps them, out of progression', () => {
    const active = { cur: 1, entries: [entry('press', '0001'), entry('row', '0002', { done: true }), entry('fly', '0003')] }
    applyWorkoutActions(active, [act('skip-exercise', 'press', '0001'), act('skip-exercise', 'row', '0002')], make)
    expect(ids(active)).toEqual(['0002', '0003'])
    expect(active.entries[0].sets).toEqual([{ w: 40, r: 10, done: true }])
    expect(active.entries[0].noProg).toBe(true)
    expect(active.cur).toBe(1)   // the skipped exercise was the current one: the next comes up
  })

  it('a skip and an action placed after the skipped exercise apply in either order', () => {
    for (const order of [[0, 1], [1, 0]]) {
      const active = { cur: 0, entries: [entry('a', '0001'), entry('b', '0002'), entry('c', '0003')] }
      const pair = [act('skip-exercise', 'b', '0002'), act('add-exercise', null, null, { id: '0009', sets: 2, afterEntryKey: 'b' })]
      applyWorkoutActions(active, order.map(i => pair[i]), make)
      expect(ids(active)).toEqual(['0001', '0009', '0003'])
    }
  })

  it('leaves the person on the exercise they were doing when others change', () => {
    const active = { cur: 1, entries: [entry('a', '0001', { done: true }), entry('b', '0002'), entry('c', '0003'), entry('d', '0004')] }
    applyWorkoutActions(active, [act('move-exercise', 'd', '0004', { afterEntryKey: 'a' }), act('add-exercise', null, null, { id: '0009', sets: 1, afterEntryKey: null })], make)
    expect(ids(active)).toEqual(['0001', '0004', '0002', '0003', '0009'])
    expect(active.entries[active.cur].key).toBe('b')
  })

  it('adjusting changes only unfinished work rows and the rest', () => {
    const active = { cur: 0, entries: [entry('press', '0001', { done: true })] }
    active.entries[0].sets.unshift({ w: 20, r: 5, done: false, warmup: true })
    active.entries[0].sets.push({ w: 40, r: 10, done: false })
    applyWorkoutActions(active, [act('adjust-exercise', 'press', '0001', { remainingSets: 1, reps: 8, weight: 30, restSec: 180 })], make)
    expect(active.entries[0].sets).toEqual([{ w: 20, r: 5, done: false, warmup: true }, { w: 40, r: 10, done: true }, { w: 30, r: 8, done: false }])
    expect(active.entries[0].target.restSec).toBe(180)
  })

  it('an adjustment never raises a set, even below the heaviest one', () => {
    const active = { cur: 0, entries: [{ key: 'p', id: '0025', sets: [{ w: 100, r: 5, done: false }, { w: 80, r: 8, done: false }, { w: 60, r: 12, done: false }] }] }
    applyWorkoutActions(active, [act('adjust-exercise', 'p', '0025', { weight: 95, reps: 10, sec: 30 })], make)
    expect(active.entries[0].sets).toEqual([{ w: 95, r: 5, done: false }, { w: 80, r: 8, done: false }, { w: 60, r: 10, done: false }])
  })

  it('marks an action stale when the entry it is placed after is gone', () => {
    const active = { entries: [entry('a', '0001')] }
    expect(markWorkoutActions({ actions: [act('add-exercise', null, null, { id: '0009', afterEntryKey: 'gone' })] }, active)[0].stale).toBe(true)
  })

  it('marks a recommendation stale when its unfinished target is gone', () => {
    const active = { entries: [entry('press', '0001')] }
    const proposal = { actions: [act('skip-exercise', 'press', '0001')] }
    active.entries[0].sets.forEach(set => { set.done = true })
    expect(markWorkoutActions(proposal, active)[0].stale).toBe(true)
  })

  it('a confirmed note goes under what the athlete wrote, and the athlete\'s words are kept whole', () => {
    const active = { cur: 0, note: 'Slept badly.', entries: [entry('press', '0001')] }
    applyWorkoutActions(active, [act('note', null, null, { text: 'Lunges felt too easy at 20 reps.' })], make)
    expect(active.note).toBe('Slept badly.\nLunges felt too easy at 20 reps.')
    const full = { cur: 0, note: 'x'.repeat(495), entries: [entry('press', '0001')] }
    applyWorkoutActions(full, [act('note', null, null, { text: 'Lunges felt too easy.' })], make)
    expect(full.note.startsWith('x'.repeat(495) + '\nLung')).toBe(true)
    expect(full.note.length).toBe(500)
  })

  it('builds a hold from seconds and cardio from minutes', () => {
    expect(coachExerciseConfig('0001', { sets: 2, sec: 40 })).toMatchObject({ mode: 'time', sets: 2, sec: 40 })
    expect(coachExerciseConfig('0001', { sets: 3, reps: 12 })).toMatchObject({ mode: 'reps', sets: 3, reps: 12 })
  })
})
