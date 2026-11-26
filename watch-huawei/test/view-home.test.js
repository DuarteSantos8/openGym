// View tests, Start, the routines list, waiting for the phone, the summary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dollarT } from './i18n.js'
import { K, V, T0, mk, ent, row, act, ready, TODAY, started, ASKING, rows } from './view-helpers.js'

/* ---------- Start ---------- */

test('Start: never heard the phone says so, with no way to start', () => {
  const w = mk()
  const d = w.d()
  assert.equal(w.screen(), 'idle')
  assert.equal(d.title, 'Not synced yet')
  assert.equal(d.hint, 'In openGym on your phone, open Settings, then Huawei.')
  assert.equal(d.showStart, false)
})

test('Start: heard, nothing planned and nothing to start', () => {
  const w = mk()
  w.snap(null, { ready: null })
  const d = w.d()
  assert.equal(d.title, 'No workout running')
  assert.equal(d.hint, 'Start one on your phone and it shows up here.')
  assert.equal(d.showStart, false)
})

test('Start: today\'s routine with its plan, and the others a tap away', () => {
  const w = ready(null, TODAY(), [{ name: 'Legs', routineIds: ['r2'], entries: [] }])
  const d = w.d()
  assert.deepEqual([d.title, d.name, d.plan, d.startLabel, d.showStart, d.showRoutines], ['Today', 'Push day', '2 Exercises · 3 Sets', 'Start workout', true, true])
  assert.equal(d.canStart, true)
})

test('Start: no today means Quick start with the first other, and a name-only plan shows no plan line', () => {
  const w = ready(null, null, [{ name: 'Legs', routineIds: ['r2'], entries: [] }])
  const d = w.d()
  assert.deepEqual([d.title, d.name, d.plan, d.startLabel, d.showRoutines], ['Nothing planned. Your call.', 'Legs', '', 'Quick start', false])
})

test('Routines: three rows a page, the next page, picking one starts its 3-2-1', () => {
  const others = ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n, routineIds: [n], entries: [] }))
  const w = ready(null, TODAY(), others)
  w.tap('routines')
  assert.equal(w.screen(), 'routines')
  let d = w.d()
  assert.deepEqual([d.ro0, d.rs0, d.ro1, d.ro2, d.rPaged], ['Push day', 'Today', 'A', 'B', true])
  w.tap('rnext')
  d = w.d()
  assert.deepEqual([d.ro0, d.ro1, d.ro2, d.rv2, d.rs0], ['C', 'D', 'E', true, ''])
  w.tap('rnext')
  assert.equal(w.d().ro0, 'Push day') // wraps
  w.tap('rnext'); w.tap('pick1')
  assert.equal(w.screen(), 'count')
  assert.equal(w.ui.cd.session.name, 'D')
  w.tap('cancelCount')
  assert.equal(w.screen(), 'idle')
  w.tap('routines'); w.tap('rback')
  assert.equal(w.screen(), 'idle')
})

test('a pick on an empty row does nothing', () => {
  const w = ready(null, TODAY(), [])
  w.tap('routines'); w.tap('pick2')
  assert.equal(w.screen(), 'routines')
})

test('Routines: a list that got shorter under the last page keeps its rows tappable', () => {
  const others = ['A', 'B', 'C', 'D', 'E'].map(n => ({ name: n, routineIds: [n], entries: [] }))
  const w = ready(null, TODAY(), others)
  w.tap('routines'); w.tap('rnext')
  assert.equal(w.ui.rp, 2)
  w.snap(null, { settings: { weighIn: false }, ready: { today: TODAY(), others: others.slice(0, 1) } }) // two routines left: one page
  assert.equal(w.ui.rp, 1)
  assert.equal(w.d().ro1, 'A')
  w.tap('pick1')
  assert.equal(w.ui.cd.session.name, 'A')
})

test('The lost state: the one message and button, in the watch\'s words', () => {
  const d = V.lostData(V.translator(dollarT('de-DE')))
  assert.equal(d.s_lost, true)
  V.SCREENS.forEach(k => assert.equal(d['s_' + k], false))
  assert.deepEqual([d.lostText, d.retryLabel], ['Training konnte nicht gelesen werden. Nichts wurde geändert.', 'Nochmal versuchen'])
  Object.keys(d).forEach(k => assert.ok(k in V.blank(), k))
})

