// The numbers behind the one Metrics page: time, sets, volume and heart rate (the Garmin's level).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../entry/src/main/js/MainAbility/common/core.js'
import * as X from '../entry/src/main/js/MainAbility/common/metrics.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T0 = 1761742800000
function mk (stored) {
  const t = { now: T0 }
  const env = { radio: { transmit: (m, l) => { t.l = l } }, now: () => t.now, random: () => 0.5, save: () => {}, buzz: () => {} }
  const c = K.createCore(env, stored)
  return { c: c, s: c.s, t: t }
}
const ent = (id, i, sets, extra) => Object.assign({ id: id, name: id, i: i, sets: sets }, extra || {})
const act = (entries, extra) => Object.assign({ id: 'w1', name: 'Push', start: T0 - 600000, unit: 'kg', cur: 0, restSec: 90, count: entries.length, entries: entries }, extra || {})
const snap = (active, settings, extra) => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: settings || {}, active: active, ready: null }, extra || {})
function running (entries, extra, settings) { const m = mk(); K.onPhone(m.c, snap(act(entries, extra), settings)); return m }
const rows = (id, n, extra) => Array.apply(null, Array(n)).map((_, j) => Object.assign({ w: 60, r: 8, sid: id + j }, extra || {}))
const beat = (m, at, bpm) => { m.t.now = T0 + at; K.hrSample(m.c, bpm) }

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
/* ---------- Zones ---------- */
/* ---------- the pages ---------- */
/* ---------- Effort ---------- */
const rated = (m, pos, si, v) => { m.t.now += 2000; K.tickSet(m.c, pos, si, null, 60, 8, null, 0); m.t.now += 2000; K.rate(m.c, v) }

/* ---------- Muscles ---------- */
/* ---------- the small ones ---------- */
/* ---------- the three pure modules stay inside the lite engine's built-ins ---------- */
import { readFileSync } from 'node:fs'
import { strip } from './syntax.test.js'
test('metrics.js calls only ES5 methods', () => {
  const es5 = 'forEach map filter some every indexOf slice concat push sort join keys isArray floor ceil round max min abs apply replace now'.split(' ')
  ;['metrics.js'].forEach(f => {
    const src = strip(readFileSync(new URL('../entry/src/main/js/MainAbility/common/' + f, import.meta.url), 'utf8'))
    const called = []
    src.replace(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g, (m, name) => { called.push(name) })
    assert.deepEqual(called.filter(n => es5.indexOf(n) < 0), [], f)
    const globals = []
    src.replace(/\b(Math|Object|Array|JSON|Number|String|Date)\.([A-Za-z_$][\w$]*)/g, (m, a, b) => { globals.push(a + '.' + b) })
    assert.deepEqual(globals.filter(g => ['Math.floor', 'Math.ceil', 'Math.round', 'Math.max', 'Math.min', 'Math.abs', 'Object.keys', 'Array.isArray'].indexOf(g) < 0), [], f)
  })
})
