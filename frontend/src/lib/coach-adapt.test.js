// "Ask the Coach" mid-workout: the changes the Coach proposes for the unfinished part of the
// session, applied to S.active (lib/coach-adapt.js), and what a review may now do to a plan
// (warm-ups, programmes) applied and undone with the ordinary engine (lib/coach.js).
import { describe, it, expect } from 'vitest'
import { applyAdapt, markAdaptStale, resolveEntry, adaptFor, adaptLogEntry } from './coach-adapt.js'
import { applyChangeSet, markStale, revertLast, changeMeaning, changeValues, changeTitle } from './coach.js'
import { isWarmupRow } from './workout-model.js'
import { programmeById, programmesOf } from './programmes.js'

const BENCH = '0025', CURL = '0294', SQUAT = '0043', DBPRESS = '0289', ROW = '0027'
const row = (w, r, done = false, extra = {}) => ({ w, r, done, ...extra })
const warm = (w, r, done = false) => ({ w, r, done, phase: 'warmup', warmup: true })
const session = () => ({
  unit: 'kg', exWeights: {}, workouts: [], week: {}, dayPlan: {},
  routines: [{ id: 'push', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 80 }, { id: CURL, sets: 3, reps: 10, weight: 14 }, { id: SQUAT, sets: 3, reps: 5, weight: 100 }] }],
  active: {
    id: 'act-1', d: '2026-10-29', cur: 0, entries: [
      { id: BENCH, rid: 'push', target: { sets: 3, reps: 5, weight: 80 }, sets: [warm(40, 5, true), row(80, 5, true), row(80, 5), row(80, 5)] },
      { id: CURL, rid: 'push', target: { sets: 3, reps: 10, weight: 14 }, sets: [row(14, 10), row(14, 10), row(14, 10)] },
      { id: SQUAT, rid: 'push', target: { sets: 3, reps: 5, weight: 100 }, sets: [row(100, 5), row(100, 5), row(100, 5)] },
    ],
  },
  coach: { consent: { agreedAt: 1, version: 2 }, log: [], snapshots: [] },
})
const proposal = changes => ({ id: 'p1', kind: 'adapt', activeId: 'act-1', summary: 'For today.', changes: changes.map((c, i) => ({ id: 'a' + i, why: 'because', ...c })) })
const ids = p => p.changes.map(c => c.id)

