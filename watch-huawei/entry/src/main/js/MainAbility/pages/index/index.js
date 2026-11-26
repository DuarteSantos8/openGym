// The page: glue between Huawei's APIs, the core (common/core.js) and the screens (common/view.js).
// It loads the stored state, makes the core, wires the radio and the store, and once a second runs
// the core's clock and copies the screen's data into `data`. It decides nothing about what is shown
// or what a tap does: view.js does, and has the tests.
import file from '@system.file'
import vibrator from '@system.vibrator'
import sensor from '@system.sensor'
import brightness from '@system.brightness'
import app from '@system.app'
import { P2pClient, Message, Builder } from '../../common/wearengine.js'
import { createCore, launch, stop, second, countTick, onPhone, hrSample } from '../../common/core.js'
import { createRadio } from '../../common/radio.js'
import { createStore } from '../../common/store.js'
import { blank, newUi, tick, build, act, translator, lostData, wantHr, wantAwake, buzzPlan, bpmNow, swipeTo } from '../../common/view.js'

// The phone app this watch talks to (wire.md section 4). The package is the phone app's release
// applicationId (a debug phone build is ch.duartesantos.opengym.test: change it to try one).
// The fingerprint is a placeholder until the phone build's signing certificate is registered with
// Huawei: put its SHA-256 here, no colons, and the same pair in config.json's supportLists.
const PHONE_PACKAGE = 'ch.duartesantos.opengym'
const PHONE_FINGERPRINT = 'REPLACE_WITH_SHA256_OF_SIGNING_CERT'
const VERSION_WAIT_MS = 3000 // how long to wait for wearengine.js to learn the service version

const noop = function () {}
const nowMs = function () { return Date.now() } // unsure: Date is not in Huawei's lite docs; check on a real watch
// No env.tick (a monotonic clock) for the core: nothing in Huawei's lite docs gives one, so durations
// use the watch clock, as core.js falls back to.

// Made at module load, as Huawei's own sample does: wearengine.js learns the Wear Engine service version
// in a callback, and nothing may be sent or registered before it knows (it takes an older path, and
// a different send call, while `version` is unset). A failing Wear Engine (no phone, a simulator) leaves
// a client that only fails: the watch then works on its own and queues events.
let client = {}
try { client = new P2pClient() } catch (e) { client = {} }

// What lives while the page does. Module level, like Huawei's own sample: a page's `this` only holds data.
const S = { boot: 0, shown: false, lost: false, core: null, ui: null, store: null, radio: null, t: null, loop: 0, ticks: 0, lastSec: 0, fast: false, reg: 'pending', sum: false, hr: false, bpm: 0, bpmAt: 0, awake: false }

function makeMessage (text) {
  const builder = new Builder()
  builder.setDescription(text) // text goes as the description; setPayload reads 16-bit units
  const message = new Message()
  message.builder = builder
  return message
}

// The watch has two buzzes. view.js turns each pattern of the core into [delay, mode] steps.
function buzz (pattern) {
  buzzPlan(pattern).forEach(function (step) {
    const go = function () {
      try { vibrator.vibrate({ mode: step[1], success: noop, fail: noop }) } catch (e) { /* no motor */ }
    }
    if (step[0] > 0) setTimeout(go, step[0]); else go()
  })
}

function startHr () {
  S.bpm = 0
  try {
    sensor.subscribeHeartRate({
      success: function (ret) { S.bpm = ret && ret.heartRate > 0 ? ret.heartRate : 0; S.bpmAt = nowMs() },
      fail: function () { S.bpm = 0 } // no permission or no sensor: the core just has no heart rate
    })
  } catch (e) { S.bpm = 0 }
}
function stopHr () {
  try { sensor.unsubscribeHeartRate() } catch (e) { /* it was not on */ }
  S.bpm = 0
}
function keepOn (on) {
  try { brightness.setKeepScreenOn({ keepScreenOn: on, success: noop, fail: noop }) } catch (e) { /* the screen sleeps as it does */ }
}

// The sensor and the screen follow the workout: on only when the core wants them.
function devices (c) {
  const hr = wantHr(c)
  if (hr !== S.hr) { S.hr = hr; if (hr) startHr(); else stopHr() }
  const awake = wantAwake(c)
  if (awake !== S.awake) { S.awake = awake; keepOn(awake) }
}

function refresh (page) {
  const c = S.core
  if (!c) return
  const d = build(c, S.ui, words(page))
  Object.keys(d).forEach(function (k) { if (page[k] !== d[k]) page[k] = d[k] })
  // the crown scrolls the summary list: ask for it once when the summary comes up (the list draws a turn later)
  if (d.s_summary !== S.sum) {
    S.sum = d.s_summary
    if (S.sum) setTimeout(function () { try { page.$refs.sum.rotation({ focus: true }) } catch (e) { /* no crown on this watch */ } }, 0)
  }
  devices(c)
}

// The receiver is registered once per show. Its own success callback may never come (wearengine.js calls
// it only for a registration answer), so a received frame counts as registered too; only an explicit
// failure is tried again, and never while a message is half gathered (registering drops frames).
function listen (page) {
  S.reg = 'pending'
  S.radio.listen(
    function (message) {
      try { onPhone(S.core, message); tick(S.core, S.ui) } catch (e) { /* a snapshot the core cannot read must not stop the watch */ }
      refresh(page)
    },
    function (ok) { S.reg = ok ? 'ok' : 'failed' }
  )
}

