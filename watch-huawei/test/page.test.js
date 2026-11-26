// The page file, which nothing here can run on a watch: its HML, its handlers and its data checked
// against the view files, then the page itself run under Node with fake Huawei APIs (the imports are rewritten
// to fakes), through a workout and a restart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { blank, ACTIONS, SCREENS } from '../entry/src/main/js/MainAbility/common/view-common.js'
import '../entry/src/main/js/MainAbility/common/view-home.js' // each adds its taps to ACTIONS
import '../entry/src/main/js/MainAbility/common/view-lift.js'
import '../entry/src/main/js/MainAbility/common/view-rest.js'
import '../entry/src/main/js/MainAbility/common/view-over.js'
import { dollarT } from './i18n.js'
import { frames } from '../entry/src/main/js/MainAbility/common/frames.js'

// The pages that draw screens: the home page (pages/index), the lift page (the 3-2-1, the set, the hold, all sets done,
// the cardio card) and the rest page (every other screen).
const pagesDir = new URL('../entry/src/main/js/MainAbility/pages/', import.meta.url)
const PG = {}
;['index', 'lift', 'rest', 'over'].forEach(n => {
  const d = new URL(n + '/', pagesDir)
  PG[n] = {
    hml: readFileSync(new URL('index.hml', d), 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
    css: readFileSync(new URL('index.css', d), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    js: readFileSync(new URL('index.js', d), 'utf8')
  }
})
const OWN = { index: ['idle', 'routines', 'wait', 'summary'], lift: ['count', 'hold', 'set', 'end', 'card'], over: ['over'] } // view-common.js PAGE: the screens each page draws, the rest page's are the others (the home page also has its own `lost`)
const hml = PG.index.hml + PG.lift.hml + PG.rest.hml + PG.over.hml
const css = PG.index.css + '\n' + PG.lift.css + '\n' + PG.rest.css + '\n' + PG.over.css
const js = PG.index.js
const names = (page, re) => [...page.hml.matchAll(re)].map(m => m[1])
const boundIn = page => names(page, /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g)
const handlersIn = page => names(page, /\bonclick="([A-Za-z_]\w*)"/g)
const haveIn = page => [...page.js.matchAll(/^ {2}([A-Za-z_]\w*): function/gm)].map(m => m[1])

const fieldsIn = page => page.js.match(/const FIELDS = \(([\s\S]*?)\)\.split/)[1].match(/'([^']*)'/g).map(x => x.slice(1, -1)).join('').split(' ')

test('a page\'s data is exactly the names its HML binds (each name costs the engine heap), and every name is a field the view fills', () => {
  const data = blank()
  Object.keys(PG).forEach(n => {
    const bound = [...new Set(boundIn(PG[n]))].sort()
    assert.deepEqual(fieldsIn(PG[n]).slice().sort(), bound, n)
    bound.forEach(k => assert.ok(k in data, n + ' HML binds ' + k + ', which is not in data'))
    assert.deepEqual(Object.keys(blank(fieldsIn(PG[n]))).sort(), bound, n)
  })
  const all = boundIn(PG.index).concat(boundIn(PG.lift), boundIn(PG.rest), boundIn(PG.over))
  Object.keys(data).forEach(k => assert.ok(all.indexOf(k) >= 0, 'data ' + k + ' is never shown'))
})

test('every screen is a block of the HML of the page that draws it, shown by its own flag', () => {
  SCREENS.forEach(s => {
    const mine = OWN.index.indexOf(s) >= 0 ? 'index' : OWN.lift.indexOf(s) >= 0 ? 'lift' : OWN.over.indexOf(s) >= 0 ? 'over' : 'rest'
    Object.keys(PG).forEach(n => assert.equal(PG[n].hml.indexOf('if="{{s_' + s + '}}"') >= 0, n === mine, s + ' is on the ' + mine + ' page only'))
  })
  assert.ok(PG.index.hml.indexOf('if="{{s_lost}}"') >= 0) // the stored workout that could not be read: the first page's
})

test('every tap in a page\'s HML has a handler in that page, and every action is reachable from some page', () => {
  Object.keys(PG).forEach(n => {
    const p = PG[n]
    const have = haveIn(p)
    handlersIn(p).forEach(h => assert.ok(have.indexOf(h) >= 0, n + ': no handler ' + h))
    have.forEach(h => assert.ok(ACTIONS.indexOf(h) >= 0 || ['onInit', 'onShow', 'onHide', 'onDestroy', 'swipe', 'retry'].indexOf(h) >= 0, n + ': stray ' + h))
    // each handler forwards its own name
    have.filter(h => ACTIONS.indexOf(h) >= 0).forEach(h => assert.ok(p.js.indexOf('  ' + h + ': function () { go(this, \'' + h + '\') }') >= 0, n + ': ' + h))
    assert.equal(p.hml.indexOf('onswipe="swipe"') >= 0, n !== 'over', n) // the Overview has nothing a swipe acts on (view-common.js swipeTo)
  })
  const wired = handlersIn(PG.index).concat(handlersIn(PG.lift), handlersIn(PG.rest), handlersIn(PG.over))
  ACTIONS.forEach(a => assert.ok(wired.indexOf(a) >= 0, a + ' is not wired in the HML of any page'))
})

test('every class a page\'s HML uses is in its CSS, and only components the research file confirms are used', () => {
  Object.keys(PG).forEach(n => {
    const p = PG[n]
    ;[...p.hml.matchAll(/\bclass="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).forEach(c => assert.ok(new RegExp('\\.' + c + '\\b').test(p.css), n + ': no style for .' + c))
    ;[...p.hml.matchAll(/<([a-z-]+)[\s>]/g)].map(m => m[1]).forEach(t => assert.ok(['div', 'text', 'input', 'progress', 'stack', 'list', 'list-item'].indexOf(t) >= 0, t))
    ;[...p.hml.matchAll(/<input\b[^>]*>/g)].forEach(m => assert.match(m[0], /type="button"/))
    ;[...p.hml.matchAll(/<progress\b[^>]*>/g)].forEach(m => assert.match(m[0], /type="(arc|horizontal)"/))
  })
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
  '@system.app': 'app', '@system.router': 'router'
}
const appJs = readFileSync(new URL('../entry/src/main/js/MainAbility/app.js', import.meta.url), 'utf8')
const common = new URL('../entry/src/main/js/MainAbility/common/', import.meta.url)
const glueJs = readFileSync(new URL('page-glue.js', common), 'utf8')
let loads = 0
// The page and the app (app.js) are loaded the way the framework does: the Huawei modules are fakes, the
// page reaches the app through getApp(). The app is made again with each page: a new boot of the watch.
async function loadFrom (src, W) {
  // the number keeps each load's fake modules apart: Node caches a data: module by its text
  const fake = t => {
    Object.keys(modules).forEach(m => { t = t.replace("'" + m + "'", "'data:text/javascript,export%20default%20globalThis.__W." + modules[m] + "%3B//" + loads + "'") })
    t = t.replace(/'(?:\.\.\/\.\.\/common|\.\/common|\.)\/wearengine\.js'/, "'data:text/javascript,export%20const%20P2pClient%3DglobalThis.__W.P2pClient%3Bexport%20const%20Message%3DglobalThis.__W.Message%3Bexport%20const%20Builder%3DglobalThis.__W.Builder%3B//" + loads + "'")
    return t.replace(/'(?:\.\.\/\.\.\/common|\.\/common|\.)\/([a-z-]+\.js)'/g, (_, f) => f === 'page-glue.js' ? "'./glue.mjs'" : "'" + new URL(f, common).href + "'")
  }
  const tmp = mkdtempSync(join(tmpdir(), 'og-page-'))
  const f = join(tmp, 'page.mjs')
  // the page glue is a module of each page's bundle: a copy for each load, with the fakes, as the framework builds it
  writeFileSync(join(tmp, 'glue.mjs'), fake(glueJs))
  writeFileSync(f, fake(src))
  try { return (await import(pathToFileURL(f).href + '?' + Math.random())).default } finally { rmSync(tmp, { recursive: true }) }
}
async function loadPage (W, sameApp, name) {
  loads += 1
  if (!sameApp) {
    const appDef = await loadFrom(appJs, W)
    globalThis.getApp = () => ({ data: appDef.data })
  }
  return loadFrom(PG[name || 'index'].js, W)
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
  W.replaced = [] // the pages the app asked the router for, oldest first
  W.router = { replace: o => { W.replaced.push(o.uri) } }
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
// a second page of the same app (a page switch): the app and its core stay, the page module is new
async function nextPage (W, name) {
  const def = await loadPage(W, true, name)
  const page = Object.assign({ $t: dollarT('de-DE') }, def.data)
  Object.keys(def).forEach(k => { if (typeof def[k] === 'function') page[k] = def[k] })
  page.def = def
  return page
}
// the router replaced the page: what the framework does next. The new page is made, the old one goes (first, unless
// `keep`: then it stays up and the new one is shown beside it), and the new page's client learns its version.
async function follow (W, page, keep) {
  const uri = W.replaced.shift()
  assert.ok(uri, 'the page asked the router for a new page')
  const next = await nextPage(W, uri.split('/')[1])
  if (!keep) { page.def.onHide.call(page); page.def.onDestroy.call(page) }
  next.def.onInit.call(next); next.def.onShow.call(next); W.settle()
  return next
}
// the phone's message, framed as Wear Engine carries it
const fromPhone = (W, obj) => frames(JSON.stringify(obj), 'p').forEach(f => W.receiver.onReceiveMessage(f))

const realTimeout = globalThis.setTimeout
const realNow = Date.now
const restore = () => { globalThis.setTimeout = realTimeout; Date.now = realNow }

const snap = (extra) => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: { lang: 'en', weighIn: false }, active: null, ready: { today: { routineIds: ['r1'], name: 'Push day', entries: [{ id: 'b', name: 'Bench', i: 0, sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }] }] }, others: [] } }, extra || {})

test('page: boots, says hello over Wear Engine, shows the phone\'s routine, runs a workout across the pages, survives a restart', async () => {
  const disk = new Map()
  const W = world(disk)
  try {
    let page = await boot(W)
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

    page.start() // the 3-2-1 is the lift page's screen: the home page switches to it
    assert.deepEqual(W.replaced, ['pages/lift/index'])
    page = await follow(W, page)
    assert.equal(page.s_count, true)
    W.advance(4)
    assert.equal(page.s_set, true)
    assert.deepEqual([page.name, page.tag, page.wNum, page.doneLabel], ['Bench', 'Satz 1 von 2', '60', 'Fertig'])
    assert.ok(W.hr, 'the heart-rate sensor runs during a workout')
    W.hr.success({ heartRate: 130 })
    W.advance(2)
    assert.equal(page.top.indexOf('130 bpm') >= 0, true)

    page.wPlus()
    page.done() // the rest is the rest page's screen
    assert.deepEqual(W.replaced, ['pages/rest/index'])
    page = await follow(W, page)
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
    let page2 = await boot(W2)
    assert.deepEqual(W2.replaced, ['pages/rest/index']) // the home page builds nothing of the rest, it hands over
    assert.equal(page2.s_idle, false)
    page2 = await follow(W2, page2)
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

test('app: its data holds functions only (a state object there died with JS REF LIMIT), and the page gets the core through it', async () => {
  const W = world(new Map())
  try {
    await boot(W)
    const d = globalThis.getApp().data
    assert.deepEqual(Object.keys(d).sort(), ['get', 'k'])
    Object.keys(d).forEach(k => assert.equal(typeof d[k], 'function', k))
    assert.equal(typeof d.k().pressDone, 'function')
    assert.ok(d.get().c, 'the core is the app\'s')
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
    def.onInit.call(page) // the framework starts the page first; its files have not answered yet
    assert.doesNotThrow(() => page.start.call(page))
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
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    assert.equal(page.s_set, true)
    page.def.swipe.call(page, { direction: 'right' })
    assert.deepEqual([page.s_set, W.terminated, W.replaced.length], [true, 0, 0])
    page.def.swipe.call(page, { direction: 'left' }) // the Metrics page is the rest page's
    assert.deepEqual(W.replaced, ['pages/rest/index'])
    page = await follow(W, page)
    assert.deepEqual([page.s_mnum, 's_set' in page], [true, false])
    page.def.swipe.call(page, { direction: 'left' }) // the one page stays
    assert.equal(page.s_mnum, true)
    page.def.swipe.call(page, { direction: 'right' }) // and the set is the lift page's
    assert.deepEqual(W.replaced, ['pages/lift/index'])
    page = await follow(W, page)
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
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    page.menu(); page = await follow(W, page); page.mFinish(); page.yes()
    page = await follow(W, page) // the summary is the home page's
    assert.equal(page.s_summary, true)
    const asked = []
    page.$refs = { sum: { rotation: o => asked.push(o) } }
    W.advance(1)
    assert.deepEqual(asked, [{ focus: true }])
    W.advance(3)
    assert.equal(asked.length, 1) // once, not on every redraw
    page.close(); W.advance(2); fromPhone(W, snap()); page.start(); page = await follow(W, page); W.advance(4)
    page.menu(); page = await follow(W, page); page.mFinish(); page.yes()
    page = await follow(W, page)
    assert.equal(page.s_summary, true)
    page.$refs = {} // a watch whose list has no crown method
    assert.doesNotThrow(() => W.advance(1))
  } finally { restore() }
})

test('page: a rebuild while the summary is up asks for the crown again', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    page.menu(); page = await follow(W, page); page.mFinish(); page.yes()
    page = await follow(W, page)
    const asked = []
    page.$refs = { sum: { rotation: o => asked.push(o) } }
    W.advance(1)
    assert.equal(asked.length, 1)
    // a page switch: the app keeps the core, so the summary is still up on the new page, and the crown is asked for again
    const next = await nextPage(W, 'index')
    page.def.onHide.call(page); page.def.onDestroy.call(page) // the old page goes first
    next.def.onInit.call(next); next.def.onShow.call(next); W.settle(); W.advance(1)
    assert.equal(next.s_summary, true)
    assert.equal(asked.length, 1) // the new page has its own $refs: none yet
    next.$refs = { sum: { rotation: o => asked.push(o) } }
    next.def.onDestroy.call(next)
    const again = await nextPage(W, 'index')
    again.$refs = next.$refs
    again.def.onInit.call(again); again.def.onShow.call(again); W.settle(); W.advance(1)
    assert.equal(again.s_summary, true)
    assert.equal(asked.length, 2)
  } finally { restore() }
})

test('page switch: a rest and the heart-rate totals survive a new page, in either teardown order, and the clock and link keep going', async () => {
  for (const newFirst of [false, true]) {
    const W = world(new Map())
    try {
      let page = await boot(W)
      fromPhone(W, snap())
      page.start(); page = await follow(W, page); W.advance(4)
      W.hr.success({ heartRate: 120 }); W.advance(3)
      page.done(); page = await follow(W, page)
      assert.equal(page.s_rest, true)
      const A = globalThis.getApp().data.get()
      const core = A.c
      const hr = globalThis.getApp().data.k().hrSoFar(core)
      assert.ok(hr, 'heart-rate totals exist')
      const next = await nextPage(W, 'rest')
      const old = page.def
      if (newFirst) { next.def.onInit.call(next); next.def.onShow.call(next); old.onHide.call(page); old.onDestroy.call(page) } else { old.onHide.call(page); old.onDestroy.call(page); next.def.onInit.call(next); next.def.onShow.call(next) }
      W.settle(); W.advance(1) // the new page's client learns its version, then it links
      assert.equal(A.c, core, 'no new core')
      assert.deepEqual(globalThis.getApp().data.k().hrSoFar(A.c), hr)
      assert.equal(next.s_rest, true)
      assert.ok(A.store && A.radio && A.cb, 'the new page is wired: store, radio, redraw')
      const t = W.timers.length
      W.advance(2)
      assert.ok(W.timers.length > 0 || t > 0, 'the clock runs')
      assert.ok(W.hr, 'the sensor still runs')
      assert.ok(W.receiver, 'the new page listens')
      next.restSkip()
      W.advance(1)
      assert.deepEqual(W.replaced, ['pages/lift/index']) // the next set is the lift page's
      W.advance(1)
      next.def.onHide.call(next)
      assert.equal(W.hr, null) // the page that owns the app stops it
    } finally { restore() }
  }
})

test('page switch: a hold survives a new page, in either teardown order', async () => {
  for (const newFirst of [false, true]) {
    const W = world(new Map())
    try {
      let page = await boot(W)
      fromPhone(W, Object.assign(snap(), { ready: { today: { routineIds: ['r1'], name: 'Core', entries: [{ id: 'p', name: 'Plank', i: 0, mode: 'time', sets: [{ sec: 45 }, { sec: 45 }] }] }, others: [] } }))
      page.start(); page = await follow(W, page); W.advance(4)
      page.done(); W.advance(5) // the 3-2-1, then the hold counts
      assert.equal(page.s_hold, true)
      const A = globalThis.getApp().data.get()
      const core = A.c
      const next = await nextPage(W, 'lift')
      const old = page.def
      if (newFirst) { next.def.onInit.call(next); next.def.onShow.call(next); old.onHide.call(page); old.onDestroy.call(page) } else { old.onHide.call(page); old.onDestroy.call(page); next.def.onInit.call(next); next.def.onShow.call(next) }
      W.settle(); W.advance(3)
      assert.equal(A.c, core)
      assert.equal(next.s_hold, true)
      assert.ok(core.g.hold, 'the hold is still running')
      assert.deepEqual(W.awake[W.awake.length - 1], true)
    } finally { restore() }
  }
})

test('page switch: a later page does not register or send before its own client knows the version, and the core and clock do not wait', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    const A = globalThis.getApp().data.get()
    const core = A.c
    W.holdVersion = true // the next page's client does not learn its version yet
    const next = await nextPage(W, 'lift')
    page.def.onHide.call(page); page.def.onDestroy.call(page); W.settle()
    const [regs, sent] = [W.registers, W.sent.length]
    next.def.onInit.call(next); next.def.onShow.call(next); W.settle()
    W.advance(2)
    assert.deepEqual([W.registers, W.sent.length, W.early], [regs, sent, []])
    assert.equal(A.c, core)
    assert.equal(next.s_set, true) // the screen draws and the clock runs meanwhile
    W.holdVersion = false
    W.client.version = '401' // the callback comes
    W.advance(1)
    assert.ok(W.registers > regs, 'registered once the version was known')
    assert.ok(W.sent.slice(sent).join('').indexOf('"type":"hello"') >= 0, 'and said hello')
    assert.deepEqual(W.early, [])
    next.def.onHide.call(next)
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
    page.start(); page = await follow(W0, page); W0.advance(4)
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
    p2.start() // taps do nothing without a core
    p2.def.onHide.call(p2); W.settle()
    assert.equal(JSON.stringify([...disk.entries()].sort()), files, 'nothing was written')
    // the files read again: Try again starts the workout as it was
    W.failReads = false
    p2.def.onShow.call(p2)
    p2.retry(); W.settle(); W.advance(2)
    assert.deepEqual(W.replaced, ['pages/rest/index']) // the workout is back, on the rest, which is not the home page's
    const p3 = await follow(W, p2)
    assert.equal(p3.s_rest, true)
    p3.def.onDestroy.call(p3)
  } finally { restore() }
})

