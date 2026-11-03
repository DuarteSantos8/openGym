// A finished workout as a picture: "Share" on the finish summary and "Share as image" in a past
// workout's options (#453) make this same card. Plain text loses its layout in most chat apps, a
// card keeps it. Three steps, so the part that decides what the card says and where it goes is
// testable without a canvas:
//   workoutCardModel  — what the card says: name, date, duration, sets, volume, new bests, the
//                       week streak and how hard each muscle was worked
//   layoutWorkoutCard — where everything goes on a 9:16 story or a 1:1 square, given a way to
//                       measure text
//   drawWorkoutCard   — paints a layout onto a 2D canvas context
// Nothing here stores anything; the workout is read, never written. No exercise picture is ever
// on the card: the body map is the app's own drawing, the logo is the app icon's dumbbell.
import { sessionSections, workoutVolume, workoutDuration, workoutDay, doneUnits } from './history.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { MUSCLES, INERT, levelsOf, loadOfWorkouts } from './muscles.js'
import { fmtDate, fmtDur, fmtNum, fmtVol, capWords } from './format.js'
import { t, exerciseNameClass } from './i18n-core.js'
import { parseColor, mixColor, FORMATS, drawBrand, roundRect } from './card-draw.js'

export const CARD_WIDTH = 1080
const PAD = 96
// More than this many new bests and the rest are counted instead of listed: a card is a glance.
export const MAX_RECORDS = 6
const TITLE_LINES = 2
const STAT_SIZE = 64

/**
 * What the card says. `unit` is the profile's, `nameOf(entry)` the exercise's display name — the
 * same pair "Copy as text" takes (workoutText). Sets are work sets, as the volume is: warm-ups are
 * left out of both, the way they are left out of records and progression everywhere else. A
 * per-side set counts once per side, as the workout screen counts it. `levels` is the finish
 * summary's muscle map for this one session (levelsOf over loadOfWorkouts), null when no set
 * reached a muscle the map can show — a card of only cardio has nothing to shade. `warmups` is the
 * profile's "Count warm-ups in volume" (#719): the volume counts them then, the sets still do not.
 * `streak` is the week streak (lib/streak.js) to show with its flame, 0 for none.
 */
export function workoutCardModel(w, { unit, nameOf, warmups = false, streak = 0 }) {
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
      { label: t('Volume'), value: fmtVol(warmups ? workoutVolume(w, { warmups }) : (w.vol ?? workoutVolume(w)), unit) },
      { label: t('Sets'), value: fmtNum(sets) },
      { label: t('PRs'), value: records.length ? '🏆 ' + fmtNum(records.length) : '–' },
    ],
    records: records.map(r => r.name),
    streak: Number(streak) > 0 ? Number(streak) : 0,
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
export function fitSize(text, width, measure, weight, max, min = 24) {
  let size = max
  while (size > min && measure(text, weight, size) > width) size -= 2
  return size
}

/**
 * Where everything goes. `measure(text, weight, size)` returns a width in pixels — the canvas's
 * measureText in the app, a fake in the tests. `format` is 'story' (1080×1920, for Stories) or
 * 'square' (1080×1080, for a feed or a chat). `rtl` mirrors the card for Arabic: text anchors at
 * the right edge, the tiles run right to left and the trophy sits to the right of its line; the
 * logo stays as it is. `map` is `{ aspect }`, one body view's height over its width, to include
 * the muscle map, or null to leave it out; a model without levels has none either way, and the
 * map is left out too when what is left of the card is too small for it. Returns the canvas size
 * and a flat list of items for drawWorkoutCard; a text item carries its size and weight, the
 * font family is the drawer's.
 */
