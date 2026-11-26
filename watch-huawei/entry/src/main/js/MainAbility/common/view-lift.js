// The lift page's screens: the 3-2-1, the set (and fixing one), the hold, all sets done, the cardio card.
// Part of the view (see view-common.js): the data each screen shows, and its taps.
import { add, begin, clock, fmtW, hrText, isOff, isTrue, dictOf, join, sideWord, strOf, syncText } from './view-common.js'
let
  current, place, partners, progress, fixList, unitOf, locked, isTimed, isCardio, held, restLeft, countNumber,
  holdStart, holdCancel, holdStop, pressDone, fixSave, fixStep, fixLast, fixCancel, stepOf, stepWeight, stepReps,
  nextExercise
export function attach (K) {
  current = K.current
  place = K.place
  partners = K.partners
  progress = K.progress
  fixList = K.fixList
  unitOf = K.unitOf
  locked = K.locked
  isTimed = K.isTimed
  isCardio = K.isCardio
  held = K.held
  restLeft = K.restLeft
  countNumber = K.countNumber
  holdStart = K.holdStart
  holdCancel = K.holdCancel
  holdStop = K.holdStop
  pressDone = K.pressDone
  fixSave = K.fixSave
  fixStep = K.fixStep
  fixLast = K.fixLast
  fixCancel = K.fixCancel
  stepOf = K.stepOf
  stepWeight = K.stepWeight
  stepReps = K.stepReps
  nextExercise = K.nextExercise
}

export const WARM = '#FF9F0A'

const FILL = {
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
  }
}

function box (c, ui, field, dir) {
  const cur = current(c)
  if (!cur || cur.si == null) return
  if (field === 'w') ui.w = stepWeight(ui.w, stepOf(c.s, cur.e), dir)
  else if (isTimed(cur.e)) ui.r = Math.max(5, stepReps(ui.r, 5 * dir))
  else ui.r = stepReps(ui.r, dir)
}

const ACT = {
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
  stopHold: (c, ui) => { holdStop(c) },
  finish: (c, ui) => { ui.confirm = 'finish' },
  nextEx: (c, ui) => { nextExercise(c) }
}
add(FILL, ACT)
