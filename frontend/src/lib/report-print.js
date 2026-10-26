// Paper versions of training that happened: one finished workout (its detail sheet's "Save as
// PDF"), and the performance report over a stretch of days (Stats, History and Settings > Data).
// The numbers come from lib/report.js; the page shell, the page-break rules and the printing from
// lib/print-doc.js. Charts are inline SVG drawn here, so they stay sharp at any zoom and print the
// same on every platform. No exercise media is ever put on paper.
import { EXIDX } from './exercises.js'
import { setLabel, sessionSections, workoutVolume, sessionVolume, countsWarmups, workoutDuration, workoutDay } from './history.js'
import { isWarmupRow, hasCompletedWork } from './workout-model.js'
import { fmtNum, fmtVol, fmtDur, fmtDate, todayISO, DAYS, weekOrder, weekDayOffset } from './format.js'
import { t, tn, dateLocale } from './i18n-core.js'
import { speedUnitOf } from './speed.js'
import { printedName } from './plan-share.js'
import { esc, printShell, printDocument, probeMarks, paperDate } from './print-doc.js'
import { reportData, workSetsOf } from './report.js'

/* ----------------------------------- pieces ----------------------------------- */

const nameParts = e => printedName(EXIDX[e.id], e.n || e.muscleSnapshot?.n || e.id)

function nameHTML(e, { pr = false, short = false } = {}) {
  const ex = EXIDX[e.id]
  const { name, en, cls } = nameParts(e)
  const part = ex && ex.bp && ex.bp !== 'cardio' ? ` <span class="part">${esc(t(ex.bp))}</span>` : ''
  // `short`: a row in a long list, where the English line and the spelled-out badge cost a line each.
  const badge = pr ? ` <span class="pr">${short ? 'PR' : esc(t('New best'))}</span>` : ''
  return `<div class="ex-n ${cls}">${esc(name)}${part}${badge}</div>`
    + (en && !short ? `<div class="ex-en">${esc(en)}</div>` : '')
}

// Short day + date for lists: "Thu 15 Oct".
const listDate = iso => (iso ? fmtDate(iso, true) : '')
const clock = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' }) : '')
const signed = (n, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return ''
  const r = Math.round(n * 10 ** digits) / 10 ** digits
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + fmtNum(Math.abs(r))
}
// Change against the stretch before, as a small line under a card's number: arrow, the change
// itself and, when there was something before, the percentage ("▲ +3 · 33%"). The arrow and the
// sign carry the meaning, the colour only helps (so it reads the same in grey and to colour-blind
// eyes). Nothing when both stretches are empty.
function delta(now, before, fmt = v => fmtNum(Math.round(v))) {
  if (now == null || before == null || !(now > 0 || before > 0)) return ''
  const d = now - before
  if (!d) return `<div class="delta flat">± 0</div>`
  const pct = before > 0 ? ` · ${fmtNum(Math.abs(Math.round(d / before * 100)))}%` : ''
  return `<div class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ −'}${esc(fmt(Math.abs(d)))}${pct}</div>`
}

// A stat card: label, value, an optional line under it.
const card = (label, value, sub = '') => `<div class="card"><div class="c-l">${esc(label)}</div><div class="c-v">${value}</div>${sub}</div>`

/* ----------------------------------- charts ----------------------------------- */
// Shared rules: a recessive grid (three hairlines, labelled at the start edge), thin marks, the
// accent only on the mark that matters (the latest bar, the best point), labels in text ink.

const NICE = [1, 2, 2.5, 5, 10]
function niceMax(v) {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const n of NICE) if (n * p >= v) return n * p
  return 10 * p
}
const compact = v => (v >= 10000 ? fmtNum(Math.round(v / 100) / 10) + 'k' : fmtNum(Math.round(v)))

