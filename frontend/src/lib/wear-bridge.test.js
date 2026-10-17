import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  routineToWatchSnapshot, routineIndexForWatch, watchSessionToActive, watchSessionProblem,
  watchSessionEnd, classifyWatchSession, WEAR_SCHEMA,
} from './wear-bridge.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { isoOf } from './format.js'
import { readSession } from './progression.js'
import { isSideSet, clustersOf, dropsOf, isRestPauseSet, isDropSet } from './workout-model.js'

const T0 = new Date(2026, 8, 17, 18, 0).getTime()
const UUID = '3f2b8c1e-5d7a-4c9e-8a11-0f6d2b9e7c44'
const base = (extra = {}) => ({ unit: 'kg', workouts: [], exWeights: {}, routines: [], restSec: 90, ...extra })

const bench = { id: '0025', sets: 3, reps: 5, weight: 60, prog: 'off', restSec: 120 }
const routine = (ex, extra = {}) => ({ id: 'push', name: 'Push', prog: 'off', ex, ...extra })

// What the watch sends back for a snapshot, with every row ticked as planned unless `edit` says so.
function sessionFrom(snapshot, edit = () => {}, extra = {}) {
  return {
    v: WEAR_SCHEMA, id: UUID, routineId: snapshot.routineId, name: snapshot.name, unit: snapshot.unit,
    start: T0, end: T0 + 50 * 60000,
    exercises: snapshot.exercises.map((ex, xi) => ({
      id: ex.id, ctx: ex.ctx,
      sets: ex.sets.map((s, si) => {
        const { rest, ...logged } = s
        const row = { ...logged, done: true, at: T0 + (xi * 10 + si + 1) * 60000 }
        edit(row, xi, si)
        return row
      }),
    })),
    ...extra,
  }
}

