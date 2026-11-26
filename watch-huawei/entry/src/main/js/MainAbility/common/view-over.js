// The over page's screen: the Overview (a list of the exercises; a row with sets left takes the lifter to its set).
// Part of the view (see view-common.js): the data the screen shows, and its taps.
import { OVERVIEW_ROWS, add, arrOf, dictOf, isTrue, pagesOf, strOf, syncText, toF } from './view-common.js'
let
  entries, hasMore, progress, supersetStart, setIndex, save
export function attach (K) {
  entries = K.entries
  hasMore = K.hasMore
  progress = K.progress
  supersetStart = K.supersetStart
  setIndex = K.setIndex
  save = K.save
}

function setCount (e) {
  let done = 0
  let all = 0
  arrOf(e.sets).forEach(r => { if (dictOf(r) && !isTrue(r.warmup)) { all += 1; if (isTrue(r.done)) done += 1 } })
  return [done, all]
}

const FILL = {
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
  }
}

const ACT = {
  ovNext: (c, ui) => { ui.op = ui.op + 1 >= pagesOf(entries(c.s).length, OVERVIEW_ROWS) ? 0 : ui.op + 1 },
  ovBack: (c, ui) => { c.g.page = 'set' }
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
