// What each screen shows, as plain data the page's HML binds to, and what each tap does. All the
// decisions live here (which screen is up, every line of text, which buttons exist); the page file only
// copies the data across and forwards taps. Nothing here touches a Huawei API.
//
//   ui = newUi(lang)            the screen-only state: menus, the 3-2-1, the weight and reps boxes
//   tick(c, ui)                 once a second and after anything that changed c: starts the 3-2-1's
//                               workout, loads the boxes for the set that is up
//   build(c, ui, t) -> data     the screen's fields (always `s_<screen>`, `top`, the look)
//   act(c, ui, name)            a tap (ACTIONS lists the names; each is one handler in the page)
//   translator(lang) -> t(key, a, b, c)
//   swipeTo(c, ui, dir)         a swipe: left opens the Metrics pages from the set or the rest and goes on to the next
//                               page, right goes back a page (from the first, to the workout); ui.mp is the page, 0 none
// Same language subset as core.js (test/syntax.test.js).
import {
  entries, current, setIndex, place, partners, planSize, progress, fixList, logged, hasMore, needsPhone,
  unitOf, stepOf, stepWeight, stepReps, isTimed, isCardio, locked, restLeft, restPaused, held, countNumber, chips, chipLabel,
  canRate, lastSet, waiting, save, startWorkout, finishWorkout, pressDone, skipSet, nextExercise, holdStart, holdStop, holdCancel,
  restAdd, restSkip, rate, refSet, fixLast, fixStep, fixCancel, fixSave, keepGoing,
  startFlow, preState, preCancel, checkinAnswer, checkinSkip, weighInStep, weighInDone, canAdd, canRemove, addSet, removeSet,
  supersetStart, sessionNote, noteOn, sensorShouldRest, setId, lockFor, reach
} from './core.js'
import { numbers, pulse, zones, effort, muscles, metricPages, streak, restStyle, bandOf, setsText } from './metrics.js'
import { medalOf, usesComma } from './medal.js'
import { KEYS, TEXTS } from './texts.js'

export const LIME = '#A3E635'
export const ON_LIME = '#0C0E12'
export const WARM = '#FF9F0A'
export const COUNT_MS = 3700 // "3, 2, 1", "Go!" for 0.7 s, then it starts
export const CLOSE_GUARD_MS = 1000 // the summary ignores a tap for its first second
export const ROUTINE_ROWS = 3
export const OVERVIEW_ROWS = 4
export const METRIC_ROWS = 5 // rows of the Effort and Muscles pages (and the Zones')
export const PULSE_BARS = 12
export const PLATES = 4
const METRIC_SCREEN = { numbers: 'mnum', pulse: 'mpulse', effort: 'meffort', zones: 'mzones', muscles: 'mmuscles' }
const METRIC_SCREENS = Object.keys(METRIC_SCREEN).map(k => METRIC_SCREEN[k])
export const SCREENS = ['idle', 'routines', 'count', 'wait', 'ask', 'confirm', 'menu', 'hold', 'set', 'over', 'rest', 'end', 'card', 'summary', 'checkin', 'weighin'].concat(METRIC_SCREENS)
// the medal's metals (Wear OS Medal.kt): never the accent
const GOLD = { rim: '#D9B45F', rimLine: '#7A5A1E', face: '#F2D791', faceLine: '#BB9545', ink: '#2A1C07' }
const STEEL = { rim: '#B0B8C2', rimLine: '#4F5762', face: '#D4DAE1', faceLine: '#949DA8', ink: '#13171C' }
const QUIET = '#a1a1a6'
const RED = '#ff453a'

/* ---------- small helpers (ES5) ---------- */
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const toF = v => (typeof v === 'number' && isFinite(v) ? v : null)
const isTrue = v => v === true || v === 1
const isOff = v => v === false || v === 0
const known = lang => Object.prototype.hasOwnProperty.call(TEXTS, lang)
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
// The app's languages whose script the watch's one font (SourceHanSansSC-Regular) may not draw show
// English instead.
// unsure: whether it draws Arabic, Persian, Hindi, Bengali and Thai; check on a real watch and empty this list if it does.
const NO_GLYPHS = ['ar', 'bn', 'fa', 'hi', 'th']