/** Vertical bars, one per bucket. `bars` = [{ label, value, title }]. */
export function barChartSVG(bars, { w = 680, h = 170, unit = '' } = {}) {
  const padL = 44, padR = 8, padT = 12, padB = 22
  const max = niceMax(Math.max(0, ...bars.map(b => b.value)))
  const iw = w - padL - padR, ih = h - padT - padB
  const n = Math.max(1, bars.length)
  const slot = iw / n
  const bw = Math.max(2, Math.min(36, slot * 0.62))
  const y = v => padT + ih - (v / max) * ih
  const grid = [0, 0.5, 1].map(f => {
    const v = max * f, yy = y(v)
    return `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" class="g${f === 0 ? ' base' : ''}"/><text x="${padL - 6}" y="${yy + 3}" class="ax" text-anchor="end">${esc(compact(v))}</text>`
  }).join('')
  // Every label when they fit, else every k-th so they never collide.
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)))
  const last = bars.length - 1
  const marks = bars.map((b, i) => {
    const x = padL + slot * i + (slot - bw) / 2
    const hh = Math.max(0, (b.value / max) * ih)
    const r = Math.min(3, bw / 2, hh)
    const top = padT + ih - hh
    const shape = hh > 0
      ? `<path d="M${x},${padT + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + ih} Z" class="${i === last ? 'bar hot' : 'bar'}"><title>${esc(b.title || '')}</title></path>`
      : ''
    const lab = i % every === 0 || i === last ? `<text x="${x + bw / 2}" y="${h - 6}" class="ax" text-anchor="middle">${esc(b.label)}</text>` : ''
    return shape + lab
  }).join('')
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(unit)}">${grid}${marks}</svg>`
}

/** A line over time. `pts` = [{ t, y }] ascending; `from`/`to` fix the time axis (ms). */
export function lineChartSVG(pts, { w = 680, h = 150, from, to, fmt = fmtNum, labels = [] } = {}) {
  const padL = 44, padR = 12, padT = 14, padB = 22
  const iw = w - padL - padR, ih = h - padT - padB
  if (!pts.length) return ''
  const ys = pts.map(p => p.y)
  let lo = Math.min(...ys), hi = Math.max(...ys)
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  // Round numbers on the axis: two or three steps of 1, 2, 2.5 or 5 × a power of ten.
  const step = niceMax((hi - lo) / 2)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  if (hi - lo < step * 2) hi = lo + step * 2
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v)
  const t0 = from ?? pts[0].t, t1 = Math.max(to ?? pts[pts.length - 1].t, t0 + 1)
  const x = tt => padL + ((tt - t0) / (t1 - t0)) * iw
  const y = v => padT + ih - ((v - lo) / (hi - lo)) * ih
  const grid = ticks.map(v => {
    const yy = y(v)
    return `<line x1="${padL}" x2="${w - padR}" y1="${yy}" y2="${yy}" class="g"/><text x="${padL - 6}" y="${yy + 3}" class="ax" text-anchor="end">${esc(fmt(v))}</text>`
  }).join('')
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')
  let best = 0
  pts.forEach((p, i) => { if (p.y > pts[best].y) best = i })
  const dots = pts.map((p, i) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${i === best ? 3.6 : 2.2}" class="${i === best ? 'dot hot' : 'dot'}"/>`).join('')
  // Direct labels on the last point and the best one, not on every point.
  const lab = (i, above) => {
    const p = pts[i]
    const xx = Math.min(w - padR, Math.max(padL, x(p.t)))
    const anchor = xx > w - padR - 30 ? 'end' : xx < padL + 30 ? 'start' : 'middle'
    return `<text x="${xx}" y="${y(p.y) + (above ? -7 : 13)}" class="val" text-anchor="${anchor}">${esc(fmt(p.y))}</text>`
  }
  // Above the point, unless the line comes down into it (then below, clear of the line).
  const vlabels = [...new Set([best, pts.length - 1])].map(i => lab(i, i === best || !(i > 0 && pts[i - 1].y > pts[i].y))).join('')
  const xl = labels.map(([tt, text], i) => `<text x="${x(tt)}" y="${h - 6}" class="ax" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${esc(text)}</text>`).join('')
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" role="img">${grid}<path d="${path}" class="line"/>${dots}${vlabels}${xl}</svg>`
}

