// The home page: glue between Huawei's APIs, the screens (common/view-common.js, view-home.js) and the app (app.js).
// The app holds the core, the clock, the sensor and the buzz; this page loads the stored state (the first page of
// a run does), wires the radio and the store, and copies the screen's data into `data` when the app says to. It
// decides nothing about what is shown or what a tap does: the view files do, and have the tests. It imports
// nothing from core.js (a page that did would carry a second copy of it): the core's functions come through
// getApp().data.k(). When the workout is on a screen another page draws (view-common.js pageOf), it switches
// page BEFORE it builds anything: this page's view files have no such screen.
import app from '@system.app'
import { createGlue } from '../../common/page-glue.js'
import { blank, newUi, tick, lostData, swipeTo, attach } from '../../common/view-common.js'
import { attach as attachHome } from '../../common/view-home.js'

// The names this page's HML binds (a test keeps the list and the HML the same).
const FIELDS = (
  's_lost lostText accent ink retryLabel s_idle title name plan hint canStart startLabel showStart ' +
  'showRoutines routinesLabel top s_routines rv0 ro0 rs0 rv1 ro1 rs1 rv2 ro2 rs2 rPaged gt s_wait menuLabel ' +
  'body s_summary durLabel dur setsLabel setsNum volLabel volNum hrOn hrLine syncOn sync doneLabel'
).split(' ')

// The crown scrolls the summary list: ask for it once when the summary comes up (the list draws a turn later).
const G = createGlue('index', FIELDS, function (d, page) {
  if (d.s_summary !== G.S.sum) {
    G.S.sum = d.s_summary
    if (G.S.sum) setTimeout(function () { try { page.$refs.sum.rotation({ focus: true }) } catch (e) { /* no crown on this watch */ } }, 0)
  }
})
const S = G.S
const go = G.go

// The stored workout could not be read: say so, make no core, save nothing (the store refuses to).
function showLost (page) {
  G.put(page, lostData(G.words(page)))
}

function start (page, stored) {
  const A = G.A
  A.ui = newUi()
  G.link()
  A.make(stored)
  if (S.shown) G.resume(page)
}

// Loads the stored state and starts the core: once per app run (the first page, or Try again). It drops
// any older core first: only one core may save into one store. Later pages find the core running and
// only adopt it (onInit): its summary, hold, rest, heart-rate totals and screen state carry on.
function boot (page) {
  const A = G.A
  S.boot += 1
  S.t = null // the new page's $t, not the old one's
  const mine = S.boot
  A.drop()
  const gen = A.gen
  const store = A.newStore() // made by the app: a store made here would keep this page in the heap after it is gone
  store.load(function (stored, status) {
    if (mine !== S.boot || gen !== A.gen) return
    if (status === 'unreadable') { showLost(page); return }
    G.whenVersion(function () { if (mine === S.boot && gen === A.gen) start(page, stored) })
  })
}

export default {
  data: blank(FIELDS),
  onInit: function () {
    attach(G.init()); attachHome(G.K)
    if (G.A.c) G.adopt(this); else boot(this)
  },
  onShow: function () { G.show(this) },
  onHide: function () { G.hide() },
  onDestroy: function () { G.destroy() },
  retry: function () { boot(this) },
  // Swipe right leaves the app, from the Start screen only: not by accident in the middle of a workout.
  // In a workout a swipe left opens the Metrics page and a swipe right steps back (view-common.js swipeTo).
  swipe: function (e) {
    if (e.direction !== 'left' && e.direction !== 'right') return // a list scrolling is not ours
    const A = G.A
    if (e.direction === 'right' && (!A.c || this.s_idle)) { app.terminate(); return }
    const c = A.c
    if (!c) return
    try { swipeTo(c, A.ui, e.direction); tick(c, A.ui) } catch (err) { /* the screen stays */ }
    G.refresh(this)
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