export function layoutWorkoutCard(model, { measure, rtl = false, map = null, format = 'story' }) {
  const square = format === 'square'
  const { width, height } = square ? FORMATS.square : FORMATS.story
  const items = []
  const inner = width - PAD * 2
  const start = rtl ? width - PAD : PAD
  const dir = rtl ? -1 : 1
  let y = PAD + (square ? 0 : 40)
  const text = (str, size, weight, color, x = start, extra) => {
    items.push({ kind: 'text', text: str, x, y: y + size, size, weight, color, ...extra })
    y += Math.round(size * 1.3)
  }

  items.push({ kind: 'bar', x: start, y, w: 96 * dir, h: 10 })
  y += 10 + (square ? 34 : 52)
  const titleSize = square ? 64 : 84
  for (const line of wrapText(model.title, inner, s => measure(s, 700, titleSize), square ? 1 : TITLE_LINES)) text(line, titleSize, 700, 'label')
  if (model.date) { y += 4; text(model.date, square ? 34 : 40, 400, 'label2') }

  // The numbers as tiles: two by two on a story, one row on a square.
  y += square ? 26 : 44
  const gap = 20
  const cols = square ? Math.max(1, model.stats.length) : 2
  const rows = Math.ceil(model.stats.length / cols)
  const tileW = (inner - gap * (cols - 1)) / cols
  const tileH = square ? 140 : 176
  const statMax = square ? 48 : STAT_SIZE
  const labelSize = square ? 26 : 30
  model.stats.forEach((stat, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    const x = rtl ? width - PAD - (c + 1) * tileW - c * gap : PAD + c * (tileW + gap)
    const ty = y + r * (tileH + gap)
    const textX = rtl ? x + tileW - 28 : x + 28
    const room = tileW - 56
    items.push({ kind: 'tile', x, y: ty, w: tileW, h: tileH })
    const [label] = wrapText(stat.label, room, s => measure(s, 500, labelSize), 1)
    items.push({ kind: 'text', text: label, x: textX, y: ty + 26 + labelSize, size: labelSize, weight: 500, color: 'label2' })
    const size = fitSize(stat.value, room, measure, 700, statMax, 20)
    const [value] = wrapText(stat.value, room, s => measure(s, 700, size), 1)
    items.push({ kind: 'text', text: value, x: textX, y: ty + tileH - 30, size, weight: 700, color: 'label' })
  })
  y += rows * tileH + Math.max(0, rows - 1) * gap

  const footY = height - PAD
  const footRoom = 110
  if (square) squareBottom({ model, items, y, footY: footY - footRoom, inner, width, rtl, measure, map })
  else storyBottom({ model, items, y, footY, footRoom, inner, width, rtl, measure, map, start, dir })

  items.push({ kind: 'sep', x: PAD, y: footY - 78, w: inner })
  items.push({ kind: 'brand', x: PAD, y: footY, w: inner, size: 40 })
  return { width, height, rtl, format: square ? 'square' : 'story', items }
}

