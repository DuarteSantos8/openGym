// What the watch shows, screen by screen, driven the way the page drives it: taps through act(),
// a second through second() + tick(), data from build().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as K from '../entry/src/main/js/MainAbility/common/core.js'
import * as V from '../entry/src/main/js/MainAbility/common/view.js'
import { KEYS, TEXTS } from '../entry/src/main/js/MainAbility/common/texts.js'

const T0 = 1761742800000
const t = V.translator('en')
const clone = v => JSON.parse(JSON.stringify(v))

function mk (opts) {
  const o = opts || {}
  const clk = { now: T0 }
  const buzzes = []
  const sent = []
  const env = { radio: { transmit: m => { sent.push(clone(m)) } }, now: () => clk.now, random: () => 0.5, save: () => {}, buzz: p => buzzes.push(p), today: () => '2026-11-25' }
  const c = K.createCore(env, o.stored)
  const ui = V.newUi(o.lang || 'en')
  const w = {
    c, ui, clk, buzzes, sent,
    snap: (active, extra) => { K.onPhone(c, Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: {}, active: active, ready: null }, extra || {})); V.tick(c, ui) },
    tap: name => { V.act(c, ui, name); V.tick(c, ui) },
    // seconds pass: the page's timer tick
    wait: sec => { for (let i = 0; i < sec; i++) { clk.now += 1000; K.second(c); V.tick(c, ui) } },
    d: () => V.build(c, ui, t),
    screen: () => V.screenOf(c, ui),
    evs: () => c.s.ob.map(K.unpack)
  }
  return w
}
const ent = (id, i, sets, extra) => Object.assign({ id: id, name: id, i: i, sets: sets }, extra || {})
const row = (w, r, extra) => Object.assign({ w: w, r: r }, extra || {})
const session = (entries, extra) => Object.assign({ routineIds: ['r1'], name: 'Push day', entries: entries }, extra || {})
const act = (entries, extra) => Object.assign({ id: 'w1', name: 'Push', start: T0 - 600000, unit: 'kg', cur: 0, restSec: 90, count: entries.length, entries: entries }, extra || {})
const grid = a => { a.entries[0].step = 2.5; return a }
const fixture = () => JSON.parse(readFileSync(new URL('../../frontend/garmin/test/snapshot.json', import.meta.url), 'utf8'))
// a watch that has heard the phone and holds today's routine
// a watch that has heard the phone; the phone asks for no weigh-in unless a test says so
const ready = (opts, today, others, settings) => { const w = mk(opts); w.snap(null, { settings: settings || { weighIn: false }, ready: { today: today, others: others || [] } }); return w }
const TODAY = () => session([ent('Bench', 0, [row(60, 8), row(60, 8)], { last: '55×8, 57.5×6', restSec: 60 }), ent('Row', 1, [row(40, 10)])])
const started = (opts, today) => { const w = ready(opts, today || TODAY()); w.tap('start'); w.wait(4); return w }

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

/* ---------- 3-2-1 ---------- */

test('3-2-1: 3, 2, 1, Go!, then the workout starts by itself; a tap starts it at once', () => {
  const w = ready(null, TODAY())
  w.tap('start')
  const nums = []
  for (let i = 0; i < 4; i++) { nums.push(w.d().big); if (i < 3) w.wait(1) }
  assert.deepEqual(nums, ['3', '2', '1', 'Go!'])
  assert.equal(w.screen(), 'count')
  assert.equal(w.d().label, 'Start workout')
  w.wait(1) // 4 s: past 3.7
  assert.equal(w.screen(), 'set')
  assert.equal(w.evs()[0].type, 'start')
  const v = ready(null, TODAY())
  v.tap('start'); v.tap('skipCount')
  assert.equal(v.screen(), 'set')
})

