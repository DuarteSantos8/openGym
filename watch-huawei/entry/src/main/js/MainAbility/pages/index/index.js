// The home page: glue between Huawei's APIs, the screens (common/view-common.js, view-home.js) and the app (app.js).
// The app holds the core, the clock, the sensor and the buzz; this page loads the stored state (the first page of
// a run does), wires the radio and the store, and copies the screen's data into `data` when the app says to. It
// decides nothing about what is shown or what a tap does: the view files do, and have the tests. It imports
// nothing from core.js (a page that did would carry a second copy of it): the core's functions come through
// getApp().data.k(). When the workout is on a screen another page draws (view-common.js pageOf), it switches
// page BEFORE it builds anything: this page's view files have no such screen.
import file from '@system.file'
import app from '@system.app'
import router from '@system.router'
import { P2pClient, Message, Builder } from '../../common/wearengine.js'
import { createRadio } from '../../common/radio.js'
import { createStore } from '../../common/store.js'
import { blank, newUi, tick, build, act, translator, lostData, swipeTo, pageOf, attach } from '../../common/view-common.js'
import { attach as attachHome } from '../../common/view-home.js'

// The phone app this watch talks to (wire.md section 4). The package is the phone app's release
// applicationId (a debug phone build is ch.duartesantos.opengym.test: change it to try one).
// The fingerprint is a placeholder until the phone build's signing certificate is registered with
// Huawei: put its SHA-256 here, no colons, and the same pair in config.json's supportLists.
const PHONE_PACKAGE = 'ch.duartesantos.opengym'
const PHONE_FINGERPRINT = 'REPLACE_WITH_SHA256_OF_SIGNING_CERT'
const VERSION_WAIT_MS = 3000 // how long to wait for wearengine.js to learn the service version

const nowMs = function () { return Date.now() } // unsure: Date is not in Huawei's lite docs; check on a real watch

// Made at module load, as Huawei's own sample does: wearengine.js learns the Wear Engine service version
// in a callback, and nothing may be sent or registered before it knows (it takes an older path, and
// a different send call, while `version` is unset). A failing Wear Engine (no phone, a simulator) leaves
// a client that only fails: the watch then works on its own and queues events.
let client = {}
try { client = new P2pClient() } catch (e) { client = {} }

// What lives while the page does. Module level, like Huawei's own sample: a page's `this` only holds data.
// A is the app's shared state (app.js), K the core's functions.
let A = null
let K = null
// rx and cb are this page's own radio and redraw: a page only ever clears what it put there itself.
const S = { boot: 0, shown: false, left: false, lost: false, t: null, ticks: 0, reg: 'pending', sum: false, rx: null, cb: null }

function makeMessage (text) {
  const builder = new Builder()
  builder.setDescription(text) // text goes as the description; setPayload reads 16-bit units
  const message = new Message()
  message.builder = builder
  return message
}

// The workout is on another page's screen: replace this page with it (once; the app's clock and the radio's callbacks
// may ask again before the framework has swapped the pages). The core, the clock and the store stay in app.js.
function leave (to) {
  if (S.left) return
  S.left = true
  try { router.replace({ uri: 'pages/' + to + '/index' }) } catch (e) { S.left = false }
}

function refresh (page) {
  const c = A.c
  if (!c) return
  const to = pageOf(c, A.ui)
  if (to !== 'index') { leave(to); return }
  const d = build(c, A.ui, words(page))
  Object.keys(d).forEach(function (k) { if (page[k] !== d[k]) page[k] = d[k] })
  // the crown scrolls the summary list: ask for it once when the summary comes up (the list draws a turn later)
  if (d.s_summary !== S.sum) {
    S.sum = d.s_summary
    if (S.sum) setTimeout(function () { try { page.$refs.sum.rotation({ focus: true }) } catch (e) { /* no crown on this watch */ } }, 0)
  }
  A.dev() // the sensor and the screen lock follow the workout
}

// The receiver is registered once per show. Its own success callback may never come (wearengine.js calls
// it only for a registration answer), so a received frame counts as registered too; only an explicit
// failure is tried again, and never while a message is half gathered (registering drops frames).
function listen (page) {
  S.reg = 'pending'
  const rx = S.rx
  rx.listen(
    function (message) {
      if (rx !== S.rx) return // a radio of a page that is gone
      try { K.onPhone(A.c, message); tick(A.c, A.ui) } catch (e) { /* a snapshot the core cannot read must not stop the watch */ }
      refresh(page)
    },
    function (ok) { S.reg = ok ? 'ok' : 'failed' }
  )
}

// Only the page that owns the app's redraw may stop the app (a new page may be up before this one is torn down).
function pause () {
  if (S.rx && A.radio === S.rx) S.rx.stop() // a newer page's receiver is not ours to unregister
  S.reg = 'pending'
  if (S.cb && A.cb === S.cb) { A.cb = null; A.hide() }
  S.cb = null
}

// Shown (again): the receiver, then the app's hello, redraw and clock. The app calls A.cb on each pass of
// its clock, once a second with sec true.
function resume (page) {
  if (S.rx) listen(page) // a later page has no radio until its client knows the version (onInit)
  S.cb = A.cb = function (sec) {
    try {
      tick(A.c, A.ui)
      if (sec) {
        S.ticks += 1
        if (S.reg === 'failed' && S.ticks % 10 === 0 && !S.rx.gathering()) listen(page) // the receiver's retry
      }
    } catch (e) { /* the clock keeps going */ }
    refresh(page)
  }
  A.show()
}