/** The consistency calendar: one column per week, one row per weekday, shaded by volume. */
export function calendarSVG(days, ws, { cell = 13, gap = 3 } = {}) {
  if (!days.length) return ''
  // Two weeks or less: one strip of days, each named under its square.
  if (days.length <= 14) {
    const c = 22, g = 4
    const w = days.length * (c + g), h = c + 16
    const cells = days.map((day, i) => {
      const label = new Date(day.d + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'narrow' })
      return `<rect x="${i * (c + g)}" y="0" width="${c}" height="${c}" rx="4" class="l${day.level}"><title>${esc(day.d)}</title></rect>`
        + `<text x="${i * (c + g) + c / 2}" y="${c + 12}" class="ax" text-anchor="middle">${esc(label)}</text>`
    }).join('')
    return `<svg class="cal" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${cells}</svg>`
  }
  const first = new Date(days[0].d + 'T12:00:00')
  const lead = weekDayOffset(first.getDay(), ws)
  const cols = Math.ceil((lead + days.length) / 7)
  const left = 26, top = 4
  const w = left + cols * (cell + gap), h = top + 7 * (cell + gap)
  const rows = weekOrder(ws).map((d, i) => (i % 2 === 0 ? `<text x="${left - 5}" y="${top + i * (cell + gap) + cell - 3}" class="ax" text-anchor="end">${esc(t(DAYS[d]))}</text>` : '')).join('')
  const cells = days.map((day, i) => {
    const k = lead + i
    const cx = left + Math.floor(k / 7) * (cell + gap), cy = top + (k % 7) * (cell + gap)
    return `<rect x="${cx}" y="${cy}" width="${cell}" height="${cell}" rx="2.5" class="l${day.level}"><title>${esc(day.d)}</title></rect>`
  }).join('')
  return `<svg class="cal" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${rows}${cells}</svg>`
}

const CHART_CSS = `
  svg.chart { display: block; overflow: visible; }
  svg .g { stroke: #e9ebf0; stroke-width: 1; }
  svg .g.base { stroke: #c9cdd6; }
  svg .ax { font-size: 9px; fill: #8a909d; font-family: inherit; }
  svg .val { font-size: 9.5px; fill: #3b404b; font-weight: 600; font-family: inherit; }
  svg .bar { fill: #6b7180; }
  svg .bar.hot { fill: #4d7c0f; }
  svg .line { fill: none; stroke: #3b404b; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  svg .dot { fill: #3b404b; stroke: #fff; stroke-width: 1.2; }
  svg .dot.hot { fill: #a3e635; stroke: #3f6212; stroke-width: 1.4; }
  svg.cal { display: block; }
  svg.cal .l0 { fill: #f0f1f4; } svg.cal .l1 { fill: #e2f5bd; } svg.cal .l2 { fill: #bfe57a; }
  svg.cal .l3 { fill: #84cc16; } svg.cal .l4 { fill: #3f6212; }
`

/* ------------------------------- shared page CSS ------------------------------- */