// The watch's own language as one of the app's: configuration.getLocale() gives { language, countryOrRegion }.
export function deviceLang (loc) {
  const l = loc && typeof loc.language === 'string' ? loc.language.toLowerCase() : ''
  const r = loc && typeof loc.countryOrRegion === 'string' ? loc.countryOrRegion.toUpperCase() : ''
  if (l === 'zh') return r === 'TW' || r === 'HK' || r === 'MO' ? 'zh-TW' : 'zh'
  if (l === 'pt') return r === 'BR' ? 'pt-BR' : 'pt'
  if (l === 'in') return 'id'
  return known(l) ? l : 'en'
}
// The phone's language when the snapshot gives one, else the watch's, else English.
// The phone may leave `lang` out of a snapshot (it cuts fields to fit), so the last one it gave is kept
// in the state (c.s.pl) and stays until the phone gives another.
export function langOf (c, ui) {
  const l = typeof c.s.pl === 'string' ? c.s.pl : ui.lang
  const use = known(l) ? l : 'en'
  return NO_GLYPHS.indexOf(use) >= 0 ? 'en' : use
}
export function translator (lang) {
  const line = TEXTS[known(lang) ? lang : 'en'].split('\n')
  const words = {}
  KEYS.forEach((k, i) => { words[k] = line[i] })
  return (key, a, b, c) => {
    let w = words[key]
    if (w === undefined) return key
    if (a !== undefined) w = w.split('{0}').join(String(a))
    if (b !== undefined) w = w.split('{1}').join(String(b))
    if (c !== undefined) w = w.split('{2}').join(String(c))
    return w
  }
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
function hrText (c) {
  const st = dictOf(c.s.set)
  const show = st ? dictOf(st.show) : null
  if (show && isOff(show.hr)) return ''
  return c.g.bpm > 0 ? c.g.bpm + ' bpm' : ''
}
// "Waiting to sync 2", "Phone out of reach (2)", and, where asked for, "All synced". `bar`: the short form for the
// top bar, which is about 170 px wide: "(2)" and "Phone away (2)".
function syncText (c, t, synced, bar) {
  const n = waiting(c.s)
  if (c.g.awayAt != null) return (bar ? t('phone_gone') : t('phone_out_of_reach')) + (n > 0 ? ' (' + n + ')' : '')
  if (n > 0) return bar ? '(' + n + ')' : t('waiting_sync') + ' ' + n
  return synced ? t('all_synced') : ''
}
// Apple's colours for an effort chip, by the phone's bands (lib/effort.js): purple, red, orange, yellow, the accent, teal.
const ZONE_COLORS = ['#40c8e0', '#30d158', '#ffd60a', '#ff9f0a', '#ff453a'] // teal, green, yellow, orange, red
const BANDS = ['#bf5af2', '#ff453a', '#ff9f0a', '#ffd60a', null, '#40c8e0']
const BAND_TOPS = [0.25, 0.75, 1.5, 2.5, 3.5]
function bandColor (kind, v, accent) {
  const rir = kind === 'rpe' ? 10 - v : v
  let i = 0
  while (i < BAND_TOPS.length && rir > BAND_TOPS[i]) i++
  return BANDS[i] || accent
}
const join = a => a.filter(x => x).join(' · ')

/* ---------- ui state ---------- */
export function newUi (lang) {
  return { lang: lang || 'en', cd: null, rp: 0, op: 0, mp: 0, mn: 0, menu: false, confirm: null, key: '', w: 0, r: 0, hasW: false, rt: 0, rtFor: null, cdN: null, rm: null, menuRest: false }
}

// The routines the Start screen offers: today's first, then the others: those without a folder as the
// phone sent them, then each folder's routines together (folders in the order the phone's list first
// meets them). `folder` is the name shown under a routine.
function routinesOf (s) {
  const rd = dictOf(s.rd)
  const out = []
  if (!rd) return out
  if (dictOf(rd.today)) out.push({ s: rd.today, today: true, folder: '' })
  const others = arrOf(rd.others).filter(o => dictOf(o))
  const folderOf = o => (typeof o.folder === 'string' ? o.folder : '')
  const names = []
  others.forEach(o => { const f = folderOf(o); if (f && names.indexOf(f) < 0) names.push(f) })
  others.filter(o => !folderOf(o)).forEach(o => out.push({ s: o, today: false, folder: '' }))
  names.forEach(f => others.filter(o => folderOf(o) === f).forEach(o => out.push({ s: o, today: false, folder: f })))
  return out
}
const pagesOf = (n, per) => Math.max(1, Math.ceil(n / per))

/* ---------- which screen ---------- */
// The Metrics page the lifter is on, 1 to the number of pages now (the list shrinks when the heart rate goes).
const metricIndex = (c, ui) => Math.min(ui.mp, metricPages(c).length)
export function screenOf (c, ui) {
  const s = c.s
  const g = c.g
  if (g.ended) return 'summary'
  if (!s.w) {
    const pre = preState(c)
    if (pre && pre.kind === 'checkin') return 'checkin'
    if (pre && pre.kind === 'weighin') return 'weighin'
    return ui.cd ? 'count' : ui.rp > 0 ? 'routines' : 'idle'
  }
  const cur = current(c)
  if (ui.confirm) return 'confirm'
  if (g.ask) return 'ask'
  if (ui.menu) return 'menu'
  if (ui.mp > 0) return METRIC_SCREEN[metricPages(c)[metricIndex(c, ui) - 1]]
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

/* ---------- the weight and reps boxes ---------- */
// Loaded again only when the set up changes, so a lifter's edits survive redraws.
export function loadBoxes (c, ui) {
  const cur = c.s.w ? current(c) : null
  if (!cur || cur.si == null || !cur.row || isCardio(cur.e)) { ui.key = ''; return }
  const e = cur.e
  // by the set's id and its planned numbers, not its place: a removal or an add gives the next set the same
  // place, and a snapshot may change what is planned; each must load that set's numbers (core.js c.g.up moves on them)
  const key = (cur.fixing ? 'f' : '') + strOf(e.id) + '#' + cur.si + '#' + strOf(cur.side) + '#' + strOf(cur.row.sid) + '#' + strOf(cur.row.w) + '/' + strOf(cur.row.r) + '/' + strOf(cur.row.sec)
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
function begin (c, ui) {
  const cd = ui.cd
  ui.cd = null
  startWorkout(c, cd.session, cd.bw)
}
// The check-in and the weigh-in ask first (core.js startFlow); when the flow reaches its 3-2-1 the count starts.
function afterPre (c, ui, kind) {
  if (kind !== 'count') return
  const p = preState(c)
  ui.cd = { at: c.env.now(), session: p.session, bw: p.bw }
  ui.cdN = null
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
    // the pages came or went (Pulse, Zones): back to the first, as Wear does
    const n = metricPages(c).length
    ui.mp = ui.mp > 1 && n !== ui.mn ? 1 : Math.min(ui.mp, n)
    ui.mn = n
    if (c.g.pre) preCancel(c)
  }
  else {
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
  // a Remove confirm closes by itself when the set it offered moved or changed
  if (ui.confirm === 'remove' && (!ui.rm || ui.rm.up !== c.g.up)) { ui.confirm = null; ui.rm = null }
  loadBoxes(c, ui)
}

/* ---------- the screens ---------- */
const sideWord = (t, side) => (side === 'L' ? t('left') : side === 'R' ? t('right') : '')

function planText (session, t) {
  const es = arrOf(session.entries)
  if (!es.length) return ''
  const p = planSize(es)
  return p[0] + ' ' + t('exercises') + ' · ' + p[1] + ' ' + t('sets')
}

// "60 kg × 8 Reps", "0:30", with the side: the numbers a set is planned with.
function numbersOf (c, cur, t) {
  const e = cur.e
  const sd = dictOf(cur.row.sides)
  const one = sd && cur.side ? dictOf(sd[cur.side]) : null
  const w = toF(one && one.w != null ? one.w : cur.row.w)
  let out
  if (isTimed(e)) out = clock(toF(cur.row.sec) != null && cur.row.sec >= 1 ? cur.row.sec : 30)
  else {
    const r = toF(one && one.r != null ? one.r : cur.row.r)
    const reps = (r == null ? 0 : r) + ' ' + t('reps')
    out = w != null && w > 0 ? fmtW(w) + ' ' + unitOf(c.s, e) + ' × ' + reps : reps
  }
  return cur.side ? out + ' · ' + sideWord(t, cur.side) : out
}

function setCount (e) {
  let done = 0
  let all = 0
  arrOf(e.sets).forEach(r => { if (dictOf(r) && !isTrue(r.warmup)) { all += 1; if (isTrue(r.done)) done += 1 } })
  return [done, all]
}

const QUESTION = { sleep: ['checkin_sleep', 'checkin_sleep_lo', 'checkin_sleep_hi'], energy: ['checkin_energy', 'checkin_energy_lo', 'checkin_energy_hi'], sore: ['checkin_sore', 'checkin_sore_lo', 'checkin_sore_hi'] }
const FILL = {
  checkin: (c, ui, t, d) => {
    const p = preState(c)
    const q = QUESTION[p.key]
    d.title = t('checkin_title')
    d.qLabel = t(q[0])
    d.qLo = t(q[1])
    d.qHi = t(q[2])
    d.qStep = (p.step + 1) + '/' + p.steps
    d.skipLabel = t('checkin_skip')
    d.cancelLabel = t('cancel')
  },
  weighin: (c, ui, t, d) => {
    const p = preState(c)
    d.title = t('body_weight')
    d.bwNum = fmtW(p.w)
    d.bwUnit = p.unit
    d.saveLabel = t('save_and_start')
    d.skipLabel = t('skip') // Apple's Skip, beside the round X: the long words did not fit the circle's foot
    d.cancelLabel = t('cancel')
  },
  idle: (c, ui, t, d) => {
    const s = c.s
    const list = routinesOf(s)
    const first = list.length ? list[0] : null
    d.canStart = !!first && s.sy === true && !locked(c)
    d.showStart = !!first && s.sy === true
    d.name = first ? strOf(first.s.name) : ''
    d.plan = first ? planText(first.s, t) : ''
    d.title = !s.sy ? t('not_synced') : !first ? t('no_workout') : first.today ? t('today') : t('rest_day')
    d.hint = !s.sy ? t('open_phone_once') : !first ? t('start_on_phone') : ''
    d.startLabel = first && first.today ? t('start_workout') : t('quick_start')
    d.showRoutines = list.length > 1
    d.routinesLabel = t('routines')
    // the hint's room holds the week streak when there is nothing to hint at; the accent says this week is done
    const sk = !d.hint ? streak(c) : null
    if (sk && sk.weeks > 0) d.hint = t('week_streak') + ' ' + sk.weeks
    d.hintColor = sk && sk.thisWeekDone ? d.accent : QUIET
    // the phone along the bottom: in reach, away, or nothing when the watch cannot tell (core.js reach)
    const near = reach(c)
    const wait = waiting(s)
    d.top = join([near === 'near' ? t('phone_connected') : near === 'away' ? t('phone_gone') : '', wait > 0 ? t('waiting_sync') + ' ' + wait : ''])
  },
  routines: (c, ui, t, d) => {
    const list = routinesOf(c.s)
    const pages = pagesOf(list.length, ROUTINE_ROWS)
    const page = Math.min(ui.rp, pages)
    for (let k = 0; k < ROUTINE_ROWS; k++) {
      const item = list[(page - 1) * ROUTINE_ROWS + k]
      d['ro' + k] = item ? strOf(item.s.name) : ''
      d['rs' + k] = item ? (item.today ? t('today') : item.folder) : ''
      d['rv' + k] = !!item
    }
    d.rPaged = pages > 1
    d.cancelLabel = t('cancel')
  },
  count: (c, ui, t, d) => {
    const running = !!c.s.w
    const el = c.env.now() - (running ? c.g.hcd : ui.cd.at)
    const n = countNumber(el)
    d.pct = Math.max(0, Math.min(100, Math.round(100 - el / 30))) // the ring drains over the three seconds
    d.big = n > 0 ? String(n) : t('go')
    d.goOn = n <= 0 // Go! is wider than a number: the page draws it smaller, inside the ring
    d.label = running ? t('start_hold') : t('start_workout')
    d.cancelLabel = t('cancel')
  },
  wait: (c, ui, t, d) => {
    d.name = strOf(c.s.w.name)
    d.body = entries(c.s).length ? t('next_on_phone') : t('waiting_phone')
  },
  ask: (c, ui, t, d) => {
    const w = c.s.w
    const last = lastSet(w)
    d.title = t('still_training')
    d.body = c.g.askLeft ? t('left_gym') : t('no_set_for', Math.max(1, Math.floor(last == null ? 0 : (c.env.now() - last) / 60000)))
    d.keepLabel = t('keep_going')
    d.finishLabel = t('finish_workout')
  },
  confirm: (c, ui, t, d) => {
    const discard = ui.confirm === 'discard'
    const remove = ui.confirm === 'remove'
    d.title = remove ? t('remove_set') : discard ? t('discard_workout_q') : t('finish_workout_q')
    d.yesLabel = remove ? t('remove_set') : discard ? t('discard_workout') : t('finish_and_save')
    d.yesColor = remove || discard ? RED : '#ffffff' // a button that throws something away is outlined red, as Apple's Remove
    d.noLabel = t('cancel')
  },
  menu: (c, ui, t, d) => {
    const has = entries(c.s).length > 0
    d.hasPrev = fixList(c.s).length > 0
    d.hasOver = has && c.g.page !== 'over'
    d.hasSkip = has
    d.hasNext = has
    const si = setIndex(c.s, c.s.pos)
    // not from the rest: tickSet has already moved the position on to the next exercise
    const here = !c.g.fix && !ui.menuRest
    d.hasAdd = here && canAdd(c.s, c.s.pos)
    d.hasRemove = here && si != null && canRemove(c.s, c.s.pos, si)
    d.lAdd = t('add_set')
    d.lRemove = t('remove_set')
    d.lPrev = t('previous_set')
    d.lOver = t('overview')
    d.lSkip = t('skip_set')
    d.lNext = t('next_exercise')
    d.lFinish = t('finish_and_save')
    d.lDiscard = t('discard_workout')
    d.lBack = t('continue_workout')
  },
  hold: (c, ui, t, d) => {
    const cur = current(c)
    const h = c.g.hold
    const left = Math.max(0, h[1] - held(c))
    d.name = cur ? strOf(cur.e.name) : ''
    d.tag = t('hold') + (cur && cur.side ? ' · ' + sideWord(t, cur.side) : '')
    d.time = clock(left)
    d.pct = Math.max(0, Math.min(100, Math.round(left * 100 / h[1])))
    d.timeColor = left <= 5 ? WARM : d.accent
    d.stopLabel = t('stop')
    d.top = hrText(c) // red is the heart rate alone; the sync state is the quiet line at the foot
    d.sync = syncText(c, t, false)
  },
  set: (c, ui, t, d) => {
    const s = c.s
    const cur = current(c)
    const e = cur.e
    const pl = place(e, cur.si)
    const warm = isTrue(cur.row.warmup)
    const st = dictOf(s.set)
    const show = st ? dictOf(st.show) : null
    let tag = warm ? t('warmup') + ' ' + pl[0] + '/' + pl[1] : t('set_of', pl[0], pl[1])
    if (cur.side) tag += ' · ' + sideWord(t, cur.side)
    if (cur.fixing) tag = t('edit') + ' · ' + tag
    const ps = partners(s, cur.pos)
    d.name = strOf(e.name)
    d.tag = tag
    d.pill = pl[0] + '/' + pl[1] + ' ' + t('menu') // the pill opens the menu, as Apple's does
    d.band = bandOf(cur.row)
    d.bandOn = d.band !== ''
    d.partner = ps.length ? '+ ' + ps[0] + (ps.length > 1 ? ' +' + (ps.length - 1) : '') : ''
    d.partnerOn = d.partner !== ''
    d.fixing = cur.fixing
    d.prevOn = fixList(s).length > 0
    d.nextOn = cur.fixing
    d.wOn = ui.hasW
    // "Added weight" for a bodyweight exercise, as Wear words it; its unit is the profile's, left off for room
    d.wNum = isTrue(e.bodyweight) ? '+' + fmtW(ui.w) : fmtW(ui.w)
    // a long word (pl, lt) does not fit the tile: the plain word, the plus sign says the rest
    const aw = t('added_weight').toUpperCase()
    d.wLabel = isTrue(e.bodyweight) && aw.length <= 14 ? aw : t('weight').toUpperCase()
    d.wUnit = unitOf(s, e).toUpperCase()
    d.rLabel = (isTimed(e) ? t('hold') : t('reps')).toUpperCase()
    d.rNum = isTimed(e) ? clock(ui.r) : String(Math.round(ui.r))
    d.last = !cur.fixing && !(show && isOff(show.last)) && typeof e.last === 'string' && e.last ? t('last_time', e.last) : ''
    d.doneLabel = cur.fixing ? t('save') : isTimed(e) ? t('start_hold') : t('done')
    d.cancelLabel = t('cancel')
    d.locked = locked(c)
    // a rest runs on while a set is fixed: its time stays at the top
    d.top = hrText(c) // the sync state is not shown here: red means heart rate
    const rl = cur.fixing ? restLeft(c) : null
    if (rl != null && rl > 0) d.top = join([t('rest') + ' ' + clock(rl), d.top])
  },
  rest: (c, ui, t, d) => {
    const s = c.s
    const left = restLeft(c)
    const paused = restPaused(c)
    const total = c.g.restTotal > 0 ? c.g.restTotal : ui.rt
    // as Apple's: the heart rate on top, the time, a draining bar (not while paused), the sync state at the foot
    d.top = hrText(c)
    d.sync = syncText(c, t, false)
    d.barOn = restStyle(c) === 'ring' && !paused
    d.restLabel = paused ? t('paused') : ''
    d.timeColor = paused ? QUIET : d.accent
    d.restTime = clock(left)
    d.pct = total > 0 ? Math.max(0, Math.min(100, Math.round(left * 100 / total))) : 0
    const cur = current(c)
    const st = dictOf(s.set)
    const show = st ? dictOf(st.show) : null
    const next = !!cur && cur.si != null && !(show && isOff(show.next))
    d.nextName = next ? t('up_next_set', strOf(cur.e.name), place(cur.e, cur.si)[0], place(cur.e, cur.si)[1]) : ''
    d.nextNums = next ? numbersOf(c, cur, t) : ''
    const kind = st ? st.effort : null
    const rated = c.g.rated
    d.rateOn = canRate(c)
    d.effortOn = d.rateOn && rated == null
    const vals = chips(kind)
    for (let k = 0; k < 4; k++) { d['c' + k] = chipLabel(kind, vals[k]); d['cc' + k] = bandColor(kind, vals[k], d.accent) }
    if (d.rateOn) {
      const ref = refSet(s, c.g.last)
      const e = ref ? entries(s)[ref[0]] : null
      const sp = e ? place(e, ref[1]) : null
      const name = String(kind).toUpperCase()
      d.rateLn = join([name, sp ? t('up_next_set', strOf(e.name), sp[0], sp[1]) : ''])
      if (rated != null) { d.ratedText = name + ' ' + chipLabel(kind, rated); d.ratedColor = bandColor(kind, rated, d.accent) }
    }
    d.upNext = next ? t('up_next') : ''
    d.skipLabel = t('skip')
    d.locked = locked(c)
  },
  over: (c, ui, t, d) => {
    const s = c.s
    const es = entries(s)
    const pages = pagesOf(es.length, OVERVIEW_ROWS)
    const page = Math.min(ui.op, pages - 1)
    for (let k = 0; k < OVERVIEW_ROWS; k++) {
      const i = page * OVERVIEW_ROWS + k
      const e = i < es.length ? dictOf(es[i]) : null
      const n = e ? setCount(e) : [0, 0]
      d['on' + k] = e ? strOf(e.name) : ''
      d['oc' + k] = e ? n[0] + '/' + n[1] : ''
      d['ol' + k] = e && i === s.pos ? d.accent : '#1c1c1e' // the one up has the accent outline
      d['ob' + k] = e && n[1] > 0 && n[0] === n[1] ? d.accent : '#2c2c2e' // all its sets done: a filled mark
      d['ovv' + k] = !!e
    }
    for (let k = 0; k < OVERVIEW_ROWS; k++) d['ss' + k] = page * OVERVIEW_ROWS + k < es.length && supersetStart(s, page * OVERVIEW_ROWS + k)
    d.ssLabel = t('superset')
    // the phone's note, read-only: it sits at the top of the Overview's list (the set page has no room)
    d.note = noteOn(c) ? sessionNote(c) : ''
    d.noteOn = d.note !== ''
    const last = es.length ? dictOf(es[es.length - 1]) : null
    const more = hasMore(s) && last ? Math.max(1, (toF(s.w.count) == null ? 0 : s.w.count) - (toF(last.i) == null ? es.length : last.i) - 1) : 0
    d.ovMore = more > 0 ? '+' + more + ' ' + t('exercises') : ''
    d.ovMoreOn = more > 0
    d.ovPaged = pages > 1
    const p = progress(s)
    d.title = strOf(s.w.name) || t('overview')
    d.count = t('sets_of', p[0], p[1])
    d.sync = syncText(c, t, true)
    d.finishLabel = t('finish_workout')
    d.backLabel = t('continue_workout')
  },
  end: (c, ui, t, d) => {
    const p = progress(c.s)
    d.title = t('all_sets_done')
    d.count = t('sets_of', p[0], p[1])
    d.sync = syncText(c, t, true)
    d.finishLabel = t('finish_workout')
  },
  card: (c, ui, t, d) => {
    const cur = current(c)
    d.name = strOf(cur.e.name)
    d.body = isCardio(cur.e) ? t('log_on_phone') : t('all_sets_done')
    d.nextLabel = t('next_exercise')
  },
  summary: (c, ui, t, d) => {
    const m = c.g.ended
    const md = medalOf(m, { comma: usesComma(langOf(c, ui)), repsWord: t('reps'), maxPlates: PLATES })
    const metal = md.gold ? GOLD : STEEL
    d.title = m.ended ? t('ended_on_phone') : t('workout_saved')
    d.name = strOf(m.name)
    d.gold = md.gold
    d.mRim = metal.rim
    d.mRimLine = metal.rimLine
    d.mFace = metal.face
    d.mFaceLine = metal.faceLine
    d.mInk = metal.ink
    d.mTimeNum = md.time
    d.mUnit = t(md.timeLabel).toUpperCase()
    d.mVol = md.volume + ' ' + md.unit
    d.gemPx = md.gems.radius > 8 ? '18px' : '14px'
    for (let k = 0; k < 7; k++) d['gem' + k] = k < md.gems.angles.length
    d.legend = md.legend.key === 'n_sets' ? t('n_sets', md.legend.count) : md.legend.key === 'new_record' ? t('new_record') : md.legend.count + ' ' + t('records')
    for (let k = 0; k < PLATES; k++) {
      const p = md.plates[k]
      d['pv' + k] = !!p
      d['pn' + k] = p ? p.name : ''
      d['pnum' + k] = p ? t('band_to', p.old, p.now) + (p.unit ? ' ' + p.unit : '') : ''
    }
    d.rMore = md.more > 0 ? t('n_more', md.more) : ''
    d.rMoreOn = md.more > 0
    d.dur = m.dur == null ? '' : md.time + ' ' + t(md.timeLabel).toLowerCase() // the medal's own words
    d.durLabel = t('time')
    d.setsNum = String(m.sets)
    d.setsLabel = t('sets')
    d.volNum = Math.round(m.vol) + ' ' + strOf(m.unit)
    d.volLabel = t('volume')
    d.hrLine = Array.isArray(m.hr) ? t('hr_avg_max', m.hr[0], m.hr[1]) : ''
    d.hrOn = Array.isArray(m.hr)
    d.sync = syncText(c, t, true)
    d.syncOn = d.sync !== ''
    d.doneLabel = t('done')
  },
  // The Metrics pages (metrics.js has the numbers); each has a heading and "n/total" at the foot
  mnum: (c, ui, t, d) => {
    const n = numbers(c)
    d.mSub = n.paused ? t('paused') : t('time')
    d.mTime = n.elapsed == null ? '--' : clock(n.elapsed)
    d.setsNum = n.sets[0] + '/' + n.sets[1]
    d.setsLabel = t('sets')
    d.volNum = n.volume + ' ' + n.unit
    d.volLabel = t('volume')
    d.mHr = n.hr && n.hr.now ? n.hr.now + ' bpm' : ''
    d.hrLine = n.hr ? t('hr_avg_max', n.hr.avg, n.hr.max) : ''
  },
  mpulse: (c, ui, t, d) => {
    const p = pulse(c, PULSE_BARS)
    const bpm = p.points.map(x => x[1])
    let lo = Infinity
    let hi = 0
    bpm.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v) })
    const num = v => (v == null ? '--' : String(v))
    d.mTitle = t('heart_rate')
    d.mAvg = num(p.avg)
    d.mAvgLabel = t('avg')
    d.mMin = num(p.min)
    d.mMinLabel = t('min')
    d.mMax = num(p.max)
    d.mMaxLabel = t('max')
    // a bar 8 to 64 px tall for each reading, the lowest shortest; a missing reading is no bar
    for (let k = 0; k < PULSE_BARS; k++) d['pb' + k] = k >= bpm.length ? '0px' : (hi === lo ? 36 : 8 + Math.round((bpm[k] - lo) * 56 / (hi - lo))) + 'px'
  },
  meffort: (c, ui, t, d) => {
    const e = effort(c)
    const comma = usesComma(langOf(c, ui))
    d.mTitle = t('effort') + (e.kind ? ' ' + e.kind.toUpperCase() : '')
    rowsOf(d, e.rows.map(r => [r.name, setsText(r.value, comma)]), t, true)
    d.mEmpty = t('no_effort_yet')
  },
  mzones: (c, ui, t, d) => {
    const z = zones(c)
    d.mTitle = t('zones')
    d.zNeed = z.needsBirthYear
    d.zOn = !z.needsBirthYear
    d.mNeed = z.needsBirthYear ? t('no_age_set') + '. ' + t('add_birth_year') : ''
    for (let k = 0; k < 5; k++) {
      const b = z.bands[k]
      d['zn' + k] = z.needsBirthYear ? '' : (z.now === k + 1 ? '> Z' : 'Z') + (k + 1)
      d['zr' + k] = !b ? '' : k === 0 ? t('band_under', z.bands[1].lo) : k === 4 ? t('band_over', b.lo) : t('band_to', b.lo, b.hi)
      d['zt' + k] = z.needsBirthYear ? '' : clock(z.times[k])
      d['zc' + k] = ZONE_COLORS[k] // Apple's zone colours; the zone now keeps its "> " mark
    }
  },
  mmuscles: (c, ui, t, d) => {
    const m = muscles(c)
    const comma = usesComma(langOf(c, ui))
    d.mTitle = t('muscles')
    rowsOf(d, m.rows.map(r => [r.name, setsText(r.sets, comma)]), t)
    d.mEmpty = t('no_sets_yet')
  }
}