test('3-2-1: the workout\'s count buzzes on each number and on Go!, and stays quiet when the phone says so', () => {
  const w = ready(null, TODAY())
  w.tap('start')
  assert.deepEqual(w.buzzes, [[[30, 40]]]) // the 3
  w.wait(1); w.wait(1); w.wait(1)
  assert.deepEqual(w.buzzes, [[[30, 40]], [[30, 40]], [[30, 40]], [[100, 250]]])
  const q = ready(null, TODAY())
  q.snap(null, { settings: { restHaptics: false }, ready: { today: TODAY(), others: [] } })
  q.tap('start'); q.wait(3)
  assert.deepEqual(q.buzzes, [])
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

test('Overview: the page clamps when the window shrinks', () => {
  const w = mk()
  const es = [0, 1, 2, 3, 4].map(i => ent('E' + i, i, [row(10, 10)]))
  w.snap(act(es))
  w.tap('menu'); w.tap('mOver'); w.tap('ovNext')
  assert.equal(w.ui.op, 1)
  w.snap(act(es.slice(0, 2)))
  assert.equal(w.ui.op, 0)
})

test('The lost state: the one message and button, in the watch\'s words', () => {
  const d = V.lostData(V.translator('de'))
  assert.equal(d.s_lost, true)
  V.SCREENS.forEach(k => assert.equal(d['s_' + k], false))
  assert.deepEqual([d.lostText, d.retryLabel], ['Training konnte nicht gelesen werden. Nichts wurde geändert.', 'Nochmal versuchen'])
  Object.keys(d).forEach(k => assert.ok(k in V.blank(), k))
})

test('Fixing: a rest that runs on stays in view at the top', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  w.tap('done'); w.wait(2)
  w.tap('menu'); w.tap('mPrev')
  assert.equal(w.screen(), 'set')
  assert.match(w.d().top, /^Rest 1:\d\d/)
})

test('Start is ignored while locked (a second after the summary closed)', () => {
  const w = ready(null, TODAY())
  w.c.g.lock = w.clk.now + 1000
  assert.equal(w.d().canStart, false)
  w.tap('start')
  assert.equal(w.screen(), 'idle')
})

/* ---------- Set ---------- */

test('Set: the phone\'s workout opens on its own, numbers as the box shows them', () => {
  const w = mk()
  w.snap(fixture().active)
  const d = w.d()
  assert.equal(w.screen(), 'set')
  assert.deepEqual([d.name, d.tag, d.wOn, d.wNum, d.wUnit, d.rNum, d.rLabel, d.last, d.doneLabel],
    ['Barbell Bench Press', 'Set 2 of 2', true, '60', 'kg', '8', 'Reps', 'Last time: 55×8, 57.5×6', 'Done'])
  assert.equal(d.s_set, true)
  assert.equal(d.s_idle, false)
})

test('Set: + and - move the boxes on the exercise\'s grid, never below zero, no trailing .0', () => {
  const w = mk()
  w.snap(grid(fixture().active))
  w.tap('wPlus'); assert.equal(w.d().wNum, '62.5')
  w.tap('wPlus'); assert.equal(w.d().wNum, '65')
  w.tap('wMinus'); w.tap('wMinus'); w.tap('wMinus'); assert.equal(w.d().wNum, '57.5')
  w.tap('rPlus'); assert.equal(w.d().rNum, '9')
  for (let i = 0; i < 12; i++) w.tap('rMinus')
  assert.equal(w.d().rNum, '0')
})

test('Set: the edits survive a redraw and a snapshot, and reload for the next set', () => {
  const w = mk()
  w.snap(grid(fixture().active))
  w.tap('wPlus')
  w.wait(2)
  w.snap(grid(fixture().active))
  assert.equal(w.d().wNum, '62.5')
  w.tap('done')
  assert.equal(w.c.s.w.entries[0].sets[1].w, 62.5)
  assert.equal(w.evs().filter(e => e.type === 'setDone').pop().w, 62.5)
})

test('Set: Last time hides when the phone says so, and without a last time', () => {
  const w = mk()
  const a = fixture().active
  w.snap(a, { settings: { show: { last: false } } })
  assert.equal(w.d().last, '')
  const v = mk()
  const b = fixture().active
  b.entries[0].last = null
  v.snap(b)
  assert.equal(v.d().last, '')
})

test('Set: a warm-up set says so', () => {
  const w = mk()
  w.snap(act([ent('Pull', 0, [row(20, 10, { warmup: true }), row(20, 10, { warmup: true }), row(40, 8), row(40, 8)])]))
  assert.equal(w.d().tag, 'Warm-up 1/2')
})

test('Set: the exercise name can be long, and is whole in the data (the page clips it)', () => {
  const name = 'Dumbbell Romanian Deadlift with a Very Long Name'.repeat(2)
  const w = mk()
  w.snap(act([ent('x', 0, [row(20, 8)], { name: name })]))
  assert.equal(w.d().name, name)
})

test('Set: the Done button waits a second after a Done', () => {
  const w = mk()
  w.snap(fixture().active)
  w.tap('done')
  const n = w.evs().length
  w.tap('done')
  assert.equal(w.evs().length, n)
})

test('Set: bodyweight shows no weight box until the phone gives it a load, and its number says "+"', () => {
  const w = mk()
  w.snap(act([ent('Dip', 0, [row(null, 10)], { bodyweight: true })]))
  assert.equal(w.d().wOn, false)
  const v = mk()
  v.snap(act([ent('Dip', 0, [row(10, 10)], { bodyweight: true })]))
  assert.deepEqual([v.d().wOn, v.d().wNum], [true, '+10'])
  v.tap('wMinus'); v.tap('wMinus'); v.tap('wMinus'); v.tap('wMinus'); v.tap('wMinus')
  assert.equal(v.d().wOn, true) // it stays on the screen at 0
})

test('A pound user: lb, the 5 lb grid, and the summary in lb', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(135, 5)])], { unit: 'lb' }), { unit: 'lb' })
  assert.deepEqual([w.d().wNum, w.d().wUnit], ['135', 'lb'])
  w.tap('wPlus')
  assert.equal(w.d().wNum, '140')
  w.tap('done'); w.wait(2)
  w.tap('finish'); w.tap('yes')
  assert.equal(w.d().volNum, '700 lb')
})

test('Per side: the side up shows, and the other follows with no rest between', () => {
  const w = mk()
  w.snap(act([ent('Split squat', 0, [{ w: 20, r: 8, sides: { L: { w: 20, r: 8 }, R: { w: 22, r: 8 } } }, { w: 20, r: 8, sides: { L: {}, R: {} } }])]))
  assert.equal(w.d().tag, 'Set 1 of 2 · Left')
  w.tap('done')
  assert.equal(w.screen(), 'set')
  assert.equal(w.d().tag, 'Set 1 of 2 · Right')
  assert.equal(w.d().wNum, '22')
  w.wait(2)
  w.tap('done')
  assert.equal(w.screen(), 'rest')
  assert.match(w.d().nextNums, /· Left$/)
})

test('Superset: the partner shows under the tag, +N for more', () => {
  const w = mk()
  w.snap(act([ent('A', 0, [row(10, 10)], { group: 'g' }), ent('B', 1, [row(10, 10)], { group: 'g' }), ent('C', 2, [row(10, 10)], { group: 'g' })]))
  assert.equal(w.d().partner, '+ B +1')
  const v = mk()
  v.snap(act([ent('A', 0, [row(10, 10)], { group: 'g' }), ent('B', 1, [row(10, 10)], { group: 'g' })]))
  assert.equal(v.d().partner, '+ B')
  v.tap('done')
  assert.equal(v.screen(), 'set') // no rest inside a round
  assert.equal(v.d().name, 'B')
})

test('Cardio: logged on the phone, the watch offers the next exercise', () => {
  const w = mk()
  w.snap(act([ent('Run', 0, [row(null, null)], { mode: 'cardio' }), ent('Row', 1, [row(40, 10)])]))
  assert.equal(w.screen(), 'card')
  assert.deepEqual([w.d().body, w.d().nextLabel], ['Log this one on your phone.', 'Next exercise'])
  w.tap('nextEx')
  assert.equal(w.d().name, 'Row')
})

/* ---------- Hold ---------- */

test('Hold: a timed set shows Hold and m:ss, no weight, a 3-2-1, the hold counting down, Stop logs it', () => {
  const w = mk()
  w.snap(act([ent('Plank', 0, [{ sec: 45 }, { sec: 45 }], { mode: 'time' })]))
  let d = w.d()
  assert.deepEqual([d.wOn, d.rLabel, d.rNum, d.doneLabel], [false, 'Hold', '0:45', 'Start hold'])
  w.tap('rPlus'); assert.equal(w.d().rNum, '0:50')
  w.tap('done')
  assert.equal(w.screen(), 'count')
  assert.deepEqual([w.d().big, w.d().label], ['3', 'Start hold'])
  w.wait(4)
  assert.equal(w.screen(), 'hold')
  d = w.d()
  assert.deepEqual([d.name, d.tag, d.time, d.pct, d.timeColor], ['Plank', 'Hold', '0:50', 100, '#A3E635'])
  w.wait(10)
  assert.equal(w.d().time, '0:40')
  w.wait(36)
  assert.equal(w.d().time, '0:04')
  assert.equal(w.d().timeColor, '#FF9F0A')
  w.tap('stopHold')
  assert.equal(w.evs().filter(e => e.type === 'setDone').pop().sec, 46)
})

