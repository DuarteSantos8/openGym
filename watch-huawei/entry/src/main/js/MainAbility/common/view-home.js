// The home page's screens: Start, the routines list, waiting for the phone, the summary. Part of the view
// (see view-common.js): the data each screen shows, and its taps.
import { ROUTINE_ROWS, add, arrOf, strOf, clock, pagesOf, routinesOf, syncText } from './view-common.js'
let
  entries, locked, planSize, lockFor
export function attach (K) {
  entries = K.entries
  locked = K.locked
  planSize = K.planSize
  lockFor = K.lockFor
}

export const CLOSE_GUARD_MS = 1000 // the summary ignores a tap for its first second

function planText (session, t) {
  const es = arrOf(session.entries)
  if (!es.length) return ''
  const p = planSize(es)
  return p[0] + ' ' + t('exercises') + ' · ' + p[1] + ' ' + t('sets')
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
  wait: (c, ui, t, d) => {
    d.name = strOf(c.s.w.name)
    d.body = entries(c.s).length ? t('next_on_phone') : t('waiting_phone')
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
  }
}

const startFrom = (c, ui, item) => {
  if (!item) return
  ui.rp = 0
  ui.cd = { at: c.env.now(), session: item.s }
  ui.cdN = null
}

const ACT = {
  start: (c, ui) => { const l = routinesOf(c.s); if (l.length && c.s.sy === true && !locked(c)) startFrom(c, ui, l[0]) },
  routines: (c, ui) => { ui.rp = 1 },
  rnext: (c, ui) => { ui.rp = ui.rp >= pagesOf(routinesOf(c.s).length, ROUTINE_ROWS) ? 1 : ui.rp + 1 },
  rback: (c, ui) => { ui.rp = 0 },
  close: (c, ui) => {
    if (c.env.now() - c.g.endedAt < CLOSE_GUARD_MS) return
    c.g.ended = null
    lockFor(c, 1000) // the Start button on the next screen waits a second too, by the core's own clock
  }
}
for (let k = 0; k < ROUTINE_ROWS; k++) {
  ACT['pick' + k] = (c, ui) => startFrom(c, ui, routinesOf(c.s)[(ui.rp - 1) * ROUTINE_ROWS + k])
}

add(FILL, ACT)
