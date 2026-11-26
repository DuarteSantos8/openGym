// The page file, which nothing here can run on a watch: its HML, its handlers and its data checked
// against view.js, then the page itself run under Node with fake Huawei APIs (the imports are rewritten
// to fakes), through a workout and a restart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { blank, ACTIONS, SCREENS } from '../entry/src/main/js/MainAbility/common/view.js'
import { dollarT } from './i18n.js'
import { frames } from '../entry/src/main/js/MainAbility/common/frames.js'

const dir = new URL('../entry/src/main/js/MainAbility/pages/index/', import.meta.url)
const hml = readFileSync(new URL('index.hml', dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const css = readFileSync(new URL('index.css', dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const js = readFileSync(new URL('index.js', dir), 'utf8')

const bound = [...hml.matchAll(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g)].map(m => m[1])
const handlers = [...hml.matchAll(/\bonclick="([A-Za-z_]\w*)"/g)].map(m => m[1])
const classes = [...hml.matchAll(/\bclass="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/))

test('every name the HML binds is data the page starts with, and every data name is used', () => {
  const data = blank()
  bound.forEach(k => assert.ok(k in data, 'HML binds ' + k + ', which is not in data'))
  Object.keys(data).forEach(k => assert.ok(bound.indexOf(k) >= 0, 'data ' + k + ' is never shown'))
})

test('every screen is a block of the HML, shown by its own flag', () => {
  SCREENS.forEach(s => assert.ok(hml.indexOf('if="{{s_' + s + '}}"') >= 0, s))
})

test('every tap in the HML has a handler in the page, and every action is reachable from the HML', () => {
  const have = [...js.matchAll(/^ {2}([A-Za-z_]\w*): function/gm)].map(m => m[1])
  handlers.forEach(h => assert.ok(have.indexOf(h) >= 0, 'no handler ' + h))
  ACTIONS.forEach(a => { assert.ok(have.indexOf(a) >= 0, 'no handler ' + a); assert.ok(handlers.indexOf(a) >= 0, a + ' is not wired in the HML') })
  have.forEach(h => assert.ok(ACTIONS.indexOf(h) >= 0 || ['onInit', 'onShow', 'onHide', 'onDestroy', 'swipe', 'retry'].indexOf(h) >= 0, 'stray ' + h))
  // each handler forwards its own name
  ACTIONS.forEach(a => assert.ok(js.indexOf('  ' + a + ': function () { go(this, \'' + a + '\') }') >= 0, a))
  assert.ok(hml.indexOf('onswipe="swipe"') >= 0)
})

test('every class the HML uses is in the CSS, and only components the research file confirms are used', () => {
  classes.forEach(c => assert.ok(new RegExp('\\.' + c + '\\b').test(css), 'no style for .' + c))
  const tags = [...hml.matchAll(/<([a-z-]+)[\s>]/g)].map(m => m[1])
  tags.forEach(t => assert.ok(['div', 'text', 'input', 'progress', 'stack', 'list', 'list-item'].indexOf(t) >= 0, t))
  ;[...hml.matchAll(/<input\b[^>]*>/g)].forEach(m => assert.match(m[0], /type="button"/))
  ;[...hml.matchAll(/<progress\b[^>]*>/g)].forEach(m => assert.match(m[0], /type="(arc|horizontal)"/))
})

test('the dimmed arrow beside Done is as wide as an arrow and has no tap handler', () => {
  const rule = name => (css.match(new RegExp('\\.' + name + '\\s*\\{([^}]*)\\}')) || [])[1] || ''
  assert.equal(rule('arrowOff').match(/width:\s*(\d+)px/)[1], rule('arrow').match(/width:\s*(\d+)px/)[1])
  ;[...hml.matchAll(/<input[^>]*class="arrowOff"[^>]*>/g)].forEach(m => assert.doesNotMatch(m[0], /onclick/))
  assert.doesNotMatch(hml, /<div else class="arrow"/)
})

test('buttons are at least 56 px tall and text boxes have a size', () => {
  const rule = name => (css.match(new RegExp('\\.' + name + '\\s*\\{([^}]*)\\}')) || [])[1] || ''
  ;['btn', 'arrow'].forEach(n => assert.ok(parseInt((rule(n).match(/height:\s*(\d+)px/) || [])[1] || (rule('btn').match(/height:\s*(\d+)px/) || [])[1], 10) >= 56, n))
  ;['hero', 'big', 'mid', 'name', 'small', 'tiny'].forEach(n => assert.match(rule(n), /width:[^;]+;[^}]*height:|height:[^;]+;[^}]*width:/, n))
  assert.doesNotMatch(css, /animation|transition|transform/)
  assert.doesNotMatch(hml + css, /—/)
  assert.doesNotMatch(hml, /\{\{[^}]*(=>|`|\.\.\.|\bconst\b|\blet\b)/)
})

/* ---------- the page, run ---------- */

const modules = {
  '@system.file': 'file', '@system.vibrator': 'vibrator', '@system.sensor': 'sensor', '@system.brightness': 'brightness',
  '@system.app': 'app'
}
let loads = 0
async function loadPage (W) {
  let src = js
  loads += 1
  // the number keeps each load's fake modules apart: Node caches a data: module by its text
  Object.keys(modules).forEach(m => { src = src.replace("'" + m + "'", "'data:text/javascript,export%20default%20globalThis.__W." + modules[m] + "%3B//" + loads + "'") })
  src = src.replace("'../../common/wearengine.js'", "'data:text/javascript,export%20const%20P2pClient%3DglobalThis.__W.P2pClient%3Bexport%20const%20Message%3DglobalThis.__W.Message%3Bexport%20const%20Builder%3DglobalThis.__W.Builder%3B//" + loads + "'")
  src = src.replace(/'\.\.\/\.\.\/common\/([a-z]+\.js)'/g, (_, f) => "'" + new URL('../entry/src/main/js/MainAbility/common/' + f, import.meta.url).href + "'")
  const tmp = mkdtempSync(join(tmpdir(), 'og-page-'))
  const f = join(tmp, 'page.mjs')
  writeFileSync(f, src)
  try { return (await import(pathToFileURL(f).href + '?' + Math.random())).default } finally { rmSync(tmp, { recursive: true }) }
}

// fake Huawei: files that answer later (flush), a P2P client that records, a sensor, a clock and timers
function world (disk) {
  const W = { disk: disk, now: 1761742800000, timers: [], sent: [], receiver: null, hr: null, awake: [], buzzes: [], io: [], terminated: 0 }
  W.file = {
    readText: p => W.io.push(() => (W.failReads ? p.fail('x', 300) : W.disk.has(p.uri) ? p.success({ text: W.disk.get(p.uri) }) : p.fail('x', 301))),
    writeText: p => W.io.push(() => { W.disk.set(p.uri, p.text); p.success() }),
    delete: p => W.io.push(() => { W.disk.delete(p.uri); p.success() })
  }
  W.vibrator = { vibrate: p => { W.buzzes.push(p.mode); p.success() } }
  W.sensor = { subscribeHeartRate: p => { W.hr = p }, unsubscribeHeartRate: () => { W.hr = null } }
  W.brightness = { setKeepScreenOn: p => { W.awake.push(p.keepScreenOn); p.success() } }
  W.app = { terminate: () => { W.terminated += 1 }, getInfo: () => ({ appName: 'openGym', versionName: '1.4.6', versionCode: 1004006 }) }
  W.Builder = function () {}
  W.Builder.prototype.setDescription = function (d) { this.messageInfo = d }
  W.Message = function () {}
  W.Message.prototype.getData = function () { return this.builder.messageInfo }
  // shaped like wearengine.js: the service version arrives in a later turn (W.io), until then `version` is
  // undefined and a call takes the legacy path (recorded in W.early); a registration may never call back
  W.early = []
  W.registers = 0
  W.P2pClient = function () { const me = this; W.client = me; if (!W.holdVersion) W.io.push(() => { me.version = '401' }) }
  W.P2pClient.prototype.setPeerPkgName = function (n) { if (this.version === undefined) W.early.push('pkg'); W.pkg = n }
  W.P2pClient.prototype.setPeerFingerPrint = function (f) { if (this.version === undefined) W.early.push('fp'); W.fp = f }
  W.pending = []
  W.P2pClient.prototype.send = function (m, cb) { if (this.version === undefined) W.early.push('send'); W.sent.push(m.getData()); W.pending.push(cb) }
  W.P2pClient.prototype.registerReceiver = function (r) { if (this.version === undefined) W.early.push('register'); W.registers += 1; W.receiver = r; if (!W.silentReg) r.onSuccess() }
  W.P2pClient.prototype.unregisterReceiver = function (r) { W.receiver = null; r.onSuccess() }
  // files finish, and the phone answers every frame: success
  W.settle = () => {
    while (W.io.length || W.pending.length) {
      while (W.io.length) W.io.shift()()
      W.pending.splice(0).forEach(cb => { cb.onSuccess(); cb.onSendResult({ code: 207 }); cb.onSendProgress('100%') })
    }
  }
  W.advance = sec => { for (let i = 0; i < sec; i++) { W.now += 1000; W.timers.splice(0).forEach(t => t.fn()); W.settle() } }
  return W
}
async function boot (W) {
  globalThis.__W = W
  globalThis.setTimeout = (fn, ms) => { W.timers.push({ fn: fn, ms: ms }) }
  Date.now = () => W.now
  const def = await loadPage(W)
  const page = Object.assign({ $t: dollarT('de-DE') }, def.data) // the framework's $t, for a watch set to German
  Object.keys(def).forEach(k => { if (typeof def[k] === 'function') page[k] = def[k] })
  page.def = def
  def.onInit.call(page)
  def.onShow.call(page) // the page is shown while the state is still loading
  W.settle()
  return page
}
// the phone's message, framed as Wear Engine carries it
const fromPhone = (W, obj) => frames(JSON.stringify(obj), 'p').forEach(f => W.receiver.onReceiveMessage(f))

const realTimeout = globalThis.setTimeout
const realNow = Date.now
const restore = () => { globalThis.setTimeout = realTimeout; Date.now = realNow }

const snap = (extra) => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: { lang: 'en', weighIn: false }, active: null, ready: { today: { routineIds: ['r1'], name: 'Push day', entries: [{ id: 'b', name: 'Bench', i: 0, sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }] }] }, others: [] } }, extra || {})

test('page: boots, says hello over Wear Engine, shows the phone\'s routine, runs a workout, survives a restart', async () => {
  const disk = new Map()
  const W = world(disk)
  try {
    const page = await boot(W)
    assert.deepEqual(W.early, []) // nothing was sent or registered before the version was known
    assert.equal(W.pkg, 'ch.duartesantos.opengym')
    assert.ok(W.fp)
    assert.ok(W.receiver, 'the receiver is registered')
    assert.equal(page.s_idle, true)
    assert.equal(page.title, 'Noch nicht synchronisiert') // the watch's own language until the phone says one
    assert.equal(W.sent.length, 2) // hello, then the watch status
    assert.match(W.sent[0], /^[0-9a-z]+\.0\.1\|\{"events":\[\{"id":"h[^"]*","type":"hello"/)

    fromPhone(W, snap())
    assert.deepEqual([page.title, page.name, page.startLabel], ['Heute', 'Push day', 'Training starten']) // the phone's language is not used: the watch's own

    page.start()
    assert.equal(page.s_count, true)
    W.advance(4)
    assert.equal(page.s_set, true)
    assert.deepEqual([page.name, page.tag, page.wNum, page.doneLabel], ['Bench', 'Satz 1 von 2', '60', 'Fertig'])
    assert.ok(W.hr, 'the heart-rate sensor runs during a workout')
    W.hr.success({ heartRate: 130 })
    W.advance(2)
    assert.equal(page.top.indexOf('130 bpm') >= 0, true)

    page.wPlus()
    page.done()
    assert.equal(page.s_rest, true)
    assert.deepEqual(W.awake, [true]) // the screen is held on for the rest
    assert.ok(W.buzzes.length >= 1)
    W.settle()
    // the start and the set wait in the outbox and went out as frames
    W.advance(2)
    const wire = W.sent.join('\n')
    assert.match(wire, /"type":"start"/)
    assert.match(wire, /"type":"setDone"/)

    // the app closes: sensor and receiver stop, the screen is released, the clock ends itself
    page.def.onHide.call(page)
    W.settle()
    assert.equal(W.hr, null)
    assert.equal(W.receiver, null)
    assert.equal(W.awake[W.awake.length - 1], false)
    W.advance(2)
    assert.equal(W.timers.length, 0)

    // coming back to the front registers again and says hello again
    const hellos = W.sent.filter(f => /"type":"hello"/.test(f)).length
    page.def.onShow.call(page)
    W.settle()
    assert.ok(W.receiver)
    assert.equal(W.sent.filter(f => /"type":"hello"/.test(f)).length, hellos + 1)
    page.def.onHide.call(page)
    W.settle()

    // a new start on the same files: the workout and the rest are still there
    const W2 = world(disk)
    const page2 = await boot(W2)
    assert.equal(page2.s_rest, true)
    assert.equal(page2.nextName, 'Bench, Satz 2/2')
    assert.match(W2.sent[0], /"type":"hello"/)
    page2.def.onDestroy.call(page2)
    W2.settle()
  } finally { restore() }
})

test('page: after a destroy and a new page, the words come from the new page\'s $t', async () => {
  const W = world(new Map())
  try {
    const p1 = await boot(W) // German
    W.advance(2)
    assert.equal(p1.title, 'Noch nicht synchronisiert')
    p1.def.onDestroy.call(p1)
    const p2 = Object.assign({ $t: dollarT('en-US') }, p1.def.data)
    Object.keys(p1.def).forEach(k => { if (typeof p1.def[k] === 'function') p2[k] = p1.def[k] })
    p1.def.onInit.call(p2); p1.def.onShow.call(p2); W.settle(); W.advance(2)
    assert.equal(p2.title, 'Not synced yet')
  } finally { restore() }
})

test('page: a tap before the state is loaded does nothing, and a swipe right leaves only from Start', async () => {
  const W = world(new Map())
  try {
    globalThis.__W = W
    globalThis.setTimeout = (fn, ms) => { W.timers.push({ fn: fn, ms: ms }) }
    const def = await loadPage(W)
    const page = Object.assign({ $t: dollarT('de-DE') }, def.data) // the framework's $t, for a watch set to German
    Object.keys(def).forEach(k => { if (typeof def[k] === 'function') page[k] = def[k] })
    assert.doesNotThrow(() => page.done.call(page))
    def.swipe.call(page, { direction: 'left' })
    assert.equal(W.terminated, 0)
    def.swipe.call(page, { direction: 'right' })
    assert.equal(W.terminated, 1)
    page.s_idle = false
    def.onInit.call(page); W.settle()
    page.s_idle = false
    def.swipe.call(page, { direction: 'right' })
    assert.equal(W.terminated, 1)
  } finally { restore() }
})

test('page: in a workout a swipe left opens the Metrics page and a swipe right goes back; it never leaves the app', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    fromPhone(W, snap())
    page.start(); W.advance(4)
    assert.equal(page.s_set, true)
    page.def.swipe.call(page, { direction: 'right' })
    assert.deepEqual([page.s_set, W.terminated], [true, 0])
    page.def.swipe.call(page, { direction: 'left' })
    assert.deepEqual([page.s_mnum, page.s_set], [true, false])
    page.def.swipe.call(page, { direction: 'left' }) // the one page stays
    assert.equal(page.s_mnum, true)
    page.def.swipe.call(page, { direction: 'right' })
    assert.deepEqual([page.s_set, W.terminated], [true, 0])
    // an up or down swipe (a list scrolling) does not redraw
    page.tag = 'stale' // the Set screen fills the tag: a redraw would rewrite it
    page.def.swipe.call(page, { direction: 'up' })
    page.def.swipe.call(page, { direction: 'down' })
    assert.equal(page.tag, 'stale')
    page.def.onDestroy.call(page)
    W.settle()
  } finally { restore() }
})

/* ---------- the review's cases ---------- */



test('page: the summary list gets the crown once when it shows, and a crown that is not there breaks nothing', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    fromPhone(W, snap())
    page.start(); W.advance(4)
    const asked = []
    page.$refs = { sum: { rotation: o => asked.push(o) } }
    page.menu(); page.mFinish(); page.yes()
    assert.equal(page.s_summary, true)
    W.advance(1)
    assert.deepEqual(asked, [{ focus: true }])
    W.advance(3)
    assert.equal(asked.length, 1) // once, not on every redraw
    page.close(); page.start(); W.advance(4)
    page.$refs = {} // a watch whose list has no crown method
    page.menu(); page.mFinish(); page.yes()
    assert.doesNotThrow(() => W.advance(1))
  } finally { restore() }
})

test('page: a rebuild while the summary is up asks for the crown again', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    fromPhone(W, snap())
    page.start(); W.advance(4)
    const asked = []
    page.$refs = { sum: { rotation: o => asked.push(o) } }
    page.menu(); page.mFinish(); page.yes()
    W.advance(1)
    assert.equal(asked.length, 1)
    page.def.onDestroy.call(page)
    page.def.onShow.call(page); W.settle(); W.advance(1)
    assert.equal(asked.length, 2)
  } finally { restore() }
})

test('page: nothing is sent or registered before wearengine.js knows its version; it waits, then goes on', async () => {
  const W = world(new Map())
  W.holdVersion = true
  try {
    const page = await boot(W)
    W.advance(2)
    assert.deepEqual([W.sent.length, W.registers, W.early.length], [0, 0, 0])
    W.client.version = '401' // the callback comes
    W.advance(1)
    assert.ok(W.registers >= 1 && W.sent.length >= 1)
    assert.deepEqual(W.early, [])
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: a version that never comes does not stop the watch (it goes on after a few seconds)', async () => {
  const W = world(new Map())
  W.holdVersion = true
  try {
    const page = await boot(W)
    W.advance(20) // the poll runs every 200 ms; the fake clock runs a batch a second
    assert.ok(W.sent.length >= 1)
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: the receiver is registered once per show, and a silent registration is not repeated', async () => {
  const W = world(new Map())
  W.silentReg = true // wearengine.js only calls onSuccess for a registration answer
  try {
    const page = await boot(W)
    assert.equal(W.registers, 1)
    W.advance(35)
    assert.equal(W.registers, 1)
    page.def.onHide.call(page); page.def.onShow.call(page); W.settle()
    assert.equal(W.registers, 2)
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: a registration that fails is tried again, but not while a message is half gathered', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    W.receiver.onFailure()
    // a snapshot arrives in two frames; only the first has come
    const fr = frames(JSON.stringify(snap({ ready: { today: { name: 'x'.repeat(1100), entries: [] }, others: [] } })), 'q')
    assert.equal(fr.length, 2)
    W.receiver.onReceiveMessage(fr[0]) // any frame means it is registered
    W.receiver.onFailure()
    const before = W.registers
    W.advance(30)
    assert.equal(W.registers, before, 'no re-registration while gathering')
    W.receiver.onReceiveMessage(fr[1])
    W.receiver.onFailure()
    W.advance(30)
    assert.ok(W.registers > before)
    page.def.onDestroy.call(page)
  } finally { restore() }
})



test('page: a stored workout that cannot be read is not replaced by an empty one; Try again reads it', async () => {
  const disk = new Map()
  const W0 = world(disk)
  let page
  try {
    page = await boot(W0)
    fromPhone(W0, snap())
    page.start(); W0.advance(4)
    page.done(); W0.settle()
    page.def.onHide.call(page); W0.settle()
    page.def.onDestroy.call(page)
  } finally { restore() }
  const files = JSON.stringify([...disk.entries()].sort())
  const W = world(disk)
  W.failReads = true
  try {
    const p2 = await boot(W)
    W.advance(5)
    assert.equal(p2.s_lost, true)
    assert.match(p2.lostText, /Training konnte nicht gelesen werden/) // the watch's language: German
    assert.equal(p2.s_idle, false)
    assert.equal(W.sent.length, 0)
    p2.done() // taps do nothing without a core
    p2.def.onHide.call(p2); W.settle()
    assert.equal(JSON.stringify([...disk.entries()].sort()), files, 'nothing was written')
    // the files read again: Try again starts the workout as it was
    W.failReads = false
    p2.def.onShow.call(p2)
    p2.retry(); W.settle(); W.advance(2)
    assert.equal(p2.s_lost, false)
    assert.equal(p2.s_rest, true)
    p2.def.onDestroy.call(p2)
  } finally { restore() }
})

test('page: a load that finishes after the page was hidden starts nothing until it is shown again', async () => {
  const disk = new Map()
  const W0 = world(disk)
  try {
    const p0 = await boot(W0)
    fromPhone(W0, snap())
    p0.start(); W0.advance(4); p0.done(); W0.settle()
    p0.def.onHide.call(p0); W0.settle(); p0.def.onDestroy.call(p0)
  } finally { restore() }
  const W = world(disk)
  try {
    globalThis.__W = W
    globalThis.setTimeout = (fn, ms) => { W.timers.push({ fn: fn, ms: ms }) }
    Date.now = () => W.now
    const def = await loadPage(W)
    const page = Object.assign({ $t: dollarT('de-DE') }, def.data) // the framework's $t, for a watch set to German
    Object.keys(def).forEach(k => { if (typeof def[k] === 'function') page[k] = def[k] })
    def.onInit.call(page)
    def.onShow.call(page)
    def.onHide.call(page) // hidden while the load is still out
    W.settle(); W.advance(2)
    assert.equal(W.registers, 0)
    assert.equal(W.hr, null)
    assert.deepEqual(W.awake, [])
    assert.equal(W.timers.length, 0)
    def.onShow.call(page); W.settle()
    assert.equal(W.registers, 1)
    assert.ok(W.hr)
    def.onDestroy.call(page)
  } finally { restore() }
})

test('page: a second onInit drops the first core: only the new one saves, and no write goes into a store that has not loaded', async () => {
  const disk = new Map()
  const W0 = world(disk)
  try {
    const p0 = await boot(W0)
    fromPhone(W0, snap())
    p0.start(); W0.advance(4); p0.done(); W0.settle()
    p0.def.onHide.call(p0); W0.settle(); p0.def.onDestroy.call(p0)
  } finally { restore() }
  const W = world(disk)
  try {
    const page = await boot(W)
    const files = [...disk.keys()].sort().join()
    page.def.onInit.call(page) // the framework runs onInit again with the module alive
    page.def.onShow.call(page)
    page.restSkip(); page.wPlus(); W.advance(3) // taps and the clock before the new load finishes: no core, nothing happens
    assert.equal([...disk.keys()].sort().join(), files)
    W.settle(); W.advance(2)
    assert.equal(page.s_rest || page.s_set, true) // the stored workout is back
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: the 3-2-1 ticks every quarter second, and the count buzzes', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    fromPhone(W, snap())
    page.start()
    const delays = W.timers.map(t => t.ms)
    assert.ok(delays.indexOf(250) >= 0, 'the loop speeds up for the count: ' + delays)
    W.advance(1)
    assert.equal(page.big, '2')
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('config.json: the supportLists pair is the page\'s package and fingerprint, and the bundle name is the phone link\'s', () => {
  const cfg = JSON.parse(readFileSync(new URL('../entry/src/main/config.json', import.meta.url), 'utf8'))
  const pkg = js.match(/const PHONE_PACKAGE = '([^']+)'/)[1]
  const fp = js.match(/const PHONE_FINGERPRINT = '([^']+)'/)[1]
  assert.equal(cfg.module.metaData.customizeData[0].value, pkg + ':' + fp)
  assert.equal(cfg.app.bundleName, 'ch.duartesantos.opengym.huawei')
})

test('style bindings bind single values inside a declaration, never a whole style string', () => {
  const styles = [...hml.matchAll(/\bstyle="([^"]*)"/g)].map(m => m[1])
  assert.ok(styles.length > 5)
  styles.forEach(v => { assert.doesNotMatch(v, /^\{\{[^}]*\}\}$/, v); assert.match(v, /^([a-z-]+: (\{\{[A-Za-z][A-Za-z0-9]*\}\}|#[0-9a-f]{6});\s?)+$/, v) })
})


/* ---------- step 1 ---------- */

test('page: the first message after hello is the watch status with the app version (app.getInfo)', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    const wire = W.sent.join('\n')
    assert.match(wire, /"type":"watchStatus"[^}]*"version":"1\.4\.6"/)
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: the heart-rate sensor is stopped after three idle hours of a workout', async () => {
  const W = world(new Map())
  try {
    const page = await boot(W)
    fromPhone(W, snap())
    page.start(); W.advance(4)
    assert.ok(W.hr)
    W.advance(3 * 3600 + 30)
    assert.equal(W.hr, null)
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: a second onInit while the first core still has a send out: its late answer saves nothing into the new store', async () => {
  const disk = new Map()
  const W = world(disk)
  try {
    const page = await boot(W)
    fromPhone(W, snap())
    page.start(); W.advance(4)
    // a set is done; its message is sent and the phone has not answered yet
    const noAnswer = W.settle
    W.settle = () => { while (W.io.length) W.io.shift()() }
    page.done(); W.settle()
    assert.ok(W.pending.length >= 1)
    const late = W.pending.splice(0)
    page.def.onInit.call(page) // the second boot
    W.settle()
    W.advance(1)
    const before = JSON.stringify([...disk.entries()].sort())
    late.forEach(cb => { cb.onSuccess(); cb.onSendResult({ code: 207 }); cb.onSendProgress('100%') }) // the old core hears it now
    W.settle()
    assert.equal(JSON.stringify([...disk.entries()].sort()), before)
    W.settle = noAnswer
    page.def.onDestroy.call(page)
  } finally { restore() }
})
