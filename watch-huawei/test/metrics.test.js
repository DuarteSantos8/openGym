// The numbers behind the Metrics pages: time, heart rate, Pulse, Zones, Effort, Muscles, and the small ones
// (streak, plain rest, band tag). Formulas ported from Wear OS WatchLogic.kt Metrics and SessionCoreTest.kt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../entry/src/main/js/MainAbility/common/core.js'
import * as X from '../entry/src/main/js/MainAbility/common/metrics.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T0 = 1761742800000
function mk (stored) {
  const t = { now: T0 }
  const env = { radio: { transmit: (m, l) => { t.l = l } }, now: () => t.now, random: () => 0.5, save: () => {}, buzz: () => {}, today: () => '2026-11-25' }
  const c = K.createCore(env, stored)
  return { c: c, s: c.s, t: t }
}
const ent = (id, i, sets, extra) => Object.assign({ id: id, name: id, i: i, sets: sets }, extra || {})
const act = (entries, extra) => Object.assign({ id: 'w1', name: 'Push', start: T0 - 600000, unit: 'kg', cur: 0, restSec: 90, count: entries.length, entries: entries }, extra || {})
const snap = (active, settings, extra) => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: settings || {}, active: active, ready: null }, extra || {})
function running (entries, extra, settings) { const m = mk(); K.onPhone(m.c, snap(act(entries, extra), settings)); return m }
const rows = (id, n, extra) => Array.apply(null, Array(n)).map((_, j) => Object.assign({ w: 60, r: 8, sid: id + j }, extra || {}))
const beat = (m, at, bpm) => { m.t.now = T0 + at; K.hrSample(m.c, bpm) }

/* ---------- the pure formulas (WatchLogic.kt Metrics, SessionCoreTest.kt) ---------- */
test('zones by percent of Tanaka\'s maximum: zone 1 is everything under 60 %', () => {
  assert.equal(X.maxHeartRate(40), 180)
  assert.equal(X.zone(68, 180), 1)
  assert.equal(X.zone(107, 180), 1)
  assert.equal(X.zone(108, 180), 2) // 60 % opens zone 2
  assert.equal(X.zone(126, 180), 3)
  assert.equal(X.zone(161, 180), 4)
  assert.equal(X.zone(200, 180), 5) // over the maximum stays in 5
  assert.equal(X.zone(0, 180), null)
  assert.equal(X.zone(100, 0), null)
})

test('the zone bands agree with zone(), also on a fraction', () => {
  const b = X.zoneBands(180)
  assert.deepEqual(b.map(x => x.lo), [null, 108, 126, 144, 162])
  assert.deepEqual(b.map(x => x.hi), [107, 125, 143, 161, null])
  const max = X.maxHeartRate(37) // 182.1
  X.zoneBands(max).forEach((band, i) => {
    if (band.lo != null) { assert.equal(X.zone(band.lo, max), i + 1); assert.equal(X.zone(band.lo - 1, max), i) }
  })
})

test('time in zones: each reading counts until the next, at most 30 s; the last counts nothing; out of order nothing', () => {
  const hr = [[0, 100], [10000, 130], [20000, 170], [120000, 170]]
  assert.deepEqual(X.timeInZones(hr, 180), [10, 0, 10, 0, 30])
  assert.deepEqual(X.timeInZones([], 180), [0, 0, 0, 0, 0])
  assert.deepEqual(X.timeInZones([[0, 150]], 180), [0, 0, 0, 0, 0])
  assert.deepEqual(X.timeInZones([[5000, 100], [1000, 100]], 180), [0, 0, 0, 0, 0])
})

test('age only from 10 to 100', () => {
  assert.equal(X.age(1988, 2026), 38)
  assert.equal(X.age(2016, 2026), 10)
  assert.equal(X.age(1926, 2026), 100)
  assert.equal(X.age(null, 2026), null)
  assert.equal(X.age(2017, 2026), null)
  assert.equal(X.age(1925, 2026), null)
  assert.equal(X.age('1988', 2026), null)
})