const REPORT_CSS = `
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt; }
  .card { border: 1px solid var(--rule); border-radius: 6pt; padding: 7pt 9pt; min-width: 0; }
  .c-l { font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .c-v { font-size: 15pt; font-weight: 700; letter-spacing: -.01em; margin-top: 1pt; white-space: nowrap; }
  .c-v small { font-size: 8.5pt; font-weight: 500; color: var(--muted); margin-inline-start: 2pt; }
  .c-s { font-size: 7.5pt; color: var(--muted); }
  .delta { font-size: 7.5pt; color: var(--muted); }
  .delta.up { color: var(--lime-ink); }
  .note-line { font-size: 7.5pt; color: var(--faint); margin-top: 4pt; }

  .panel { margin-top: 2pt; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt 14pt; }
  .lift { min-width: 0; }
  .lift-h { display: flex; justify-content: space-between; gap: 6pt; align-items: baseline; }
  .lift-h .ex-n { font-size: 9pt; }
  .lift-c { font-size: 8pt; color: var(--muted); white-space: nowrap; }
  .lift-c b { color: var(--ink-2); }
  .lift-c b.up { color: var(--lime-ink); }

  .facts-row { display: flex; flex-wrap: wrap; gap: 4pt 16pt; margin-top: 6pt; font-size: 8.5pt; color: var(--ink-2); }
  .facts-row b { font-weight: 700; }
  .cal-wrap { display: flex; gap: 18pt; align-items: flex-start; flex-wrap: wrap; }
  .legend { display: flex; gap: 3pt; align-items: center; font-size: 7.5pt; color: var(--faint); margin-top: 4pt; }
  .legend i { display: inline-block; width: 8pt; height: 8pt; border-radius: 2pt; }
  .legend .l0 { background: #f0f1f4; } .legend .l1 { background: #e2f5bd; } .legend .l2 { background: #bfe57a; }
  .legend .l3 { background: #84cc16; } .legend .l4 { background: #3f6212; }
  .keep-next { break-after: avoid; page-break-after: avoid; }

  table.mus td { padding: 2.5pt 6pt 2.5pt 0; border-bottom: 0; }
  table.mus td.m { width: 26%; white-space: nowrap; }
  table.mus td.v { width: 16%; text-align: end; white-space: nowrap; color: var(--muted); }
  .hbar { height: 7pt; border-radius: 2pt; background: #6b7180; }
  .hbar.top { background: #4d7c0f; }

  .ex-n { font-weight: 600; overflow-wrap: anywhere; }
  .ex-n.capitalize { text-transform: capitalize; }
  .ex-n .part { display: inline-block; text-transform: none; color: var(--faint); font-weight: 400; font-size: 8pt; margin-inline-start: 2pt; }
  .ex-n .part::first-letter { text-transform: uppercase; }
  td.num + td.num, th.num + th.num { padding-inline-start: 12pt; }
  .ex-en { color: var(--faint); font-size: 8pt; text-transform: capitalize; overflow-wrap: anywhere; }
  .pr { display: inline-block; font-size: 6.5pt; letter-spacing: .06em; text-transform: uppercase; font-weight: 700;
    color: #3f6212; background: var(--lime-soft); border: 1px solid #d3eba4; border-radius: 3pt; padding: 0 3pt; vertical-align: 1pt; margin-inline-start: 3pt; }

  /* a list's heading, printed as its table's first header row (repeats on the next page) */
  th.t-h { font-size: 7.5pt; letter-spacing: .12em; color: var(--muted); padding: 16pt 0 3pt; border-bottom: 1px solid var(--rule); }
  .panel.list { margin-top: 0; }

  /* one workout in the report's list */
  table.wk { margin-bottom: 8pt; }
  th.wk-h { text-transform: none; letter-spacing: 0; font-size: 9.5pt; color: var(--ink); padding: 7pt 0 3pt; border-bottom: 1px solid var(--ink); }
  th.wk-h .t { font-weight: 700; overflow-wrap: anywhere; }
  th.wk-h .t span { color: var(--muted); font-weight: 500; margin-inline-end: 6pt; }
  th.wk-h .f { float: right; font-size: 8pt; color: var(--muted); font-weight: 400; white-space: nowrap; margin-inline-start: 8pt; }
  [dir="rtl"] th.wk-h .f { float: left; }
  table.wk td { font-size: 8.5pt; padding: 2.5pt 6pt 2.5pt 0; }
  table.wk td.n { width: 38%; }
  table.wk td.n .ex-n { font-weight: 500; }
  table.wk td.s { color: var(--ink-2); }
  td.wk-note { font-size: 8pt; color: var(--muted); font-style: italic; border-bottom: 0; }

  /* one exercise of a single workout */
  .wx { padding: 6pt 0 7pt; border-bottom: 1px solid var(--rule-soft); }
  .wx-h { display: flex; gap: 8pt; align-items: flex-start; }
  .wx-num { flex: none; width: 14pt; height: 14pt; margin-top: 1pt; border-radius: 50%; background: var(--tint); color: var(--muted); font-size: 7pt; font-weight: 700; line-height: 14pt; text-align: center; }
  .wx-main { flex: 1; min-width: 0; }
  .wx-sum { flex: none; font-size: 8pt; color: var(--muted); white-space: nowrap; text-align: end; }
  .sets { margin: 4pt 0 0 22pt; font-size: 0; }
  [dir="rtl"] .sets { margin: 4pt 22pt 0 0; }
  .set { display: inline-block; vertical-align: top; min-width: 23mm; margin: 0 4pt 4pt 0; padding: 3pt 6pt; border: 1px solid var(--rule); border-radius: 4pt; font-size: 8.5pt; }
  [dir="rtl"] .set { margin: 0 0 4pt 4pt; }
  .set .k { display: block; font-size: 6.5pt; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); font-weight: 700; }
  .set .v { font-weight: 600; white-space: nowrap; }
  /* "100×5 (RIR 2)" reads left to right in every language, Arabic included. */
  .set .v, table.wk td.s { unicode-bidi: isolate; direction: ltr; }
  [dir="rtl"] table.wk td.s { text-align: right; }
  .set.warm { border-style: dashed; color: var(--muted); }
  .set.warm .v { font-weight: 500; }
  .set.skip { color: var(--faint); }
  .wx-note { margin: 2pt 0 0 22pt; font-size: 8.5pt; color: var(--ink-2); font-style: italic; }
  [dir="rtl"] .wx-note { margin: 2pt 22pt 0 0; }
  .ss { border-inline-start: 2.5pt solid var(--lime); padding-inline-start: 8pt; margin: 4pt 0; }
  .ss-tag { font-size: 7pt; letter-spacing: .1em; text-transform: uppercase; color: var(--lime-ink); font-weight: 700; padding-top: 5pt; }
  .ss .wx:last-child { border-bottom: 0; }
  .session-note { border-inline-start: 2.5pt solid var(--rule); padding: 4pt 0 4pt 9pt; color: var(--ink-2); font-style: italic; white-space: pre-wrap; }
  ${CHART_CSS}
`

