// The Zepp OS watch's session logic (lib/session.js): the Wear OS SessionCoreTest and CodecTest
// cases on this port, and the same contract files the Wear OS watch reads
// (frontend/android/wear/src/test/resources): the phone's snapshot parses here, and the events
// built here are exactly the ones the phone's page applies (frontend/src/lib/watch-sync.wear.test.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as C from '../lib/session.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'android', 'wear', 'src', 'test', 'resources')
const resource = name => readFileSync(join(fixtures, name), 'utf8')

const set = (w, r, { done = false, at, warmup = false } = {}) => ({ w, r, sec: null, done, warmup, ...(at != null ? { at } : {}) })
const workout = (id, ...entries) => ({ id, name: 'Legs', unit: 'kg', entries })
const snapOf = o => C.parseSnapshot(o)
const squat = () => ({ id: 'sq', name: 'Squat', sets: [set(100, 5), set(100, 5)], best: { w: 100, r: 5 } })
const lunge = () => ({ id: 'lu', name: 'Lunge', sets: [{ w: 20, r: 8, done: false, sides: { L: {}, R: {} } }], perSide: true })
const started = (...e) => C.applySnapshot(C.emptyState(), snapOf({ active: workout('w1', ...e) }))

test('reads the phone\'s snapshot', () => {
  const snap = C.parseSnapshot(resource('snapshot.json'))
  assert.ok(snap)
  assert.equal(snap.unit, 'kg')
  const a = snap.active
  assert.equal(a.id, 'w-1')
  assert.equal(a.name, 'Push day')
  assert.equal(a.rest.endsAt, 1761743000000)
  assert.equal(a.start, 1761742800000)
  assert.equal(a.activeAt, 1761742950000)
  assert.equal(a.entries.length, 2)
  const bench = a.entries[0]
  assert.equal(bench.id, '0025')
  assert.equal(bench.name, 'Barbell Bench Press')
  assert.equal(bench.restSec, 120)
  assert.match(bench.last, /55/)
  assert.deepEqual(bench.sets.map(s => s.done), [true, false])
  assert.equal(bench.sets[1].w, 60)
  assert.equal(bench.sets[0].sec, null)
  assert.equal(snap.ready, null)
  assert.equal(a.entries[1].sets[0].warmup, true)
  assert.equal(snap.settings.lang, 'de')
  assert.equal(snap.streak.weeks, 1)
})

test('ignores what it does not know', () => {
  const snap = C.parseSnapshot('{"v":9,"unit":"lb","active":null,"future":{"x":1}}')
  assert.equal(snap.unit, 'lb')
  assert.equal(snap.active, null)
  assert.equal(C.parseSnapshot('not json'), null)
  assert.equal(C.parseSnapshot('[]'), null)
  // an entry without an id is left out, not the whole workout with it
  assert.equal(C.parseSnapshot({ active: { id: 'w', entries: [{ name: 'x' }, { id: 7 }] } }).active.entries[0].id, '7')
})

test('sends the events the page applies', () => {
  const snap = C.parseSnapshot(resource('snapshot.json'))
  let s = C.applySnapshot(C.emptyState(), snap)
  const out = []
  let ev
  ;[s, ev] = C.tick(s, { ei: 0, si: 1, w: 62.5, r: 7, at: 1761743100000, id: 'ev-1', hr: { avg: 128, max: 141 } }); out.push(ev)
  ;[s, ev] = C.tick(s, { ei: 1, si: 1, w: 30, r: 10, at: 1761743200000, id: 'ev-2' }); out.push(ev)
  ;[s, ev] = C.finish(s, { at: 1761743300000, id: 'ev-3' }); out.push(ev)
  const push = { routineIds: ['r-push'], name: 'Push day', entries: snap.active.entries }
  ;[s, ev] = C.start(s, push, { wid: 'watch-test', at: 1761743400000, id: 'ev-4' }); out.push(ev)
  assert.deepEqual(out, JSON.parse(resource('events.json')))
})

test('a tick stays until the phone shows it', () => {
  let s = started(squat())
  ;[s] = C.tick(s, { ei: 0, si: 0, w: 105, r: 5, at: 1000, id: 'e1' })
  s = C.applySnapshot(s, snapOf({ active: workout('w1', squat()) }))
  assert.equal(s.workout.entries[0].sets[0].done, true)
  assert.equal(s.workout.entries[0].sets[0].w, 105)
  const phone = { ...squat(), sets: [set(105, 5, { done: true, at: 1000 }), set(100, 5)] }
  s = C.applySnapshot(s, snapOf({ active: workout('w1', phone) }))
  assert.deepEqual(s.pending, {})
})

test('finished here stays finished', () => {
  let s = started(squat())
  ;[s] = C.finish(s, { at: 2000, id: 'f' })
  assert.equal(s.workout, null)
  s = C.applySnapshot(s, snapOf({ active: workout('w1', squat()) }))
  assert.equal(s.workout, null)
})

test('started here stays until the phone has it', () => {
  const s0 = C.applySnapshot(C.emptyState(), snapOf({ ready: { today: { routineIds: ['r'], name: 'Legs', entries: [squat()] } } }))
  const [s1, ev] = C.start(s0, s0.ready.today, { wid: 'watch-1', at: 10, id: 'st' })
  assert.equal(ev.type, 'start')
  let s = C.applySnapshot(s1, snapOf({ active: null }))
  assert.equal(s.workout.id, 'watch-1')
  s = C.applySnapshot(s, snapOf({ active: workout('watch-1', squat()) }))
  assert.equal(s.startedHere, null)
  const s2 = C.applySnapshot(s1, snapOf({ active: null, discarded: ['watch-1'] }))
  assert.equal(s2.workout, null)
})