test('Hold: a tap on the 3-2-1 starts it, Cancel drops it', () => {
  const w = mk()
  w.snap(act([ent('Plank', 0, [{ sec: 30 }], { mode: 'time' })]))
  w.tap('done'); w.tap('skipCount')
  assert.equal(w.screen(), 'hold')
  const v = mk()
  v.snap(act([ent('Plank', 0, [{ sec: 30 }], { mode: 'time' })]))
  v.tap('done'); v.tap('cancelCount')
  assert.equal(v.screen(), 'set')
})

/* ---------- Rest ---------- */

test('Rest: the ring empties, +15 and -15 move it, Skip ends it (after the one-second lock)', () => {
  const w = mk()
  w.snap(fixture().active)
  w.c.s.rest = null
  w.tap('done')
  assert.equal(w.screen(), 'rest')
  let d = w.d()
  assert.deepEqual([d.restLabel, d.restTime, d.pct, d.skipLabel, d.locked], ['Rest', '2:00', 100, 'Skip', true])
  w.wait(30)
  d = w.d()
  assert.deepEqual([d.restTime, d.pct, d.locked], ['1:30', 75, false])
  w.tap('restPlus')
  assert.equal(w.d().restTime, '1:45')
  assert.equal(w.d().pct, Math.round(100 * 105 / 135)) // the total grew by 15 too
  w.tap('restMinus'); w.tap('restMinus')
  assert.equal(w.d().restTime, '1:15')
  w.tap('restSkip')
  assert.notEqual(w.screen(), 'rest')
  assert.equal(w.evs().filter(e => e.type === 'rest').pop().endsAt == null, true)
})

test('Rest: Skip pressed in the first second is ignored', () => {
  const w = mk()
  w.snap(fixture().active)
  w.tap('done')
  w.tap('restSkip')
  assert.equal(w.screen(), 'rest')
})

test('Rest: what is next, with its numbers; the phone can hide it', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(62.5, 6)])]))
  w.tap('done')
  const d = w.d()
  assert.deepEqual([d.upNext, d.nextName, d.nextNums], ['Up next', 'Bench, set 2/2', '62.5 kg × 6 Reps'])
  const v = mk()
  v.snap(act([ent('Bench', 0, [row(60, 8), row(62.5, 6)])]), { settings: { show: { next: false } } })
  v.tap('done')
  assert.deepEqual([v.d().upNext, v.d().nextName], ['', ''])
})

test('Rest: a rest the phone runs gets its ring from the first time seen', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])], { rest: { endsAt: T0 + 60000 }, restAt: T0 }))
  assert.equal(w.screen(), 'rest')
  assert.equal(w.d().pct, 100)
  w.wait(30)
  assert.equal(w.d().pct, 50)
})

test('Rest: paused on the phone says Paused and holds the number', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])], { restPaused: true, restLeft: 40, restAt: T0 }))
  assert.equal(w.screen(), 'rest')
  assert.deepEqual([w.d().restLabel, w.d().restTime], ['Paused', '0:40'])
  w.wait(5)
  assert.equal(w.d().restTime, '0:40')
})

test('Rest: the effort chips, RIR then RPE, and the chosen one after', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]), { settings: { effort: 'rir' } })
  w.wait(2)
  w.tap('done')
  w.wait(2)
  let d = w.d()
  assert.deepEqual([d.effortOn, d.how, d.c0, d.c1, d.c2, d.c3], [true, 'How hard was that set?', '0', '1', '2', '3+'])
  w.tap('chip2')
  d = w.d()
  assert.deepEqual([d.effortOn, d.upNext], [false, 'Up next · Effort 2'])
  assert.equal(w.evs().filter(e => e.type === 'setDone').pop().rir, 2)
  const v = mk()
  v.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]), { settings: { effort: 'rpe' } })
  v.tap('done'); v.wait(2)
  assert.deepEqual([v.d().c0, v.d().c1, v.d().c2, v.d().c3], ['10', '9', '8', '<8'])
})

test('Rest: no effort chips when the phone does not ask', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  w.tap('done')
  assert.equal(w.d().effortOn, false)
})

test('Rest: -15 and +15 are ignored in the first second after Done, like Skip', () => {
  const w = mk()
  w.snap(fixture().active)
  w.tap('done')
  const before = w.c.s.rest
  w.tap('restMinus'); w.tap('restPlus')
  assert.equal(w.c.s.rest, before)
  assert.equal(w.d().locked, true)
  w.wait(2)
  w.tap('restPlus')
  assert.equal(w.c.s.rest, before + 15000)
  w.tap('restMinus')
  assert.equal(w.c.s.rest, before)
})

/* ---------- Fixing the last set, menu ---------- */

test('Menu: previous set opens the set in Edit mode; the arrows, Save and Cancel', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8), row(60, 8)])]))
  w.tap('done'); w.wait(2)
  w.tap('done'); w.wait(2)
  w.tap('menu')
  assert.equal(w.screen(), 'menu')
  assert.equal(w.d().hasPrev, true)
  w.tap('mPrev')
  assert.equal(w.screen(), 'set')
  let d = w.d()
  assert.deepEqual([d.fixing, d.tag, d.doneLabel, d.nextOn, d.prevOn, d.last], [true, 'Edit · Set 2 of 3', 'Save', true, true, ''])
  w.tap('wPlus'); w.tap('rMinus')
  assert.deepEqual([w.d().wNum, w.d().rNum], ['62.5', '7'])
  w.tap('prev')
  assert.equal(w.d().tag, 'Edit · Set 1 of 3')
  assert.equal(w.d().wNum, '60') // each set loads what was logged for it
  w.tap('nextFix')
  assert.equal(w.d().tag, 'Edit · Set 2 of 3')
  w.tap('wPlus'); w.tap('wPlus')
  w.tap('done')
  assert.equal(w.screen(), 'rest') // saved, the rest as it was
  const fix = w.evs().filter(e => e.type === 'setDone').pop()
  assert.deepEqual([fix.setIdx, fix.w, fix.r], [1, 65, 8])
  w.tap('menu'); w.tap('mPrev'); w.tap('cancelFix')
  assert.equal(w.screen(), 'rest')
})