/* ------------------------------- one workout ------------------------------- */

function workoutUnits(w) {
  const entries = w.entries || []
  return sessionSections(entries).flatMap(s => s.units).map(u => u.map(i => entries[i]).filter(Boolean)).filter(u => u.length)
}

// The sets of one exercise as small boxes: warm-ups dashed, sets not done faint. Wraps onto as
// many lines as it needs and never runs past the page edge.
function setsHTML(e, speedUnit) {
  let n = 0
  const rows = (e.sets || []).map(s => {
    const warm = isWarmupRow(s)
    const done = hasCompletedWork(s)
    const key = warm ? t('Warm-up') : t('Set {0}', ++n)
    const value = done ? setLabel(e.id, s, e.target, speedUnit) : '–'
    return `<div class="set${warm ? ' warm' : ''}${done ? '' : ' skip'}"><span class="k">${esc(key)}</span><span class="v">${esc(value)}</span></div>`
  })
  return rows.length ? `<div class="sets">${rows.join('')}</div>` : ''
}

function entryVolume(e, S) { return workoutVolume({ entries: [e] }, { warmups: countsWarmups(S) }) }

/**
 * One finished workout on paper: what it was, when, how long and how heavy, then every exercise
 * with every set. Each exercise, and each superset, stays whole on a page.
 */
export function workoutPrintHTML(S, w, { owner = '', probe = false } = {}) {
  const m = probeMarks(probe)
  const unit = S.unit || 'kg'
  const speedUnit = speedUnitOf(S)
  const prs = new Set(w.prs || [])
  const ms = workoutDuration(w)
  const day = workoutDay(w)
  const sets = workSetsOf(w)
  const vol = sessionVolume(w, S)
  const cards = [
    ms >= 60000 ? card(t('Duration'), esc(fmtDur(ms))) : '',
    card(t('Sets'), esc(fmtNum(sets))),
    card(t('Volume'), esc(fmtVol(vol, unit))),
    card(t('New bests'), esc(fmtNum(prs.size))),
    w.bw ? card(t('Body weight'), esc(fmtNum(w.bw) + ' ' + unit)) : '',
    card(t('Exercises'), esc(fmtNum((w.entries || []).length))),
  ].filter(Boolean).slice(0, 6)
  let num = 0
  const exHTML = e => {
    const v = entryVolume(e, S)
    const done = (e.sets || []).filter(s => !isWarmupRow(s) && hasCompletedWork(s)).length
    const sum = [t('{0} sets', done), v > 0 ? fmtVol(v, unit) : ''].filter(Boolean).join(' · ')
    return `<div class="wx"><div class="wx-h"><div class="wx-num">${++num}</div><div class="wx-main">${nameHTML(e, { pr: prs.has(e.id) })}</div><div class="wx-sum">${esc(sum)}</div></div>`
      + setsHTML(e, speedUnit)
      + (e.note ? `<div class="wx-note">${esc(e.note)}</div>` : '') + '</div>'
  }
  const units = workoutUnits(w)
  const blocks = units.map((u, i) => {
    const inner = u.length > 1 ? `<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div>${u.map(exHTML).join('')}</div>` : exHTML(u[0])
    const head = i === 0 ? `${m.h('x0')}<h3 class="sec-h">${esc(t('Exercises'))}</h3>` : ''
    return `<div class="keep">${m.s('x' + i)}${head}${inner}${m.e('x' + i)}</div>`
  }).join('')
  const note = w.note ? `<div class="keep">${m.s('note')}<h3 class="sec-h">${esc(t('Session note'))}</h3><div class="session-note">${esc(w.note)}</div>${m.e('note')}</div>` : ''
  const facts = [day ? paperDate(day) : '', [clock(w.start), clock(w.end)].filter(Boolean).join(' – ')]
  const body = `<div class="keep">${m.s('cards')}<div class="cards">${cards.join('')}</div>${m.e('cards')}</div>`
    + (blocks || `<p class="none">${esc(t('no sets'))}</p>`) + note
  return printShell({ title: w.name || t('Workout'), kicker: t('Workout'), facts, owner, date: todayISO(), body, css: REPORT_CSS })
}

/* ---------------------------- the performance report ---------------------------- */

