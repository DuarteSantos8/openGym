// View tests, the shared part: words, look, status line, the registry, the tick and the sweeps over every screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FILES, dollarT } from './i18n.js'
import { K, V, T0, mk, ent, row, act, fixture, ready, TODAY } from './view-helpers.js'

test('Overview: the page clamps when the window shrinks', () => {
  const w = mk()
  const es = [0, 1, 2, 3, 4].map(i => ent('E' + i, i, [row(10, 10)]))
  w.snap(act(es))
  w.tap('menu'); w.tap('mOver'); w.tap('ovNext')
  assert.equal(w.ui.op, 1)
  w.snap(act(es.slice(0, 2)))
  assert.equal(w.ui.op, 0)
})

/* ---------- the status line, the look, words ---------- */

test('Status line: heart rate unless the phone hides it, sync only when something waits', () => {
  const w = mk()
  w.snap(fixture().active)
  assert.equal(w.d().top, '')
  K.hrSample(w.c, 128)
  assert.equal(w.d().top, '128 bpm')
  w.tap('done')
  // on the rest the top is the heart rate alone: the sync state is the line at the bottom
  assert.equal(w.d().top, '128 bpm')
  assert.equal(w.d().sync, 'Waiting to sync 1')
  w.c.g.awayAt = w.clk.now
  assert.equal(w.d().sync, 'Phone out of reach (1)')
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

test('Words: $t first, then the English kept in the code, then the key; {0} {1} are filled in', () => {
  const de = V.translator(dollarT('de-DE'))
  assert.equal(de('set_of', 2, 4), 'Satz 2 von 4')
  assert.equal(de('no_such_key'), 'no_such_key')
  const none = V.translator(dollarT('xx-XX')) // a watch language with no file: $t gives undefined
  assert.equal(none('done'), 'Done')
  assert.equal(none('set_of', 2, 4), 'Set 2 of 4')
  assert.equal(V.translator(() => { throw new Error('no $t') })('done'), 'Done')
  assert.equal(V.translator(() => '')('done'), 'Done')
})

test('the screens speak every language they are given: no key missing, no leftover placeholder', () => {
  Object.keys(FILES).forEach(lang => {
    assert.deepEqual(Object.keys(FILES[lang]), Object.keys(FILES['en-US']), lang)
    Object.keys(FILES[lang]).forEach(k => assert.doesNotMatch(FILES[lang][k], /%\d|\$\d\$|—/, lang + ' ' + k))
  })
})

test('the view files only ask for words that exist', () => {
  const src = ['common', 'home', 'lift', 'rest'].map(f => readFileSync(new URL('../entry/src/main/js/MainAbility/common/view-' + f + '.js', import.meta.url), 'utf8')).join('\n')
  const used = [...src.matchAll(/\bt\('([a-z_]+)'/g)].map(m => m[1])
  assert.ok(used.length > 40)
  used.forEach(k => assert.ok(k in FILES['en-US'], k))
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
  assert.deepEqual([K.wantAwake(w.c), K.wantHr(w.c)], [false, false])
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])]))
  assert.deepEqual([K.wantAwake(w.c), K.wantHr(w.c)], [false, true])
  w.tap('done')
  assert.equal(K.wantAwake(w.c), true)
  w.tap('restSkip')
  w.wait(2); w.tap('restSkip')
  assert.equal(K.wantAwake(w.c), false)
  const v = mk()
  v.snap(act([ent('P', 0, [{ sec: 30 }], { mode: 'time' })]))
  v.tap('done')
  assert.equal(K.wantAwake(v.c), true) // the 3-2-1 before a hold
  v.wait(4)
  assert.equal(K.wantAwake(v.c), true)
  w.tap('finish'); w.tap('yes')
  assert.equal(K.wantHr(w.c), false)
})

test('buzzes: each pair with an intensity is one buzz, long from 200 ms, a 0 pair is a pause', () => {
  assert.deepEqual(K.buzzPlan([[40, 60]]), [[0, 'short']])
  assert.deepEqual(K.buzzPlan([[50, 150]]), [[0, 'short']])
  assert.deepEqual(K.buzzPlan([[100, 250]]), [[0, 'long']])
  assert.deepEqual(K.buzzPlan([[60, 300]]), [[0, 'long']])
  // the double at the end of a rest is two short buzzes: how long 'long' lasts is not documented, and a second one could merge into it
  assert.deepEqual(K.buzzPlan([[100, 400], [0, 200], [100, 400]]), [[0, 'short'], [600, 'short']])
  assert.deepEqual(K.buzzPlan(null), [])
})

test('the heart rate fed to the core: the last reading for 15 s, then none', () => {
  assert.equal(K.bpmNow(120, 1000, 1000), 120)
  assert.equal(K.bpmNow(120, 1000, 16000), 120)
  assert.equal(K.bpmNow(120, 1000, 16001), 0)
  assert.equal(K.bpmNow(0, 1000, 1000), 0)
})

test('numbers: no trailing .0, times as m:ss', () => {
  assert.deepEqual([V.fmtW(60), V.fmtW(62.5), V.fmtW(1.25), V.fmtW(0.1 + 0.2), V.fmtW(null), V.fmtW(60.0)], ['60', '62.5', '1.25', '0.3', '0', '60'])
  assert.deepEqual([V.clock(0), V.clock(5), V.clock(125), V.clock(3600), V.clock(3725), V.clock(-4), V.clock(null)], ['0:00', '0:05', '2:05', '1:00:00', '1:02:05', '0:00', '0:00'])
})

test('the heart-rate sensor rests after three idle hours and wakes with the next action', () => {
  const w = mk()
  w.snap(act([ent('Bench', 0, [row(60, 8), row(60, 8)])], { start: T0, activeAt: T0 }))
  assert.equal(K.wantHr(w.c), true)
  w.clk.now += 3 * 3600000 + 1000
  assert.equal(K.wantHr(w.c), false)
  w.tap('wPlus') // a tap on the boxes is no workout action; a set done is
  w.tap('done')
  assert.equal(K.wantHr(w.c), true)
})

test('pageOf: Start, the wait and the summary are the home page; the set, the hold and the 3-2-1 the lift page; the rest, the menu and the confirm the rest page', () => {
  const pages = w => V.pageOf(w.c, w.ui)
  const w = ready(null, TODAY())
  assert.equal(pages(w), 'index') // idle
  w.tap('routines'); assert.equal(pages(w), 'index')
  w.tap('rback'); w.tap('start'); assert.equal(pages(w), 'lift') // the 3-2-1
  w.wait(4); assert.equal(pages(w), 'lift') // the set
  w.tap('done'); assert.equal(pages(w), 'rest')
  w.tap('menu'); assert.equal(pages(w), 'rest')
  w.tap('mFinish'); assert.equal(w.screen(), 'confirm'); assert.equal(pages(w), 'rest')
  w.tap('yes'); assert.equal(pages(w), 'index') // the summary
  const v = ready(null, null, [{ name: 'Legs', routineIds: ['r2'], entries: [] }]); v.tap('start'); v.tap('skipCount')
  assert.equal(v.screen(), 'wait'); assert.equal(pages(v), 'index')
  const x = mk(); x.snap(act([ent('R', 0, [row(null, null)], { mode: 'cardio' })]))
  assert.deepEqual([x.screen(), pages(x)], ['card', 'lift'])
})