test('Menu: the items follow the workout, each closes the menu', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)]), ent('Row', 1, [row(40, 10)])]))
  w.tap('menu')
  let d = w.d()
  assert.deepEqual([d.hasPrev, d.hasOver, d.hasSkip, d.hasNext, d.lPrev, d.lOver, d.lSkip, d.lNext, d.lFinish, d.lDiscard, d.lBack],
    [false, true, true, true, 'Previous set', 'Overview', 'Skip set', 'Next exercise', 'Finish and save', 'Discard workout', 'Continue workout'])
  w.tap('mBack')
  assert.equal(w.screen(), 'set')
  w.tap('menu'); w.tap('mSkip')
  assert.equal(w.screen(), 'set')
  assert.equal(w.c.s.sk.length, 1)
  w.tap('menu'); w.tap('mNext')
  assert.equal(w.d().name, 'Row')
})

test('Finish and Discard ask first', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])]))
  w.tap('menu'); w.tap('mFinish')
  assert.equal(w.screen(), 'confirm')
  let d = w.d()
  assert.deepEqual([d.title, d.yesLabel, d.noLabel], ['Finish workout?', 'Finish and save', 'Cancel'])
  w.tap('no')
  assert.equal(w.screen(), 'set')
  assert.ok(w.c.s.w)
  w.tap('menu'); w.tap('mDiscard')
  d = w.d()
  assert.deepEqual([d.title, d.yesLabel], ['Discard workout?', 'Discard workout'])
  w.tap('yes')
  assert.equal(w.screen(), 'idle') // a discard shows no summary
  assert.equal(w.evs().pop().type, 'discard')
})

test('Menu: a fix whose set has left the window is dropped, not drawn', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  w.tap('done'); w.wait(2)
  w.tap('menu'); w.tap('mPrev')
  assert.equal(w.d().fixing, true)
  w.c.g.fix = [w.c.g.fix[0], 9, null] // the window moved on: no such set
  w.wait(1)
  assert.equal(w.c.g.fix, null)
  assert.notEqual(w.screen(), 'confirm')
  assert.doesNotThrow(() => w.d())
})

/* ---------- Overview, end, summary ---------- */

test('Overview: rows with done/all, the one up marked, +N for the exercises beyond, a row takes you there', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8, { done: true }), row(60, 8)]), ent('Row', 1, [row(40, 10, { warmup: true }), row(40, 10)])], { count: 5 }))
  w.tap('menu'); w.tap('mOver')
  assert.equal(w.screen(), 'over')
  const d = w.d()
  assert.deepEqual([d.title, d.ot0, d.ot1, d.ovv2, d.ovMore, d.count, d.ovPaged], ['Overview', '> 1/2  Bench', '0/1  Row', false, '+3 Exercises', '1 of 3 sets', false])
  w.tap('ov1')
  assert.equal(w.screen(), 'set')
  assert.equal(w.d().name, 'Row')
  w.tap('menu'); w.tap('mOver'); w.tap('ovBack')
  assert.equal(w.screen(), 'set')
})

test('Overview: a finished exercise is not a way back in; more than four rows page', () => {
  const w = mk()
  const es = [0, 1, 2, 3, 4].map(i => ent('E' + i, i, [row(10, 10, i === 0 ? { done: true } : {})]))
  w.snap(act(es))
  w.tap('menu'); w.tap('mOver')
  assert.equal(w.d().ovPaged, true)
  w.tap('ov0')
  assert.equal(w.screen(), 'over')
  w.tap('ovNext')
  assert.deepEqual([w.d().ot0, w.d().ovv1], ['0/1  E4', false])
})

test('End: the last set done lands on the Overview; Finish asks, Yes saves and the summary shows', () => {
  const w = started(null, session([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  assert.equal(w.screen(), 'set')
  w.tap('done'); w.wait(2)
  w.tap('restSkip'); w.wait(2)
  w.tap('done'); w.wait(2)
  assert.equal(w.screen(), 'over')
  assert.equal(w.d().count, '2 of 2 sets')
  w.tap('finish')
  assert.equal(w.screen(), 'confirm')
  w.wait(30)
  w.tap('yes')
  assert.equal(w.screen(), 'summary')
  const d = w.d()
  assert.deepEqual([d.title, d.name, d.dur, d.durLabel, d.setsNum, d.setsLabel, d.volNum, d.volLabel, d.hrLine, d.doneLabel],
    ['Workout saved', 'Push day', '0:36', 'Time', '2', 'Sets', '960 kg', 'Volume', '', 'Done'])
  assert.equal(d.sync, 'Waiting to sync 2')
  assert.equal(w.evs().pop().type, 'finish')
})

test('End: Back from the Overview at the end shows the end screen, with Finish', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])]))
  w.tap('done'); w.wait(2)
  assert.equal(w.screen(), 'over')
  w.tap('ovBack')
  assert.equal(w.screen(), 'end')
  const d = w.d()
  assert.deepEqual([d.title, d.count, d.finishLabel], ['All sets done', '1 of 1 sets', 'Finish workout'])
  w.tap('finish')
  assert.equal(w.screen(), 'confirm')
})

test('Summary: heart rate, the close guard, and Start waits a second after it', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])]))
  K.hrSample(w.c, 120); K.hrSample(w.c, 140)
  w.tap('finish'); w.tap('yes')
  assert.equal(w.screen(), 'summary')
  assert.equal(w.d().hrLine, '130 avg · 140 max')
  w.tap('close')
  assert.equal(w.screen(), 'summary') // within the first second
  w.wait(2)
  w.tap('close')
  assert.equal(w.screen(), 'idle')
})

test('The phone ended the workout: the summary says so', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8, { done: true }), row(60, 8)])]))
  w.snap(null)
  assert.equal(w.screen(), 'summary')
  const d = w.d()
  assert.deepEqual([d.title, d.name, d.setsNum], ['Ended on your phone', 'Push', '1'])
})

/* ---------- Still training, waiting ---------- */

test('Still training?: after the quiet time, Keep going or Finish', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])], { start: T0, activeAt: T0 }))
  w.wait(20 * 60 + 10)
  assert.equal(w.screen(), 'ask')
  let d = w.d()
  assert.deepEqual([d.title, d.body, d.keepLabel, d.finishLabel], ['Still training?', 'No set for 20 min. Still at it?', 'Keep going', 'Finish workout'])
  w.tap('keep')
  assert.equal(w.screen(), 'set')
  assert.equal(w.evs().pop().type, 'stillHere')
  w.wait(20 * 60 + 10)
  assert.equal(w.screen(), 'ask')
  w.tap('askFinish')
  assert.equal(w.screen(), 'over')
  assert.equal(w.evs().filter(e => e.type === 'stillHere').length, 1) // Finish tells the phone nothing
})