function rangeTitle(r) {
  if (r.kind === '7d') return t('Last 7 days')
  if (r.kind === '4w') return t('Last 4 weeks')
  if (r.kind === '3m') return t('Last 3 months')
  return t('{0} days', r.days)
}

const bucketLabel = (b, unit) => {
  const d = new Date(b.from + 'T12:00:00')
  if (unit === 'day') return d.toLocaleDateString(dateLocale(), { weekday: 'short' }).replace(/\.$/, '')
  if (unit === 'month') return d.toLocaleDateString(dateLocale(), { month: 'short' })
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'numeric' })
}

function summaryHTML(R, unit) {
  const T = R.totals, P = R.prev
  const bw = T.bwChange != null
    ? card(t('Body weight'), `${esc(signed(T.bwChange))}<small>${esc(unit)}</small>`, `<div class="c-s">${esc(fmtNum(T.bwStart))} → ${esc(fmtNum(T.bwEnd))} ${esc(unit)}</div>`)
    : card(t('Body weight'), T.bwEnd != null ? `${esc(fmtNum(T.bwEnd))}<small>${esc(unit)}</small>` : '–', `<div class="c-s">${esc(T.bwEnd != null ? t('One weigh-in') : t('No weigh-ins'))}</div>`)
  const cards = [
    card(t('Workouts'), esc(fmtNum(T.workouts)), delta(T.workouts, P.workouts)),
    card(t('Volume'), `${esc(compact(T.volume))}<small>${esc(unit)}</small>`, delta(T.volume, P.volume, v => `${compact(v)} ${unit}`)),
    card(t('Work sets'), esc(fmtNum(T.sets)), delta(T.sets, P.sets)),
    card(t('Training time'), esc(T.ms >= 60000 ? fmtDur(T.ms) : '–'), delta(T.ms, P.ms, v => fmtDur(Math.max(60000, v)))),
    card(t('New bests'), esc(fmtNum(T.prs)), delta(T.prs, P.prs)),
    bw,
  ]
  // The note only when at least one card carries an arrow.
  const note = cards.some(c => c.includes('class="delta')) ? `<div class="note-line">${esc(t('Arrows compare with the {0} days before.', R.range.days))}</div>` : ''
  return `<div class="cards">${cards.join('')}</div>${note}`
}

function volumeHTML(R, unit) {
  const { unit: per, buckets } = R.buckets
  const bars = buckets.map(b => ({ label: bucketLabel(b, per), value: b.volume, title: `${b.from}: ${fmtVol(b.volume, unit)}` }))
  const title = per === 'day' ? t('Volume per day') : per === 'week' ? t('Volume per week') : t('Volume per month')
  return { title, html: barChartSVG(bars, { unit }) + `<div class="note-line">${esc(unit)} · ${esc(t('Work sets only, warm-ups left out.'))}</div>` }
}

function calendarHTML(R) {
  const s = R.streak
  const facts = [
    [t('Active days'), `${fmtNum(s.activeDays)} / ${fmtNum(R.range.days)}`],
    [t('Workouts per week'), fmtNum(R.perWeek)],
    [t('Most days in a row'), fmtNum(s.longestDays)],
    [t('Week streak'), fmtNum(s.weeks ?? s.longestWeeks)],
  ]
  const legend = `<div class="legend">${esc(t('Less'))} ${[0, 1, 2, 3, 4].map(l => `<i class="lg l${l}"></i>`).join('')} ${esc(t('More'))}</div>`
  return `<div class="cal-wrap"><div>${calendarSVG(R.calendar, R.weekStart)}${legend}</div>`
    + `<div class="facts-row" style="flex-direction:column;gap:3pt">${facts.map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join('')}</div></div>`
}

function musclesHTML(R, m) {
  const list = R.muscles.worked
  if (!list.length) return `<div class="keep panel"><h3 class="sec-h">${esc(t('Sets per muscle'))}</h3><p class="none">${esc(t('No muscle work in this period.'))}</p></div>`
  const max = list[0].sets || 1
  const rows = list.map((x, i) => `<tr><td class="m">${m.s('mus' + i)}${esc(t(x.name))}${m.e('mus' + i)}</td><td><div class="hbar${i === 0 ? ' top' : ''}" style="width:${Math.max(2, Math.round(x.sets / max * 100))}%"></div></td><td class="v">${esc(t('{0} sets', x.sets >= 0.5 ? fmtNum(Math.round(x.sets)) : '<1'))}</td></tr>`).join('')
  const missed = R.muscles.missed.length ? `<div class="note-line">${esc(t('Not trained:'))} ${esc(R.muscles.missed.map(x => t(x.name)).join(', '))}</div>` : ''
  return `<table class="mus">${headRow(t('Sets per muscle'), 3, 'mus0', m)}<tbody>${rows}</tbody></table>${missed}<div class="note-line">${esc(t('Rounded to whole sets. A set counts fully for its main muscle and partly for the ones that help, so the muscles add up to more than your work sets.'))}</div>`
}