describe('applying the Coach’s changes to the workout in progress', () => {
  it('belongs to the session it was asked in, and only that one', () => {
    const S = session()
    expect(adaptFor(S, proposal([]))).toBe(true)
    expect(adaptFor({ ...S, active: { ...S.active, id: 'other' } }, proposal([]))).toBe(false)
    expect(adaptFor({ ...S, active: null }, proposal([]))).toBe(false)
    const p = proposal([{ type: 'sets', entry: 1, exId: CURL, sets: 2 }])
    expect(applyAdapt({ ...S, active: { ...S.active, id: 'other' } }, p, ids(p)).applied).toEqual([])
  })

  it('a weight cut lands on the open sets only, rounded down to the step, warm-ups re-aimed', () => {
    const S = session()
    S.active.entries[0].sets.splice(1, 0, warm(60, 3))   // an open warm-up after a logged one
    const p = proposal([{ type: 'weight', entry: 0, exId: BENCH, pct: -20 }])
    expect(applyAdapt(S, p, ids(p)).applied).toEqual(['a0'])
    const sets = S.active.entries[0].sets
    expect(sets.filter(r => !isWarmupRow(r)).map(r => r.w)).toEqual([80, 62.5, 62.5])   // 64 → 62.5; the logged 80 stays
    expect(sets[0].w).toBe(40)
    expect(sets[1].w).toBeLessThan(62.5)
  })

  it('sets: fewer drops the trailing open sets, more copies the last one fresh', () => {
    const S = session()
    const p = proposal([{ type: 'sets', entry: 0, exId: BENCH, sets: 1 }, { type: 'sets', entry: 1, exId: CURL, sets: 4 }])
    applyAdapt(S, p, ids(p))
    expect(S.active.entries[0].sets.filter(r => !isWarmupRow(r)).map(r => r.done)).toEqual([true, false])
    expect(S.active.entries[1].sets).toHaveLength(4)
    expect(S.active.entries[1].sets[3]).toEqual({ w: 14, r: 10, done: false })
  })

  it('reps and rest are today’s numbers only; the routine keeps its own', () => {
    const S = session()
    const p = proposal([{ type: 'reps', entry: 1, exId: CURL, reps: 8 }, { type: 'rest', entry: 2, exId: SQUAT, rest: 180 }])
    applyAdapt(S, p, ids(p))
    expect(S.active.entries[1].sets.map(r => r.r)).toEqual([8, 8, 8])
    expect(S.active.entries[2].target.restSec).toBe(180)
    expect(S.routines[0].ex.map(e => e.reps)).toEqual([5, 10, 5])
    expect(S.routines[0].ex[2].restSec).toBeUndefined()
  })

  it('a swap of an exercise under way keeps its logged sets and moves the open ones over', () => {
    const S = session()
    const p = proposal([{ type: 'swap', entry: 0, exId: BENCH, to: DBPRESS }])
    applyAdapt(S, p, ids(p))
    const [bench, next] = S.active.entries
    expect(bench.id).toBe(BENCH)
    expect(bench.sets.every(r => r.done)).toBe(true)
    expect(next.id).toBe(DBPRESS)
    expect(next.sets.filter(r => !isWarmupRow(r))).toHaveLength(2)
    expect(next.rid).toBe('push')
  })

  it('a swap of an exercise not started replaces it in place', () => {
    const S = session()
    const p = proposal([{ type: 'swap', entry: 2, exId: SQUAT, to: ROW, reps: 8 }])
    applyAdapt(S, p, ids(p))
    expect(S.active.entries.map(e => e.id)).toEqual([BENCH, CURL, ROW])
    expect(S.active.entries[2].sets.filter(r => !isWarmupRow(r)).map(r => r.r)).toEqual([8, 8, 8])
    expect(S.active.cur).toBe(0)
  })

  it('skip, move and add, found by exercise, never by a shifted index', () => {
    const S = session()
    const p = proposal([
      { type: 'skip', entry: 1, exId: CURL },
      { type: 'move', entry: 2, exId: SQUAT, place: 'next' },
      { type: 'add', to: ROW, sets: 2, reps: 12 },
    ])
    applyAdapt(S, p, ids(p))
    expect(S.active.entries.map(e => e.id)).toEqual([BENCH, ROW, SQUAT])
    expect(S.active.entries[1].sets.filter(r => !isWarmupRow(r)).map(r => r.r)).toEqual([12, 12])
    expect(S.active.entries[1].addedInSession).toBe(true)
    expect(S.active.cur).toBe(0)
  })

  it('goes stale instead of landing on the wrong exercise when the session moved on', () => {
    const S = session()
    const p = proposal([{ type: 'reps', entry: 1, exId: CURL, reps: 6 }, { type: 'skip', entry: 2, exId: SQUAT }])
    S.active.entries.splice(0, 1)                                    // bench removed on the watch
    expect(resolveEntry(S.active, p.changes[0])).toBe(0)             // found again by id
    S.active.entries[1].sets.forEach(r => { r.done = true })          // squats finished meanwhile
    expect(markAdaptStale(S, p).map(c => c.stale)).toEqual([false, true])
    expect(applyAdapt(S, p, ids(p)).applied).toEqual(['a0'])
    expect(S.active.entries[1].sets.every(r => r.done && r.r === 5)).toBe(true)
  })

  it('only what was ticked', () => {
    const S = session()
    const p = proposal([{ type: 'reps', entry: 1, exId: CURL, reps: 6 }, { type: 'skip', entry: 2, exId: SQUAT }])
    applyAdapt(S, p, ['a1'])
    expect(S.active.entries[1].sets.map(r => r.r)).toEqual([10, 10, 10])
    expect(S.active.entries.map(e => e.id)).toEqual([BENCH, CURL])
  })

  it('leaves a history line with each change as it was shown', () => {
    const p = proposal([{ type: 'sets', entry: 1, exId: CURL, sets: 2, before: 3 }, { type: 'skip', entry: 2, exId: SQUAT }])
    const log = adaptLogEntry({ ...p, focus: { exId: CURL, reason: 'short', entry: 1 } }, ['a0'])
    expect(log.kind).toBe('adapt')
    expect(log.focus).toEqual({ exId: CURL, reason: 'short' })
    expect(log.decisions.map(d => [d.type, d.status, d.sets ?? null])).toEqual([['sets', 'accepted', 2], ['skip', 'rejected', null]])
  })
})

