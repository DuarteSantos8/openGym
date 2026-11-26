// What every page shares: the link to the phone, the redraw, the lifecycle, the page switch. A page calls
// createGlue(name, fields, after) once at load and keeps what is its own (which screens, its taps, how it starts).
// Glue between Huawei's APIs, the view files (common/view-*.js) and the app (app.js): it decides nothing about what is
// shown or what a tap does. It imports nothing from core.js (a page that did would carry a second copy of it): the core's
// functions come through getApp().data.k(). Each page's bundle holds its own copy of this file, so it costs no extra bytes.
//   name    the page's folder name ('index', 'lift'): pageOf says which page draws the screen that is up
//   fields  the names the page's HML binds: refresh writes only those into the page (each one costs the engine heap)
//   after   after(d, page): the page's own step in refresh, with the data built (the summary's crown)
import router from '@system.router'
import { P2pClient, Message, Builder } from './wearengine.js'
import { createRadio } from './radio.js'
import { tick, build, act, translator, pageOf } from './view-common.js'

// The phone app this watch talks to (wire.md section 4). The package is the phone app's release
// applicationId (a debug phone build is ch.duartesantos.opengym.test: change it to try one).
// The fingerprint is a placeholder until the phone build's signing certificate is registered with
// Huawei: put its SHA-256 here, no colons, and the same pair in config.json's supportLists.
const PHONE_PACKAGE = 'ch.duartesantos.opengym'
const PHONE_FINGERPRINT = 'REPLACE_WITH_SHA256_OF_SIGNING_CERT'
const VERSION_WAIT_MS = 3000 // how long to wait for wearengine.js to learn the service version

const nowMs = function () { return Date.now() } // unsure: Date is not in Huawei's lite docs; check on a real watch

function makeMessage (text) {
  const builder = new Builder()
  builder.setDescription(text) // text goes as the description; setPayload reads 16-bit units
  const message = new Message()
  message.builder = builder
  return message
}

export function createGlue (name, fields, after) {
  // Made at load, as Huawei's own sample does: wearengine.js learns the Wear Engine service version in a callback,
  // and nothing may be sent or registered before it knows (it takes an older path, and a different send call, while
  // `version` is unset). A failing Wear Engine (no phone, a simulator) leaves a client that only fails: the watch
  // then works on its own and queues events.
  let client = {}
  try { client = new P2pClient() } catch (e) { client = {} }
  // A is the app's shared state (app.js), K the core's functions; both are set by init. rx and cb are this page's
  // own radio and redraw: a page only ever clears what it put there itself.
  let A = null
  let K = null
  const own = {}
  fields.forEach(function (k) { own[k] = true })
  const S = { boot: 0, shown: false, left: false, t: null, ticks: 0, reg: 'pending', sum: false, rx: null, cb: null }
  const G = { S: S }

  G.init = function () {
    A = G.A = getApp().data.get()
    K = G.K = getApp().data.k()
    S.t = null
    return K
  }

  // the page's $t, kept until the page is destroyed or boots again: the framework picks the file for the watch's language
  function words (page) {
    return S.t || (S.t = translator(function (path, args) { return args ? page.$t(path, args) : page.$t(path) }))
  }
  G.words = words
  // Only the names the page's HML binds go into the page.
  G.put = function (page, d) {
    Object.keys(d).forEach(function (k) { if (own[k] && page[k] !== d[k]) page[k] = d[k] })
  }

  // The workout is on another page's screen: replace this page with it (once; the app's clock and the radio's callbacks
  // may ask again before the framework has swapped the pages). The core, the clock and the store stay in app.js.
  G.leave = function (to) {
    if (S.left) return
    S.left = true
    try { router.replace({ uri: 'pages/' + to + '/index' }) } catch (e) { S.left = false }
  }

  G.refresh = function (page) {
    const c = A.c
    if (!c) return
    const to = pageOf(c, A.ui)
    if (to !== name) { G.leave(to); return }
    const d = build(c, A.ui, words(page))
    G.put(page, d)
    if (after) after(d, page)
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
        G.refresh(page)
      },
      function (ok) { S.reg = ok ? 'ok' : 'failed' }
    )
  }

  // Only the page that owns the app's redraw may stop the app (a new page may be up before this one is torn down).
  function pause () {
    if (S.rx && A.radio === S.rx) S.rx.stop() // a newer page's receiver is not ours to unregister
    S.reg = 'pending'
    // a page that asked for another is not the app leaving the screen: the next page's show carries on (the sensor, the lock)
    if (S.cb && A.cb === S.cb) { A.cb = null; if (!S.left) A.hide() }
    S.cb = null
  }

  // Shown (again): the receiver, then the app's hello, redraw and clock. The app calls A.cb on each pass of
  // its clock, once a second with sec true.
  G.resume = function (page) {
    if (S.rx) listen(page) // a later page has no radio until its client knows the version (adopt)
    S.cb = A.cb = function (sec) {
      try {
        tick(A.c, A.ui)
        if (sec) {
          S.ticks += 1
          if (S.reg === 'failed' && S.ticks % 10 === 0 && !S.rx.gathering()) listen(page) // the receiver's retry
        }
      } catch (e) { /* the clock keeps going */ }
      G.refresh(page)
    }
    A.show()
  }

  // wearengine.js has no hook for "version known": its own property is polled (unsure: documented nowhere).
  G.whenVersion = function (cb) {
    let waited = 0
    const poll = function () {
      if (client.version !== undefined || typeof client.send !== 'function' || waited >= VERSION_WAIT_MS) { cb(); return }
      waited += 200
      setTimeout(poll, 200)
    }
    poll()
  }

  // This page's own link to the phone: the client's peer and a radio the app's core sends through.
  G.link = function () {
    try {
      client.setPeerPkgName(PHONE_PACKAGE)
      client.setPeerFingerPrint(PHONE_FINGERPRINT)
    } catch (e) { /* the failing client stays failing */ }
    S.rx = A.radio = createRadio(client, makeMessage, nowMs())
  }

  // The app's core is already running (a later page): this page only brings its own link, once its client knows the
  // version. A page whose screen is not up does not link or say hello: it is about to leave.
  G.adopt = function (page) {
    const mine = S.boot
    G.whenVersion(function () {
      if (mine !== S.boot || !A.c || pageOf(A.c, A.ui) !== name) return
      G.link()
      if (S.shown && S.cb) { listen(page); K.launch(A.c) } // hello, as a shown page does
    })
  }

  G.show = function (page) {
    S.shown = true
    S.left = false
    if (A.c) G.resume(page)
  }
  G.hide = function () { S.shown = false; pause() }
  // what this page put in the app goes with it (its radio and redraw); the core, the store and the ui stay
  G.destroy = function () {
    S.shown = false; S.sum = false; S.t = null; S.boot += 1
    pause()
    if (A.radio === S.rx) A.radio = null
    S.rx = null
  }

  // One tap: the view files do it, then the screen is drawn again. An error must not take the page down;
  // the core saves after each change, so nothing already done is lost.
  G.go = function (page, tap) {
    const c = A.c
    if (!c) return
    try { act(c, A.ui, tap); tick(c, A.ui) } catch (e) { /* nothing done, the screen stays */ }
    G.refresh(page)
    A.poke()
  }
  return G
}
