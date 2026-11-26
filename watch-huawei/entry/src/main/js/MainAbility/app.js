// The app: the one copy of the core (common/core.js) and what must outlive a page: the clock, the
// heart-rate sensor, the buzz and keep-screen-on. A page reaches it with getApp().data.get() (the shared
// state A) and .k() (the core's functions); it imports nothing from core.js, or it would carry its own copy.
// `data` holds functions only: a state object there died with JS REF LIMIT (split-design.md section 8), so A
// lives in this module and `get` returns it.
//
// A.c      the core, made by A.make(stored)        A.ui     the screen-only state (view-common.js newUi), set by the page
// A.store  the store (saves c.s), made here by A.newStore   A.radio  the page's radio (frames over Wear Engine)
// A.cb     the page's redraw, called as cb(sec): sec is true on the once-a-second pass. The page sets it on
//          show and clears it on hide; A.radio is cleared on destroy. A page clears only what it set itself.
// Nothing a page made may stay in A after the page is gone: one of its functions keeps all its code in the heap.
import vibrator from '@system.vibrator'
import sensor from '@system.sensor'
import brightness from '@system.brightness'
import app from '@system.app'
import file from '@system.file'
import { createStore } from './common/store.js'
import * as K from './common/core.js'

const noop = function () {}
const nowMs = function () { return Date.now() } // unsure: Date is not in Huawei's lite docs; check on a real watch
// No env.tick (a monotonic clock) for the core: nothing in Huawei's lite docs gives one, so durations
// use the watch clock, as core.js falls back to.

const A = { c: null, ui: null, store: null, radio: null, cb: null, gen: 0 }
// gen: which core may save; loop: which clock may run; on: a page is shown; fast: the clock is on its 250 ms beat
const L = { gen: 0, loop: 0, on: false, lastSec: 0, fast: false, hr: false, bpm: 0, bpmAt: 0, awake: false }

// The watch has two buzzes. core.js buzzPlan turns each pattern of the core into [delay, mode] steps.
function buzz (pattern) {
  K.buzzPlan(pattern).forEach(function (step) {
    const go = function () {
      try { vibrator.vibrate({ mode: step[1], success: noop, fail: noop }) } catch (e) { /* no motor */ }
    }
    if (step[0] > 0) setTimeout(go, step[0]); else go()
  })
}

function startHr () {
  L.bpm = 0
  try {
    sensor.subscribeHeartRate({
      success: function (ret) { L.bpm = ret && ret.heartRate > 0 ? ret.heartRate : 0; L.bpmAt = nowMs() },
      fail: function () { L.bpm = 0 } // no permission or no sensor: the core just has no heart rate
    })
  } catch (e) { L.bpm = 0 }
}
function stopHr () {
  try { sensor.unsubscribeHeartRate() } catch (e) { /* it was not on */ }
  L.bpm = 0
}
function keepOn (on) {
  try { brightness.setKeepScreenOn({ keepScreenOn: on, success: noop, fail: noop }) } catch (e) { /* the screen sleeps as it does */ }
}

// The sensor and the screen follow the workout: on only when the core wants them.
function devices () {
  const c = A.c
  if (!c) return
  const hr = K.wantHr(c)
  if (hr !== L.hr) { L.hr = hr; if (hr) startHr(); else stopHr() }
  const awake = K.wantAwake(c)
  if (awake !== L.awake) { L.awake = awake; keepOn(awake) }
}

// The app's own version for the phone's watch list: documented @system.app getInfo().versionName.
function appVersion () {
  try { return String(app.getInfo().versionName || '') } catch (e) { return '' }
}

const isCounting = function () { return !!(A.ui && A.ui.cd) || (!!A.c && A.c.g.hcd != null) }

// The clock. Once a second: the heart rate, the core's second(), the store's retry. While a 3-2-1 is up it
// ticks every 250 ms, and only the count moves between seconds. The page redraws through A.cb. A.hide and
// A.drop bump L.loop, and the timer of an older loop ends itself.
function loop () {
  const mine = L.loop
  const counting = isCounting()
  L.fast = counting
  setTimeout(function () {
    if (mine !== L.loop) return
    const c = A.c
    let sec = false
    try {
      const now = nowMs()
      if (now - L.lastSec >= 900) {
        L.lastSec = now
        sec = true
        K.hrSample(c, K.bpmNow(L.bpm, L.bpmAt, now)) // the sensor reports every 5 s: the last reading stands for up to 15 s
        K.second(c)
        if (A.store && A.store.failed) A.store.save(c.s) // a save that did not make it is tried again
      } else K.countTick(c)
    } catch (e) { /* the clock keeps going */ }
    if (A.cb) A.cb(sec)
    devices()
    loop()
  }, counting ? 250 : 1000)
}

// The core of a stored state. Only this core may save (a late callback of an older one must not write over
// the new store), and its radio and store are whatever the page has up at the time.
A.make = function (stored) {
  A.drop()
  const mine = L.gen
  A.c = K.createCore({
    radio: { transmit: function (m, l) { if (A.radio) A.radio.transmit(m, l); else l.onError() } },
    now: nowMs,
    random: Math.random,
    version: appVersion(),
    save: function (state) { if (mine === L.gen && A.store) A.store.save(state) },
    buzz: buzz
  }, stored)
}
// The old core sends and saves nothing more, and its clock ends.
A.drop = function () {
  L.gen += 1
  A.gen = L.gen // a boot's late callbacks check it
  L.loop += 1
  if (A.c) K.stop(A.c)
  A.c = null
}
// A page is up: hello (and the watch's version when due), a redraw, the clock.
A.show = function () {
  L.on = true
  L.loop += 1
  K.launch(A.c)
  if (A.cb) A.cb(false)
  devices()
  loop()
}
// The page is gone from the front: the clock, the sensor and the screen lock stop; the state is stored.
A.hide = function () {
  L.on = false
  L.loop += 1
  if (L.hr) { L.hr = false; stopHr() }
  if (L.awake) { L.awake = false; keepOn(false) }
  if (A.c && A.store) A.store.save(A.c.s) // the store skips it when nothing changed
}
A.dev = devices
// A new store for a boot. It outlives every page, so it is made here: a store the home page made kept that page in the heap.
A.newStore = function () { A.store = createStore(file); return A.store }
// A tap may have begun a 3-2-1: do not wait out a slow tick.
A.poke = function () {
  if (L.on && isCounting() && !L.fast) { L.loop += 1; loop() }
}

export default {
  data: { get: function () { return A }, k: function () { return K } },
  onCreate: function () {},
  onDestroy: function () {}
}
