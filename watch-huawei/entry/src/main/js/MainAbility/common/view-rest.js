// The rest page's screens: the rest, Still training?, the menu, the Overview, the Metrics page, the Finish and
// Discard question. Part of the view (see view-common.js): the data each screen shows, and its taps.
import { numbers, attach as attachMetrics } from './metrics.js'
import { OVERVIEW_ROWS, QUIET, add, arrOf, clock, dictOf, fmtW, hrText, isOff, isTrue, join, pagesOf, sideWord, strOf, syncText, toF } from './view-common.js'
let
  entries, current, place, locked, restLeft, restPaused, chips, chipLabel, canRate, refSet, rate, unitOf, isTimed,
  fixList, hasMore, progress, supersetStart, lastSet, finishWorkout, keepGoing, skipSet, nextExercise, fixLast,
  setIndex, save, restAdd, restSkip
export function attach (K) {
  entries = K.entries
  current = K.current
  place = K.place
  locked = K.locked
  restLeft = K.restLeft
  restPaused = K.restPaused
  chips = K.chips
  chipLabel = K.chipLabel
  canRate = K.canRate
  refSet = K.refSet
  rate = K.rate
  unitOf = K.unitOf
  isTimed = K.isTimed
  fixList = K.fixList
  hasMore = K.hasMore
  progress = K.progress
  supersetStart = K.supersetStart
  lastSet = K.lastSet
  finishWorkout = K.finishWorkout
  keepGoing = K.keepGoing
  skipSet = K.skipSet
  nextExercise = K.nextExercise
  fixLast = K.fixLast
  setIndex = K.setIndex
  save = K.save
  restAdd = K.restAdd
  restSkip = K.restSkip
  attachMetrics(K)
}

const RED = '#ff453a'
// Apple's colours for an effort chip, by the phone's bands (lib/effort.js): purple, red, orange, yellow, the accent, teal.
const BANDS = ['#bf5af2', '#ff453a', '#ff9f0a', '#ffd60a', null, '#40c8e0']
const BAND_TOPS = [0.25, 0.75, 1.5, 2.5, 3.5]
function bandColor (kind, v, accent) {
  const rir = kind === 'rpe' ? 10 - v : v
  let i = 0
  while (i < BAND_TOPS.length && rir > BAND_TOPS[i]) i++
  return BANDS[i] || accent
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

const ACT = {
  restMinus: (c, ui) => { if (!locked(c)) restAdd(c, -15) },
  restPlus: (c, ui) => { if (!locked(c)) restAdd(c, 15) },
  restSkip: (c, ui) => { if (!locked(c)) restSkip(c) },
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
  ovBack: (c, ui) => { c.g.page = 'set' }
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

add(FILL, ACT)
