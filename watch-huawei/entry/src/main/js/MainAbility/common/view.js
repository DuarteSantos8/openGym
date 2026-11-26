// What each screen shows, as plain data the page's HML binds to, and what each tap does. All the
// decisions live here (which screen is up, every line of text, which buttons exist); the page file only
// copies the data across and forwards taps. Nothing here touches a Huawei API.
//
//   ui = newUi()                the screen-only state: menus, the 3-2-1, the weight and reps boxes
//   tick(c, ui)                 once a second and after anything that changed c: starts the 3-2-1's
//                               workout, loads the boxes for the set that is up
//   build(c, ui, t) -> data     the screen's fields (always `s_<screen>`, `top`, the look)
//   act(c, ui, name)            a tap (ACTIONS lists the names; each is one handler in the page)
//   translator($t) -> t(key, a, b, c)   the watch's language through the page's $t, English from en.js where it has none
//   swipeTo(c, ui, dir)         a swipe: left opens the Metrics page from the set or the rest, right goes back; ui.mp is 1 on it
// Same language subset as core.js (test/syntax.test.js).
import {
  entries, current, setIndex, place, partners, planSize, progress, fixList, logged, hasMore, needsPhone,
  unitOf, stepOf, stepWeight, stepReps, isTimed, isCardio, locked, restLeft, restPaused, held, countNumber, chips, chipLabel,
  canRate, lastSet, waiting, save, startWorkout, finishWorkout, pressDone, skipSet, nextExercise, holdStart, holdStop, holdCancel,
  restAdd, restSkip, rate, refSet, fixLast, fixStep, fixCancel, fixSave, keepGoing, supersetStart, sensorShouldRest, lockFor
} from './core.js'
import { numbers } from './metrics.js'
import { EN } from './en.js'

export const LIME = '#A3E635'
export const ON_LIME = '#0C0E12'
export const WARM = '#FF9F0A'
export const COUNT_MS = 3700 // "3, 2, 1", "Go!" for 0.7 s, then it starts
export const CLOSE_GUARD_MS = 1000 // the summary ignores a tap for its first second
export const ROUTINE_ROWS = 3
export const OVERVIEW_ROWS = 4
export const SCREENS = ['idle', 'routines', 'count', 'wait', 'ask', 'confirm', 'menu', 'hold', 'set', 'over', 'rest', 'end', 'card', 'summary', 'mnum']
const QUIET = '#a1a1a6'
const RED = '#ff453a'

/* ---------- small helpers (ES5) ---------- */
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const toF = v => (typeof v === 'number' && isFinite(v) ? v : null)
const isTrue = v => v === true || v === 1
const isOff = v => v === false || v === 0
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
export function translator (get) {
  return (key, a, b, c) => {
    let w
    try { w = get('strings.' + key) } catch (e) { w = undefined }
    if (typeof w !== 'string' || w === '') w = EN[key]
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
export function newUi () {
  return { cd: null, rp: 0, op: 0, mp: 0, menu: false, confirm: null, key: '', w: 0, r: 0, hasW: false, rt: 0, rtFor: null, cdN: null }
}

// The routines the Start screen offers: today's first, then the others as the phone sent them.
function routinesOf (s) {
  const rd = dictOf(s.rd)
  const out = []
  if (!rd) return out
  if (dictOf(rd.today)) out.push({ s: rd.today, today: true })
  arrOf(rd.others).forEach(o => { if (dictOf(o)) out.push({ s: o, today: false }) })
  return out
}
const pagesOf = (n, per) => Math.max(1, Math.ceil(n / per))

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

const FILL = {
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
    d.top = syncText(c, t, false) // the sync pill along the bottom
  },
  routines: (c, ui, t, d) => {
    const list = routinesOf(c.s)
    const pages = pagesOf(list.length, ROUTINE_ROWS)
    const page = Math.min(ui.rp, pages)
    for (let k = 0; k < ROUTINE_ROWS; k++) {
      const item = list[(page - 1) * ROUTINE_ROWS + k]
      d['ro' + k] = item ? strOf(item.s.name) : ''
      d['rs' + k] = item && item.today ? t('today') : ''
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
    d.title = discard ? t('discard_workout_q') : t('finish_workout_q')
    d.yesLabel = discard ? t('discard_workout') : t('finish_and_save')
    d.yesColor = discard ? RED : '#ffffff' // a button that throws something away is outlined red, as Apple's Remove
    d.noLabel = t('cancel')
  },
  menu: (c, ui, t, d) => {
    const has = entries(c.s).length > 0
    d.hasPrev = fixList(c.s).length > 0
    d.hasOver = has && c.g.page !== 'over'
    d.hasSkip = has
    d.hasNext = has
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
    d.barOn = !paused
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
    d.title = m.ended ? t('ended_on_phone') : t('workout_saved')
    d.name = strOf(m.name)
    d.dur = m.dur == null ? '' : clock(m.dur)
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
  // The Metrics page (metrics.js has the numbers)
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
  }
}

// Everything the HML binds to, as the page starts with it. build() only ever returns these keys.
export function blank () {
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
  return d
}

/* ---------- taps ---------- */
const startFrom = (c, ui, item) => {
  if (!item) return
  ui.rp = 0
  ui.cd = { at: c.env.now(), session: item.s }
  ui.cdN = null
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
  cancelCount: (c, ui) => { if (c.s.w) holdCancel(c); else ui.cd = null },
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
  menu: (c, ui) => { ui.menu = true },
  restMinus: (c, ui) => { if (!locked(c)) restAdd(c, -15) },
  restPlus: (c, ui) => { if (!locked(c)) restAdd(c, 15) },
  restSkip: (c, ui) => { if (!locked(c)) restSkip(c) },
  stopHold: (c, ui) => { holdStop(c) },
  mpBack: (c, ui) => { ui.mp = 0 },
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
    finishWorkout(c, what === 'discard')
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

// A swipe on the page. Left opens the Metrics page from the set or the rest, right goes back from it to the workout.
// Anything else on top (a confirm, the menu) is left alone. Leaving the app by a swipe right from Start is the
// page's own rule.
export function swipeTo (c, ui, dir) {
  if (!c.s.w) return
  const at = screenOf(c, ui)
  if (dir === 'left' && (at === 'set' || at === 'rest')) ui.mp = 1
  else if (dir === 'right' && at === 'mnum') ui.mp = 0
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