// The five name-and-number rows of the Effort and Muscles pages: [[name, value]], "+n more" past five. `latest`:
// the last five (Effort, as Wear: the exercise in hand shows), else the first five (Muscles: most first).
function rowsOf (d, list, t, latest) {
  const shown = latest ? list.slice(-METRIC_ROWS) : list
  for (let k = 0; k < METRIC_ROWS; k++) {
    const r = shown[k]
    d['mrOn' + k] = !!r
    d['mr' + k] = r ? r[0] : ''
    d['mv' + k] = r ? r[1] : ''
  }
  d.mMore = list.length > METRIC_ROWS ? t('n_more', list.length - METRIC_ROWS) : ''
  d.mEmptyOn = list.length === 0
}

// Everything the HML binds to, as the page starts with it. build() only ever returns these keys.
export function blank () {
  const d = {
    top: '', menuLabel: '', accent: LIME, ink: ON_LIME,
    canStart: false, showStart: false, showRoutines: false, routinesLabel: '', startLabel: '', title: '', name: '', plan: '', hint: '',
    rPaged: false, cancelLabel: '', big: '', label: '', body: '', keepLabel: '', finishLabel: '', yesLabel: '', yesColor: '#ffffff', noLabel: '',
    hasPrev: false, hasOver: false, hasSkip: false, hasNext: false, lPrev: '', lOver: '', lSkip: '', lNext: '', lFinish: '', lDiscard: '', lBack: '',
    tag: '', pill: '', band: '', bandOn: false, partnerOn: false, wLabel: '', time: '', pct: 0, timeColor: LIME, stopLabel: '', partner: '', fixing: false, prevOn: false, nextOn: false, wOn: false,
    qLabel: '', qLo: '', qHi: '', qStep: '', bwNum: '', bwUnit: '', saveLabel: '', hasAdd: false, hasRemove: false, lAdd: '', lRemove: '',
    ssLabel: '', note: '', noteOn: false, lt: '<', gt: '>', wNum: '', wUnit: '', rLabel: '', rNum: '', last: '', doneLabel: '', restLabel: '', restTime: '', upNext: '', nextName: '',
    nextNums: '', effortOn: false, skipLabel: '', locked: false, ovMore: '', ovPaged: false, count: '', sync: '', rMoreOn: false, hrOn: false, goOn: false, ovMoreOn: false,
    backLabel: '', nextLabel: '', dur: '', durLabel: '', setsNum: '', setsLabel: '', volNum: '', volLabel: '', hrLine: '',
    hintColor: QUIET, barOn: true, rateOn: false, ratedText: '', ratedColor: QUIET, rateLn: '', syncOn: false,
    cc0: QUIET, cc1: QUIET, cc2: QUIET, cc3: QUIET,
    mTitle: '', mPos: '', mSub: '', mTime: '', mHr: '', mAvg: '', mAvgLabel: '', mMin: '', mMinLabel: '', mMax: '', mMaxLabel: '',
    mEmpty: '', mEmptyOn: false, mMore: '', zOn: false, zNeed: false, mNeed: '',
    gold: false, mRim: STEEL.rim, mRimLine: STEEL.rimLine, mFace: STEEL.face, mFaceLine: STEEL.faceLine, mInk: STEEL.ink, mTimeNum: '', mUnit: '',
    mVol: '', gemPx: '18px', legend: '', rMore: ''
  }
  for (let k = 0; k < PULSE_BARS; k++) d['pb' + k] = '0px'
  for (let k = 0; k < METRIC_ROWS; k++) { d['mrOn' + k] = false; d['mr' + k] = ''; d['mv' + k] = '' }
  for (let k = 0; k < 5; k++) { d['zn' + k] = ''; d['zr' + k] = ''; d['zt' + k] = ''; d['zc' + k] = '#ffffff' }
  for (let k = 0; k < 7; k++) d['gem' + k] = false
  for (let k = 0; k < PLATES; k++) { d['pv' + k] = false; d['pn' + k] = ''; d['pnum' + k] = '' }
  SCREENS.forEach(k => { d['s_' + k] = false })
  d.s_lost = false
  d.lostText = ''
  d.retryLabel = ''
  for (let k = 0; k < ROUTINE_ROWS; k++) { d['ro' + k] = ''; d['rs' + k] = ''; d['rv' + k] = false }
  for (let k = 0; k < OVERVIEW_ROWS; k++) { d['on' + k] = ''; d['oc' + k] = ''; d['ol' + k] = '#1c1c1e'; d['ob' + k] = '#2c2c2e'; d['ovv' + k] = false }
  for (let k = 0; k < 4; k++) { d['c' + k] = ''; d['ss' + k] = false }
  for (let k = 0; k < 5; k++) d['q' + k] = String(k + 1)
  for (let k = 0; k < 4; k++) d['c' + k] = ''
  return d
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
  if (METRIC_SCREENS.indexOf(screen) >= 0) d.mPos = metricIndex(c, ui) + '/' + metricPages(c).length
  return d
}

