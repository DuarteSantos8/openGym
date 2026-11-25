// The record rules (Wear OS SessionCore.record / beatsBest, the Apple Watch's twin), ported case for case from
// MedalTest.kt eachRecordCarriesTheBestItBeat and the cases around it, then the collector in the core's state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordOf, foldRecords, recordList } from '../entry/src/main/js/MainAbility/common/records.js'

const row = (w, r, sec, extra) => Object.assign({ w: w, r: r, sec: sec, done: true }, extra || {})
const ent = (id, name, best, sets, extra) => Object.assign({ id: id, name: name, i: 0, best: best, sets: sets }, extra || {})

const six = () => [
  ent('b', 'Bench', { w: 100, r: 5 }, [row(102.5, 3), row(105, 2), row(100, 6)]),
  ent('r', 'Row', { w: 70, r: 8 }, [row(70, 9), row(70, 10), row(60, 15)]),
  ent('d', 'Assisted dip', { w: 25, r: 8 }, [row(20, 8), row(15, 6)], { assisted: true }),
  ent('p', 'Plank', { sec: 60 }, [row(null, null, 75), row(null, null, 70)], { mode: 'time' }),
  ent('c', 'Curl', { w: 30, r: 10 }, [row(35, 8)], { unit: 'lb' }),
  ent('n', 'Squat', { w: 140, r: 5 }, [row(140, 5)])
]

test('each record carries the best it beat: the heaviest past it, the most reps at it, the lightest when assisted, a hold, the exercise\'s own unit', () => {
  const es = six()
  assert.deepEqual(es.map(e => recordOf(e, 'kg')), [
    ['Bench', 'w', 100, 105, 'kg'],
    ['Row', 'r', 8, 10, 'kg'],
    ['Assisted dip', 'w', 25, 15, 'kg'],
    ['Plank', 'h', 60, 75, 'kg'],
    ['Curl', 'w', 30, 35, 'lb'],
    null
  ])
})

test('no best, no record: a record is never claimed without a best to beat', () => {
  assert.equal(recordOf(ent('a', 'A', undefined, [row(100, 5)]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', null, [row(100, 5)]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', {}, [row(100, 5)]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { w: 0, r: 0 }, [row(100, 5)]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { w: 50 }, [row(100, 5)]), 'kg'), null) // half a best
  assert.equal(recordOf(ent('a', 'A', { sec: 0 }, [row(null, null, 30)], { mode: 'time' }), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { sec: 30 }, [row(null, null, 30)], { mode: 'time' }), 'kg'), null) // equal is not more
})

test('cardio, warm-ups and sets not done do not count', () => {
  assert.equal(recordOf(ent('c', 'Run', { w: 10, r: 5 }, [row(20, 9)], { mode: 'cardio' }), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { w: 100, r: 5 }, [row(110, 5, null, { warmup: true })]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { w: 100, r: 5 }, [row(110, 5, null, { done: false })]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { w: 100, r: 5 }, []), 'kg'), null)
  assert.deepEqual(recordOf(ent('a', 'A', { w: 100, r: 5 }, [row(110, 5, null, { warmup: true }), row(101, 1)]), 'kg'), ['A', 'w', 100, 101, 'kg'])
})

test('a bodyweight exercise: reps past the best at weight 0; a missing weight counts as 0', () => {
  assert.deepEqual(recordOf(ent('p', 'Pull-up', { w: 0, r: 8 }, [{ r: 10, done: true }]), 'kg'), ['Pull-up', 'r', 8, 10, 'kg'])
  assert.deepEqual(recordOf(ent('p', 'Pull-up', { w: 0, r: 8 }, [{ w: 10, r: 3, done: true }]), 'kg'), ['Pull-up', 'w', 0, 10, 'kg'])
  assert.equal(recordOf(ent('p', 'Pull-up', { w: 0, r: 8 }, [{ r: 8, done: true }]), 'kg'), null)
})

test('a lighter weight is no record, and more reps at another weight is none either', () => {
  assert.equal(recordOf(ent('a', 'A', { w: 100, r: 5 }, [row(90, 20)]), 'kg'), null)
  assert.equal(recordOf(ent('a', 'A', { w: 100, r: 5 }, [row(100, 5)]), 'kg'), null)
  // the weight record wins over a reps record on the same exercise
  assert.deepEqual(recordOf(ent('a', 'A', { w: 100, r: 5 }, [row(100, 9), row(105, 1)]), 'kg'), ['A', 'w', 100, 105, 'kg'])
})

test('a per-side row counts by its aggregate: the heavier side\'s weight, the reps of both', () => {
  const sided = ent('s', 'Split squat', { w: 20, r: 20 }, [{ w: 20, r: 22, done: true, sides: { L: { w: 20, r: 11, done: true }, R: { w: 20, r: 11, done: true } } }])
  assert.deepEqual(recordOf(sided, 'kg'), ['Split squat', 'r', 20, 22, 'kg'])
})

test('foldRecords keeps one line per exercise by its place in the workout, and recordList reads them in order', () => {
  const rc = {}
  const es = six().map((e, i) => Object.assign(e, { i: i }))
  foldRecords(rc, { unit: 'kg', entries: es })
  assert.deepEqual(Object.keys(rc).sort(), ['0', '1', '2', '3', '4'])
  assert.deepEqual(recordList(rc).map(r => r[0]), ['Bench', 'Row', 'Assisted dip', 'Plank', 'Curl'])
  // an exercise with i 10 comes after one with i 2 (a numeric order, not a text one)
  foldRecords(rc, { unit: 'kg', entries: [ent('z', 'Z', { w: 1, r: 1 }, [row(2, 1)], { i: 10 })] })
  assert.equal(recordList(rc).slice(-1)[0][0], 'Z')
})

test('foldRecords: an exercise the window left keeps its record; one whose best was cut keeps it; one unticked while in view loses it', () => {
  const rc = {}
  const bench = () => Object.assign(six()[0], { i: 0 })
  foldRecords(rc, { unit: 'kg', entries: [bench()] })
  foldRecords(rc, { unit: 'kg', entries: [Object.assign(ent('x', 'X', { w: 1, r: 1 }, [row(1, 1)]), { i: 5 })] }) // another window
  assert.equal(recordList(rc).length, 1)
  const cut = bench(); delete cut.best
  foldRecords(rc, { unit: 'kg', entries: [cut] })
  assert.equal(recordList(rc).length, 1) // nothing to compare with now: what was folded stays
  const unticked = bench(); unticked.sets[1].done = false
  foldRecords(rc, { unit: 'kg', entries: [unticked] })
  assert.deepEqual(recordList(rc), [['Bench', 'w', 100, 102.5, 'kg']]) // 105 is unticked; 102.5 still beats 100
  const un2 = bench(); un2.sets = un2.sets.map(r => Object.assign(r, { done: false }))
  foldRecords(rc, { unit: 'kg', entries: [bench()] })
  foldRecords(rc, { unit: 'kg', entries: [un2] })
  assert.equal(recordList(rc).length, 0)
})