describe('routineToWatchSnapshot', () => {
  it('flattens the routine the way a session start builds it, with the rest each set earns', () => {
    const st = base()
    const snap = routineToWatchSnapshot(routine([bench]), st, { now: 5 })
    expect(snap).toMatchObject({ v: 1, kind: 'snapshot', routineId: 'push', name: 'Push', unit: 'kg', ts: 5, skipped: [] })
    expect(snap.exercises).toHaveLength(1)
    const ex = snap.exercises[0]
    expect(ex).toMatchObject({ id: '0025', mode: 'reps', perSide: false })
    expect(ex.sets).toEqual([
      { w: 60, r: 5, rest: 120 }, { w: 60, r: 5, rest: 120 }, { w: 60, r: 5, rest: 120 },
    ])
  })

  it('tells the watch how far one click of the crown moves the load', () => {
    const snap = routineToWatchSnapshot(routine([{ ...bench, inc: 1.25 }, { id: '0025', mode: 'time', sets: 1, sec: 30, weight: 0 }, { ...bench }]), base())
    expect(snap.exercises.map(e => e.step)).toEqual([1.25, 5, 2.5])
    expect(routineToWatchSnapshot(routine([bench]), base({ unit: 'lb' })).exercises[0].step).toBe(5)
  })

  it('uses the profile default when the exercise has no rest of its own', () => {
    const snap = routineToWatchSnapshot(routine([{ ...bench, restSec: 0 }]), base({ restSec: 75 }))
    expect(snap.exercises[0].sets.every(s => s.rest === 75)).toBe(true)
  })

  it('applies the progression, as the workout screen would when it opens', () => {
    const history = [1, 2, 3].map(n => ({
      id: 'h' + n, d: `2026-09-0${n}`, start: n, routineIds: ['push'],
      entries: [{ id: '0025', target: { sets: 3, reps: 5, weight: 60 }, sets: [5, 5, 5].map(r => ({ w: 60, r, done: true })) }],
    }))
    const r = routine([{ ...bench, prog: 'linear' }], { prog: 'linear' })
    const snap = routineToWatchSnapshot(r, base({ workouts: history }))
    const planned = snap.exercises[0].sets.filter(s => s.phase !== 'warmup')
    expect(planned[0].w).toBeGreaterThan(60)
  })

  it('marks warm-up rows and gives the ramp its own rest', () => {
    const snap = routineToWatchSnapshot(routine([{ ...bench, warmupSets: 2, warmupRestSec: 30 }]), base())
    const sets = snap.exercises[0].sets
    expect(sets.filter(s => s.phase === 'warmup')).toHaveLength(2)
    expect(sets[0]).toMatchObject({ phase: 'warmup', rest: 30 })
    // The break after the last ramp set is the work rest, into the first heavy set.
    expect(sets[1]).toMatchObject({ phase: 'warmup', rest: 120 })
  })

  it('carries drop sets with their drops filled in', () => {
    const cfg = { ...bench, sets: 2, intensifier: { type: 'dropset', count: 2, pct: 20 } }
    const snap = routineToWatchSnapshot(routine([cfg]), base())
    const set = snap.exercises[0].sets[0]
    expect(set.type).toBe('dropset')
    expect(set.drops).toHaveLength(2)
    expect(set.drops[0].w).toBeLessThan(60)
    expect(set.drops[1].w).toBeLessThan(set.drops[0].w)
    expect(set.drops.every(d => d.r === 5)).toBe(true)
  })

  it('carries rest-pause as activation plus bursts that add up to the total', () => {
    const cfg = { ...bench, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }
    const snap = routineToWatchSnapshot(routine([cfg]), base())
    const work = snap.exercises[0].sets.find(s => s.type === 'restpause')
    expect(work.r).toBe(12)
    expect(work.clusters.map(c => c.r)).toEqual([6, 3, 2, 1])
    expect(work.clusters.every(c => c.restSec === 15)).toBe(true)
  })

  it('sends a timed exercise as seconds, and a to-failure set as such', () => {
    const plank = { id: '0025', mode: 'time', sets: 2, sec: 40, weight: 0, prog: 'off' }
    const snap = routineToWatchSnapshot(routine([plank, { ...bench, lastToFailure: true }]), base())
    expect(snap.exercises[0]).toMatchObject({ mode: 'time' })
    expect(snap.exercises[0].sets[0]).toMatchObject({ sec: 40 })
    expect(snap.exercises[0].sets[0].r).toBeUndefined()
    const sets = snap.exercises[1].sets
    expect(sets[2].failure).toBe(true)
    expect(sets[1].failure).toBeUndefined()
  })

  it('leaves cardio out and says so', () => {
    const treadmill = { id: '3666', mode: 'cardio', sets: 1, min: 20, speed: 5 }
    const snap = routineToWatchSnapshot(routine([treadmill, bench]), base(), { nameOf: e => 'name-' + e.id })
    expect(snap.skipped).toEqual([{ id: '3666', name: 'name-3666' }])
    expect(snap.exercises.map(e => e.id)).toEqual(['0025'])
  })

  it('does not carry a per-side intensifier: the watch logs one total', () => {
    const cfg = { ...bench, sets: 1, reps: 10, side: true, intensifier: { type: 'dropset', count: 1, pct: 20 } }
    const ex = routineToWatchSnapshot(routine([cfg]), base()).exercises[0]
    expect(ex.perSide).toBe(true)
    expect(ex.sets[0].type).toBeUndefined()
    expect(ex.sets[0].drops).toBeUndefined()
    expect(ex.sets[0].r).toBe(10)
  })

  it('keeps the session bookkeeping to echo back, and the superset pairing', () => {
    const snap = routineToWatchSnapshot(routine([{ ...bench, sg: 'a' }]), base())
    const { ctx } = snap.exercises[0]
    expect(ctx.target).toMatchObject({ id: '0025', sets: 3, reps: 5, weight: 60 })
    expect(ctx.planned).toBeTruthy()
    expect(ctx.sg).toBe('a')
  })

  it('answers null for no routine', () => {
    expect(routineToWatchSnapshot(null, base())).toBeNull()
    expect(routineToWatchSnapshot({ name: 'x', ex: [] }, base())).toBeNull()
  })

  it('serialises to something a DataItem can hold', () => {
    const many = Array.from({ length: 12 }, () => ({ ...bench, sets: 5, warmupSets: 2 }))
    const json = JSON.stringify(routineToWatchSnapshot(routine(many), base()))
    expect(json.length).toBeLessThan(90 * 1024)
  })
})

