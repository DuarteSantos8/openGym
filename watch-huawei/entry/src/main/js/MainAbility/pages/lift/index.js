// The lift page: the 3-2-1, a set (and fixing one), a hold, all sets done and the cardio card (view-lift.js).
// Glue between Huawei's APIs, the screens (common/view-common.js, view-lift.js) and the app (app.js): it wires this page's radio and
// adopts the core the home page made, and copies the screen's data into `data` when the app says to. It decides nothing about
// what is shown or what a tap does: the view files do, and have the tests. It imports nothing from core.js (a page that did
// would carry a second copy of it): the core's functions come through getApp().data.k(). When the workout is on a screen
// another page draws (view-common.js pageOf), it switches page BEFORE it builds anything: this page's view files have no such screen.
import { createGlue } from '../../common/page-glue.js'
import { blank, tick, swipeTo, attach } from '../../common/view-common.js'
import { attach as attachLift } from '../../common/view-lift.js'

// The names this page's HML binds (a test keeps the list and the HML the same).
const FIELDS = (
  's_count label pct accent goOn big s_hold top name tag timeColor time ink stopLabel sync s_set fixing cancelLabel ' +
  'pill partnerOn partner wOn wLabel wNum wUnit rLabel rNum last prevOn lt locked doneLabel nextOn gt s_end ' +
  'menuLabel title count finishLabel s_card body nextLabel'
).split(' ')

const G = createGlue('lift', FIELDS)
const go = G.go

export default {
  data: blank(FIELDS),
  onInit: function () {
    attach(G.init()); attachLift(G.K)
    if (G.A.c) G.adopt(this); else G.leave('index') // the home page makes the core: a page of its own cannot run without it
  },
  onShow: function () { G.show(this) },
  onHide: function () { G.hide() },
  onDestroy: function () { G.destroy() },
  // In a workout a swipe left opens the Metrics page (the rest page's) and a swipe right steps back (view-common.js swipeTo). A swipe never leaves the app from here.
  swipe: function (e) {
    if (e.direction !== 'left' && e.direction !== 'right') return // a list scrolling is not ours
    const A = G.A
    const c = A.c
    if (!c) return
    try { swipeTo(c, A.ui, e.direction); tick(c, A.ui) } catch (err) { /* the screen stays */ }
    G.refresh(this)
  },

  skipCount: function () { go(this, 'skipCount') },
  cancelCount: function () { go(this, 'cancelCount') },
  stopHold: function () { go(this, 'stopHold') },
  cancelFix: function () { go(this, 'cancelFix') },
  menu: function () { go(this, 'menu') },
  wMinus: function () { go(this, 'wMinus') },
  wPlus: function () { go(this, 'wPlus') },
  rMinus: function () { go(this, 'rMinus') },
  rPlus: function () { go(this, 'rPlus') },
  prev: function () { go(this, 'prev') },
  done: function () { go(this, 'done') },
  nextFix: function () { go(this, 'nextFix') },
  finish: function () { go(this, 'finish') },
  nextEx: function () { go(this, 'nextEx') }
}
