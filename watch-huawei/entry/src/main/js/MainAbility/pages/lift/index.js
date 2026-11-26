// The lift page. INTERIM: until tasks 10 and 11 split the rest page off it, this page draws every screen of a workout
// (the home page draws Start, the routines, the wait and the summary: view-common.js pageOf). Glue between Huawei's APIs,
// the screens (common/view-*.js) and the app (app.js): it wires this page's radio, adopts the core the home page made,
// and copies the screen's data into `data` when the app says to. It decides nothing about what is shown or what a tap
// does: the view files do, and have the tests. It imports nothing from core.js (a page that did would carry a second
// copy of it): the core's functions come through getApp().data.k(). When the workout is on the home page's screen it
// switches page BEFORE it builds anything: this page's view files have no such screen.
import { createGlue } from '../../common/page-glue.js'
import { blank, tick, swipeTo, attach } from '../../common/view-common.js'
import { attach as attachLift } from '../../common/view-lift.js'
import { attach as attachRest } from '../../common/view-rest.js'

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

const G = createGlue('lift', FIELDS)
const go = G.go

export default {
  data: blank(FIELDS),
  onInit: function () {
    attach(G.init()); attachLift(G.K); attachRest(G.K)
    if (G.A.c) G.adopt(this); else G.leave('index') // the home page makes the core: a page of its own cannot run without it
  },
  onShow: function () { G.show(this) },
  onHide: function () { G.hide() },
  onDestroy: function () { G.destroy() },
  // In a workout a swipe left opens the Metrics page and a swipe right steps back (view-common.js swipeTo). A swipe
  // never leaves the app from here.
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