test('Still training?: "Looks like you left the gym"', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])], { leftGymAt: T0 - 1000 }))
  w.wait(10)
  assert.equal(w.screen(), 'ask')
  assert.equal(w.d().body, 'Looks like you left the gym')
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

/* ---------- the status line, the look, words ---------- */

test('Status line: heart rate unless the phone hides it, sync only when something waits', () => {
  const w = mk()
  w.snap(fixture().active)
  assert.equal(w.d().top, '')
  K.hrSample(w.c, 128)
  assert.equal(w.d().top, '128 bpm')
  w.tap('done')
  assert.equal(w.d().top, '128 bpm · Waiting to sync 1')
  w.c.g.awayAt = w.clk.now
  assert.equal(w.d().top, '128 bpm · Phone out of reach (1)')
  const v = mk()
  v.snap(fixture().active, { settings: { show: { hr: false } } })
  K.hrSample(v.c, 128)
  assert.equal(v.d().top, '')
})

test('Look: the lime unless the phone gives an accent; the ink follows', () => {
  const w = mk()
  assert.deepEqual([w.d().accent, w.d().ink], ['#A3E635', '#0C0E12'])
  w.snap(null, { settings: { accent: '#ff5a15', onAccent: '#101010' } })
  assert.deepEqual([w.d().accent, w.d().ink], ['#ff5a15', '#101010'])
  w.snap(null, { settings: { accent: 'red' } })
  assert.deepEqual([w.d().accent, w.d().ink], ['#A3E635', '#0C0E12'])
})

test('Words: the phone\'s language, else the watch\'s, else English', () => {
  const w = mk({ lang: 'fr' })
  assert.equal(V.langOf(w.c, w.ui), 'fr')
  w.snap(null, { settings: { lang: 'de' } })
  assert.equal(V.langOf(w.c, w.ui), 'de')
  w.snap(null, { settings: { lang: 'xx' } })
  assert.equal(V.langOf(w.c, w.ui), 'en')
  w.snap(null, { settings: { lang: 'ar' } })
  assert.equal(V.langOf(w.c, w.ui), 'en') // not drawable by the font, for now
  assert.equal(V.translator('de')('set_of', 2, 4), 'Satz 2 von 4')
  assert.equal(V.translator('de')('no_such_key'), 'no_such_key')
  assert.equal(V.translator('xx')('done'), 'Done')
})

test('Words: the phone leaving settings.lang out of a snapshot does not change the language back', () => {
  const w = mk({ lang: 'fr' })
  w.snap(null, { settings: { lang: 'de' } })
  assert.equal(V.langOf(w.c, w.ui), 'de')
  w.snap(null, { settings: {} }) // cut to fit its size
  assert.equal(V.langOf(w.c, w.ui), 'de')
  w.snap(null, { settings: { lang: 'es' } })
  assert.equal(V.langOf(w.c, w.ui), 'es')
  // and it is kept with the state: a restart before the next snapshot still speaks Spanish
  const v = mk({ lang: 'fr', stored: JSON.parse(JSON.stringify(w.c.s)) })
  assert.equal(V.langOf(v.c, v.ui), 'es')
})

test('deviceLang maps the watch\'s locale onto the app\'s languages', () => {
  const l = (language, countryOrRegion) => V.deviceLang({ language: language, countryOrRegion: countryOrRegion })
  assert.deepEqual([l('de', 'DE'), l('zh', 'CN'), l('zh', 'TW'), l('zh', 'HK'), l('pt', 'BR'), l('pt', 'PT'), l('in', 'ID'), l('xx', ''), l('constructor', '')],
    ['de', 'zh', 'zh-TW', 'zh-TW', 'pt-BR', 'pt', 'id', 'en', 'en'])
  assert.equal(V.deviceLang(null), 'en')
  assert.equal(V.deviceLang({}), 'en')
})

test('the screens speak every language they are given: no key missing, no leftover placeholder', () => {
  Object.keys(TEXTS).forEach(lang => {
    const line = TEXTS[lang].split('\n')
    assert.equal(line.length, KEYS.length, lang)
    line.forEach((w, i) => { assert.ok(w, lang + ' ' + KEYS[i]); assert.doesNotMatch(w, /%\d|\$\d\$|—/, lang + ' ' + KEYS[i]) })
  })
})

test('view.js only asks for words that exist', () => {
  const src = readFileSync(new URL('../entry/src/main/js/MainAbility/common/view.js', import.meta.url), 'utf8')
  const used = [...src.matchAll(/\bt\('([a-z_]+)'/g)].map(m => m[1])
  assert.ok(used.length > 40)
  used.forEach(k => assert.ok(KEYS.indexOf(k) >= 0, k))
})

/* ---------- plumbing ---------- */

test('Every key build() can return is one the page starts with, and none is also a handler', () => {
  const blank = V.blank()
  const keys = {}
  const sweep = w => { const d = w.d(); Object.keys(d).forEach(k => { keys[k] = true; assert.ok(k in blank, k) }) }
  const w1 = mk(); sweep(w1) // idle
  const w2 = ready(null, TODAY(), [{ name: 'B', entries: [] }]); sweep(w2); w2.tap('routines'); sweep(w2); w2.tap('rback'); w2.tap('start'); sweep(w2)
  w2.wait(4); sweep(w2); w2.tap('done'); sweep(w2); w2.wait(2); sweep(w2); w2.tap('menu'); sweep(w2); w2.tap('mOver'); sweep(w2)
  w2.tap('ovBack'); w2.tap('finish'); sweep(w2); w2.tap('yes'); sweep(w2)
  const w3 = mk(); w3.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])], { leftGymAt: T0 - 1 })); w3.wait(10); sweep(w3)
  w3.tap('keep'); w3.tap('done'); sweep(w3)
  const w4 = mk(); w4.snap(act([ent('P', 0, [{ sec: 10 }], { mode: 'time' })])); w4.tap('done'); sweep(w4); w4.wait(4); sweep(w4)
  const w5 = mk(); w5.snap(act([ent('R', 0, [row(null, null)], { mode: 'cardio' })])); sweep(w5)
  const w6 = mk(); w6.snap(act([ent('R', 0, [row(1, 1, { done: true })])])); sweep(w6); w6.tap('ovBack'); sweep(w6)
  const w7 = mk(); w7.snap(act([])); sweep(w7)
  Object.keys(blank).forEach(k => assert.ok(!V.ACTIONS.includes(k), 'data key and handler share a name: ' + k))
  ;['onInit', 'onReady', 'onShow', 'onHide', 'onDestroy', 'data'].forEach(k => assert.ok(!(k in blank) && !V.ACTIONS.includes(k), k))
  SCREENS_SEEN(keys)
})
function SCREENS_SEEN (keys) {
  V.SCREENS.forEach(s => assert.ok(('s_' + s) in keys, s))
}

