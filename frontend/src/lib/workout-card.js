// A finished workout as a picture, for "Share as image" in its detail sheet (#453): plain text
// loses its layout in most chat apps, a card keeps it. Three steps, so the part that decides what
// the card says and where it goes is testable without a canvas:
//   workoutCardModel  — what the card says: name, date, duration, sets, volume, new bests and
//                       how hard each muscle was worked
//   layoutWorkoutCard — where everything goes, given a way to measure text
//   drawWorkoutCard   — paints a layout onto a 2D canvas context
// Nothing here stores anything; the workout is read, never written.
import { sessionSections, workoutVolume, workoutDuration, workoutDay, doneUnits } from './history.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { MUSCLES, INERT, levelsOf, loadOfWorkouts } from './muscles.js'
import { fmtDate, fmtDur, fmtNum, fmtVol, capWords } from './format.js'
import { t, exerciseNameClass } from './i18n-core.js'

export const CARD_WIDTH = 1080
const PAD = 88
const MIN_HEIGHT = 720
// More than this many new bests and the rest are counted instead of listed: a card that grows
// past a phone screen is not glanceable any more.
export const MAX_RECORDS = 6
const TITLE_LINES = 2
const STAT_SIZE = 56
const MAP_MAX_HEIGHT = 560

/**
 * What the card says. `unit` is the profile's, `nameOf(entry)` the exercise's display name — the
 * same pair "Copy as text" takes (workoutText). Sets are work sets, as the volume is: warm-ups are
 * left out of both, the way they are left out of records and progression everywhere else. A
 * per-side set counts once per side, as the workout screen counts it. `levels` is the finish
 * summary's muscle map for this one session (levelsOf over loadOfWorkouts), null when no set
 * reached a muscle the map can show — a card of only cardio has nothing to shade.
 */
export function workoutCardModel(w, { unit, nameOf }) {
  const entries = w.entries || []
  const sets = entries.reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (isWarmupRow(s) ? 0 : doneUnits(s)), 0), 0)
  // New bests in the order the sheet lists the exercises, each named once — a combined session
  // can hold the same lift twice.
  const prs = new Set(w.prs || [])
  const records = []
  for (const i of sessionSections(entries).flatMap(section => section.units).flat()) {
    const entry = entries[i]
    if (!entry || !prs.has(entry.id) || records.some(r => r.id === entry.id)) continue
    const name = nameOf(entry)
    records.push({ id: entry.id, name: exerciseNameClass(EXIDX[entry.id]) ? capWords(name) : name })
  }
  const day = workoutDay(w)
  const ms = workoutDuration(w)
  const levels = levelsOf(loadOfWorkouts([w]))
  return {
    title: w.name || '',
    date: day ? fmtDate(day, true, true) : '',
    // Imported history has no clock: an unknown duration is left out rather than shown as 0.
    stats: [
      ...(ms >= 60000 ? [{ label: t('Duration'), value: fmtDur(ms) }] : []),
      { label: t('Sets'), value: fmtNum(sets) },
      { label: t('Volume'), value: fmtVol(w.vol ?? workoutVolume(w), unit) },
    ],
    records: records.map(r => r.name),
    levels: MUSCLES.some(m => levels[m] > 0) ? levels : null,
  }
}

// Greedy word wrap to `max` lines; the last line that does not fit is cut with an ellipsis.
// A word wider than the line on its own (a long German compound) is cut too, never overflowed.
export function wrapText(text, width, measure, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? line + ' ' + words[i] : words[i]
    if (measure(next) <= width) { line = next; continue }
    if (line) lines.push(line)
    line = words[i]
    if (lines.length === max) break
  }
  if (line && lines.length < max) lines.push(line)
  const rest = lines.join(' ').length < words.join(' ').length
  return lines.map((l, i) => (i === lines.length - 1 && (rest || measure(l) > width) ? ellipsize(l, width, measure) : l))
}
function ellipsize(text, width, measure) {
  let s = text
  while (s && measure(s + '…') > width) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}

// The largest size up to `max` at which `text` fits `width`: a 12,345.5 kg volume shrinks to fit
// its tile rather than running into the next one.
function fitSize(text, width, measure, weight, max, min = 28) {
  let size = max
  while (size > min && measure(text, weight, size) > width) size -= 2
  return size
}

/**
 * Where everything goes. `measure(text, weight, size)` returns a width in pixels — the canvas's
 * measureText in the app, a fake in the tests. `rtl` mirrors the card for Arabic: text anchors
 * at the right edge, the tiles run right to left and the trophy sits to the right of its line.
 * `map` is `{ aspect }`, one body view's height over its width, to include the muscle map, or
 * null to leave it out; a model without levels has none either way. Returns the canvas size and
 * a flat list of items for drawWorkoutCard; a text item carries its size and weight, the font
 * family is the drawer's.
 */
