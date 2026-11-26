// View tests, the rest, the menu, the Overview, Still training?, the Metrics page, the confirm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { K, V, T0, mk, ent, row, session, act, fixture, ready, TODAY, started, rows, beat, swipe, live, startedWith } from './view-helpers.js'

/* ---------- Rest ---------- */

test('Rest: the ring empties, +15 and -15 move it, Skip ends it (after the one-second lock)', () => {
  const w = mk()
  w.snap(fixture().active)
  w.c.s.rest = null
  w.tap('done')
  assert.equal(w.screen(), 'rest')
  let d = w.d()
  assert.deepEqual([d.restLabel, d.restTime, d.pct, d.skipLabel, d.locked, d.barOn], ['', '2:00', 100, 'Skip', true, true])
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
  assert.deepEqual([w.d().restLabel, w.d().restTime, w.d().barOn], ['Paused', '0:40', false]) // no bar while paused
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
  assert.deepEqual([d.effortOn, d.c0, d.c1, d.c2, d.c3], [true, '0', '1', '2', '3+'])
  w.tap('chip2')
  d = w.d()
  assert.deepEqual([d.effortOn, d.rateOn, d.ratedText, d.upNext], [false, true, 'RIR 2', 'Up next'])
  assert.equal(d.ratedColor, '#ffd60a') // RIR 2 is yellow
  assert.equal(w.evs().filter(e => e.type === 'setDone').pop().rir, 2)
  const v = mk()
  v.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]), { settings: { effort: 'rpe' } })
  v.tap('done'); v.wait(2)
  assert.deepEqual([v.d().c0, v.d().c1, v.d().c2, v.d().c3], ['10', '9', '8', '<8'])
})

test('Rest: the rating line names the set, and the chips wear the effort colours (Apple\'s)', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]), { settings: { effort: 'rir', accent: '#a3e635', onAccent: '#0c0e12' } })
  w.wait(2); w.tap('done'); w.wait(2)
  const d = w.d()
  assert.deepEqual([d.rateOn, d.effortOn, d.rateLn], [true, true, 'RIR · Bench, set 1/2'])
  assert.deepEqual([d.cc0, d.cc1, d.cc2, d.cc3], ['#bf5af2', '#ff9f0a', '#ffd60a', '#a3e635']) // purple, orange, yellow, the accent: 3+ is easy
  const v = mk()
  v.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]), { settings: { effort: 'rpe' } })
  v.tap('done'); v.wait(2)
  assert.deepEqual([v.d().cc0, v.d().cc1, v.d().cc2, v.d().cc3, v.d().rateLn], ['#bf5af2', '#ff9f0a', '#ffd60a', '#A3E635', 'RPE · Bench, set 1/2'])
})

test('Rest: the chips and Up next show together; the top is the heart rate alone, the sync state is the bottom line', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(62.5, 6)])]), { settings: { effort: 'rir' } })
  w.wait(2); w.tap('done'); w.wait(2)
  K.hrSample(w.c, 128); w.wait(1)
  let d = w.d()
  assert.deepEqual([d.effortOn, d.upNext, d.nextName, d.top, d.sync], [true, 'Up next', 'Bench, set 2/2', '128 bpm', 'Waiting to sync 1'])
  w.c.g.awayAt = w.clk.now
  assert.equal(w.d().sync, 'Phone out of reach (1)')
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
  w.tap('restMinus')
  assert.equal(w.c.s.rest, before) // each tap on its own: a -15 and a +15 that both worked would cancel out
  w.tap('restPlus')
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
  assert.equal(d.yesColor, '#ffffff')
  w.tap('no')
  assert.equal(w.screen(), 'set')
  assert.ok(w.c.s.w)
  w.tap('menu'); w.tap('mDiscard')
  d = w.d()
  assert.deepEqual([d.title, d.yesLabel], ['Discard workout?', 'Discard workout'])
  assert.equal(d.yesColor, '#ff453a')
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
  assert.deepEqual([d.title, d.on0, d.oc0, d.on1, d.oc1, d.ovv2, d.ovMore, d.count, d.ovPaged], ['Push', 'Bench', '1/2', 'Row', '0/1', false, '+3 Exercises', '1 of 3 sets', false])
  assert.equal(d.ovMoreOn, true) // a row that says nothing is not in the list
  assert.equal(V.blank().ovMoreOn, false)
  // the one up has the accent outline; a finished exercise a filled mark
  assert.deepEqual([d.ol0, d.ol1, d.ob0, d.ob1], ['#A3E635', '#1c1c1e', '#2c2c2e', '#2c2c2e'])
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
  assert.equal(w.d().ob0, '#A3E635') // all its sets done: a filled mark
  w.tap('ov0')
  assert.equal(w.screen(), 'over')
  w.tap('ovNext')
  assert.deepEqual([w.d().on0, w.d().oc0, w.d().ovv1], ['E4', '0/1', false])
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

