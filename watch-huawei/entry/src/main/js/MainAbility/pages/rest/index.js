// The rest page: the rest, Still training?, the menu, the Metrics page and the Finish and Discard question (view-rest.js).
// Glue between Huawei's APIs, the screens (common/view-common.js, view-rest.js) and the app (app.js): it wires this page's radio and
// adopts the core the home page made, and copies the screen's data into `data` when the app says to. It decides nothing about
// what is shown or what a tap does: the view files do, and have the tests. It imports nothing from core.js (a page that did
// would carry a second copy of it): the core's functions come through getApp().data.k(). When the workout is on a screen
// another page draws (view-common.js pageOf), it switches page BEFORE it builds anything: this page's view files have no such screen.
import { createGlue } from '../../common/page-glue.js'
import { blank, tick, swipeTo, attach } from '../../common/view-common.js'
import { attach as attachRest } from '../../common/view-rest.js'

// The names this page's HML binds (a test keeps the list and the HML the same).
const FIELDS = (
  's_ask title body accent ink keepLabel finishLabel s_confirm noLabel yesColor yesLabel s_menu hasPrev lPrev ' +
  'hasOver lOver hasSkip lSkip hasNext lNext lFinish lDiscard lBack s_rest menuLabel top timeColor restTime barOn ' +
  'pct restLabel locked skipLabel rateOn rateLn effortOn cc0 c0 cc1 c1 cc2 c2 cc3 c3 ratedColor ratedText upNext ' +
  'nextNums nextName sync s_mnum lt mTime mSub mHr hrLine setsLabel setsNum volLabel volNum'
).split(' ')

const G = createGlue('rest', FIELDS)
const go = G.go

export default {
  data: blank(FIELDS),
  onInit: function () {
    attach(G.init()); attachRest(G.K)
    if (G.A.c) G.adopt(this); else G.leave('index') // the home page makes the core: a page of its own cannot run without it
  },
  onShow: function () { G.show(this) },
  onHide: function () { G.hide() },
  onDestroy: function () { G.destroy() },
  // In a workout a swipe left opens the Metrics page and a swipe right steps back (view-common.js swipeTo). A swipe never leaves the app from here.
  swipe: function (e) {
    if (e.direction !== 'left' && e.direction !== 'right') return // a list scrolling is not ours
    const A = G.A
    const c = A.c
    if (!c) return
    try { swipeTo(c, A.ui, e.direction); tick(c, A.ui) } catch (err) { /* the screen stays */ }
    G.refresh(this)
  },

  keep: function () { go(this, 'keep') },
  askFinish: function () { go(this, 'askFinish') },
  no: function () { go(this, 'no') },
  yes: function () { go(this, 'yes') },
  mPrev: function () { go(this, 'mPrev') },
  mOver: function () { go(this, 'mOver') },
  mSkip: function () { go(this, 'mSkip') },
  mNext: function () { go(this, 'mNext') },
  mFinish: function () { go(this, 'mFinish') },
  mDiscard: function () { go(this, 'mDiscard') },
  mBack: function () { go(this, 'mBack') },
  menu: function () { go(this, 'menu') },
  restMinus: function () { go(this, 'restMinus') },
  restSkip: function () { go(this, 'restSkip') },
  restPlus: function () { go(this, 'restPlus') },
  chip0: function () { go(this, 'chip0') },
  chip1: function () { go(this, 'chip1') },
  chip2: function () { go(this, 'chip2') },
  chip3: function () { go(this, 'chip3') },
  mpBack: function () { go(this, 'mpBack') }
}