describe('routineIndexForWatch', () => {
  it('lists the routines in the app order, with how many exercises each has', () => {
    const st = base({ unit: 'lb', routines: [routine([bench, bench]), { id: 'legs', name: 'Legs', ex: [] }] })
    expect(routineIndexForWatch(st, { now: 9 })).toEqual({
      v: 1, kind: 'index', unit: 'lb', ts: 9,
      routines: [{ id: 'push', name: 'Push', exercises: 2 }, { id: 'legs', name: 'Legs', exercises: 0 }],
    })
  })
})

describe('watchSessionToActive', () => {
  const st = base({ routines: [routine([bench])] })
  const snap = () => routineToWatchSnapshot(st.routines[0], st)

  it('builds the active object beginWorkout would have, keeping the watch id', () => {
    const active = watchSessionToActive(sessionFrom(snap()), st)
    expect(active).toMatchObject({
      id: UUID, d: '2026-09-17', start: T0, routineIds: ['push'], name: 'Push', bw: null, cur: 0, workoutView: 'cards',
    })
    expect(active.entries).toHaveLength(1)
    expect(active.entries[0]).toMatchObject({ id: '0025', rid: 'push', target: { sets: 3, reps: 5, weight: 60 } })
    expect(active.entries[0].sets).toEqual([
      { w: 60, r: 5, done: true, at: T0 + 60000 },
      { w: 60, r: 5, done: true, at: T0 + 2 * 60000 },
      { w: 60, r: 5, done: true, at: T0 + 3 * 60000 },
    ])
  })

  it('keeps what was typed on the watch, not what was planned', () => {
    const active = watchSessionToActive(sessionFrom(snap(), (row, x, s) => { if (s === 2) { row.w = 62.5; row.r = 4 } }), st)
    expect(active.entries[0].sets[2]).toMatchObject({ w: 62.5, r: 4, done: true })
  })

  it('leaves a row the watch never ticked undone, as Finish early would', () => {
    const active = watchSessionToActive(sessionFrom(snap(), (row, x, s) => { if (s === 2) { row.done = false; delete row.at } }), st)
    expect(active.entries[0].sets[2]).toEqual({ w: 60, r: 5, done: false })
  })

  it('finishes through buildCompletedWorkout like any session', () => {
    const payload = sessionFrom(snap())
    const active = watchSessionToActive(payload, st)
    const w = buildCompletedWorkout(active, { end: watchSessionEnd(payload) })
    expect(w).toMatchObject({ id: UUID, d: '2026-09-17', start: T0, end: T0 + 50 * 60000, routineIds: ['push'], routineId: 'push', name: 'Push' })
    expect(w.entries[0]).toMatchObject({ id: '0025', rid: 'push', topW: 60 })
    expect(w.entries[0].sets.every(s => s.done)).toBe(true)
  })

  it('reads back against the target the session was built with, so progression sees a hit', () => {
    const payload = sessionFrom(snap())
    const active = watchSessionToActive(payload, st)
    expect(readSession(active.entries[0], bench).ok).toBe(true)
    // ...and a missed rep reads as a miss, not as a hit by accident.
    const short = watchSessionToActive(sessionFrom(snap(), (row, x, s) => { if (s === 2) row.r = 3 }), st)
    expect(readSession(short.entries[0], bench).ok).toBe(false)
  })

  it('uses the echoed target even after the routine was edited in the meantime', () => {
    const payload = sessionFrom(snap())
    const edited = base({ routines: [routine([{ ...bench, reps: 12, weight: 20 }])] })
    const active = watchSessionToActive(payload, edited)
    expect(active.entries[0].target).toMatchObject({ reps: 5, weight: 60 })
  })

  it('falls back to the routine, then to the bare id, when the target did not come back', () => {
    const payload = sessionFrom(snap())
    payload.exercises[0].ctx = undefined
    expect(watchSessionToActive(payload, st).entries[0].target).toMatchObject({ id: '0025', reps: 5, weight: 60 })
    expect(watchSessionToActive(payload, base()).entries[0].target).toEqual({ id: '0025' })
  })

  it('logs a drop set with its drops on the row', () => {
    const cfg = { ...bench, sets: 1, intensifier: { type: 'dropset', count: 2, pct: 20 } }
    const s2 = base({ routines: [routine([cfg])] })
    const sn = routineToWatchSnapshot(s2.routines[0], s2)
    const active = watchSessionToActive(sessionFrom(sn, row => { row.drops[1].r = 3 }), s2)
    const row = active.entries[0].sets[0]
    expect(isDropSet(row)).toBe(true)
    expect(dropsOf(row)).toHaveLength(2)
    expect(dropsOf(row)[1].r).toBe(3)
    expect(row).toMatchObject({ w: 60, r: 5, done: true })
  })

  it('logs rest-pause with the row’s reps as the sum of what was done', () => {
    const cfg = { ...bench, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }
    const s2 = base({ routines: [routine([cfg])] })
    const sn = routineToWatchSnapshot(s2.routines[0], s2)
    // Failed at the third mini-set: 7 + 3 + 1, the last burst never started.
    const active = watchSessionToActive(sessionFrom(sn, row => {
      if (row.type === 'restpause') row.clusters = [{ r: 7, restSec: 15 }, { r: 3, restSec: 15 }, { r: 1, restSec: 15 }]
    }), s2)
    const row = active.entries[0].sets.find(isRestPauseSet)
    expect(row.r).toBe(11)
    expect(clustersOf(row).map(c => c.r)).toEqual([7, 3, 1])
    expect(clustersOf(row).reduce((n, c) => n + c.r, 0)).toBe(row.r)
  })

  it('sums a rest-pause row even if the watch sent a stale total', () => {
    const cfg = { ...bench, intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }
    const s2 = base({ routines: [routine([cfg])] })
    const sn = routineToWatchSnapshot(s2.routines[0], s2)
    const active = watchSessionToActive(sessionFrom(sn, row => { if (row.type === 'restpause') { row.r = 99; row.clusters = [{ r: 5, restSec: 15 }] } }), s2)
    expect(active.entries[0].sets.find(isRestPauseSet).r).toBe(5)
  })

  it('brings timed rows back as seconds, per-side holds with their side', () => {
    const hold = { id: '0025', mode: 'time', sets: 1, sec: 30, weight: 0, side: true, prog: 'off' }
    const s2 = base({ routines: [routine([hold])] })
    const sn = routineToWatchSnapshot(s2.routines[0], s2)
    expect(sn.exercises[0].sets.map(s => s.side)).toEqual(['L', 'R'])
    const active = watchSessionToActive(sessionFrom(sn, (row, x, s) => { if (s === 1) row.sec = 25 }), s2)
    expect(active.entries[0].sets).toMatchObject([{ sec: 30, side: 'L', done: true }, { sec: 25, side: 'R', done: true }])
    expect(active.entries[0].sets[0].r).toBeUndefined()
  })

  it('splits a per-side total back between the sides, an odd rep going left', () => {
    const cfg = { ...bench, sets: 1, reps: 10, side: true }
    const s2 = base({ routines: [routine([cfg])] })
    const sn = routineToWatchSnapshot(s2.routines[0], s2)
    const active = watchSessionToActive(sessionFrom(sn, row => { row.r = 11 }), s2)
    const row = active.entries[0].sets[0]
    expect(isSideSet(row)).toBe(true)
    expect(row.sides.L).toMatchObject({ r: 6, done: true })
    expect(row.sides.R).toMatchObject({ r: 5, done: true })
    expect(row).toMatchObject({ r: 11, done: true })
  })

  it('keeps warm-ups and to-failure marks, but never a failure mark on a warm-up', () => {
    const s2 = base({ routines: [routine([{ ...bench, warmupSets: 1, lastToFailure: true }])] })
    const sn = routineToWatchSnapshot(s2.routines[0], s2)
    const active = watchSessionToActive(sessionFrom(sn, row => { if (row.phase === 'warmup') row.failure = true }), s2)
    const [warm, , , last] = active.entries[0].sets
    expect(warm.phase).toBe('warmup')
    expect(warm.failure).toBeUndefined()
    expect(last.failure).toBe(true)
  })

  it('converts weights when the watch session was planned in the other unit', () => {
    const payload = sessionFrom(snap())
    const lb = base({ unit: 'lb', routines: [routine([bench])] })
    const active = watchSessionToActive(payload, lb)
    expect(active.entries[0].sets[0].w).toBe(132.5)   // 60 kg
    expect(active.entries[0].target.weight).toBe(132.5)
    expect(watchSessionToActive({ ...payload, unit: 'lb' }, lb).entries[0].sets[0].w).toBe(60)
  })

  it('carries the superset pairing and the exclusion flag from the echo', () => {
    const sn = snap()
    sn.exercises[0].ctx = { ...sn.exercises[0].ctx, sg: 'a', noProg: true }
    const active = watchSessionToActive(sessionFrom(sn), st)
    expect(active.entries[0]).toMatchObject({ sg: 'a', noProg: true })
  })

  it('clamps nonsense instead of storing it', () => {
    const payload = sessionFrom(snap(), row => { row.w = -5; row.r = 1e9; row.at = 'soon' })
    const row = watchSessionToActive(payload, st).entries[0].sets[0]
    expect(row.w).toBe(0)
    expect(row.r).toBe(1000)
    expect(row.at).toBeUndefined()
  })

  it('names a session with no routine Freestyle, and dates it by when it started', () => {
    const payload = sessionFrom(snap(), () => {}, { routineId: null, name: '', start: new Date(2026, 0, 2, 23, 30).getTime() })
    const active = watchSessionToActive(payload, base())
    expect(active).toMatchObject({ name: 'Freestyle', routineIds: [], d: '2026-01-02' })
  })

  it('gives null for what it cannot read', () => {
    expect(watchSessionToActive(null, st)).toBeNull()
    expect(watchSessionToActive({ ...sessionFrom(snap()), v: 2 }, st)).toBeNull()
    expect(watchSessionToActive({ ...sessionFrom(snap()), id: 'x' }, st)).toBeNull()
  })
})