/* ---------- the summary page ---------- */
test('numbers: the time stands still while the phone has the workout paused; phone time read on the watch\'s clock', () => {
  const m = running([ent('a', 0, rows('a', 3))], { start: T0 - 600000 })
  assert.deepEqual([X.numbers(m.c).elapsed, X.numbers(m.c).paused], [600, false])
  m.s.w.pausedAt = T0 - 300000
  assert.deepEqual([X.numbers(m.c).elapsed, X.numbers(m.c).paused], [300, true])
  m.t.now += 60000
  assert.equal(X.numbers(m.c).elapsed, 300)
  delete m.s.w.pausedAt
  m.s.ck = [[T0 + 60000, 90000]] // the watch's clock is 90 s ahead of the phone's
  assert.equal(X.numbers(m.c).elapsed, 600 + 60 - 90)
  m.s.w.start = null
  assert.equal(X.numbers(m.c).elapsed, null)
  assert.equal(X.numbers(mk().c), null)
})

test('numbers: a workout started here counts from the watch\'s own clock', () => {
  const m = mk()
  K.startWorkout(m.c, { name: 'Q', routineIds: [], entries: [ent('a', 0, rows('a', 2))] })
  m.s.ck = [[T0, 90000]]
  m.t.now += 30000
  assert.equal(X.numbers(m.c).elapsed, 30)
})

test('numbers: sets done and in all, the volume, and the heart rate now, average and peak', () => {
  const m = running([ent('a', 0, rows('a', 3)), ent('b', 1, rows('b', 2))], { progress: [0, 5] }, { show: { hr: true } })
  beat(m, 1000, 100); beat(m, 7000, 140)
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 0)
  const n = X.numbers(m.c)
  assert.deepEqual(n.sets, [1, 5])
  assert.equal(n.volume, 480)
  assert.equal(n.unit, 'kg')
  assert.deepEqual(n.hr, { now: 140, avg: 120, max: 140 })
  const off = running([ent('a', 0, rows('a', 1))], {}, { show: { hr: false } })
  assert.equal(X.numbers(off.c).hr, null)
})

test('numbers: the phone\'s totals count what the window does not hold', () => {
  const m = running([ent('b', 1, rows('b', 2))], { count: 3, progress: [5, 9], volume: 3000 })
  assert.deepEqual(X.numbers(m.c).sets, [5, 9])
  assert.equal(X.numbers(m.c).volume, 3000)
})

/* ---------- Pulse ---------- */
test('pulse: the average, the lowest and highest, and a line for a small chart', () => {
  const m = running([ent('a', 0, rows('a', 1))])
  for (let i = 0; i < 40; i++) beat(m, i * 5000, 100 + i)
  const p = X.pulse(m.c, 10)
  assert.deepEqual([p.avg, p.min, p.max], [120, 100, 139])
  assert.equal(p.points.length, 10)
  assert.ok(p.points[0][0] < p.points[9][0])
  const none = X.pulse(running([ent('a', 0, rows('a', 1))]).c, 10)
  assert.deepEqual(none, { avg: null, min: null, max: null, points: [] })
})

/* ---------- Zones ---------- */
test('zones: from the birth year, the five bands, the seconds in each, and the zone now', () => {
  const m = running([ent('a', 0, rows('a', 1))], {}, { birthYear: 1986, show: { zones: true } }) // 40 in 2026: max 180
  beat(m, 0, 100); beat(m, 10000, 130); beat(m, 20000, 170); beat(m, 25000, 170)
  const z = X.zones(m.c)
  assert.equal(z.maxHr, 180)
  assert.equal(z.age, 40)
  assert.equal(z.needsBirthYear, false)
  assert.deepEqual(z.times, [10, 0, 10, 0, 5])
  assert.deepEqual(z.bands.map(b => b.lo), [null, 108, 126, 144, 162])
  assert.equal(z.now, 5)
})