test('Start is ignored while locked (a second after the summary closed)', () => {
  const w = ready(null, TODAY())
  w.c.g.lock = w.clk.now + 1000
  assert.equal(w.d().canStart, false)
  w.tap('start')
  assert.equal(w.screen(), 'idle')
})

test('Summary: heart rate, the close guard, and Start waits a second after it', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])]))
  K.hrSample(w.c, 120); K.hrSample(w.c, 140)
  w.tap('finish'); w.tap('yes')
  assert.equal(w.screen(), 'summary')
  assert.equal(w.d().hrLine, '130 avg · 140 max')
  assert.equal(w.d().hrOn, true)
  w.tap('close')
  assert.equal(w.screen(), 'summary') // within the first second
  w.wait(2)
  w.tap('close')
  assert.equal(w.screen(), 'idle')
})

test('Summary: the sync row shows only when it has words', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8, { done: true })])]))
  w.snap(null)
  assert.equal(w.screen(), 'summary')
  assert.deepEqual([w.d().syncOn, w.d().sync], [true, 'All synced'])
  assert.equal(w.d().syncOn, w.d().sync !== '')
  assert.equal(V.blank().syncOn, false)
})

test('Summary: no "All synced" while the finish the phone has not acknowledged is waiting', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8, { done: true })])]))
  K.finishWorkout(w.c, false)
  w.wait(1)
  assert.equal(w.screen(), 'summary')
  assert.equal(w.evs().some(e => e.type === 'finish'), true)
  assert.equal(w.d().sync, '')
  K.ackOutbox(w.c.s, w.evs().map(e => e.id))
  assert.equal(w.d().sync, 'All synced')
})

test('The phone ended the workout: the summary says so, with the heart rate the watch had', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8, { done: true }), row(60, 8)])]))
  K.hrSample(w.c, 120); K.hrSample(w.c, 140)
  w.snap(null)
  assert.equal(w.d().hrLine, '130 avg · 140 max')
  assert.equal(w.screen(), 'summary')
  const d = w.d()
  assert.deepEqual([d.title, d.name, d.setsNum], ['Ended on your phone', 'Push', '1'])
})

test('Waiting for the phone: a workout started by name, then the next exercise on its way', () => {
  const w = ready(null, null, [{ name: 'Legs', routineIds: ['r2'], entries: [] }])
  w.tap('start'); w.tap('skipCount')
  assert.equal(w.screen(), 'wait')
  let d = w.d()
  assert.deepEqual([d.name, d.body], ['Legs', 'Waiting for your phone. Open openGym there if it takes a while.'])
  // the phone answers with the first window, and more behind it
  const id = w.c.s.w.id
  w.snap(act([ent('Squat', 0, [row(80, 5)])], { id: id, name: 'Legs', count: 3, start: T0 }))
  assert.equal(w.screen(), 'set')
  w.tap('done'); w.wait(2)
  assert.equal(w.screen(), 'wait')
  assert.equal(w.d().body, 'Next exercise is on its way from your phone.')
  w.tap('menu')
  assert.equal(w.screen(), 'menu') // Finish and Discard stay reachable
})

test('A workout the phone starts during the flow drops the flow', () => {
  const w = ready(null, TODAY(), [], ASKING)
  w.tap('start')
  w.snap(act([ent('Bench', 0, [row(60, 8)])]))
  assert.equal(w.screen(), 'set')
  w.snap(null)
  w.tap('close')
  w.wait(2); w.tap('close')
  assert.equal(w.screen(), 'idle') // not the old check-in
})

/* ---------- the review of step 1: boxes, the pinned remove, the menu on the rest, the lock ---------- */

test('Closing the summary locks for a second by the core\'s own clock, not the wall clock', () => {
  const clk = { now: T0, tick: 5000 }
  const env = { radio: { transmit: () => {} }, now: () => clk.now, tick: () => clk.tick, random: () => 0.5, save: () => {}, today: () => '2026-11-25' }
  const c = K.createCore(env, null)
  const ui = V.newUi()
  K.onPhone(c, { v: 1, unit: 'kg', restSec: 90, settings: { weighIn: false }, active: act([ent('Bench', 0, [row(60, 8)])]), ready: null })
  V.act(c, ui, 'finish'); V.act(c, ui, 'yes')
  clk.tick += 2000; clk.now += 2000
  V.act(c, ui, 'close')
  assert.equal(K.locked(c), true)
  clk.tick += 1100
  assert.equal(K.locked(c), false)
})