describe('watchSessionProblem', () => {
  const ok = { v: 1, id: UUID, start: T0, exercises: [{ id: '0025', sets: [] }] }
  it('accepts a well-formed session', () => { expect(watchSessionProblem(ok)).toBeNull() })
  it('names what is wrong', () => {
    expect(watchSessionProblem(undefined)).toBe('not an object')
    expect(watchSessionProblem({ ...ok, v: 0 })).toBe('unknown version')
    expect(watchSessionProblem({ ...ok, id: '../../etc' })).toBe('bad id')
    expect(watchSessionProblem({ ...ok, start: 0 })).toBe('no start')
    expect(watchSessionProblem({ ...ok, exercises: 'x' })).toBe('no exercises')
    expect(watchSessionProblem({ ...ok, exercises: [{ id: '', sets: [] }] })).toBe('bad exercise')
    expect(watchSessionProblem({ ...ok, exercises: [{ id: 'a', sets: 3 }] })).toBe('bad exercise')
  })
})

describe('watchSessionEnd', () => {
  it('is the end the watch gave, else the last tick, else unknown', () => {
    expect(watchSessionEnd({ start: 1, end: 500 })).toBe(500)
    expect(watchSessionEnd({ start: 10, end: 5, exercises: [{ sets: [{ at: 20 }, { at: 40 }] }, { sets: [{}] }] })).toBe(40)
    expect(watchSessionEnd({ start: 10, exercises: [] })).toBeNull()
  })
})