export function layoutWorkoutCard(model, { measure, rtl = false, width = CARD_WIDTH, map = null }) {
  const items = []
  const inner = width - PAD * 2
  const start = rtl ? width - PAD : PAD
  const dir = rtl ? -1 : 1
  let y = PAD
  const text = (str, size, weight, color, x = start, extra) => {
    items.push({ kind: 'text', text: str, x, y: y + size, size, weight, color, ...extra })
    y += Math.round(size * 1.3)
  }

  items.push({ kind: 'bar', x: start, y, w: 96 * dir, h: 10 })
  y += 10 + 52
  for (const line of wrapText(model.title, inner, s => measure(s, 700, 76), TITLE_LINES)) text(line, 76, 700, 'label')
  if (model.date) { y += 4; text(model.date, 38, 400, 'label2') }

  // The numbers as tiles, the way the finish summary shows them.
  y += 36
  const gap = 20
  const n = model.stats.length
  const tileW = (inner - gap * (n - 1)) / n
  const tileH = 150
  model.stats.forEach((stat, i) => {
    const x = rtl ? width - PAD - (i + 1) * tileW - i * gap : PAD + i * (tileW + gap)
    const textX = rtl ? x + tileW - 28 : x + 28
    const room = tileW - 56
    items.push({ kind: 'tile', x, y, w: tileW, h: tileH })
    const [label] = wrapText(stat.label, room, s => measure(s, 500, 28), 1)
    items.push({ kind: 'text', text: label, x: textX, y: y + 28 + 28, size: 28, weight: 500, color: 'label2' })
    const size = fitSize(stat.value, room, measure, 700, STAT_SIZE)
    items.push({ kind: 'text', text: stat.value, x: textX, y: y + tileH - 32, size, weight: 700, color: 'label' })
  })
  y += tileH

  // Front and back side by side, as large as the width allows without running past a phone
  // screen, with the finish summary's five-step legend under them.
  if (map && model.levels) {
    y += 48
    const viewGap = 40
    let viewW = (inner - viewGap) / 2
    let viewH = viewW * map.aspect
    if (viewH > MAP_MAX_HEIGHT) { viewH = MAP_MAX_HEIGHT; viewW = viewH / map.aspect }
    const left = (width - (viewW * 2 + viewGap)) / 2
    items.push({ kind: 'map', view: 'front', x: left, y, w: viewW, h: viewH })
    items.push({ kind: 'map', view: 'back', x: left + viewW + viewGap, y, w: viewW, h: viewH })
    y += viewH + 32
    const sw = 26
    const swGap = 8
    const less = t('Less')
    const more = t('More')
    const labelGap = 16
    const total = measure(less, 400, 28) + labelGap + 5 * sw + 4 * swGap + labelGap + measure(more, 400, 28)
    let x = (width - total) / 2
    // Read the way the language reads: "Less" first on the reading side, the ramp toward "More".
    const parts = rtl ? [more, 4, 3, 2, 1, 0, less] : [less, 0, 1, 2, 3, 4, more]
    for (const part of parts) {
      if (typeof part === 'number') {
        items.push({ kind: 'swatch', x, y, size: sw, level: part })
        x += sw + (parts.indexOf(part) === parts.length - 2 ? labelGap : swGap)
      } else {
        const w = measure(part, 400, 28)
        // Drawn left-anchored whatever the direction, so the row lands where it was measured.
        items.push({ kind: 'text', text: part, x, y: y + sw - 3, size: 28, weight: 400, color: 'label2', anchor: 'left' })
        x += w + labelGap
      }
    }
    y += sw
  }

  if (model.records.length) {
    y += 52
    text(t('New personal records'), 34, 600, 'acc')
    y += 10
    const icon = 44
    const indent = icon + 22
    const shown = model.records.length > MAX_RECORDS ? model.records.slice(0, MAX_RECORDS - 1) : model.records
    for (const name of shown) {
      items.push({ kind: 'trophy', x: rtl ? start - icon : start, y: y + 4, size: icon })
      const [line] = wrapText(name, inner - indent, s => measure(s, 500, 42), 1)
      text(line, 42, 500, 'label', start + indent * dir)
      y += 14
    }
    if (shown.length < model.records.length) text(t('and {0} more', model.records.length - shown.length), 38, 400, 'label2', start + indent * dir)
  }

  y += 64
  const height = Math.max(MIN_HEIGHT, Math.round(y + 34 + PAD))
  items.push({ kind: 'text', text: 'openGym', x: start, y: height - PAD, size: 34, weight: 700, color: 'acc' })
  return { width, height, rtl, items }
}

/* ---------- colours ---------- */