test('zones: without a birth year there is nothing to compute: five zeros and a hint', () => {
  const m = running([ent('a', 0, rows('a', 1))])
  beat(m, 0, 100); beat(m, 10000, 130)
  const z = X.zones(m.c)
  assert.deepEqual([z.maxHr, z.age, z.needsBirthYear, z.now], [null, null, true, null])
  assert.deepEqual(z.times, [0, 0, 0, 0, 0])
  assert.deepEqual(z.bands, [])
  assert.equal(X.zones(running([ent('a', 0, rows('a', 1))], {}, { birthYear: 2020 }).c).needsBirthYear, true) // age 6: not plausible
})

/* ---------- the pages ---------- */
test('metricPages: the numbers, Pulse when there is a heart rate and it is shown, Effort, Zones, Muscles last', () => {
  const m = running([ent('a', 0, rows('a', 1))], {}, { show: { hr: true } })
  assert.deepEqual(X.metricPages(m.c), ['numbers', 'effort', 'muscles'])
  beat(m, 1000, 100)
  assert.deepEqual(X.metricPages(m.c), ['numbers', 'pulse', 'effort', 'zones', 'muscles'])
  m.s.set.show.zones = false
  assert.deepEqual(X.metricPages(m.c), ['numbers', 'pulse', 'effort', 'muscles'])
  m.s.set.show.hr = false
  assert.deepEqual(X.metricPages(m.c), ['numbers', 'effort', 'muscles'])
  assert.deepEqual(X.metricPages(mk().c), [])
})

/* ---------- Effort ---------- */
const rated = (m, pos, si, v) => { m.t.now += 2000; K.tickSet(m.c, pos, si, null, 60, 8, null, 0); m.t.now += 2000; K.rate(m.c, v) }

test('effort: one row per exercise rated here, the mean of its rated sets, in workout order; unrated ones skipped', () => {
  const m = running([ent('a', 0, rows('a', 2), { name: 'Bench' }), ent('b', 1, rows('b', 1), { name: 'Row' }), ent('c', 2, rows('c', 1), { name: 'Fly' })], {}, { effort: 'rpe' })
  assert.deepEqual(X.effort(m.c), { kind: 'rpe', rows: [] })
  rated(m, 0, 0, 8); rated(m, 0, 1, 9)
  m.t.now += 2000; K.tickSet(m.c, 1, 0, null, 60, 8, null, 0) // not rated
  rated(m, 2, 0, 7)
  const e = X.effort(m.c)
  assert.deepEqual(e.rows.map(r => [r.name, r.value]), [['Bench', 8.5], ['Fly', 7]])
  assert.equal(e.rows[0].id, 'a')
  assert.equal(X.effort(running([ent('a', 0, rows('a', 1))]).c).kind, null)
  assert.equal(X.effort(mk().c).rows.length, 0)
})

test('effort: the same exercise twice rates apart; a rating follows the phone\'s scale (RIR = 10 - RPE); an unticked set loses it', () => {
  const twice = () => [ent('a', 0, rows('a', 2), { name: 'Bench' }), ent('a', 1, rows('z', 2), { name: 'Bench' })]
  const m = running(twice(), {}, { effort: 'rpe' })
  rated(m, 0, 0, 8); rated(m, 1, 0, 10)
  assert.deepEqual(X.effort(m.c).rows.map(r => r.value), [8, 10])
  // the phone has both ticks, then switches to RIR
  const done = twice(); done[0].sets[0].done = true; done[0].sets[0].at = T0 + 100000; done[1].sets[0].done = true; done[1].sets[0].at = T0 + 100000
  K.onPhone(m.c, snap(act(done), { effort: 'rir' }))
  assert.deepEqual(X.effort(m.c).rows.map(r => r.value), [2, 0])
  assert.equal(X.effort(m.c).kind, 'rir')
  // the phone unticks the first one: its rating goes and does not come back
  const undone = twice(); undone[1].sets[0].done = true; undone[1].sets[0].at = T0 + 100000
  K.onPhone(m.c, snap(act(undone), { effort: 'rir' }))
  K.onPhone(m.c, snap(act(done), { effort: 'rir' }))
  assert.deepEqual(X.effort(m.c).rows.map(r => r.value), [0])
  // another scale altogether drops them
  K.onPhone(m.c, snap(act(done), { effort: 'rpe' }))
  K.onPhone(m.c, snap(act(done), {}))
  assert.equal(X.effort(m.c).rows.length, 0)
})

