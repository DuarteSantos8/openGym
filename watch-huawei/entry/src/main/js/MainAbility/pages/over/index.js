// The over page: the Overview (view-over.js).
// Glue between Huawei's APIs, the screens (common/view-common.js, view-over.js) and the app (app.js): it wires this page's radio and
// adopts the core the home page made, and copies the screen's data into `data` when the app says to. It decides nothing about
// what is shown or what a tap does: the view files do, and have the tests. It imports nothing from core.js (a page that did
// would carry a second copy of it): the core's functions come through getApp().data.k(). When the workout is on a screen
// another page draws (view-common.js pageOf), it switches page BEFORE it builds anything: this page's view files have no such screen.
import { createGlue } from '../../common/page-glue.js'
import { blank, attach } from '../../common/view-common.js'
import { attach as attachOver } from '../../common/view-over.js'

// The names this page's HML binds (a test keeps the list and the HML the same).
const FIELDS = (
  's_over title count ss0 ssLabel ovv0 ol0 ob0 on0 oc0 ss1 ovv1 ol1 ob1 on1 oc1 ss2 ovv2 ol2 ob2 on2 oc2 ss3 ovv3 ' +
  'ol3 ob3 on3 oc3 ovPaged gt ovMoreOn ovMore sync accent ink finishLabel backLabel'
).split(' ')

const G = createGlue('over', FIELDS)
const go = G.go

export default {
  data: blank(FIELDS),
  onInit: function () {
    attach(G.init()); attachOver(G.K)
    if (G.A.c) G.adopt(this); else G.leave('index') // the home page makes the core: a page of its own cannot run without it
  },
  onShow: function () { G.show(this) },
  onHide: function () { G.hide() },
  onDestroy: function () { G.destroy() },
  // No swipe handler: a swipe acts only on the set, the rest and the Metrics page (view-common.js swipeTo), none of them here.

  ov0: function () { go(this, 'ov0') },
  ov1: function () { go(this, 'ov1') },
  ov2: function () { go(this, 'ov2') },
  ov3: function () { go(this, 'ov3') },
  ovNext: function () { go(this, 'ovNext') },
  finish: function () { go(this, 'finish') },
  ovBack: function () { go(this, 'ovBack') }
}