test('page: a load that finishes after the page was hidden starts nothing until it is shown again', async () => {
  const disk = new Map()
  const W0 = world(disk)
  try {
    let p0 = await boot(W0)
    fromPhone(W0, snap())
    p0.start(); p0 = await follow(W0, p0); W0.advance(4); p0.done(); W0.settle()
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

test('page: a second boot (Try again) drops the first core: only the new one saves, and no write goes into a store that has not loaded', async () => {
  const disk = new Map()
  const W0 = world(disk)
  try {
    let p0 = await boot(W0)
    fromPhone(W0, snap())
    p0.start(); p0 = await follow(W0, p0); W0.advance(4); p0.done(); W0.settle()
    p0.def.onHide.call(p0); W0.settle(); p0.def.onDestroy.call(p0)
  } finally { restore() }
  const W = world(disk)
  try {
    const page = await boot(W)
    const files = [...disk.keys()].sort().join()
    page.def.retry.call(page) // Try again: boots once more with the module alive (a later page's onInit adopts the running core instead)
    page.def.onShow.call(page)
    page.start(); page.routines(); W.advance(3) // taps and the clock before the new load finishes: no core, nothing happens
    assert.equal([...disk.keys()].sort().join(), files)
    W.settle(); W.advance(2)
    const A = globalThis.getApp().data.get()
    assert.ok(A.c && A.c.s.w, 'the stored workout is back')
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: the 3-2-1 ticks every quarter second, and the count buzzes', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    page.start()
    const delays = W.timers.map(t => t.ms)
    assert.ok(delays.indexOf(250) >= 0, 'the loop speeds up for the count: ' + delays)
    page = await follow(W, page)
    W.advance(1)
    assert.equal(page.big, '2')
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('config.json: the supportLists pair is the page\'s package and fingerprint, and the bundle name is the phone link\'s', () => {
  const cfg = JSON.parse(readFileSync(new URL('../entry/src/main/config.json', import.meta.url), 'utf8'))
  const pair = glueJs.match(/const PHONE_PACKAGE = '([^']+)'/)[1] + ':' + glueJs.match(/const PHONE_FINGERPRINT = '([^']+)'/)[1]
  assert.equal(cfg.module.metaData.customizeData[0].value, pair)
  Object.keys(PG).forEach(n => assert.doesNotMatch(PG[n].js, /PHONE_FINGERPRINT|PHONE_PACKAGE/, n + ' has no pair of its own: the glue has the one')) // one place
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
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    assert.ok(W.hr)
    W.advance(3 * 3600 + 30)
    assert.equal(W.hr, null)
    page.def.onDestroy.call(page)
  } finally { restore() }
})

test('page: a second boot (Try again) while the first core still has a send out: its late answer saves nothing into the new store', async () => {
  const disk = new Map()
  const W = world(disk)
  try {
    const home = await boot(W)
    fromPhone(W, snap())
    home.start()
    const page = await follow(W, home, true) // the lift page is up beside the home page, which is where Try again is
    W.advance(4)
    // a set is done; its message is sent and the phone has not answered yet
    const noAnswer = W.settle
    W.settle = () => { while (W.io.length) W.io.shift()() }
    page.done(); W.settle()
    assert.ok(W.pending.length >= 1)
    const late = W.pending.splice(0)
    home.def.retry.call(home) // the second boot
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

/* ---------- task 9: the pages switch ---------- */

test('page switch: a page hands over BEFORE it builds a screen it does not own, once, and each page draws only its own', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    assert.equal(page.s_idle, true)
    page.start() // home -> lift: the 3-2-1
    assert.deepEqual(W.replaced, ['pages/lift/index'])
    assert.ok(!page.s_count) // the home page built nothing of the lift page's screen (its view files have none)
    W.advance(2) // the clock asks again before the framework swaps the pages: still one replace
    assert.deepEqual(W.replaced, ['pages/lift/index'])
    page = await follow(W, page)
    assert.equal(page.s_count, true)
    W.advance(3)
    assert.equal(page.s_set, true)
    page.menu() // lift -> rest: the menu
    assert.deepEqual(W.replaced, ['pages/rest/index'])
    page = await follow(W, page)
    page.mFinish(); page.yes() // rest -> home: the summary
    assert.deepEqual(W.replaced, ['pages/index/index'])
    assert.ok(!page.s_summary)
    W.advance(2)
    assert.equal(W.replaced.length, 1)
    page = await follow(W, page)
    assert.equal(page.s_summary, true)
    assert.ok(!page.s_set) // nothing of the old page is left on the new one
  } finally { restore() }
})

test('page switch: the Menu on the home page\'s wait screen opens the menu on the rest page', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap({ ready: { today: { routineIds: ['r2'], name: 'Legs', entries: [] }, others: [] } }))
    page.start(); page = await follow(W, page)
    page.skipCount() // no exercise yet: the watch waits for the phone, which is the home page's screen
    page = await follow(W, page)
    assert.equal(page.s_wait, true)
    page.menu() // the home page's tap: the shared view has it
    assert.deepEqual(W.replaced, ['pages/rest/index'])
    page = await follow(W, page)
    assert.equal(page.s_menu, true)
    page.mBack()
    page = await follow(W, page)
    assert.equal(page.s_wait, true)
  } finally { restore() }
})

test('page switch: a page of its own without the core sends the lifter to the home page, and the rest page does too', async () => {
  const W = world(new Map())
  try {
    await boot(W) // the home page makes the core
    const A = globalThis.getApp().data.get()
    A.drop()
    const lift = await nextPage(W, 'lift')
    lift.def.onInit.call(lift)
    assert.deepEqual(W.replaced, ['pages/index/index'])
    W.replaced.length = 0
    const rest = await nextPage(W, 'rest')
    rest.def.onInit.call(rest)
    assert.deepEqual(W.replaced, ['pages/index/index'])
  } finally { restore() }
})

test('config.json lists the home page first and a folder with an hml, css and js for every page', () => {
  const cfg = JSON.parse(readFileSync(new URL('../entry/src/main/config.json', import.meta.url), 'utf8'))
  assert.deepEqual(cfg.module.js[0].pages, ['pages/index/index', 'pages/lift/index', 'pages/rest/index', 'pages/over/index'])
  cfg.module.js[0].pages.forEach(p => ['js', 'hml', 'css'].forEach(ext => assert.doesNotThrow(() => readFileSync(new URL('../entry/src/main/js/MainAbility/' + p + '.' + ext, import.meta.url)), p + '.' + ext)))
})

/* ---------- task 9, fix round 1 ---------- */

test('a page keeps only the names it declared: the screens\' other flags and fields are not written into it', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    let name = 'index'
    const stray = () => Object.keys(page).filter(k => ['$t', '$refs', 'def'].indexOf(k) < 0 && typeof page[k] !== 'function' && fieldsIn(PG[name]).indexOf(k) < 0)
    assert.deepEqual(stray(), [])
    page.start(); page = await follow(W, page); name = 'lift'; W.advance(4)
    assert.equal(page.s_set, true)
    assert.deepEqual(stray(), []) // no s_count or s_summary on the lift page
    assert.equal('s_idle' in page, false)
    page.done(); page = await follow(W, page); name = 'rest'
    assert.equal(page.s_rest, true)
    assert.deepEqual(stray(), []) // and none of the lift page's on the rest page
    assert.equal('s_set' in page, false)
  } finally { restore() }
})

test('a page that is about to leave neither links nor says hello', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    const [regs, sent] = [W.registers, W.sent.length]
    const home = await nextPage(W, 'index') // a home page made while the workout is on the lift page's screen
    page.def.onHide.call(page); page.def.onDestroy.call(page)
    home.def.onInit.call(home); home.def.onShow.call(home); W.settle(); W.advance(2)
    assert.deepEqual([W.registers, W.sent.length], [regs, sent])
    assert.equal(globalThis.getApp().data.get().radio, null)
    assert.deepEqual(W.replaced, ['pages/lift/index'])
  } finally { restore() }
})

