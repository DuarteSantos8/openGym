// The lift page. INTERIM: until tasks 10 and 11 split the rest page off it, this page draws every screen of a workout
// (the home page draws Start, the routines, the wait and the summary: view-common.js pageOf). Glue between Huawei's APIs,
// the screens (common/view-*.js) and the app (app.js): it wires this page's radio, adopts the core the home page made,
// and copies the screen's data into `data` when the app says to. It decides nothing about what is shown or what a tap
// does: the view files do, and have the tests. It imports nothing from core.js (a page that did would carry a second
// copy of it): the core's functions come through getApp().data.k(). When the workout is on the home page's screen it
// switches page BEFORE it builds anything: this page's view files have no such screen.
import router from '@system.router'
import { P2pClient, Message, Builder } from '../../common/wearengine.js'
import { createRadio } from '../../common/radio.js'
import { blank, tick, build, act, translator, swipeTo, pageOf, attach } from '../../common/view-common.js'
import { attach as attachLift } from '../../common/view-lift.js'
import { attach as attachRest } from '../../common/view-rest.js'

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
const S = { boot: 0, shown: false, left: false, t: null, ticks: 0, reg: 'pending', rx: null, cb: null }

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
  if (to !== 'lift') { leave(to); return }
  const d = build(c, A.ui, words(page))
  Object.keys(d).forEach(function (k) { if (page[k] !== d[k]) page[k] = d[k] })
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
  's_count label pct accent goOn big s_ask title body ink keepLabel finishLabel s_confirm noLabel yesColor ' +
  'yesLabel s_menu hasPrev lPrev hasOver lOver hasSkip lSkip hasNext lNext lFinish lDiscard lBack s_hold ' +
  'top name tag timeColor time stopLabel sync s_set fixing cancelLabel pill partnerOn partner wOn wLabel ' +
  'wNum wUnit rLabel rNum last prevOn lt locked doneLabel nextOn gt s_rest menuLabel restTime barOn ' +
  'restLabel skipLabel rateOn rateLn effortOn cc0 c0 cc1 c1 cc2 c2 cc3 c3 ratedColor ratedText upNext ' +
  'nextNums nextName s_over count ss0 ssLabel ovv0 ol0 ob0 on0 oc0 ss1 ovv1 ol1 ob1 on1 oc1 ss2 ovv2 ol2 ' +
  'ob2 on2 oc2 ss3 ovv3 ol3 ob3 on3 oc3 ovPaged ovMoreOn ovMore backLabel s_end s_card nextLabel s_mnum ' +
  'mTime mSub mHr hrLine setsLabel setsNum volLabel volNum'
).split(' ')

export default {
  data: blank(FIELDS),
  onInit: function () {
    A = getApp().data.get()
    K = getApp().data.k()
    attach(K)
    attachLift(K); attachRest(K)
    S.t = null
    if (!A.c) { leave('index'); return } // the home page makes the core: a page of its own cannot run without it
    const mine = S.boot
    const page = this
    whenVersion(function () { // this page's own link, once its client knows the version
      if (mine !== S.boot || !A.c) return
      link()
      if (S.shown && S.cb) { listen(page); K.launch(A.c) } // hello, as a shown page does
    })
  },
  onShow: function () {
    S.shown = true
    S.left = false
    if (A.c) resume(this)
  },
  onHide: function () { S.shown = false; pause() },
  // what this page put in the app goes with it (its radio and redraw); the core, the store and the ui stay
  onDestroy: function () {
    S.shown = false; S.t = null; S.boot += 1
    pause()
    if (A.radio === S.rx) A.radio = null
    S.rx = null
  },
  // In a workout a swipe left opens the Metrics page and a swipe right steps back (view-common.js swipeTo). A swipe
  // never leaves the app from here.
  swipe: function (e) {
    if (e.direction !== 'left' && e.direction !== 'right') return // a list scrolling is not ours
    const c = A.c
    if (!c) return
    try { swipeTo(c, A.ui, e.direction); tick(c, A.ui) } catch (err) { /* the screen stays */ }
    refresh(this)
  },

  skipCount: function () { go(this, 'skipCount') },
  cancelCount: function () { go(this, 'cancelCount') },
  done: function () { go(this, 'done') },
  wMinus: function () { go(this, 'wMinus') },
  wPlus: function () { go(this, 'wPlus') },
  rMinus: function () { go(this, 'rMinus') },
  rPlus: function () { go(this, 'rPlus') },
  prev: function () { go(this, 'prev') },
  nextFix: function () { go(this, 'nextFix') },
  cancelFix: function () { go(this, 'cancelFix') },
  menu: function () { go(this, 'menu') },
  restMinus: function () { go(this, 'restMinus') },
  restPlus: function () { go(this, 'restPlus') },
  restSkip: function () { go(this, 'restSkip') },
  chip0: function () { go(this, 'chip0') },
  chip1: function () { go(this, 'chip1') },
  chip2: function () { go(this, 'chip2') },
  chip3: function () { go(this, 'chip3') },
  stopHold: function () { go(this, 'stopHold') },
  mpBack: function () { go(this, 'mpBack') },
  mPrev: function () { go(this, 'mPrev') },
  mOver: function () { go(this, 'mOver') },
  mSkip: function () { go(this, 'mSkip') },
  mNext: function () { go(this, 'mNext') },
  mFinish: function () { go(this, 'mFinish') },
  mDiscard: function () { go(this, 'mDiscard') },
  mBack: function () { go(this, 'mBack') },
  yes: function () { go(this, 'yes') },
  no: function () { go(this, 'no') },
  keep: function () { go(this, 'keep') },
  askFinish: function () { go(this, 'askFinish') },
  ov0: function () { go(this, 'ov0') },
  ov1: function () { go(this, 'ov1') },
  ov2: function () { go(this, 'ov2') },
  ov3: function () { go(this, 'ov3') },
  ovNext: function () { go(this, 'ovNext') },
  ovBack: function () { go(this, 'ovBack') },
  finish: function () { go(this, 'finish') },
  nextEx: function () { go(this, 'nextEx') }
}