test('Overview: with no routine name the title is the word', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])], { name: '' }))
  w.tap('menu'); w.tap('mOver')
  assert.deepEqual([w.d().title, w.d().ovMoreOn], ['Overview', false])
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
  const queued = w.evs().length
  w.tap('askFinish')
  assert.equal(w.screen(), 'over')
  assert.equal(w.evs().length, queued) // no finish is queued before the lifter confirms
  assert.equal(w.evs().filter(e => e.type === 'stillHere').length, 1) // Finish tells the phone nothing
})

test('Still training?: "Looks like you left the gym"', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8)])], { leftGymAt: T0 - 1000 }))
  w.wait(10)
  assert.equal(w.screen(), 'ask')
  assert.equal(w.d().body, 'Looks like you left the gym')
})

test('Overview: a Superset heading above the first of a superset', () => {
  const w = mk()
  w.snap(act([ent('A', 0, [row(10, 10)]), ent('B', 1, [row(10, 10)], { group: 'g' }), ent('C', 2, [row(10, 10)], { group: 'g' }), ent('D', 3, [row(10, 10)])]))
  w.tap('menu'); w.tap('mOver')
  const d = w.d()
  assert.deepEqual([d.ss0, d.ss1, d.ss2, d.ss3, d.ssLabel], [false, true, false, false, 'Superset'])
})

test('Metrics: a swipe left from the set or the rest opens the page, a swipe right goes back to the workout', () => {
  const w = startedWith()
  swipe(w, 'right')
  assert.equal(w.screen(), 'set') // nothing to go back to
  swipe(w, 'left')
  assert.equal(w.screen(), 'mnum')
  swipe(w, 'left'); assert.equal(w.screen(), 'mnum') // the one page stays
  swipe(w, 'right'); assert.equal(w.screen(), 'set')
  w.tap('done')
  assert.equal(w.screen(), 'rest')
  swipe(w, 'left'); assert.equal(w.screen(), 'mnum')
  swipe(w, 'right'); assert.equal(w.screen(), 'rest')
})

test('Metrics: the back button goes back to the workout', () => {
  const w = startedWith()
  swipe(w, 'left')
  assert.equal(w.screen(), 'mnum')
  w.tap('mpBack'); assert.equal(w.screen(), 'set')
  w.tap('mpBack'); assert.equal(w.screen(), 'set') // nothing to go back to
  w.tap('done')
  swipe(w, 'left')
  w.tap('mpBack'); assert.equal(w.screen(), 'rest')
})

test('Metrics: not from Start, the menu or a confirm; the workout ending closes it', () => {
  const idle = ready(null, TODAY())
  swipe(idle, 'left')
  assert.equal(idle.screen(), 'idle')
  const w = startedWith({ show: { hr: true } })
  w.tap('menu'); swipe(w, 'left'); w.tap('mBack')
  assert.equal(w.screen(), 'set')
  w.tap('menu'); w.tap('mFinish'); swipe(w, 'left'); assert.equal(w.screen(), 'confirm'); w.tap('no') // a confirm stays on top
  assert.equal(w.screen(), 'set')
  swipe(w, 'left'); assert.equal(w.screen(), 'mnum')
  swipe(w, 'right')
  w.tap('finish'); w.tap('yes')
  assert.equal(w.screen(), 'summary')
  w.wait(2); w.tap('close')
  swipe(w, 'right')
  assert.equal(w.screen(), 'idle')
})

test('Metrics numbers: the time, the sets, the volume and the heart rate; the time stands still while paused', () => {
  const w = startedWith()
  w.wait(30)
  swipe(w, 'left')
  let d = w.d()
  assert.deepEqual([d.mTime, d.mSub, d.setsNum, d.setsLabel, d.volNum, d.volLabel, d.mHr, d.hrLine], ['0:30', 'Time', '0/3', 'Sets', '0 kg', 'Volume', '', ''])
  beat(w, 100); beat(w, 140)
  d = w.d()
  assert.deepEqual([d.mHr, d.hrLine], ['140 bpm', '120 avg · 140 max'])
  const p = live([ent('Bench', 0, [row(60, 8, { done: true }), row(60, 8)])], {}, { start: T0 - 600000, pausedAt: T0 - 540000 })
  swipe(p, 'left')
  assert.deepEqual([p.d().mTime, p.d().mSub], ['1:00', 'Paused'])
  p.wait(30)
  assert.equal(p.d().mTime, '1:00')
})