/* ---------- taps ---------- */
const startFrom = (c, ui, item) => {
  if (!item) return
  ui.rp = 0
  afterPre(c, ui, startFlow(c, item.s))
}

function box (c, ui, field, dir) {
  const cur = current(c)
  if (!cur || cur.si == null) return
  if (field === 'w') ui.w = stepWeight(ui.w, stepOf(c.s, cur.e), dir)
  else if (isTimed(cur.e)) ui.r = Math.max(5, stepReps(ui.r, 5 * dir))
  else ui.r = stepReps(ui.r, dir)
}

const ACT = {
  start: (c, ui) => { const l = routinesOf(c.s); if (l.length && c.s.sy === true && !locked(c)) startFrom(c, ui, l[0]) },
  routines: (c, ui) => { ui.rp = 1 },
  rnext: (c, ui) => { ui.rp = ui.rp >= pagesOf(routinesOf(c.s).length, ROUTINE_ROWS) ? 1 : ui.rp + 1 },
  rback: (c, ui) => { ui.rp = 0 },
  skipCount: (c, ui) => { if (c.s.w) { if (c.g.hcd != null) holdStart(c) } else if (ui.cd) begin(c, ui) },
  cancelCount: (c, ui) => { if (c.s.w) holdCancel(c); else { ui.cd = null; preCancel(c) } },
  ciSkip: (c, ui) => { afterPre(c, ui, checkinSkip(c)) },
  ciBack: (c, ui) => { preCancel(c) },
  bwP1: (c, ui) => { weighInStep(c, 10) },
  bwM1: (c, ui) => { weighInStep(c, -10) },
  bwP01: (c, ui) => { weighInStep(c, 1) },
  bwM01: (c, ui) => { weighInStep(c, -1) },
  bwSave: (c, ui) => { afterPre(c, ui, weighInDone(c, true)) },
  bwSkip: (c, ui) => { afterPre(c, ui, weighInDone(c, false)) },
  bwCancel: (c, ui) => { preCancel(c) },
  mAdd: (c, ui) => { ui.menu = false; if (!ui.menuRest) addSet(c, c.s.pos) },
  // The confirm pins the set it offered (place and id); Yes removes that set or nothing
  mRemove: (c, ui) => {
    ui.menu = false
    const pos = c.s.pos
    const si = setIndex(c.s, pos)
    if (ui.menuRest || c.g.fix || si == null || !canRemove(c.s, pos, si)) return
    ui.rm = { pos: pos, si: si, sid: setId(c.s, pos, si), up: c.g.up }
    ui.confirm = 'remove'
  },
  done: (c, ui) => {
    if (locked(c)) return
    const cur = current(c)
    if (cur && cur.fixing) { fixSave(c, ui.hasW ? ui.w : null, ui.r); return }
    if (pressDone(c, ui.hasW ? ui.w : null, ui.r) === 'confirmFinish') ui.confirm = 'finish'
  },
  wMinus: (c, ui) => box(c, ui, 'w', -1),
  wPlus: (c, ui) => box(c, ui, 'w', 1),
  rMinus: (c, ui) => box(c, ui, 'r', -1),
  rPlus: (c, ui) => box(c, ui, 'r', 1),
  prev: (c, ui) => { if (current(c) && current(c).fixing) fixStep(c, -1); else fixLast(c) },
  nextFix: (c, ui) => { fixStep(c, 1) },
  cancelFix: (c, ui) => { fixCancel(c) },
  menu: (c, ui) => { ui.menuRest = screenOf(c, ui) === 'rest'; ui.menu = true },
  restMinus: (c, ui) => { if (!locked(c)) restAdd(c, -15) },
  restPlus: (c, ui) => { if (!locked(c)) restAdd(c, 15) },
  restSkip: (c, ui) => { if (!locked(c)) restSkip(c) },
  stopHold: (c, ui) => { holdStop(c) },
  mpBack: (c, ui) => { if (ui.mp > 0) ui.mp = metricIndex(c, ui) - 1 },
  mPrev: (c, ui) => { ui.menu = false; fixLast(c) },
  mOver: (c, ui) => { ui.menu = false; ui.op = 0; c.g.page = 'over' },
  mSkip: (c, ui) => { ui.menu = false; skipSet(c) },
  mNext: (c, ui) => { ui.menu = false; nextExercise(c) },
  mFinish: (c, ui) => { ui.menu = false; ui.confirm = 'finish' },
  mDiscard: (c, ui) => { ui.menu = false; ui.confirm = 'discard' },
  mBack: (c, ui) => { ui.menu = false },
  yes: (c, ui) => {
    const what = ui.confirm
    ui.confirm = null
    ui.menu = false
    if (what === 'remove') { const rm = ui.rm; ui.rm = null; if (rm && rm.up === c.g.up) removeSet(c, rm.pos, rm.si, rm.sid) } else finishWorkout(c, what === 'discard')
  },
  no: (c, ui) => { ui.confirm = null },
  keep: (c, ui) => { keepGoing(c, true) },
  askFinish: (c, ui) => { keepGoing(c, false); c.g.page = 'over'; ui.op = 0 },
  ovNext: (c, ui) => { ui.op = ui.op + 1 >= pagesOf(entries(c.s).length, OVERVIEW_ROWS) ? 0 : ui.op + 1 },
  ovBack: (c, ui) => { c.g.page = 'set' },
  finish: (c, ui) => { ui.confirm = 'finish' },
  nextEx: (c, ui) => { nextExercise(c) },
  close: (c, ui) => {
    if (c.env.now() - c.g.endedAt < CLOSE_GUARD_MS) return
    c.g.ended = null
    lockFor(c, 1000) // the Start button on the next screen waits a second too, by the core's own clock
  }
}
for (let k = 1; k <= 5; k++) {
  ACT['ci' + k] = (c, ui) => { afterPre(c, ui, checkinAnswer(c, k)) }
}
for (let k = 0; k < ROUTINE_ROWS; k++) {
  ACT['pick' + k] = (c, ui) => startFrom(c, ui, routinesOf(c.s)[(ui.rp - 1) * ROUTINE_ROWS + k])
}
for (let k = 0; k < 4; k++) {
  ACT['chip' + k] = (c, ui) => {
    const st = dictOf(c.s.set)
    rate(c, chips(st ? st.effort : null)[k])
  }
}
for (let k = 0; k < OVERVIEW_ROWS; k++) {
  // a row with sets left takes the lifter there
  ACT['ov' + k] = (c, ui) => {
    const i = ui.op * OVERVIEW_ROWS + k
    if (i >= entries(c.s).length || setIndex(c.s, i) == null) return
    c.s.pos = i
    c.g.fix = null
    c.g.page = 'set'
    save(c)
  }
}
export const ACTIONS = Object.keys(ACT)