function liftsHTML(R, unit, range, m) {
  const t0 = new Date(range.from + 'T00:00:00').getTime(), t1 = new Date(range.to + 'T23:59:59').getTime()
  return R.lifts.map((l, i) => {
    const e = { id: l.id }
    const change = l.change != null ? `<b class="${l.change > 0 ? 'up' : ''}">${esc(signed(l.change))} ${esc(unit)}</b>` : ''
    const best = l.best ? `${esc(t('Best:'))} ${esc(fmtNum(l.best.y))} ${esc(unit)}` : ''
    const chart = l.points.length > 1
      ? lineChartSVG(l.points, { w: 330, h: 120, from: t0, to: t1, labels: [[t0, fmtDate(range.from)], [t1, fmtDate(range.to)]] })
      : `<p class="none small">${esc(t('One session in this period.'))} ${best}</p>`
    return `<div class="lift keep">${m.s('lift' + i)}<div class="lift-h">${nameHTML(e)}<div class="lift-c">${[change, best].filter(Boolean).join(' · ')}</div></div>${chart}${m.e('lift' + i)}</div>`
  })
}

// A list's heading as the first row of its table header: a table's header row is printed again
// at the top of every page the table continues on, so the heading can never be left alone at
// the bottom of a page, and a continued list says what it is.
function headRow(title, cols, id, m, more = '') {
  return `<thead><tr><th colspan="${cols}" class="t-h">${m.h(id)}${esc(title)}</th></tr>${more}</thead>`
}

function prsHTML(R, unit, m) {
  const rows = R.prs.map((p, i) => {
    const e = p.entry || { id: p.id }
    const set = p.best ? `${fmtNum(p.best.w)} ${unit} × ${p.best.r}` : (p.entry ? (p.entry.sets || []).filter(s => !isWarmupRow(s) && hasCompletedWork(s)).map(s => setLabel(p.id, s, p.entry.target)).slice(-1)[0] || '' : '')
    return `<tr><td style="white-space:nowrap">${m.s('pr' + i)}${esc(listDate(p.d))}${m.e('pr' + i)}</td><td>${nameHTML(e)}</td><td class="num">${esc(set)}</td><td class="num">${p.best ? esc(fmtNum(p.best.est) + ' ' + unit) : '–'}</td></tr>`
  }).join('')
  return `<table>${headRow(t('New bests'), 4, 'pr0', m, `<tr><th>${esc(t('Date'))}</th><th>${esc(t('Exercise'))}</th><th class="num">${esc(t('Best set'))}</th><th class="num">${esc(t('Est. 1RM'))}</th></tr>`)}<tbody>${rows}</tbody></table>`
}

function workoutListItem(S, w, unit, speedUnit, m, id, lead = '') {
  const prs = new Set(w.prs || [])
  const ms = workoutDuration(w)
  const facts = [ms >= 60000 ? fmtDur(ms) : '', fmtVol(sessionVolume(w, S), unit), t('{0} sets', workSetsOf(w))].filter(Boolean).join(' · ')
  const rows = workoutUnits(w).flat().map((e, j) => {
    const sets = (e.sets || []).filter(s => !isWarmupRow(s) && hasCompletedWork(s)).map(s => setLabel(e.id, s, e.target, speedUnit))
    if (!sets.length) return ''
    return `<tr><td class="n">${m.s(id + 'r' + j)}${nameHTML(e, { pr: prs.has(e.id), short: true })}</td><td class="s">${esc(sets.join(', '))}${m.e(id + 'r' + j)}</td></tr>`
  }).join('')
  const note = w.note ? `<tr><td colspan="2" class="wk-note">${esc(w.note)}</td></tr>` : ''
  // One table per workout: it stays on one page when it fits; a workout longer than a page
  // breaks between exercises, and its header row (date, name, totals) comes along to the next.
  // The probe id starts with T-: the check allows such a block to run over, but only from the
  // top of a page, never because it was started near the bottom.
  const end = m.e('T-' + id)
  return `<table class="wk keep"><thead>${lead}<tr><th colspan="2" class="wk-h">${m.s('T-' + id)}<span class="f">${esc(facts)}</span><span class="t"><span>${esc(listDate(workoutDay(w)))}</span>${esc(w.name || t('Workout'))}</span></th></tr></thead>`
    + `<tbody>${rows}${note}${end ? `<tr><td colspan="2" style="padding:0;border:0">${end}</td></tr>` : ''}</tbody></table>`
}