test('every screen is reached at least once in the sweep above', () => {
  const seen = {}
  const w = ready(null, TODAY(), [{ name: 'B', entries: [] }])
  const mark = () => { seen[w.screen()] = true }
  mark(); w.tap('routines'); mark(); w.tap('rback'); w.tap('start'); mark(); w.wait(4); mark(); w.tap('done'); mark(); w.wait(2); mark()
  w.tap('menu'); mark(); w.tap('mOver'); mark(); w.tap('ovBack'); w.tap('finish'); mark(); w.tap('yes'); mark()
  assert.deepEqual(Object.keys(seen).sort(), ['confirm', 'count', 'idle', 'menu', 'over', 'rest', 'routines', 'set', 'summary'].sort())
})

test('a handler name that is not an action does nothing, and none is an inherited property', () => {
  const w = mk()
  assert.doesNotThrow(() => { V.act(w.c, w.ui, 'constructor'); V.act(w.c, w.ui, 'toString'); V.act(w.c, w.ui, 'nope') })
})

test('the screen stays on only during a rest or a hold, the sensor only while a workout runs', () => {
  const w = mk()
  assert.deepEqual([V.wantAwake(w.c), V.wantHr(w.c)], [false, false])
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  assert.deepEqual([V.wantAwake(w.c), V.wantHr(w.c)], [false, true])
  w.tap('done')
  assert.equal(V.wantAwake(w.c), true)
  w.tap('restSkip')
  w.wait(2); w.tap('restSkip')
  assert.equal(V.wantAwake(w.c), false)
  const v = mk()
  v.snap(act([ent('P', 0, [{ sec: 30 }], { mode: 'time' })]))
  v.tap('done')
  assert.equal(V.wantAwake(v.c), true) // the 3-2-1 before a hold
  v.wait(4)
  assert.equal(V.wantAwake(v.c), true)
  w.tap('finish'); w.tap('yes')
  assert.equal(V.wantHr(w.c), false)
})

test('buzzes: each pair with an intensity is one buzz, long from 200 ms, a 0 pair is a pause', () => {
  assert.deepEqual(V.buzzPlan([[40, 60]]), [[0, 'short']])
  assert.deepEqual(V.buzzPlan([[50, 150]]), [[0, 'short']])
  assert.deepEqual(V.buzzPlan([[100, 250]]), [[0, 'long']])
  assert.deepEqual(V.buzzPlan([[60, 300]]), [[0, 'long']])
  // the double at the end of a rest is two short buzzes: how long 'long' lasts is not documented, and a second one could merge into it
  assert.deepEqual(V.buzzPlan([[100, 400], [0, 200], [100, 400]]), [[0, 'short'], [600, 'short']])
  assert.deepEqual(V.buzzPlan(null), [])
})

test('the heart rate fed to the core: the last reading for 15 s, then none', () => {
  assert.equal(V.bpmNow(120, 1000, 1000), 120)
  assert.equal(V.bpmNow(120, 1000, 16000), 120)
  assert.equal(V.bpmNow(120, 1000, 16001), 0)
  assert.equal(V.bpmNow(0, 1000, 1000), 0)
})

test('numbers: no trailing .0, times as m:ss', () => {
  assert.deepEqual([V.fmtW(60), V.fmtW(62.5), V.fmtW(1.25), V.fmtW(0.1 + 0.2), V.fmtW(null), V.fmtW(60.0)], ['60', '62.5', '1.25', '0.3', '0', '60'])
  assert.deepEqual([V.clock(0), V.clock(5), V.clock(125), V.clock(3600), V.clock(3725), V.clock(-4), V.clock(null)], ['0:00', '0:05', '2:05', '1:00:00', '1:02:05', '0:00', '0:00'])
})


/* ---------- step 1: before a start, the set menu, folders, the Overview ---------- */

const ASKING = { weighIn: true, lastBw: 72.5, checkin: true, checkinDay: '2026-11-24' }
const types = w => w.evs().map(e => e.type)
// rows with set ids, as the phone sends them, for the set menu
const rows = (e, plans) => Object.assign(e, { sets: plans.map((p, k) => Object.assign({ sid: e.id + k }, p)) })

test('Start with the check-in on: three questions, then the weigh-in, then the 3-2-1; both events go with the start', () => {
  const w = ready(null, TODAY(), [], ASKING)
  w.tap('start')
  assert.equal(w.screen(), 'checkin')
  let d = w.d()
  assert.deepEqual([d.title, d.qLabel, d.qLo, d.qHi, d.qStep, d.skipLabel], ['How are you today?', 'Sleep', 'Barely slept', 'Slept like a log', '1/3', 'Skip for today'])
  w.tap('ci4')
  d = w.d()
  assert.deepEqual([d.qLabel, d.qStep], ['Energy', '2/3'])
  w.tap('ci2'); w.tap('ci5')
  assert.equal(w.screen(), 'weighin')
  d = w.d()
  assert.deepEqual([d.title, d.bwNum, d.bwUnit, d.saveLabel, d.skipLabel], ['Body weight', '72.5', 'kg', 'Save & start workout', 'Start without weighing in'])
  w.tap('bwP1'); w.tap('bwP01'); w.tap('bwP01')
  assert.equal(w.d().bwNum, '73.7')
  w.tap('bwM1'); w.tap('bwM01')
  assert.equal(w.d().bwNum, '72.6')
  w.tap('bwSave')
  assert.equal(w.screen(), 'count')
  w.wait(4)
  assert.equal(w.screen(), 'set')
  assert.deepEqual(types(w), ['dailyForm', 'weighIn', 'start'])
  const [form, weigh, start] = w.evs()
  assert.deepEqual([form.sleep, form.energy, form.sore, weigh.w, start.bw], [4, 2, 5, 72.6, 72.6])
})