// A story's lower half: the map as large as the room allows, then the records and the streak
// right above the footer. Worked out from the bottom up, so the map gets what is left.
function storyBottom({ model, items, y, footY, footRoom, inner, width, rtl, measure, map, start, dir }) {
  const text = (str, size, weight, color, x = start, extra) => {
    items.push({ kind: 'text', text: str, x, y: y + size, size, weight, color, ...extra })
    y += Math.round(size * 1.3)
  }
  // Worked out from the bottom up: the logo, the streak and the records keep their room, and the
  // map gets what is left between them and the tiles.
  const recSize = 42
  const recLine = Math.round(recSize * 1.3) + 14
  const cap = MAX_RECORDS
  const shown = model.records.length > cap ? model.records.slice(0, cap - 1) : model.records
  const more = model.records.length - shown.length
  const recNeed = shown.length ? Math.round(34 * 1.3) + 10 + shown.length * recLine + (more ? Math.round(38 * 1.3) : 0) + 14 : 0
  const streakNeed = model.streak > 0 ? 78 : 0
  const need = recNeed + streakNeed
  const free = footY - footRoom - need - y

  // Front and back side by side, as large as the room allows, with the finish summary's
  // five-step legend under them.
  if (map && model.levels && free > 380) {
    const before = 56
    const legend = 28 + 26
    y += before
    const viewGap = 40
    let viewH = Math.min(free - before - legend - 60, 760)
    let viewW = viewH / map.aspect
    if (viewW * 2 + viewGap > inner) { viewW = (inner - viewGap) / 2; viewH = viewW * map.aspect }
    const left = (width - (viewW * 2 + viewGap)) / 2
    items.push({ kind: 'map', view: 'front', x: left, y, w: viewW, h: viewH })
    items.push({ kind: 'map', view: 'back', x: left + viewW + viewGap, y, w: viewW, h: viewH })
    y += viewH + 28
    const sw = 26
    const swGap = 8
    const less = t('Less')
    const moreLbl = t('More')
    const labelGap = 16
    const total = measure(less, 400, 28) + labelGap + 5 * sw + 4 * swGap + labelGap + measure(moreLbl, 400, 28)
    let x = (width - total) / 2
    // Read the way the language reads: "Less" first on the reading side, the ramp toward "More".
    const parts = rtl ? [moreLbl, 4, 3, 2, 1, 0, less] : [less, 0, 1, 2, 3, 4, moreLbl]
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

  // The records and the streak sit right above the footer.
  y = Math.max(y + 52, footY - footRoom - need)
  if (shown.length) {
    text(t('New personal records'), 34, 600, 'accText')
    y += 10
    const icon = recSize + 2
    const indent = icon + 22
    for (const name of shown) {
      items.push({ kind: 'trophy', x: rtl ? start - icon : start, y: y + 4, size: icon })
      const [line] = wrapText(name, inner - indent, s => measure(s, 500, recSize), 1)
      text(line, recSize, 500, 'label', start + indent * dir)
      y += 14
    }
    if (more) text(t('and {0} more', more), 38, 400, 'label2', start + indent * dir)
    y += 14
  }
  if (model.streak > 0) {
    const size = 56
    items.push({ kind: 'flame', x: rtl ? start - size : start, y: y - 6, size })
    const label = t('{0} week streak', model.streak)
    const room = inner - size - 18
    const [line] = wrapText(label, room, s => measure(s, 600, 40), 1)
    items.push({ kind: 'text', text: line, x: start + (size + 14) * dir, y: y + 40, size: 40, weight: 600, color: 'label' })
    y += streakNeed
  }

}

// A square's lower half: the records and the streak in a column on the reading side, the two body
// views small beside them, both under the tiles.
function squareBottom({ model, items, y, footY, inner, width, rtl, measure, map }) {
  const top = y + 34
  const room = footY - top
  const hasMap = !!(map && model.levels && room > 200)
  let colW = inner
  if (hasMap) {
    const viewGap = 20
    let viewH = Math.min(room, 400)
    let viewW = viewH / map.aspect
    if (viewW * 2 + viewGap > inner * 0.5) { viewW = (inner * 0.5 - viewGap) / 2; viewH = viewW * map.aspect }
    const mapW = viewW * 2 + viewGap
    const left = rtl ? PAD : width - PAD - mapW
    const my = top + (room - viewH) / 2
    items.push({ kind: 'map', view: 'front', x: left, y: my, w: viewW, h: viewH })
    items.push({ kind: 'map', view: 'back', x: left + viewW + viewGap, y: my, w: viewW, h: viewH })
    colW = inner - mapW - 36
  }
  const start = rtl ? width - PAD : PAD
  const dir = rtl ? -1 : 1
  const recSize = 34
  const recLine = Math.round(recSize * 1.3) + 12
  const streakNeed = model.streak > 0 ? 72 : 0
  const head = Math.round(28 * 1.3) + 8
  const fits = Math.max(0, Math.floor((room - streakNeed - head - 40) / recLine))
  const cap = Math.min(4, fits)
  const shown = model.records.length > cap ? model.records.slice(0, Math.max(0, cap - 1)) : model.records
  const more = model.records.length - shown.length
  const blockH = (shown.length || more ? head + shown.length * recLine + (more ? 40 : 0) + 12 : 0) + streakNeed
  let cy = top + Math.max(0, (room - blockH) / 2)
  if (shown.length || more) {
    items.push({ kind: 'text', text: wrapText(t('New personal records'), colW, s => measure(s, 600, 28), 1)[0], x: start, y: cy + 28, size: 28, weight: 600, color: 'accText' })
    cy += head
    const icon = recSize + 2
    const indent = icon + 18
    for (const name of shown) {
      items.push({ kind: 'trophy', x: rtl ? start - icon : start, y: cy + 2, size: icon })
      const [line] = wrapText(name, colW - indent, s => measure(s, 500, recSize), 1)
      items.push({ kind: 'text', text: line, x: start + indent * dir, y: cy + recSize, size: recSize, weight: 500, color: 'label' })
      cy += recLine
    }
    if (more) {
      const [line] = wrapText(t('and {0} more', more), colW - (shown.length ? indent : 0), s => measure(s, 400, 30), 1)
      items.push({ kind: 'text', text: line, x: start + (shown.length ? indent * dir : 0), y: cy + 30, size: 30, weight: 400, color: 'label2' })
      cy += 40
    }
    cy += 12
  }
  if (model.streak > 0) {
    const size = 44
    items.push({ kind: 'flame', x: rtl ? start - size : start, y: cy, size })
    const [line] = wrapText(t('{0} week streak', model.streak), colW - size - 16, s => measure(s, 600, 36), 1)
    items.push({ kind: 'text', text: line, x: start + (size + 16) * dir, y: cy + size - 8, size: 36, weight: 600, color: 'label' })
  }
}

/* ---------- colours ---------- */

export { parseColor, mixColor } from './card-draw.js'
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

// The trophy and the flame from components/Icon.jsx, on their 24×24 grid, so the card and the app agree.
const TROPHY = [
  'M7.6 4h8.8v4.6a4.4 4.4 0 0 1-8.8 0Z',
  'M7.6 5.6H4.9v1.5a3 3 0 0 0 2.9 3M16.4 5.6h2.7v1.5a3 3 0 0 1-2.9 3M12 13v3.4M8.6 20.4h6.8l-.7-4H9.3Z',
]
export const FLAME = 'M12 20.4c3.2 0 5.4-2.1 5.4-5.1 0-3.9-3.4-5.6-2.6-9.8-2.5.8-4 2.9-4 5.1 0 1-.5 1.6-1.2 1.6-.8 0-1.2-.7-1.2-1.8-1.1 1.2-1.8 2.9-1.8 4.9 0 3 2.2 5.1 5.4 5.1Z'
export const FLAME_COLOR = '#ff9f0a'
export const CARD_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif"

/** One body view's height over its width, from its `vb` ("minX minY width height"). */
export const viewAspect = view => {
  const [, , w, h] = String(view?.vb || '').split(/\s+/).map(Number)
  return w > 0 && h > 0 ? h / w : 1.76
}

/** A 24×24 icon path, stroked (`fill` false) or filled, at x, y and `size` px. */
export function drawIcon(ctx, paths, { x, y, size, color, fill = false, width = 1.7 }) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of [].concat(paths)) {
    const p = new Path2D(d)
    if (fill) { ctx.fillStyle = color; ctx.fill(p) } else { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(p) }
  }
  ctx.restore()
}

