// What every view test file shares: the core, one V over the four view files, and the builders (a watch, a snapshot, a started workout).
import { readFileSync } from 'node:fs'
import * as K from '../entry/src/main/js/MainAbility/common/core.js'
import * as C from '../entry/src/main/js/MainAbility/common/view-common.js'
import * as H from '../entry/src/main/js/MainAbility/common/view-home.js'
import * as Lf from '../entry/src/main/js/MainAbility/common/view-lift.js'
import * as R from '../entry/src/main/js/MainAbility/common/view-rest.js'
import { dollarT } from './i18n.js'

// One V for the view tests: view-common.js's exports and the attach of all four view files.
export const V = Object.assign({}, C, { attach: K => { C.attach(K); H.attach(K); Lf.attach(K); R.attach(K) } })
export { K }

V.attach(K)

const T0 = 1761742800000
const t = V.translator(dollarT('en-US'))
const clone = v => JSON.parse(JSON.stringify(v))

function mk (opts) {
  const o = opts || {}
  const clk = { now: T0 }
  const buzzes = []
  const sent = []
  const env = { radio: { transmit: m => { sent.push(clone(m)) } }, now: () => clk.now, random: () => 0.5, save: () => {}, buzz: p => buzzes.push(p), today: () => '2026-11-25' }
  const c = K.createCore(env, o.stored)
  const ui = V.newUi()
  const w = {
    c, ui, clk, buzzes, sent,
    snap: (active, extra) => { K.onPhone(c, Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: {}, active: active, ready: null }, extra || {})); V.tick(c, ui) },
    tap: name => { V.act(c, ui, name); V.tick(c, ui) },
    // seconds pass: the page's timer tick
    wait: sec => { for (let i = 0; i < sec; i++) { clk.now += 1000; K.second(c); V.tick(c, ui) } },
    d: () => V.build(c, ui, t),
    screen: () => V.screenOf(c, ui),
    evs: () => c.s.ob.map(K.unpack)
  }
  return w
}
const ent = (id, i, sets, extra) => Object.assign({ id: id, name: id, i: i, sets: sets }, extra || {})
const row = (w, r, extra) => Object.assign({ w: w, r: r }, extra || {})
const session = (entries, extra) => Object.assign({ routineIds: ['r1'], name: 'Push day', entries: entries }, extra || {})
const act = (entries, extra) => Object.assign({ id: 'w1', name: 'Push', start: T0 - 600000, unit: 'kg', cur: 0, restSec: 90, count: entries.length, entries: entries }, extra || {})
const grid = a => { a.entries[0].step = 2.5; return a }
const fixture = () => JSON.parse(readFileSync(new URL('../../frontend/garmin/test/snapshot.json', import.meta.url), 'utf8'))
// a watch that has heard the phone and holds today's routine
// a watch that has heard the phone; the phone asks for no weigh-in unless a test says so
const ready = (opts, today, others, settings) => { const w = mk(opts); w.snap(null, { settings: settings || { weighIn: false }, ready: { today: today, others: others || [] } }); return w }
const TODAY = () => session([ent('Bench', 0, [row(60, 8), row(60, 8)], { last: '55×8, 57.5×6', restSec: 60 }), ent('Row', 1, [row(40, 10)])])
const started = (opts, today) => { const w = ready(opts, today || TODAY()); w.tap('start'); w.wait(4); return w }
/* ---------- step 1: before a start, the set menu, folders, the Overview ---------- */

const ASKING = { weighIn: true, lastBw: 72.5, checkin: true, checkinDay: '2026-11-24' }
const types = w => w.evs().map(e => e.type)
// rows with set ids, as the phone sends them, for the set menu
const rows = (e, plans) => Object.assign(e, { sets: plans.map((p, k) => Object.assign({ sid: e.id + k }, p)) })
const sid = (e, i) => Object.assign(e, { sets: e.sets.map((r, k) => Object.assign(r, { sid: 's' + i + k })) })
/* ---------- step 2: the Metrics pages ---------- */
const beat = (w, bpm) => { K.hrSample(w.c, bpm); w.wait(1) }
const beat5 = (w, bpm) => { K.hrSample(w.c, bpm); w.wait(5) } // the page keeps one reading for each five seconds
const swipe = (w, dir) => { V.swipeTo(w.c, w.ui, dir); V.tick(w.c, w.ui) }
const live = (entries, settings, extra) => { const w = mk(); w.snap(act(entries, extra), { settings: settings || {} }); return w }
const dn = (id, i, n, extra) => ent(id, i, Array.apply(null, Array(n)).map((_, k) => row(60, 8, { done: true, sid: id + k })), extra)
const startedWith = settings => { const w = ready(null, TODAY(), [], Object.assign({ weighIn: false }, settings)); w.tap('start'); w.wait(4); return w }
export { T0, t, clone, mk, ent, row, session, act, grid, fixture, ready, TODAY, started, ASKING, types, rows, sid, beat, beat5, swipe, live, dn, startedWith }
