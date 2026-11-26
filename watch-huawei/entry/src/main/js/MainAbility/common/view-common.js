// The screens' shared part: the helpers, the words, the look, the status line, which screen and which page is up,
// the screen-only state and the once-a-second tick. view-home.js, view-lift.js and view-rest.js each hold the
// screens of one page (their `FILL` and their taps) and hand them over with add(); every page imports this file.
//
//   ui = newUi()                the screen-only state: menus, the 3-2-1, the weight and reps boxes
//   tick(c, ui)                 once a second and after anything that changed c: starts the 3-2-1's
//                               workout, loads the boxes for the set that is up
//   build(c, ui, t) -> data     the screen's fields (always `s_<screen>`, `top`, the look)
//   act(c, ui, name)            a tap (ACTIONS lists the names; each is one handler in the page)
//   translator($t) -> t(key, a, b, c)   the watch's language through the page's $t, English from en.js where it has none
//   screenOf(c, ui), pageOf(c, ui)      which screen is up, and which page ('index', 'lift', 'over' or 'rest') draws it
// Same language subset as core.js (test/syntax.test.js).
import { EN } from './en.js'
// core.js stays in app.js (a page that imported it would carry its own copy): the page hands the core's
// functions over once, with attach(K), and the code below uses them by their own names. Each view file
// has its own attach(K) with only what it uses.
let
  entries, current, logged, needsPhone, isTimed, isCardio, restLeft, restPaused, waiting, startWorkout, countNumber,
  fixCancel
export function attach (K) {
  entries = K.entries
  current = K.current
  logged = K.logged
  needsPhone = K.needsPhone
  isTimed = K.isTimed
  isCardio = K.isCardio
  restLeft = K.restLeft
  restPaused = K.restPaused
  waiting = K.waiting
  startWorkout = K.startWorkout
  countNumber = K.countNumber
  fixCancel = K.fixCancel
}

export const LIME = '#A3E635'
export const ON_LIME = '#0C0E12'
export const COUNT_MS = 3700 // "3, 2, 1", "Go!" for 0.7 s, then it starts
export const ROUTINE_ROWS = 3
export const OVERVIEW_ROWS = 4
export const SCREENS = ['idle', 'routines', 'count', 'wait', 'ask', 'confirm', 'menu', 'hold', 'set', 'over', 'rest', 'end', 'card', 'summary', 'mnum']
export const QUIET = '#a1a1a6'
// the page that draws each screen; a screen not listed is the rest page's
const REST = 'rest'
const PAGE = { idle: 'index', routines: 'index', wait: 'index', summary: 'index', count: 'lift', hold: 'lift', set: 'lift', end: 'lift', card: 'lift', over: 'over' }