test('Check-in: Skip for today sends nothing and is not asked again today; back cancels and it is asked again', () => {
  const w = ready(null, TODAY(), [], ASKING)
  w.tap('start'); w.tap('ci3')
  w.tap('ciSkip')
  assert.equal(w.screen(), 'weighin')
  assert.deepEqual(types(w), [])
  w.tap('bwSkip'); w.wait(4)
  assert.deepEqual(types(w), ['start'])
  assert.equal(w.evs()[0].bw, undefined)
  const v = ready(null, TODAY(), [], ASKING)
  v.tap('start'); v.tap('ciBack')
  assert.equal(v.screen(), 'idle')
  assert.deepEqual(types(v), [])
  v.tap('start')
  assert.equal(v.screen(), 'checkin') // asked again
  v.tap('ciSkip'); v.tap('bwCancel')
  assert.equal(v.screen(), 'idle')
  v.tap('start')
  assert.equal(v.screen(), 'weighin') // today's check-in was skipped, only the weigh-in is asked
})

test('Weigh-in: pounds, the grid and the limits; the phone not asking goes straight to the 3-2-1', () => {
  const w = mk()
  w.snap(null, { unit: 'lb', settings: { weighIn: true, lastBw: 160 }, ready: { today: TODAY(), others: [] } })
  w.tap('start')
  assert.deepEqual([w.screen(), w.d().bwNum, w.d().bwUnit], ['weighin', '160', 'lb'])
  for (let i = 0; i < 30; i++) w.tap('bwP1')
  assert.equal(w.d().bwNum, '190')
  const v = ready(null, TODAY())
  v.tap('start')
  assert.equal(v.screen(), 'count')
  const u = ready(null, TODAY(), [], { weighIn: true })
  u.tap('start')
  assert.equal(u.d().bwNum, '70') // no last weight: the core's default
})

test('The 3-2-1 after the flow can be cancelled: nothing starts', () => {
  const w = ready(null, TODAY(), [], ASKING)
  w.tap('start'); w.tap('ciSkip'); w.tap('bwSave')
  assert.equal(w.screen(), 'count')
  w.tap('cancelCount')
  assert.equal(w.screen(), 'idle')
  assert.ok(!w.c.s.w)
  w.tap('start')
  assert.equal(w.screen(), 'weighin')
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

const sid = (e, i) => Object.assign(e, { sets: e.sets.map((r, k) => Object.assign(r, { sid: 's' + i + k })) })

test('Menu: Add set and Remove set follow canAdd and canRemove; Remove asks first', () => {
  const w = mk()
  w.snap(act([sid(ent('Bench', 0, [row(60, 8), row(60, 8)]), 1)], { id: 'w1' }))
  w.tap('menu')
  let d = w.d()
  assert.deepEqual([d.hasAdd, d.hasRemove, d.lAdd, d.lRemove], [true, true, 'Add set', 'Remove set'])
  w.tap('mAdd')
  assert.equal(w.screen(), 'set')
  assert.equal(w.c.s.w.entries[0].sets.length, 3)
  assert.ok(types(w).indexOf('addSet') >= 0)
  w.tap('menu'); w.tap('mRemove')
  assert.equal(w.screen(), 'confirm')
  d = w.d()
  assert.deepEqual([d.title, d.yesLabel, d.noLabel], ['Remove set', 'Remove set', 'Cancel'])
  w.tap('no')
  assert.equal(w.c.s.w.entries[0].sets.length, 3)
  w.tap('menu'); w.tap('mRemove'); w.tap('yes')
  assert.equal(w.c.s.w.entries[0].sets.length, 2)
  assert.equal(types(w).pop(), 'removeSet')
  assert.equal(w.screen(), 'set')
})

test('Menu: no Remove for the only set, for a cardio exercise or while fixing; no Add on cardio', () => {
  const w = mk()
  w.snap(act([sid(ent('Bench', 0, [row(60, 8)]), 1)]))
  w.tap('menu')
  assert.deepEqual([w.d().hasAdd, w.d().hasRemove], [true, false])
  const v = mk()
  v.snap(act([sid(ent('Run', 0, [row(null, null)], { mode: 'cardio' }), 2)]))
  v.tap('menu')
  assert.deepEqual([v.d().hasAdd, v.d().hasRemove], [false, false])
  const u = mk()
  u.snap(act([sid(ent('Bench', 0, [row(60, 8), row(60, 8), row(60, 8)]), 3)]))
  u.tap('done'); u.wait(2)
  u.tap('menu'); u.tap('mPrev')
  assert.equal(u.d().fixing, true)
  u.ui.menu = true // even if the menu were up, a set being fixed offers no add or remove
  assert.deepEqual([u.d().hasAdd, u.d().hasRemove], [false, false])
})

test('Routines: grouped by folder, folder-less first, the folder under the name', () => {
  const o = (n, f) => Object.assign({ name: n, routineIds: [n], entries: [] }, f ? { folder: f } : {})
  const w = ready(null, TODAY(), [o('A', 'Push'), o('B'), o('C', 'Push'), o('D', 'Legs'), o('E')])
  w.tap('routines')
  let d = w.d()
  assert.deepEqual([d.ro0, d.rs0, d.ro1, d.rs1, d.ro2, d.rs2], ['Push day', 'Today', 'B', '', 'E', ''])
  w.tap('rnext')
  d = w.d()
  assert.deepEqual([d.ro0, d.rs0, d.ro1, d.rs1, d.ro2, d.rs2], ['A', 'Push', 'C', 'Push', 'D', 'Legs'])
  w.tap('pick2')
  assert.equal(w.ui.cd.session.name, 'D')
})

test('Overview: a Superset heading above the first of a superset, the phone\'s note read-only', () => {
  const w = mk()
  w.snap(act([ent('A', 0, [row(10, 10)]), ent('B', 1, [row(10, 10)], { group: 'g' }), ent('C', 2, [row(10, 10)], { group: 'g' }), ent('D', 3, [row(10, 10)])], { note: 'Go easy on the knee' }), { settings: { workoutNote: true } })
  w.tap('menu'); w.tap('mOver')
  const d = w.d()
  assert.deepEqual([d.ss0, d.ss1, d.ss2, d.ss3, d.ssLabel], [false, true, false, false, 'Superset'])
  assert.deepEqual([d.noteOn, d.note], [true, 'Go easy on the knee'])
  const v = mk()
  v.snap(act([ent('A', 0, [row(10, 10)])], { note: 'x' }), { settings: {} })
  v.tap('menu'); v.tap('mOver')
  assert.equal(v.d().noteOn, false) // the phone does not use notes
  const u = mk()
  u.snap(act([ent('A', 0, [row(10, 10)])]), { settings: { workoutNote: true } })
  u.tap('menu'); u.tap('mOver')
  assert.equal(u.d().noteOn, false) // nothing to show
})

test('Added weight: a bodyweight exercise says so', () => {
  const w = mk()
  w.snap(act([ent('Dip', 0, [row(10, 10)], { bodyweight: true })]))
  assert.deepEqual([w.d().wNum, w.d().wUnit], ['+10', 'Added weight'])
  const v = mk()
  v.snap(act([ent('Bench', 0, [row(60, 8)])]))
  assert.deepEqual([v.d().wNum, v.d().wUnit], ['60', 'kg'])
})

test('the heart-rate sensor rests after three idle hours and wakes with the next action', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])], { start: T0, activeAt: T0 }))
  assert.equal(V.wantHr(w.c), true)
  w.clk.now += 3 * 3600000 + 1000
  assert.equal(V.wantHr(w.c), false)
  w.tap('wPlus') // a tap on the boxes is no workout action; a set done is
  w.tap('done')
  assert.equal(V.wantHr(w.c), true)
})