test('ended on the phone', () => {
  assert.equal(C.applySnapshot(started(squat()), snapOf({ active: null })).workout, null)
})

test('per-side sets tick one side at a time', () => {
  let s = started(lunge())
  const [s1, ev] = C.tick(s, { ei: 0, si: 0, side: 'L', w: 20, r: 8, at: 5, id: 'l' })
  assert.equal(ev.side, 'L')
  assert.equal(s1.workout.entries[0].sets[0].done, false)
  assert.equal(C.sideUp(s1.workout.entries[0].sets[0]), 'R')
  assert.deepEqual(C.next(s1, 0, 0), [0, false])
  ;[s] = C.tick(s1, { ei: 0, si: 0, side: 'R', w: 20, r: 7, at: 6, id: 'r' })
  const row = s.workout.entries[0].sets[0]
  assert.equal(row.done, true)
  assert.equal(row.r, 15)
})

test('next goes through sets, then exercises, then the finish', () => {
  let s = started(squat(), { ...lunge(), perSide: undefined, sets: [set(20, 8)] })
  assert.deepEqual(C.next(s, 0, 0), [0, true])
  ;[s] = C.tick(s, { ei: 0, si: 0, w: 100, r: 5, at: 1, id: 'a' })
  ;[s] = C.tick(s, { ei: 0, si: 1, w: 100, r: 5, at: 2, id: 'b' })
  assert.deepEqual(C.next(s, 0, 1), [1, true])
  ;[s] = C.tick(s, { ei: 1, si: 0, w: 20, r: 8, at: 3, id: 'c' })
  assert.deepEqual(C.next(s, 1, 0), [2, true])
})

test('supersets take turns', () => {
  const a = { ...squat(), group: 'g' }
  const b = { id: 'pu', name: 'Pull-up', sets: [set(0, 8), set(0, 8)], group: 'g' }
  let s = started(a, b)
  ;[s] = C.tick(s, { ei: 0, si: 0, w: 100, r: 5, at: 1, id: 'a' })
  assert.deepEqual(C.next(s, 0, 0), [1, false])
  ;[s] = C.tick(s, { ei: 1, si: 0, w: 0, r: 8, at: 2, id: 'b' })
  assert.deepEqual(C.next(s, 1, 0), [0, true])
})

test('skipped sets are jumped', () => {
  const s = C.skip(started(squat()), 0, 0)
  assert.equal(C.setIndex(s, 0), 1)
})

test('the summary counts work sets, volume and records', () => {
  let s = started({ ...squat(), sets: [set(60, 10, { warmup: true }), set(100, 5), set(100, 5)] })
  ;[s] = C.tick(s, { ei: 0, si: 1, w: 102.5, r: 5, at: 1, id: 'a' })
  const sum = C.summary({ ...s.workout, start: 0 }, 60000)
  assert.equal(sum.sets, 1)
  assert.equal(sum.volume, 512.5)
  assert.deepEqual(sum.prs, ['Squat'])
  // duration: no start means none (start 0 is "unknown" on the wire)
  assert.equal(C.summary({ ...s.workout, start: 1 }, 60001).duration, 60)
  assert.deepEqual(C.progress(s), [1, 2])
})

test('weight steps stay on the grid', () => {
  assert.equal(C.stepWeight(60, 2.5, 1), 62.5)
  assert.equal(C.stepWeight(61, 2.5, 1), 62.5)
  assert.equal(C.stepWeight(61, 2.5, -1), 60)
  assert.equal(C.stepWeight(1, 2.5, -3), 0)
  assert.equal(C.stepReps(0, -1), 0)
  assert.equal(C.stepReps(998, 5), 999)
})

test('mixed units count in the workout\'s unit', () => {
  const lb = { id: 'x', name: 'Curl', sets: [set(100, 1, { done: true })], unit: 'lb' }
  const sum = C.summary(C.parseSnapshot({ active: { id: 'w', entries: [lb] } }).active, 0)
  assert.ok(Math.abs(sum.volume - 45.359237) < 1e-6)
})

test('the saved state round-trips through JSON', () => {
  const [s] = C.tick(started(squat()), { ei: 0, si: 0, w: 100, r: 5, at: 1, id: 'a' })
  assert.deepEqual(C.stateOf(JSON.parse(JSON.stringify(s))), s)
  assert.deepEqual(C.stateOf(null), C.emptyState())
  assert.deepEqual(C.stateOf({ pending: 'x' }).pending, {})
})

test('heart rate of a set: average and peak of what holds up', () => {
  assert.deepEqual(C.hrOf([120, 130, 0, 250, 140]), { avg: 130, max: 140 })
  assert.equal(C.hrOf([]), null)
  assert.equal(C.hrOf([0, 0]), null)
  // no reading: the event carries none
  const [, ev] = C.tick(started(squat()), { ei: 0, si: 0, w: 100, r: 5, at: 1, id: 'a', hr: null })
  assert.equal('hr' in ev, false)
})

test('the outbox keeps events until the server took them, in order', () => {
  let box = []
  box = C.enqueue(box, { id: 'a' })
  box = C.enqueue(box, null)
  box = C.enqueue(box, { id: 'b' })
  assert.deepEqual(C.settle(box, ['a']).map(e => e.id), ['b'])
  for (let i = 0; i < C.OUTBOX_MAX + 5; i++) box = C.enqueue(box, { id: 'x' + i })
  assert.equal(box.length, C.OUTBOX_MAX)
  assert.equal(box.at(-1).id, 'x' + (C.OUTBOX_MAX + 4))
  assert.match(C.makeId('ev', 1761743100000, () => 0.5), /^ev-[0-9a-z]+-[0-9a-z]+$/)
})