/* ---------- small helpers (ES5) ---------- */
export const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
export const arrOf = v => (Array.isArray(v) ? v : [])
export const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const toF = v => (typeof v === 'number' && isFinite(v) ? v : null)
export const isTrue = v => v === true || v === 1
export const isOff = v => v === false || v === 0
const two = n => (n < 10 ? '0' : '') + n
// 62.5 -> "62.5", 60 -> "60": never a trailing ".0".
export function fmtW (w) { return String(Math.round((toF(w) == null ? 0 : w) * 100) / 100) }
// 125 -> "2:05", 3725 -> "1:02:05"
export function clock (sec) {
  const s = Math.max(0, Math.floor(toF(sec) == null ? 0 : sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? h + ':' + two(m) + ':' + two(s % 60) : m + ':' + two(s % 60)
}

/* ---------- words ---------- */
// `get` is the page's $t: the word in i18n/<language>-<REGION>.json for the WATCH's language (the phone's is
// ignored, as on the Garmin). A language with no file gets undefined on the device, so English is kept here.
// The values go to $t as its params array: $t blanks a {0} it has no value for (measured in the simulator), and a
// key its file lacks comes back as the path itself. The English fallback is filled in here.
export function translator (get) {
  return (key, a, b, c) => {
    const path = 'strings.' + key
    const args = (c !== undefined ? [a, b, c] : b !== undefined ? [a, b] : a !== undefined ? [a] : []).map(String)
    let w
    try { w = args.length ? get(path, args) : get(path) } catch (e) { w = undefined }
    if (typeof w !== 'string' || w === '' || w === path) w = EN[key]
    if (w === undefined) return key
    if (a !== undefined) w = w.split('{0}').join(String(a))
    if (b !== undefined) w = w.split('{1}').join(String(b))
    if (c !== undefined) w = w.split('{2}').join(String(c))
    return w
  }
}

/* ---------- the screens' registry ---------- */
// FILL[screen] fills a screen's fields, ACT[name] is a tap; the view files add theirs when they load.
const FILL = {}
const ACT = {}
export const ACTIONS = []
export function add (fill, acts) {
  Object.keys(fill).forEach(k => { FILL[k] = fill[k] })
  Object.keys(acts).forEach(k => { ACT[k] = acts[k]; ACTIONS.push(k) })
}

/* ---------- the look ---------- */
function isHex (v) {
  if (typeof v !== 'string' || v.length !== 7 || v.charAt(0) !== '#') return false
  return v.substring(1).split('').every(ch => (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'))
}
// The phone's accent and the ink on it, as colours: the HML binds single values inside a declaration
// (style="color: {{accent}};"), the form the docs show; a whole style string is not documented.
function look (c, d) {
  const st = dictOf(c.s.set)
  d.accent = st && isHex(st.accent) ? st.accent : LIME
  d.ink = st && isHex(st.accent) && isHex(st.onAccent) ? st.onAccent : st && isHex(st.accent) ? '#000000' : ON_LIME
}

/* ---------- the status line: heart rate and sync ---------- */
export function hrText (c) {
  const st = dictOf(c.s.set)
  const show = st ? dictOf(st.show) : null
  if (show && isOff(show.hr)) return ''
  return c.g.bpm > 0 ? c.g.bpm + ' bpm' : ''
}
// "Waiting to sync 2", "Phone out of reach (2)", and, where asked for, "All synced". `bar`: the short form for the
// top bar, which is about 170 px wide: "(2)" and "Phone away (2)".
export function syncText (c, t, synced, bar) {
  const n = waiting(c.s)
  if (c.g.awayAt != null) return (bar ? t('phone_gone') : t('phone_out_of_reach')) + (n > 0 ? ' (' + n + ')' : '')
  if (n > 0) return bar ? '(' + n + ')' : t('waiting_sync') + ' ' + n
  // every event counts here, not only the sets: a finish the phone has not acknowledged is not synced
  return synced && c.s.ob.length === 0 ? t('all_synced') : ''
}
export const join = a => a.filter(x => x).join(' · ')

/* ---------- ui state ---------- */
export function newUi () {
  return { cd: null, rp: 0, op: 0, mp: 0, menu: false, confirm: null, key: '', w: 0, r: 0, hasW: false, rt: 0, rtFor: null, cdN: null }
}

// The routines the Start screen offers: today's first, then the others as the phone sent them.
export function routinesOf (s) {
  const rd = dictOf(s.rd)
  const out = []
  if (!rd) return out
  if (dictOf(rd.today)) out.push({ s: rd.today, today: true })
  arrOf(rd.others).forEach(o => { if (dictOf(o)) out.push({ s: o, today: false }) })
  return out
}
export const pagesOf = (n, per) => Math.max(1, Math.ceil(n / per))

/* ---------- which screen ---------- */
export function screenOf (c, ui) {
  const s = c.s
  const g = c.g
  if (g.ended) return 'summary'
  if (!s.w) {
    return ui.cd ? 'count' : ui.rp > 0 ? 'routines' : 'idle'
  }
  const cur = current(c)
  if (ui.confirm) return 'confirm'
  if (g.ask) return 'ask'
  if (ui.menu) return 'menu'
  if (ui.mp > 0) return 'mnum'
  if (needsPhone(s)) return 'wait'
  if (g.hcd != null) return 'count'
  if (g.hold) return 'hold'
  if (cur && cur.fixing) return 'set'
  if (g.page === 'over') return 'over'
  const left = restLeft(c)
  if (left != null && (left > 0 || restPaused(c))) return 'rest'
  if (!cur) return 'end'
  if (cur.si == null || isCardio(cur.e)) return 'card'
  return 'set'
}
export function pageOf (c, ui) { return PAGE[screenOf(c, ui)] || REST }

/* ---------- the weight and reps boxes ---------- */
// Loaded again only when the set up changes, so a lifter's edits survive redraws.
export function loadBoxes (c, ui) {
  const cur = c.s.w ? current(c) : null
  if (!cur || cur.si == null || !cur.row || isCardio(cur.e)) { ui.key = ''; return }
  const e = cur.e
  // by the set's id and its planned numbers, not its place: a removal or an add gives the next set the same
  // place, and a snapshot may change what is planned; each must load that set's numbers (core.js c.g.up moves on them)
  const planned = cur.side && dictOf(cur.row.sides) ? dictOf(cur.row.sides[cur.side]) : null // this side's own plan
  const key = (cur.fixing ? 'f' : '') + strOf(e.id) + '#' + cur.si + '#' + strOf(cur.side) + '#' + strOf(cur.row.sid) + '#' + strOf(cur.row.w) + '/' + strOf(cur.row.r) + '/' + strOf(cur.row.sec) + '#' + strOf(planned && planned.w) + '/' + strOf(planned && planned.r)
  if (ui.key === key) return
  ui.key = key
  let w = null
  let r = null
  if (cur.fixing) {
    const was = logged(c.s, cur.pos, cur.si, cur.side)
    if (was) { w = was[0]; r = isTimed(e) ? was[2] : was[1] }
  } else {
    const sd = dictOf(cur.row.sides)
    const one = sd && cur.side ? dictOf(sd[cur.side]) : null
    w = toF(one && one.w != null ? one.w : cur.row.w)
    r = toF(isTimed(e) ? cur.row.sec : one && one.r != null ? one.r : cur.row.r)
  }
  ui.hasW = !isTimed(e) && (!isTrue(e.bodyweight) || (w != null && w > 0))
  ui.w = w == null ? 0 : w
  ui.r = isTimed(e) ? (r != null && r >= 1 ? r : 30) : (r == null ? 0 : r)
}

/* ---------- once a second ---------- */
export function begin (c, ui) {
  const cd = ui.cd
  ui.cd = null
  startWorkout(c, cd.session)
}
// The workout's own 3-2-1 buzzes as the hold's does (core.js countTick): a tick on each number, a long
// one on Go!, obeying the phone's restHaptics. core.js keeps its buzz private, so this is the same rule.
function countBuzz (c, ui, el) {
  const n = countNumber(el)
  if (n === ui.cdN) return
  ui.cdN = n
  const st = dictOf(c.s.set)
  if (c.env.buzz && !(st && isOff(st.restHaptics))) c.env.buzz(n === 0 ? [[100, 250]] : [[30, 40]])
}
export function tick (c, ui) {
  const s = c.s
  const st = dictOf(s.set)
  if (s.w) {
    ui.cd = null
  } else {
    ui.menu = false
    ui.mp = 0
    ui.confirm = null
    if (ui.cd) {
      const el = c.env.now() - ui.cd.at
      countBuzz(c, ui, el)
      if (el >= COUNT_MS) begin(c, ui)
    }
  }
  // the lists may have got shorter under a page that was showing their last page
  ui.rp = ui.rp > 0 ? Math.min(ui.rp, pagesOf(routinesOf(s).length, ROUTINE_ROWS)) : 0
  ui.op = Math.max(0, Math.min(ui.op, pagesOf(entries(s).length, OVERVIEW_ROWS) - 1))
  // a fix of a set the window no longer has is dropped, so the set page never lacks its row
  if (c.g.fix) { const cur = current(c); if (cur && cur.fixing && !cur.row) fixCancel(c) }
  // a rest the phone runs has no total: the ring takes the first time it saw as the full circle
  if (s.rest != null && !(c.g.restTotal > 0) && ui.rtFor !== s.rest) { ui.rtFor = s.rest; ui.rt = restLeft(c) }
  loadBoxes(c, ui)
}

export const sideWord = (t, side) => (side === 'L' ? t('left') : side === 'R' ? t('right') : '')

// Everything the HML binds to, as the page starts with it. build() only ever returns these keys. A page keeps only
// `keys`, the names its own HML binds: each name in `data` costs the engine heap, and a page binds a third of them.
export function blank (keys) {
  const d = {
    top: '', menuLabel: '', accent: LIME, ink: ON_LIME,
    canStart: false, showStart: false, showRoutines: false, routinesLabel: '', startLabel: '', title: '', name: '', plan: '', hint: '',
    rPaged: false, cancelLabel: '', big: '', label: '', body: '', keepLabel: '', finishLabel: '', yesLabel: '', yesColor: '#ffffff', noLabel: '',
    hasPrev: false, hasOver: false, hasSkip: false, hasNext: false, lPrev: '', lOver: '', lSkip: '', lNext: '', lFinish: '', lDiscard: '', lBack: '',
    tag: '', pill: '', partnerOn: false, wLabel: '', time: '', pct: 0, timeColor: LIME, stopLabel: '', partner: '', fixing: false, prevOn: false, nextOn: false, wOn: false,
    ssLabel: '', lt: '<', gt: '>', wNum: '', wUnit: '', rLabel: '', rNum: '', last: '', doneLabel: '', restLabel: '', restTime: '', upNext: '', nextName: '',
    nextNums: '', effortOn: false, skipLabel: '', locked: false, ovMore: '', ovPaged: false, count: '', sync: '', hrOn: false, goOn: false, ovMoreOn: false,
    backLabel: '', nextLabel: '', dur: '', durLabel: '', setsNum: '', setsLabel: '', volNum: '', volLabel: '', hrLine: '',
    barOn: true, rateOn: false, ratedText: '', ratedColor: QUIET, rateLn: '', syncOn: false,
    cc0: QUIET, cc1: QUIET, cc2: QUIET, cc3: QUIET,
    mSub: '', mTime: '', mHr: ''
  }
  SCREENS.forEach(k => { d['s_' + k] = false })
  d.s_lost = false
  d.lostText = ''
  d.retryLabel = ''
  for (let k = 0; k < ROUTINE_ROWS; k++) { d['ro' + k] = ''; d['rs' + k] = ''; d['rv' + k] = false }
  for (let k = 0; k < OVERVIEW_ROWS; k++) { d['on' + k] = ''; d['oc' + k] = ''; d['ol' + k] = '#1c1c1e'; d['ob' + k] = '#2c2c2e'; d['ovv' + k] = false }
  for (let k = 0; k < 4; k++) { d['c' + k] = ''; d['ss' + k] = false }
  if (!keys) return d
  const mine = {}
  keys.forEach(k => { mine[k] = d[k] })
  return mine
}

// The state the page shows when the stored workout could not be read (store.js 'unreadable'): no core,
// nothing is saved, one button asks again.
export function lostData (t) {
  const d = {}
  SCREENS.forEach(k => { d['s_' + k] = false })
  d.s_lost = true
  d.lostText = t('read_failed')
  d.retryLabel = t('try_again')
  return d
}

export function build (c, ui, t) {
  const screen = screenOf(c, ui)
  const d = { menuLabel: t('menu'), s_lost: false }
  SCREENS.forEach(k => { d['s_' + k] = k === screen })
  d.top = join([hrText(c), syncText(c, t, false, true)])
  look(c, d)
  FILL[screen](c, ui, t, d)
  return d
}

// The Menu button is on the home page's wait screen as well as on the set (and the rest): one tap for both.
// Finish is on the lift page's end screen and the rest page's Overview.
ACT.menu = (c, ui) => { ui.menu = true }
ACT.finish = (c, ui) => { ui.confirm = 'finish' }
ACTIONS.push('menu', 'finish')
export function act (c, ui, name) {
  if (Object.prototype.hasOwnProperty.call(ACT, name)) ACT[name](c, ui)
}

// A swipe on the page. Left opens the Metrics page from the set or the rest, right goes back from it to the workout.
// Anything else on top (a confirm, the menu) is left alone. Leaving the app by a swipe right from Start is the
// page's own rule.
export function swipeTo (c, ui, dir) {
  if (!c.s.w) return
  const at = screenOf(c, ui)
  if (dir === 'left' && (at === 'set' || at === 'rest')) ui.mp = 1
  else if (dir === 'right' && at === 'mnum') ui.mp = 0
}