// "#rgb", "#rrggbb", "rgb(…)" or "rgba(…)" as [r, g, b, a]; null for anything else.
export function parseColor(value) {
  const s = String(value || '').trim()
  let m = s.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = i => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(p => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)))
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
}
// CSS color-mix(in srgb, a p%, b): p of `a` over the rest of `b`, as an rgb() string. A canvas
// is handed plain rgb, so the card does not depend on how a WebView parses color-mix().
export function mixColor(a, b, p) {
  const x = parseColor(a)
  const y = parseColor(b)
  if (!x || !y) return x ? a : b
  const ch = i => Math.round(x[i] * p + y[i] * (1 - p))
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}
/**
 * The muscle map's fills for the card, worked out the way index.css works them out for .bodymap:
 * the silhouette and an untouched muscle as a little label over the surface, levels 1–4 as more
 * and more accent over that. A semi-transparent label (the light theme's) is flattened onto the
 * surface first.
 */
export function mapColors({ label, surface, acc }) {
  const lab = parseColor(label)
  const flat = lab && lab[3] < 1 ? mixColor(`rgb(${lab[0]}, ${lab[1]}, ${lab[2]})`, surface, lab[3]) : label
  const base = mixColor(flat, surface, 0.11)
  return {
    sil: mixColor(flat, surface, 0.18),
    levels: [base, mixColor(acc, base, 0.32), mixColor(acc, base, 0.56), mixColor(acc, base, 0.78), acc],
  }
}

/* ---------- drawing ---------- */

// The trophy from components/Icon.jsx, on its 24×24 grid, so the card and the app agree.
const TROPHY = [
  'M7.6 4h8.8v4.6a4.4 4.4 0 0 1-8.8 0Z',
  'M7.6 5.6H4.9v1.5a3 3 0 0 0 2.9 3M16.4 5.6h2.7v1.5a3 3 0 0 1-2.9 3M12 13v3.4M8.6 20.4h6.8l-.7-4H9.3Z',
]
export const CARD_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif"

/** One body view's height over its width, from its `vb` ("minX minY width height"). */
export const viewAspect = view => {
  const [, , w, h] = String(view?.vb || '').split(/\s+/).map(Number)
  return w > 0 && h > 0 ? h / w : 1.76
}

/**
 * Paint a layout. `colors` holds bg, surface, tile, label, label2 and acc as CSS colours — the
 * app's current theme and accent, read off the root element by the caller. `map`, when the
 * layout has a map in it, is `{ body, levels }`: body-paths.js geometry for the profile's body
 * ({ front, back }) and the model's levels.
 */
export function drawWorkoutCard(ctx, layout, colors, map = null, family = CARD_FONT) {
  const { width, height, rtl, items } = layout
  const shades = mapColors(colors)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, height)
  const inset = 36
  ctx.fillStyle = colors.surface
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 48)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  for (const item of items) {
    if (item.kind === 'bar') {
      ctx.fillStyle = colors.acc
      roundRect(ctx, Math.min(item.x, item.x + item.w), item.y, Math.abs(item.w), item.h, item.h / 2)
      ctx.fill()
    } else if (item.kind === 'tile') {
      ctx.fillStyle = colors.tile || colors.bg
      roundRect(ctx, item.x, item.y, item.w, item.h, 28)
      ctx.fill()
    } else if (item.kind === 'swatch') {
      ctx.fillStyle = shades.levels[item.level]
      roundRect(ctx, item.x, item.y, item.size, item.size, 7)
      ctx.fill()
    } else if (item.kind === 'map') {
      const view = map?.body?.[item.view]
      if (view) drawView(ctx, view, item, map.levels, shades)
    } else if (item.kind === 'trophy') {
      ctx.save()
      ctx.translate(item.x, item.y)
      ctx.scale(item.size / 24, item.size / 24)
      ctx.strokeStyle = colors.acc
      ctx.lineWidth = 1.7
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const d of TROPHY) ctx.stroke(new Path2D(d))
      ctx.restore()
    } else {
      ctx.direction = item.anchor === 'left' ? 'ltr' : rtl ? 'rtl' : 'ltr'
      ctx.textAlign = item.anchor === 'left' ? 'left' : 'start'
      ctx.fillStyle = colors[item.color] || colors.label
      ctx.font = `${item.weight} ${item.size}px ${family}`
      ctx.fillText(item.text, item.x, item.y)
    }
  }
}
function drawView(ctx, view, box, levels, shades) {
  const [minX, minY, vw, vh] = String(view.vb).split(/\s+/).map(Number)
  ctx.save()
  ctx.translate(box.x, box.y)
  ctx.scale(box.w / vw, box.h / vh)
  ctx.translate(-minX, -minY)
  ctx.fillStyle = shades.sil
  for (const slug of INERT) for (const d of view.p[slug] || []) ctx.fill(new Path2D(d))
  for (const slug of MUSCLES) {
    ctx.fillStyle = shades.levels[levels?.[slug] || 0]
    for (const d of view.p[slug] || []) ctx.fill(new Path2D(d))
  }
  ctx.restore()
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