/**
 * Paint a layout. `colors` is a palette (lib/card-draw.js cardPalette): the light or dark look the
 * person picked, with the app's accent. `map`, when the layout has a map in it, is
 * `{ body, levels }`: body-paths.js geometry for the profile's body ({ front, back }) and the
 * model's levels.
 */
export function drawWorkoutCard(ctx, layout, colors, map = null, family = CARD_FONT) {
  const { width, height, rtl, items } = layout
  const shades = mapColors(colors)
  drawCardBase(ctx, width, height, colors)
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
      drawIcon(ctx, TROPHY, { ...item, color: colors.accText || colors.acc })
    } else if (item.kind === 'flame') {
      drawIcon(ctx, FLAME, { ...item, color: FLAME_COLOR, fill: true })
    } else if (item.kind === 'sep') {
      ctx.fillStyle = colors.sep || colors.tile
      ctx.fillRect(item.x, item.y, item.w, 2)
    } else if (item.kind === 'brand') {
      drawBrand(ctx, { x: item.x, y: item.y, width: item.w, colors, family, size: item.size })
    } else {
      drawText(ctx, item, colors, rtl, family)
    }
  }
}
/** The page and its rounded card, every shared picture's background. */
export function drawCardBase(ctx, width, height, colors) {
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, height)
  const inset = 36
  ctx.fillStyle = colors.surface
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 56)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
}
export function drawText(ctx, item, colors, rtl, family) {
  ctx.direction = item.anchor === 'left' ? 'ltr' : rtl ? 'rtl' : 'ltr'
  ctx.textAlign = item.anchor === 'left' ? 'left' : item.anchor === 'center' ? 'center' : 'start'
  ctx.fillStyle = colors[item.color] || colors.label
  ctx.font = `${item.weight} ${item.size}px ${family}`
  ctx.fillText(item.text, item.x, item.y)
}
/** One body view (front or back) into a box, shaded by `levels`. */
export function drawView(ctx, view, box, levels, shades) {
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
