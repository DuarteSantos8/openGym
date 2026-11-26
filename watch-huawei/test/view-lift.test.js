// View tests, the 3-2-1, the set, the hold, the end and cardio cards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dollarT } from './i18n.js'
import { K, V, mk, ent, row, act, grid, fixture, ready, TODAY } from './view-helpers.js'

/* ---------- 3-2-1 ---------- */

test('3-2-1: 3, 2, 1, Go!, then the workout starts by itself; a tap starts it at once', () => {
  const w = ready(null, TODAY())
  w.tap('start')
  const nums = []
  for (let i = 0; i < 4; i++) { nums.push(w.d().big); if (i < 3) w.wait(1) }
  assert.equal(w.d().goOn, true) // Go! is drawn smaller than a number, to stay inside the ring
  assert.equal(w.screen(), 'count')
  assert.equal(w.d().label, 'Start workout')
  w.wait(1) // 4 s: past 3.7
  assert.equal(w.screen(), 'set')
  assert.equal(w.evs()[0].type, 'start')
  const v = ready(null, TODAY())
  v.tap('start'); v.tap('skipCount')
  assert.equal(v.screen(), 'set')
})

test('3-2-1: the ring drains over the three seconds and is empty on Go!', () => {
  const w = ready(null, TODAY())
  w.tap('start')
  const pcts = []
  for (let i = 0; i < 4; i++) { pcts.push(w.d().pct); if (i < 3) w.wait(1) }
  assert.deepEqual(pcts, [100, 67, 33, 0])
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

test('Fixing: a rest that runs on stays in view at the top', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  w.tap('done'); w.wait(2)
  w.tap('menu'); w.tap('mPrev')
  assert.equal(w.screen(), 'set')
  assert.match(w.d().top, /^Rest 1:\d\d/)
})

/* ---------- Set ---------- */

test('Set: the phone\'s workout opens on its own, numbers as the box shows them', () => {
  const w = mk()
  w.snap(fixture().active)
  const d = w.d()
  assert.equal(w.screen(), 'set')
  assert.deepEqual([d.name, d.tag, d.pill, d.wOn, d.wLabel, d.wNum, d.wUnit, d.rNum, d.rLabel, d.last, d.doneLabel],
    ['Barbell Bench Press', 'Set 2 of 2', '2/2 Menu', true, 'WEIGHT', '60', 'KG', '8', 'REPS', 'Last time: 55×8, 57.5×6', 'Done'])
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
  assert.deepEqual([w.d().wNum, w.d().wUnit], ['135', 'LB'])
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
  assert.deepEqual([d.wOn, d.rLabel, d.rNum, d.doneLabel], [false, 'HOLD', '0:45', 'Start hold'])
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

test('Set page: the top is the heart rate alone, red is never the sync state; the Hold keeps the sync line at the foot', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  w.tap('done'); w.wait(100); w.tap('restSkip')
  K.hrSample(w.c, 128); w.wait(1)
  assert.equal(w.screen(), 'set')
  assert.equal(w.c.s.ob.length > 0, true) // something waits to sync
  assert.equal(w.d().top, '128 bpm')
  const h = mk()
  h.snap(act([ent('Plank', 0, [{ sec: 45 }, { sec: 45 }], { mode: 'time' })]))
  h.tap('done'); h.wait(4)
  assert.equal(h.screen(), 'hold')
  K.hrSample(h.c, 128); h.wait(1)
  h.c.g.awayAt = h.clk.now
  assert.deepEqual([h.d().top, h.d().sync], ['128 bpm', 'Phone out of reach'])
})

test('Added weight: a language whose word is too long for the tile gets the plain word', () => {
  const w = mk()
  w.snap(act([ent('Dip', 0, [row(10, 10)], { bodyweight: true })]))
  const lt = V.translator(dollarT('lt-LT'))
  assert.equal(V.build(w.c, w.ui, lt).wLabel, lt('weight').toUpperCase())
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

test('Added weight: a bodyweight exercise says so', () => {
  const w = mk()
  w.snap(act([ent('Dip', 0, [row(10, 10)], { bodyweight: true })]))
  assert.deepEqual([w.d().wNum, w.d().wUnit, w.d().wLabel], ['+10', 'KG', 'ADDED WEIGHT'])
  const v = mk()
  v.snap(act([ent('Bench', 0, [row(60, 8)])]))
  assert.deepEqual([v.d().wNum, v.d().wUnit], ['60', 'KG'])
})