/* ---------- the over page ---------- */

test('page switch: the Overview is the over page\'s; Continue and Finish go back across pages', async () => {
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    page.start(); page = await follow(W, page); W.advance(4)
    page.done(); page = await follow(W, page) // the rest
    page.menu(); page.mOver()
    assert.deepEqual(W.replaced, ['pages/over/index'])
    page = await follow(W, page)
    assert.equal(page.s_over, true)
    assert.equal(page.on0, 'Bench')
    assert.equal('s_rest' in page, false)
    page.ovBack() // the rest is still running: back to the rest page
    assert.deepEqual(W.replaced, ['pages/rest/index'])
    page = await follow(W, page)
    assert.equal(page.s_rest, true)
    page.menu(); page.mOver(); page = await follow(W, page)
    page.finish() // the confirm is the rest page's
    assert.deepEqual(W.replaced, ['pages/rest/index'])
    page = await follow(W, page)
    assert.equal(page.s_confirm, true)
    page.yes()
    page = await follow(W, page)
    assert.equal(page.s_summary, true)
  } finally { restore() }
})

// A function a page made, kept by the app, holds that page's whole bundle in the engine heap after the page is gone
// (the simulator ran out of heap at the first page switch while the store the home page made sat in A.store). So once a
// page is destroyed, nothing the app's state reaches may be a function from a file only the pages load.
const MA = new URL('../entry/src/main/js/MainAbility/', import.meta.url)
const appFiles = (file, seen) => {
  if (seen.indexOf(file) >= 0) return seen
  seen.push(file)
  readFileSync(new URL(file, MA), 'utf8').replace(/^import [^'\n]*'(\.[^']+)'/gm, (m, spec) => { appFiles(new URL(spec, new URL(file, MA)).href.slice(MA.href.length), seen) })
  return seen
}
const inApp = appFiles('app.js', [])
const pageOnly = ['pages/index/index.js', 'pages/lift/index.js', 'pages/rest/index.js', 'pages/over/index.js']
  .reduce((all, p) => appFiles(p, all), []).filter(f => inApp.indexOf(f) < 0)
const srcOf = files => files.map(f => readFileSync(new URL(f, MA), 'utf8')).join('\n')
const appSrc = srcOf(inApp)
const pageSrc = srcOf(pageOnly)
const pageFunctionsIn = (root) => {
  const seen = new Set()
  const out = []
  const visit = (v, path) => {
    if (!v || (typeof v !== 'object' && typeof v !== 'function') || seen.has(v)) return
    seen.add(v)
    if (typeof v === 'function') { const s = v.toString(); if (pageSrc.indexOf(s) >= 0 && appSrc.indexOf(s) < 0) out.push(path) }
    Object.keys(v).forEach(k => visit(v[k], path + '.' + k))
  }
  visit(root, 'A')
  return out
}
// the router asked for a new page: the old one is hidden and destroyed (the framework's order), nothing new is up yet
const tearDown = (W, page) => { const uri = W.replaced.shift(); page.def.onHide.call(page); page.def.onDestroy.call(page); return uri.split('/')[1] }

test('page switch: a destroyed page leaves no function of its own in the app (it would keep the page\'s code in the heap)', async () => {
  assert.ok(pageOnly.indexOf('common/page-glue.js') >= 0 && inApp.indexOf('common/core.js') >= 0)
  const W = world(new Map())
  try {
    let page = await boot(W)
    fromPhone(W, snap())
    const A = globalThis.getApp().data.get()
    page.start()
    for (const tap of ['done', 'restSkip', 'menu']) {
      const to = tearDown(W, page)
      assert.deepEqual(pageFunctionsIn(A), [], 'after the ' + to + ' switch')
      page = await nextPage(W, to)
      page.def.onInit.call(page); page.def.onShow.call(page); W.settle(); W.advance(4)
      page[tap]()
      if (!W.replaced.length) W.advance(1)
    }
  } finally { restore() }
})