/* ---------- the review of step 1: boxes, the pinned remove, the menu on the rest, the lock ---------- */

test('Remove the set that is up: the boxes show the next set\'s plan, and Done logs it', () => {
  const w = mk()
  w.snap(act([rows(ent('a', 0, []), [{ w: 60, r: 8, warmup: true }, { w: 100, r: 5 }, { w: 100, r: 5 }])], { id: 'w1' }))
  assert.deepEqual([w.d().wNum, w.d().rNum], ['60', '8'])
  w.tap('menu'); w.tap('mRemove'); w.tap('yes')
  const d = w.d()
  assert.deepEqual([d.tag, d.wNum, d.rNum], ['Set 1 of 2', '100', '5'])
  w.tap('done')
  const logged = w.evs().filter(e => e.type === 'setDone').map(e => [e.sid, e.w, e.r])
  assert.deepEqual(logged, [['a1', 100, 5]])
})

test('Add a set, or a snapshot that changes the set up: the boxes follow the new plan', () => {
  const w = mk()
  w.snap(act([rows(ent('a', 0, []), [{ w: 60, r: 8 }, { w: 60, r: 8 }])], { id: 'w1' }))
  w.tap('wPlus')
  assert.equal(w.d().wNum, '62.5')
  w.tap('menu'); w.tap('mAdd')
  assert.equal(w.d().wNum, '62.5') // the set up is the same one: the edit stays
  w.snap(act([rows(ent('a', 0, []), [{ w: 70, r: 6 }, { w: 60, r: 8 }])], { id: 'w1' })) // the phone changed the set up
  assert.deepEqual([w.d().wNum, w.d().rNum], ['70', '6'])
})

test('The Remove confirm removes the set it offered; if that set changed under it, nothing is removed and it closes', () => {
  const mkw = () => { const w = mk(); w.snap(act([rows(ent('a', 0, []), [{ w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }])], { id: 'w1' })); return w }
  const w = mkw()
  w.tap('menu'); w.tap('mRemove')
  assert.equal(w.screen(), 'confirm')
  // the phone ticks the set offered (a0) while the confirm is up
  const a = act([rows(ent('a', 0, []), [{ w: 60, r: 8, done: true, at: T0 }, { w: 60, r: 8 }, { w: 60, r: 8 }])], { id: 'w1' })
  w.snap(a)
  assert.notEqual(w.screen(), 'confirm') // it closed by itself
  assert.equal(w.c.s.w.entries[0].sets.length, 3)
  assert.equal(types(w).indexOf('removeSet'), -1)
  // a Yes that arrives anyway removes nothing
  w.ui.confirm = 'remove'
  w.tap('yes')
  assert.equal(w.c.s.w.entries[0].sets.length, 3)
  assert.equal(w.ui.confirm, null)
  // the normal case removes exactly the offered set
  const v = mkw()
  v.tap('menu'); v.tap('mRemove'); v.tap('yes')
  assert.deepEqual(v.c.s.w.entries[0].sets.map(r => r.sid), ['a1', 'a2'])
  assert.equal(v.evs().pop().sid, 'a0')
})

test('The Remove confirm closes when the exercise moved on under it', () => {
  const w = mk()
  w.snap(act([rows(ent('a', 0, []), [{ w: 60, r: 8 }, { w: 60, r: 8 }]), rows(ent('b', 1, []), [{ w: 10, r: 10 }, { w: 10, r: 10 }])], { id: 'w1' }))
  w.tap('menu'); w.tap('mRemove')
  w.c.s.pos = 1 // the watch moved to the next exercise (a tick followed from the phone)
  w.c.g.up += 1
  w.tap('yes')
  assert.deepEqual(w.c.s.w.entries.map(e => e.sets.length), [2, 2])
})

test('Menu from the rest: no Add set or Remove set (the position has moved on)', () => {
  const w = mk()
  w.snap(act([rows(ent('a', 0, []), [{ w: 60, r: 8 }]), rows(ent('b', 1, []), [{ w: 10, r: 10 }, { w: 10, r: 10 }])], { id: 'w1' }))
  w.tap('done'); w.wait(2)
  assert.equal(w.screen(), 'rest')
  w.tap('menu')
  assert.deepEqual([w.d().hasAdd, w.d().hasRemove], [false, false])
  w.tap('mBack'); w.tap('restSkip')
  w.tap('menu')
  assert.deepEqual([w.d().hasAdd, w.d().hasRemove], [true, true]) // from the set page they are offered
})

test('Closing the summary locks for a second by the core\'s own clock, not the wall clock', () => {
  const clk = { now: T0, tick: 5000 }
  const env = { radio: { transmit: () => {} }, now: () => clk.now, tick: () => clk.tick, random: () => 0.5, save: () => {}, today: () => '2026-11-25' }
  const c = K.createCore(env, null)
  const ui = V.newUi('en')
  K.onPhone(c, { v: 1, unit: 'kg', restSec: 90, settings: { weighIn: false }, active: act([ent('Bench', 0, [row(60, 8)])]), ready: null })
  V.act(c, ui, 'finish'); V.act(c, ui, 'yes')
  clk.tick += 2000; clk.now += 2000
  V.act(c, ui, 'close')
  assert.equal(K.locked(c), true)
  clk.tick += 1100
  assert.equal(K.locked(c), false)
})