export function act (c, ui, name) {
  if (Object.prototype.hasOwnProperty.call(ACT, name)) ACT[name](c, ui)
}

// A swipe on the page. Left opens the Metrics pages from the set or the rest and moves on through them (the last
// stays); right moves back, and from the first page lands on the workout. Anything else on top (a confirm, the
// menu) is left alone. Leaving the app by a swipe right from Start is the page's own rule.
export function swipeTo (c, ui, dir) {
  if (!c.s.w) return
  const at = screenOf(c, ui)
  const inside = METRIC_SCREENS.indexOf(at) >= 0
  if (dir === 'left') {
    if (inside) ui.mp = Math.min(metricIndex(c, ui) + 1, metricPages(c).length)
    else if (at === 'set' || at === 'rest') ui.mp = 1
  } else if (dir === 'right' && inside) ui.mp = metricIndex(c, ui) - 1
}

/* ---------- what the page does with the outside ---------- */
// The heart-rate sensor only while a workout runs, and not after three idle hours (core.js sensorShouldRest).
export const wantHr = c => !!c.s.w && !sensorShouldRest(c)
// The screen stays on only during a rest or a hold.
export const wantAwake = c => !!c.s.w && (c.s.rest != null || !!c.g.hold || c.g.hcd != null)

// core.js buzzes with [[intensity %, ms], ...]; the watch has 'long' and 'short' only. Each pair with
// an intensity is one buzz, long when the pair lasts 200 ms or more and it is the only one; a pair with 0 is a pause. Returns
// [[delay ms, mode], ...], each buzz starting when the pairs before it have run their time.
// A pattern with more than one buzz (the double at the end of a rest) uses short buzzes only: how long
// 'long' lasts is not documented, and a second long buzz could start inside the first and merge with it.
export function buzzPlan (pattern) {
  const out = []
  const pairs = arrOf(pattern)
  const several = pairs.filter(p => p[0] > 0).length > 1
  let at = 0
  pairs.forEach(p => {
    if (p[0] > 0) out.push([at, !several && p[1] >= 200 ? 'long' : 'short'])
    at += p[1]
  })
  return out
}

// The heart rate the core is fed once a second: the sensor reports every 5 s, so the last reading
// counts for up to 15 s (3 reports), then it is stale and counts as none.
export const HR_STALE_MS = 15000
export const bpmNow = (bpm, at, now) => (bpm > 0 && now - at <= HR_STALE_MS ? bpm : 0)