test('effort: a finished workout leaves no ratings; the ratings survive a restart', () => {
  const m = running([ent('a', 0, rows('a', 2), { name: 'Bench' })], {}, { effort: 'rir' })
  rated(m, 0, 0, 2)
  const m2 = mk(clone(m.s))
  assert.equal(X.effort(m2.c).rows.length, 1)
  K.finishWorkout(m.c, false)
  assert.deepEqual(m.s.ef, {})
})

test('effort: a set rated before the phone gave it an id, then rated again, counts once', () => {
  const m = running([ent('a', 0, [{ w: 60, r: 8 }, { w: 60, r: 8 }], { name: 'Bench' })], {}, { effort: 'rpe' })
  rated(m, 0, 0, 8)
  const sid = [{ w: 60, r: 8, sid: 's0', done: true, at: T0 + 100000 }, { w: 60, r: 8, sid: 's1' }]
  K.onPhone(m.c, snap(act([ent('a', 0, sid, { name: 'Bench' })]), { effort: 'rpe' }))
  m.t.now += 2000; K.rate(m.c, 10)
  assert.deepEqual(X.effort(m.c).rows.map(r => r.value), [10])
})

/* ---------- Muscles ---------- */
test('muscles: the working sets done, by the phone\'s weights; most first, then by name; the phone\'s names', () => {
  const m = running([
    ent('1', 0, [{ done: true, warmup: true, sid: 'x' }, { done: true, sid: 'y' }, { done: true, sid: 'z' }, { sid: 'u' }], { name: 'Bench', muscles: { chest: 1, triceps: 0.4 } }),
    ent('2', 1, [{ done: true, sid: 'v' }], { name: 'Pushdown', muscles: { triceps: 1 } }),
    ent('3', 2, [{ done: true, sid: 'w' }], { name: 'Old phone' })
  ], { muscleNames: { chest: 'Pecho', triceps: 'Tríceps' } })
  assert.deepEqual(X.muscles(m.c), { rows: [{ name: 'Pecho', sets: 2 }, { name: 'Tríceps', sets: 1.8 }], total: 3.8 })
  assert.deepEqual(X.muscles(running([ent('1', 0, rows('a', 2))]).c), { rows: [], total: 0 })
  const tie = running([ent('1', 0, [{ done: true, sid: 'a' }], { muscles: { biceps: 1, abs: 1 } })])
  assert.deepEqual(X.muscles(tie.c).rows.map(r => r.name), ['abs', 'biceps']) // no names from the phone: its keys
  assert.deepEqual(X.muscles(mk().c), { rows: [], total: 0 })
  assert.equal(X.setsText(1.8, false), '1.8')
  assert.equal(X.setsText(2, false), '2')
  assert.equal(X.setsText(1.25, true), '1,3')
})

test('muscles: an exercise the window left keeps its sets', () => {
  const m = running([ent('1', 0, rows('a', 2), { name: 'Bench', muscles: { chest: 1 } }), ent('2', 1, rows('b', 1), { muscles: { back: 1 } })], { count: 3, muscleNames: { chest: 'Chest' } })
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 0); K.tickSet(m.c, 0, 1, null, 60, 8, null, 0)
  K.onPhone(m.c, snap(act([ent('2', 1, rows('b', 1), { muscles: { back: 1 } })], { count: 3, cur: 1, muscleNames: { chest: 'Chest' } })))
  assert.deepEqual(X.muscles(m.c).rows, [{ name: 'Chest', sets: 2 }])
  // it comes back into the window (now read from there, not counted twice)
  K.onPhone(m.c, snap(act([ent('1', 0, rows('a', 2).map(r => Object.assign(r, { done: true, at: T0 })), { muscles: { chest: 1 } })], { count: 3, muscleNames: { chest: 'Chest' } })))
  assert.deepEqual(X.muscles(m.c).rows, [{ name: 'Chest', sets: 2 }])
  K.finishWorkout(m.c, false)
  assert.deepEqual(m.s.mu, {})
})