describe('a review that sets warm-ups or writes a programme', () => {
  const S0 = () => ({ ...session(), active: null, week: { 1: ['push'] } })
  const review = changes => ({ id: 'r1', kind: 'review', summary: 's', changes: changes.map((c, i) => ({ id: 'c' + i, why: 'w', ...c })) })

  it('warm-ups: auto, own rows or none, the older count gone, undone by a revert', () => {
    const S = S0()
    S.routines[0].ex[1].warmupSets = 2
    const p = markStale(review([
      { type: 'warmup', target: { routineId: 'push', exId: CURL }, before: null, after: { mode: 'own', rows: [{ wp: 50, r: 10 }] } },
      { type: 'warmup', target: { routineId: 'push', exId: SQUAT }, before: null, after: { mode: 'auto' } },
    ]), S)
    applyChangeSet(S, p, ['c0', 'c1'])
    expect(S.routines[0].ex[1]).toMatchObject({ warmup: 'own', warmupRows: [{ wp: 50, r: 10 }] })
    expect(S.routines[0].ex[1].warmupSets).toBeUndefined()
    expect(S.routines[0].ex[2].warmup).toBe('auto')
    expect(changeValues(p.changes[0], S)).toEqual({ before: 'Default', after: '50% × 10' })
    expect(changeMeaning(p.changes[1])).toMatch(/ramps up/)
    revertLast(S)
    expect(S.routines[0].ex[1].warmupSets).toBe(2)
    expect(S.routines[0].ex[2].warmup).toBeUndefined()
  })

  it('a warm-up change goes stale once the slot was changed by hand', () => {
    const S = S0()
    S.routines[0].ex[0].warmup = 'none'
    const p = markStale(review([{ type: 'warmup', target: { routineId: 'push', exId: BENCH }, before: 'auto', after: { mode: 'own', rows: [{ wb: true, r: 10 }] } }]), S)
    expect(p.changes[0].status).toBe('stale')
  })

  it('a new programme over the schedule you have, not started; a revert takes it away', () => {
    const S = S0()
    const p = markStale(review([{ type: 'programme', target: {}, before: null, after: { name: 'Bench 3 weeks', weeks: [{ t: { [BENCH]: { pct: 75 } } }, { t: { [BENCH]: { pct: 80 } } }, { deload: true }] } }]), S)
    expect(p.changes[0].status).not.toBe('stale')
    expect(changeTitle(p.changes[0], S)).toBe('New programme “Bench 3 weeks”')
    applyChangeSet(S, p, ['c0'])
    const [prog] = programmesOf(S)
    expect(prog.name).toBe('Bench 3 weeks')
    expect(prog.weeks).toHaveLength(3)
    expect(prog.days).toEqual({ 1: ['push'] })
    expect(S.programme).toBeUndefined()
    expect(changeMeaning(p.changes[0])).toMatch(/Week 1: 75%.*Week 3: deload/)
    revertLast(S)
    expect(programmesOf(S)).toEqual([])
  })

  it('a revised programme keeps its id and schedule; the revert brings its weeks back', () => {
    const S = S0()
    S.programmes = { p1: { id: 'p1', name: 'Old', at: 1, weeks: [{ t: { [BENCH]: { pct: 70 } } }], days: { 1: ['push'] } } }
    const p = markStale(review([{ type: 'programme', target: { programmeId: 'p1' }, before: { name: 'Old', weeks: 1 }, after: { name: 'Old', weeks: [{ t: { [BENCH]: { pct: 72.5 } } }, { deload: true }] } }]), S)
    applyChangeSet(S, p, ['c0'])
    expect(programmeById(S, 'p1').weeks).toEqual([{ t: { [BENCH]: { pct: 72.5 } } }, { deload: true }])
    revertLast(S)
    expect(programmeById(S, 'p1').weeks).toEqual([{ t: { [BENCH]: { pct: 70 } } }])
    // Gone meanwhile: the revision is stale rather than writing a new programme under an old id.
    delete S.programmes.p1
    expect(markStale(p, S).changes[0].status).toBe('stale')
  })

  it('a progression change says what it means at the gym', () => {
    expect(changeMeaning({ type: 'exercise-prog', after: 'double' })).toMatch(/^Double progression: Work up through a rep range/)
    expect(changeMeaning({ type: 'sets', after: 4 })).toBeNull()
  })
})