describe('classifyWatchSession', () => {
  const st = base({ routines: [routine([bench])] })
  const payload = () => sessionFrom(routineToWatchSnapshot(st.routines[0], st))

  it('finishes a session the phone has not seen', () => {
    const r = classifyWatchSession(payload(), st)
    expect(r.action).toBe('finish')
    expect(r.active.id).toBe(UUID)
  })

  it('acks without adding when the phone already has a workout with that id', () => {
    const had = base({ ...st, workouts: [{ id: UUID, d: '2026-09-17', start: T0, entries: [] }] })
    expect(classifyWatchSession(payload(), had)).toEqual({ action: 'duplicate' })
  })

  it('does not bring back a workout that was deleted after it was saved', () => {
    const gone = base({ ...st, deleted: { workouts: { [UUID]: T0 + 1 } } })
    expect(classifyWatchSession(payload(), gone)).toEqual({ action: 'duplicate' })
  })

  it('never overwrites a workout of the phone’s own: it asks', () => {
    const busy = base({ ...st, active: { id: 'mine', entries: [] } })
    const r = classifyWatchSession(payload(), busy)
    expect(r.action).toBe('conflict')
    expect(r.active.id).toBe(UUID)
  })

  it('still recognises a duplicate while the phone has its own workout going', () => {
    const busy = base({ ...st, active: { id: 'mine', entries: [] }, workouts: [{ id: UUID, entries: [] }] })
    expect(classifyWatchSession(payload(), busy).action).toBe('duplicate')
  })

  it('drops a session in which nothing was ticked rather than saving an empty workout', () => {
    const none = sessionFrom(routineToWatchSnapshot(st.routines[0], st), row => { row.done = false })
    expect(classifyWatchSession(none, st)).toEqual({ action: 'empty' })
  })

  it('calls an unreadable payload invalid so the watch can drop it', () => {
    expect(classifyWatchSession({ v: 1 }, st)).toEqual({ action: 'invalid', reason: 'bad id' })
    expect(classifyWatchSession(null, st)).toEqual({ action: 'invalid', reason: 'not an object' })
    expect(classifyWatchSession({ ...payload(), v: 2 }, st)).toEqual({ action: 'invalid', reason: 'unknown version' })
  })
})