/**
 * The performance report for `range` ('7d' | '4w' | '3m' | 'custom' with from/to, ISO days):
 * summary cards with the change against the stretch before, the charts (volume, consistency
 * calendar, muscles, estimated 1RM of the top lifts, body weight), and the lists (new bests,
 * every workout with its sets).
 */
export function reportPrintHTML(S, { range = '4w', from, to, owner = '', probe = false, today } = {}) {
  const m = probeMarks(probe)
  const unit = S.unit || 'kg'
  const speedUnit = speedUnitOf(S)
  const R = reportData(S, { range, from, to, today })
  const r = R.range
  // A section: its heading travels with its first block, which stays whole on a page.
  const section = (id, title, html) => `<div class="keep panel">${m.s(id)}${m.h(id)}<h3 class="sec-h">${esc(title)}</h3>${html}${m.e(id)}</div>`
  const parts = []
  parts.push(`<div class="keep">${m.s('summary')}${summaryHTML(R, unit)}${m.e('summary')}</div>`)
  if (!R.workouts.length) {
    parts.push(`<p class="none">${esc(t('No workouts in this period.'))}</p>`)
  } else {
    const vol = volumeHTML(R, unit)
    parts.push(section('volume', vol.title, vol.html))
    parts.push(section('consistency', t('Consistency'), calendarHTML(R)))
    // Up to eighteen rows: a list that may run over a page, row by row, its heading kept with it.
    parts.push(`<div class="panel list">${musclesHTML(R, m)}</div>`)
    if (R.lifts.length) {
      // Two charts a row; the heading rides with the first row.
      const blocks = liftsHTML(R, unit, r, m)
      parts.push(`<div class="keep panel">${m.s('lifts-h')}${m.h('lifts-h')}<h3 class="sec-h">${esc(t('Estimated 1RM, top lifts'))}</h3><div class="two">${blocks.slice(0, 2).join('')}</div>${m.e('lifts-h')}</div>`)
      if (blocks.length > 2) parts.push(`<div class="keep two" style="margin-top:8pt">${blocks.slice(2).join('')}</div>`)
    }
  }
  if (R.bodyweight.length > 1) {
    const t0 = new Date(r.from + 'T00:00:00').getTime(), t1 = new Date(r.to + 'T23:59:59').getTime()
    const pts = R.bodyweight.map(b => ({ t: b.t, y: b.w }))
    parts.push(section('bw', t('Body weight'), lineChartSVG(pts, { from: t0, to: t1, labels: [[t0, fmtDate(r.from)], [t1, fmtDate(r.to)]] })
      + `<div class="note-line">${esc(unit)} · ${esc(tn('{0} weigh-in', '{0} weigh-ins', R.bodyweight.length))}</div>`))
  }
  // A long list may run over a page: its rows never split and its header row repeats. The heading
  // stays with the first rows (break-after: avoid, and the probe checks it).
  if (R.prs.length) parts.push(`<div class="panel list">${prsHTML(R, unit, m)}</div>`)
  if (R.workouts.length) {
    const lead = `<tr><th colspan="2" class="t-h">${m.h('T-wk0')}${esc(t('All workouts'))}</th></tr>`
    R.workouts.forEach((w, i) => parts.push(workoutListItem(S, w, unit, speedUnit, m, 'wk' + i, i === 0 ? lead : '')))
  }
  const facts = [`${paperDate(r.from)} – ${paperDate(r.to)}`, tn('{0} workout', '{0} workouts', R.workouts.length)]
  return printShell({ title: rangeTitle(r), kicker: t('Performance report'), facts, owner, date: today || todayISO(), body: parts.join(''), css: REPORT_CSS })
}

/** Print the report (see printDocument): the dialog on the web, the print sheet in the app. */
export function printReport(S, opts) {
  return printDocument(reportPrintHTML(S, opts), t('Performance report'))
}

/** Print one finished workout. */
export function printWorkout(S, w, opts) {
  return printDocument(workoutPrintHTML(S, w, opts), w.name || t('Workout'))
}