test('muscles: an exercise the phone moves while it is out of the window is not counted twice', () => {
  const bench = i => ent('1', i, rows('a', 2).map(r => Object.assign(r, { done: true, at: T0 })), { name: 'Bench', muscles: { chest: 1 } })
  const m = running([ent('1', 0, rows('a', 2), { name: 'Bench', muscles: { chest: 1 } }), ent('2', 1, rows('b', 1), { muscles: { back: 1 } })], { count: 3 })
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 0); K.tickSet(m.c, 0, 1, null, 60, 8, null, 0)
  m.s.ob = [] // the phone has both ticks
  K.onPhone(m.c, snap(act([ent('2', 1, rows('b', 1), { muscles: { back: 1 } })], { count: 3, cur: 1 }))) // Bench left the window
  // the phone put a new exercise ahead: Bench is at place 1 now, and the window shows only it
  K.onPhone(m.c, snap(act([bench(1)], { count: 4, cur: 1 })))
  assert.deepEqual(X.muscles(m.c).rows, [{ name: 'chest', sets: 2 }])
})

/* ---------- the small ones ---------- */
test('streak: the weeks and whether this week is done; none when the phone sent none', () => {
  const m = mk()
  assert.equal(X.streak(m.c), null)
  K.onPhone(m.c, snap(null, {}, { streak: { weeks: 12, thisWeekDone: true } }))
  assert.deepEqual(X.streak(m.c), { weeks: 12, thisWeekDone: true })
  m.s.stk = { weeks: 'x' }
  assert.equal(X.streak(m.c), null)
})

test('restStyle: the ring unless the phone says plain; bandOf: the band text of a set, or none', () => {
  assert.equal(X.restStyle(running([ent('a', 0, rows('a', 1))]).c), 'ring')
  assert.equal(X.restStyle(running([ent('a', 0, rows('a', 1))], {}, { show: { rest: 'plain' } }).c), 'plain')
  assert.equal(X.restStyle(running([ent('a', 0, rows('a', 1))], {}, { show: { rest: 'ring' } }).c), 'ring')
  assert.equal(X.restStyle(running([ent('a', 0, rows('a', 1))], {}, { show: { rest: 'fancy' } }).c), 'ring')
  assert.equal(X.bandOf({ band: 'Red + Yellow' }), 'Red + Yellow')
  assert.equal(X.bandOf({}), '')
  assert.equal(X.bandOf(null), '')
  assert.equal(X.bandOf({ band: 5 }), '')
  assert.equal(X.bandOf({ band: new Array(200).join('x') }).length, 40)
})

/* ---------- the three pure modules stay inside the lite engine's built-ins ---------- */
import { readFileSync } from 'node:fs'
import { strip } from './syntax.test.js'
test('records.js, medal.js and metrics.js call only ES5 methods', () => {
  const es5 = 'forEach map filter some every indexOf slice concat push sort join keys isArray floor ceil round max min abs apply replace now'.split(' ')
  ;['records.js', 'medal.js', 'metrics.js'].forEach(f => {
    const src = strip(readFileSync(new URL('../entry/src/main/js/MainAbility/common/' + f, import.meta.url), 'utf8'))
    const called = []
    src.replace(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g, (m, name) => { called.push(name) })
    assert.deepEqual(called.filter(n => es5.indexOf(n) < 0), [], f)
    const globals = []
    src.replace(/\b(Math|Object|Array|JSON|Number|String|Date)\.([A-Za-z_$][\w$]*)/g, (m, a, b) => { globals.push(a + '.' + b) })
    assert.deepEqual(globals.filter(g => ['Math.floor', 'Math.ceil', 'Math.round', 'Math.max', 'Math.min', 'Math.abs', 'Object.keys', 'Array.isArray'].indexOf(g) < 0), [], f)
  })
})