// The clock. Once a second: the heart rate, the core's second(), the store's retry, the receiver's retry.
// While a 3-2-1 is up it ticks every 250 ms, and only the count moves between seconds. A page that was
// hidden or destroyed bumps S.loop and its timer ends itself.
const isCounting = function () { return !!S.ui.cd || S.core.g.hcd != null }
function loop (page) {
  const mine = S.loop
  const counting = isCounting()
  S.fast = counting
  setTimeout(function () {
    if (mine !== S.loop) return
    const c = S.core
    try {
      const now = nowMs()
      if (now - S.lastSec >= 900) {
        S.lastSec = now
        hrSample(c, bpmNow(S.bpm, S.bpmAt, now)) // the sensor reports every 5 s: the last reading stands for up to 15 s
        second(c)
        S.ticks += 1
        if (S.store.failed) S.store.save(c.s) // a save that did not make it is tried again
        if (S.reg === 'failed' && S.ticks % 10 === 0 && !S.radio.gathering()) listen(page)
      } else countTick(c)
      tick(c, S.ui)
    } catch (e) { /* the clock keeps going */ }
    refresh(page)
    loop(page)
  }, counting ? 250 : 1000)
}

function pause () {
  S.loop += 1
  if (S.hr) { S.hr = false; stopHr() }
  if (S.awake) { S.awake = false; keepOn(false) }
  if (S.radio) S.radio.stop()
  S.reg = 'pending'
  if (S.core && S.store) S.store.save(S.core.s) // the store skips it when nothing changed
}

// Shown (again): the receiver, a hello, the clock.
function resume (page) {
  S.loop += 1
  listen(page)
  launch(S.core) // hello, and the watch's version when it is due
  refresh(page)
  loop(page)
}

// The app's own version for the phone's watch list: documented @system.app getInfo().versionName.
function appVersion () {
  try { return String(app.getInfo().versionName || '') } catch (e) { return '' }
}

// the page's $t, read once: the framework picks the file for the watch's language
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

function start (page, stored, mine) {
  S.ui = newUi()
  try {
    client.setPeerPkgName(PHONE_PACKAGE)
    client.setPeerFingerPrint(PHONE_FINGERPRINT)
  } catch (e) { /* the failing client stays failing */ }
  S.radio = createRadio(client, makeMessage, nowMs())
  S.core = createCore({
    radio: S.radio,
    now: nowMs,
    random: Math.random,
    version: appVersion(),
    // only this boot's core may save (a late callback of an older one must not write over the new store)
    save: function (state) { if (mine === S.boot && S.store) S.store.save(state) },
    buzz: buzz
  }, stored)
  if (S.shown) resume(page)
}

// Loads the stored state and starts the core. A second boot (the page's onInit again, or Try again)
// drops the first one's core and loop first: only one core may save into one store.
function boot (page) {
  S.boot += 1
  const mine = S.boot
  S.loop += 1
  if (S.core) stop(S.core) // the old core sends and saves nothing more
  S.core = null
  S.lost = false
  S.store = createStore(file)
  S.store.load(function (stored, status) {
    if (mine !== S.boot) return
    if (status === 'unreadable') { showLost(page); return }
    whenVersion(function () { if (mine === S.boot) start(page, stored, mine) })
  })
}

// One tap: view.js does it, then the screen is drawn again. An error must not take the page down;
// the core saves after each change, so nothing already done is lost.
function go (page, name) {
  const c = S.core
  if (!c) return
  try { act(c, S.ui, name); tick(c, S.ui) } catch (e) { /* nothing done, the screen stays */ }
  refresh(page)
  if (isCounting() && !S.fast && S.shown) { S.loop += 1; loop(page) } // a 3-2-1 just began: do not wait out a slow tick
}

export default {
  data: blank(),
  onInit: function () { boot(this) },
  onShow: function () {
    S.shown = true
    if (S.core) resume(this)
  },
  onHide: function () { S.shown = false; pause() },
  onDestroy: function () { S.shown = false; S.sum = false; S.boot += 1; pause() },
  retry: function () { boot(this) },
  // Swipe right leaves the app, from the Start screen only: not by accident in the middle of a workout.
  // In a workout a swipe left opens the Metrics page and a swipe right steps back (view.js swipeTo).
  swipe: function (e) {
    if (e.direction !== 'left' && e.direction !== 'right') return // a list scrolling is not ours
    if (e.direction === 'right' && (!S.core || this.s_idle)) { app.terminate(); return }
    const c = S.core
    if (!c) return
    try { swipeTo(c, S.ui, e.direction); tick(c, S.ui) } catch (err) { /* the screen stays */ }
    refresh(this)
  },

  start: function () { go(this, 'start') },
  routines: function () { go(this, 'routines') },
  rnext: function () { go(this, 'rnext') },
  rback: function () { go(this, 'rback') },
  pick0: function () { go(this, 'pick0') },
  pick1: function () { go(this, 'pick1') },
  pick2: function () { go(this, 'pick2') },
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
  nextEx: function () { go(this, 'nextEx') },
  close: function () { go(this, 'close') }
}