// The same files wear/src/test/.../ContractTest.kt reads: the snapshot the phone produces and the
// session the watch produces from it. Either side changing the format alone fails one of the two.
describe('the format shared with the watch app', () => {
  const dir = new URL('../../android/wear/src/test/resources/', import.meta.url)
  const read = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
  const input = read('snapshot-v1.input.json')
  const state = { ...input.state, routines: [input.routine] }

  it('is still what the phone produces for the fixture routine', () => {
    const snap = routineToWatchSnapshot(input.routine, state, { now: 1750000000000, nameOf: e => 'Exercise ' + e.id })
    expect(JSON.parse(JSON.stringify(snap))).toEqual(read('snapshot-v1.json'))
  })

  it('reads the session the watch produces into the workout that was lifted', () => {
    const payload = read('session-v1.json')
    expect(watchSessionProblem(payload)).toBeNull()
    const verdict = classifyWatchSession(payload, state)
    expect(verdict.action).toBe('finish')

    const active = verdict.active
    expect(active).toMatchObject({ id: 'aaaaaaaa-0000-4000-8000-000000000001', routineIds: ['push'], name: 'Push', d: isoOf(new Date(payload.start)) })
    const [bench, drop, rest, plank] = active.entries
    expect(bench.sets.map(r => [r.w, r.r, r.phase === 'warmup'])).toEqual([[30, 5, true], [60, 5, false], [60, 4, false]])
    expect(drop.sets[0]).toMatchObject({ type: 'dropset', w: 40, r: 8, drops: [{ w: 32.5, r: 8 }, { w: 25, r: 6 }], done: true })
    // 6 + 3 + 2 and then no more: the row's reps are what was done, not the 12 planned.
    expect(rest.sets[1]).toMatchObject({ type: 'restpause', r: 11, done: true })
    expect(rest.sets[1].clusters.map(c => c.r)).toEqual([6, 3, 2])
    expect(plank.sets[0]).toMatchObject({ sec: 35, done: true })
    // ...against the targets the phone built the session with.
    expect(bench.target).toMatchObject({ sets: 2, reps: 5, weight: 60 })
    expect(watchSessionEnd(payload)).toBe(1750000900000)

    const w = buildCompletedWorkout(active, { end: watchSessionEnd(payload) })
    expect(w.entries).toHaveLength(4)
    expect(w.entries[2].sets.every(r => r.done)).toBe(true)
  })
})