// the page's $t, kept until the page is destroyed or boots again: the framework picks the file for the watch's language
function words (page) {
  return S.t || (S.t = translator(function (path) { return page.$t(path) }))
}

// The stored workout could not be read: say so, make no core, save nothing (the store refuses to).
function showLost (page) {
  S.lost = true
  const d = lostData(words(page))
  Object.keys(d).forEach(function (k) { page[k] = d[k] })
}

// wearengine.js has no hook for "version known": its own property is polled (unsure: documented nowhere).
function whenVersion (cb) {
  let waited = 0
  const poll = function () {
    if (client.version !== undefined || typeof client.send !== 'function' || waited >= VERSION_WAIT_MS) { cb(); return }
    waited += 200
    setTimeout(poll, 200)
  }
  poll()
}

// This page's own link to the phone: the client's peer and a radio the app's core sends through.
function link () {
  try {
    client.setPeerPkgName(PHONE_PACKAGE)
    client.setPeerFingerPrint(PHONE_FINGERPRINT)
  } catch (e) { /* the failing client stays failing */ }
  S.rx = A.radio = createRadio(client, makeMessage, nowMs())
}

function start (page, stored) {
  A.ui = newUi()
  link()
  A.make(stored)
  if (S.shown) resume(page)
}

// Loads the stored state and starts the core: once per app run (the first page, or Try again). It drops
// any older core first: only one core may save into one store. Later pages find the core running and
// only adopt it (onInit): its summary, hold, rest, heart-rate totals and screen state carry on.
function boot (page) {
  S.boot += 1
  S.t = null // the new page's $t, not the old one's
  const mine = S.boot
  A.drop()
  const gen = A.gen
  S.lost = false
  const store = createStore(file) // the app's: it holds no page, so a page's end leaves it be
  A.store = store
  store.load(function (stored, status) {
    if (mine !== S.boot || gen !== A.gen) return
    if (status === 'unreadable') { showLost(page); return }
    whenVersion(function () { if (mine === S.boot && gen === A.gen) start(page, stored) })
  })
}

// One tap: the view files do it, then the screen is drawn again. An error must not take the page down;
// the core saves after each change, so nothing already done is lost.
function go (page, name) {
  const c = A.c
  if (!c) return
  try { act(c, A.ui, name); tick(c, A.ui) } catch (e) { /* nothing done, the screen stays */ }
  refresh(page)
  A.poke()
}

// The names this page's HML binds (a test keeps the list and the HML the same).
const FIELDS = (
  's_lost lostText accent ink retryLabel s_idle title name plan hint canStart startLabel showStart ' +
  'showRoutines routinesLabel top s_routines rv0 ro0 rs0 rv1 ro1 rs1 rv2 ro2 rs2 rPaged gt s_wait menuLabel ' +
  'body s_summary durLabel dur setsLabel setsNum volLabel volNum hrOn hrLine syncOn sync doneLabel'
).split(' ')

export default {
  data: blank(FIELDS),
  onInit: function () {
    A = getApp().data.get()
    K = getApp().data.k()
    attach(K); attachHome(K)
    S.t = null
    if (A.c) { // the app's core is already running: this page only brings its own link, once its client knows the version
      const mine = S.boot
      const page = this
      whenVersion(function () {
        if (mine !== S.boot || !A.c) return
        link()
        if (S.shown && S.cb) { listen(page); K.launch(A.c) } // hello, as a shown page does
      })
    } else boot(this)
  },
  onShow: function () {
    S.shown = true
    S.left = false
    if (A.c) resume(this)
  },
  onHide: function () { S.shown = false; pause() },
  // what this page put in the app goes with it (its radio and redraw); the core, the store and the ui stay
  onDestroy: function () {
    S.shown = false; S.sum = false; S.t = null; S.boot += 1
    pause()
    if (A.radio === S.rx) A.radio = null
    S.rx = null
  },
  retry: function () { boot(this) },
  // Swipe right leaves the app, from the Start screen only: not by accident in the middle of a workout.
  // In a workout a swipe left opens the Metrics page and a swipe right steps back (view-common.js swipeTo).
  swipe: function (e) {
    if (e.direction !== 'left' && e.direction !== 'right') return // a list scrolling is not ours
    if (e.direction === 'right' && (!A.c || this.s_idle)) { app.terminate(); return }
    const c = A.c
    if (!c) return
    try { swipeTo(c, A.ui, e.direction); tick(c, A.ui) } catch (err) { /* the screen stays */ }
    refresh(this)
  },

  start: function () { go(this, 'start') },
  routines: function () { go(this, 'routines') },
  rnext: function () { go(this, 'rnext') },
  rback: function () { go(this, 'rback') },
  pick0: function () { go(this, 'pick0') },
  pick1: function () { go(this, 'pick1') },
  pick2: function () { go(this, 'pick2') },
  menu: function () { go(this, 'menu') },
  close: function () { go(this, 'close') }
}
