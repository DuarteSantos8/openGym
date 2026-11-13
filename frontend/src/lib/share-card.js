// The workout share card, redone for 1.4.5 (Sharan's idea, Discord): four templates, your own
// photo behind the numbers, a switch per element and three export sizes. Same three steps as
// lib/workout-card.js, so everything that decides what goes where is testable without a canvas:
//   shareCardModel  — what the card can say (the workout card's model plus the best set per
//                     exercise, the exercise list and the session's heart rate)
//   layoutShareCard — where it goes for a template, a size and the elements switched on
//   drawShareCard   — paints a layout onto a 2D context, with the photo if there is one
// The photo is the owner's own (a picture on this workout or one picked from the gallery or the
// camera). It is handed in as a bitmap and repainted, so the PNG that leaves carries no EXIF or
// GPS. Catalogue stills and animations never go on a card (licence, NOTICE.md): nothing here
// knows where they live, and the photo slot only takes what the sheet decoded from the owner's
// file.
import { sessionSections, workoutVolume, workoutDuration, doneUnits, modeOf, isBw, setLabel } from './history.js'
import { EXIDX } from './exercises.js'
import { isWarmupRow, hasCompletedWork, isSideSet } from './workout-model.js'
import { bestSetOf } from './onerm.js'
import { sanitizeHr } from './heart-rate.js'
import { viewEntry, exUnitOf } from './ex-unit.js'
import { fmtDur, fmtNum, fmtVol, capWords } from './format.js'
import { t, tn, exerciseNameClass } from './i18n-core.js'
import { parseColor, mixColor, drawBrand, roundRect, BRAND, accTextOnLight } from './card-draw.js'
import { isoRun } from './bidi.js'
import { workoutCardModel, wrapText, fitSize, mapColors, drawView, drawIcon, TROPHY, FLAME, FLAME_COLOR, CARD_FONT } from './workout-card.js'

export const SHARE_TEMPLATES = ['classic', 'photo', 'lifts', 'sticker']
export const SHARE_LOOKS = ['dark', 'light', 'accent']
// Story keeps out of Instagram's own chrome: the top 250 px (the name and the progress bars) and
// the bottom 340 px (the reply field) stay free of anything that has to be read.
export const SHARE_FORMATS = {
  story: { width: 1080, height: 1920, top: 250, bottom: 340 },
  portrait: { width: 1080, height: 1350, top: 104, bottom: 104 },
  square: { width: 1080, height: 1080, top: 88, bottom: 88 },
}
export const SHARE_FORMAT_IDS = Object.keys(SHARE_FORMATS)
// Everything that can be switched off, in the order the sheet lists the switches.
export const SHARE_ELEMENTS = ['title', 'date', 'duration', 'volume', 'sets', 'prs', 'exercises', 'map', 'streak', 'hr', 'logo']
export const MAX_LIFTS = 8
const PAD = 96
const HEART = 'M12 20c-.4 0-.8-.1-1-.4l-6.2-6a4.6 4.6 0 0 1 0-6.6 4.4 4.4 0 0 1 6.2 0l1 1 1-1a4.4 4.4 0 0 1 6.2 0 4.6 4.6 0 0 1 0 6.6l-6.2 6c-.2.3-.6.4-1 .4Z'

/** Which elements are on: every one, minus the ids in `hidden` (the profile's list). */
export function shownElements(hidden = []) {
  const off = new Set(Array.isArray(hidden) ? hidden : [])
  return Object.fromEntries(SHARE_ELEMENTS.map(id => [id, !off.has(id)]))
}

/** The session's heart rate: the one the watch or the health hub saved for it, else the sets' own. */
export function workoutHr(w) {
  const own = sanitizeHr(w?.hr)
  if (own) return own
  let sum = 0, n = 0, max = 0
  for (const e of w?.entries || []) {
    for (const s of e?.sets || []) {
      const hr = sanitizeHr(s?.hr)
      if (!hr || isWarmupRow(s)) continue
      sum += hr.avg; n++; max = Math.max(max, hr.max)
    }
  }
  return n ? { avg: Math.round(sum / n), max } : null
}

// The finished sides of a per-side set as sets of their own, everything else as it is.
const flatSets = sets => sets.flatMap(s => (isSideSet(s) ? [s.sides.L, s.sides.R].filter(x => x?.done === true) : [s]))

/**
 * The best set of one exercise in this workout, as the card writes it: "100 kg × 5" for a
 * weighted lift (the heaviest by estimated 1RM), "12 reps" or "+10 × 12" for body weight, the
 * longest hold or the longest cardio set otherwise. null when nothing was finished.
 */
export function bestSetLabel(entry, opts = {}) {
  return isoRun(bestSetText(entry, opts))
}
function bestSetText(entry, { unit = 'kg', speedUnit } = {}) {
  const sets = (entry?.sets || []).filter(s => hasCompletedWork(s) && !isWarmupRow(s))
  if (!sets.length) return null
  const cfg = { ...(entry.target || {}), id: entry.target?.id ?? entry.id }
  const mode = modeOf(cfg)
  if (mode === 'reps') {
    const bw = isBw(cfg)
    const best = bw ? null : bestSetOf(entry)
    if (best && best.w > 0) return `${fmtNum(best.w)} ${unit} × ${best.r}`
    // Added weight beats more reps on a body-weight lift: "+10 × 6" says more than "12 reps".
    const score = s => (Number(s.w) > 0 ? 1e6 + Number(s.w) * 1000 : 0) + (Number(s.r) || 0)
    const top = flatSets(sets).reduce((a, s) => (!a || score(s) > score(a) ? s : a), null)
    if (!top || !(Number(top.r) > 0)) return null
    const r = Math.round(Number(top.r))
    return Number(top.w) > 0 ? (bw ? `+${fmtNum(top.w)} ${unit} × ${r}` : `${fmtNum(top.w)} ${unit} × ${r}`) : t('{0} reps', r)
  }
  const score = s => (mode === 'time' ? Number(s.sec) || 0 : (Number(s.km) || 0) * 1e4 + (Number(s.min) || 0))
  const top = sets.reduce((a, s) => (!a || score(s) > score(a) ? s : a), null)
  return top ? setLabel(entry.id, top, entry.target, speedUnit) : null
}

/**
 * What the card can say. The same inputs as workoutCardModel, plus `state` (the profile, for an
 * exercise logged in a weight unit of its own) and `speedUnit` for cardio. `stats` are keyed by
 * element id so the switches can drop them; `lifts` is every exercise with a finished work set,
 * in the order the detail sheet lists them, a lift done twice counted once.
 */
export function shareCardModel(w, { unit = 'kg', nameOf, warmups = false, streak = 0, state = null, speedUnit } = {}) {
  const base = workoutCardModel(w, { unit, nameOf, warmups, streak })
  const prs = new Set(w.prs || [])
  const entries = w.entries || []
  const lifts = []
  for (const i of sessionSections(entries).flatMap(section => section.units).flat()) {
    const stored = entries[i]
    if (!stored) continue
    const entry = state ? viewEntry(state, stored) : stored
    const sets = (entry.sets || []).reduce((n, s) => n + (isWarmupRow(s) ? 0 : doneUnits(s)), 0)
    if (!sets) continue
    const best = bestSetLabel(entry, { unit: state ? exUnitOf(state, entry.id) : unit, speedUnit })
    const seen = lifts.find(l => l.id === entry.id)
    if (seen) { seen.sets += sets; continue }
    const name = nameOf(entry)
    lifts.push({ id: entry.id, name: exerciseNameClass(EXIDX[entry.id]) ? capWords(name) : name, sets, best, pr: prs.has(entry.id) })
  }
  const ms = workoutDuration(w)
  const hr = workoutHr(w)
  const records = lifts.filter(l => l.pr).length
  const stats = [
    ...(ms >= 60000 ? [{ id: 'duration', label: t('Duration'), value: fmtDur(ms) }] : []),
    { id: 'volume', label: t('Volume'), value: fmtVol(warmups ? workoutVolume(w, { warmups }) : (w.vol ?? workoutVolume(w)), unit) },
    { id: 'sets', label: t('Sets'), value: fmtNum(lifts.reduce((n, l) => n + l.sets, 0)) },
    { id: 'prs', label: t('PRs'), value: records ? fmtNum(records) : '–', ...(records ? { icon: 'trophy' } : {}) },
    ...(hr ? [{ id: 'hr', label: t('Heart rate'), value: t('{0} bpm', hr.avg), icon: 'heart' }] : []),
  ]
  return { title: base.title, date: base.date, stats, lifts, records: base.records, streak: base.streak, levels: base.levels, hr }
}

/* ---------------------------------------------------------------- photo placement -- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))
export const ZOOM_MAX = 4

/**
 * Where a photo of iw×ih lands to cover a W×H card. `pan.x` / `pan.y` run from -1 (the photo's
 * left or top edge at the card's) to 1 (its right or bottom edge), 0 is centred; `pan.zoom` is
 * on top of the cover scale, 1 to ZOOM_MAX. Kept relative so a photo placed for a story still
 * sits right when the size changes to a square.
 */
export function photoRect(iw, ih, W, H, pan = {}) {
  const s = Math.max(W / iw, H / ih) * clamp(pan.zoom || 1, 1, ZOOM_MAX)
  const w = iw * s, h = ih * s
  const ox = w - W, oy = h - H
  return { x: -ox / 2 - clamp(pan.x, -1, 1) * ox / 2, y: -oy / 2 - clamp(pan.y, -1, 1) * oy / 2, w, h }
}

/** The pan after a drag of dx, dy card pixels: the photo follows the finger, and stops at its edges. */
export function panBy(pan, dx, dy, iw, ih, W, H) {
  const r = photoRect(iw, ih, W, H, { ...pan, x: 0, y: 0 })
  const ox = r.w - W, oy = r.h - H
  return {
    zoom: clamp(pan.zoom || 1, 1, ZOOM_MAX),
    x: ox > 0.5 ? clamp((pan.x || 0) - (2 * dx) / ox, -1, 1) : 0,
    y: oy > 0.5 ? clamp((pan.y || 0) - (2 * dy) / oy, -1, 1) : 0,
  }
}

/** The pan at another zoom, clamped. */
export const zoomTo = (pan, zoom) => ({ x: clamp(pan.x, -1, 1), y: clamp(pan.y, -1, 1), zoom: clamp(zoom, 1, ZOOM_MAX) })

/**
 * How much a photo needs darkening under white text, 0 to 1, from the RGBA pixels of the part
 * the text sits on (a few hundred sampled pixels are plenty). A night shot needs little, a
 * bright beach a lot.
 */
export function shadeFor(data) {
  if (!data || data.length < 4) return 0.6
  let sum = 0, n = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
    n++
  }
  if (!n) return 0.6
  return clamp(0.35 + (sum / n) * 0.65, 0.35, 1)
}

/* ---------------------------------------------------------------- colours -- */

const lum = c => {
  const p = parseColor(c)
  if (!p) return 0
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2])
}
const rgba = (c, a) => { const p = parseColor(c) || [0, 0, 0]; return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${a})` }

/**
 * The colours for a template and a look. A photo is always white type on the darkened photo. A
 * sticker has no background at all: white type (dark look), black (light) or the accent. The
 * accent look paints the page in the accent and picks black or white type for it.
 */
export function sharePalette(template, look, acc = BRAND.green) {
  const a = parseColor(acc) ? acc : BRAND.green
  const white = { label: '#ffffff', label2: 'rgba(255, 255, 255, 0.78)', tile: 'rgba(255, 255, 255, 0.14)', sep: 'rgba(255, 255, 255, 0.2)', surface: '#101010', acc: a, accText: a, light: false }
  if (template === 'photo') return { ...white, bg: '#000000' }
  if (template === 'sticker') {
    if (look === 'light') return { ...white, label: '#000000', label2: 'rgba(0, 0, 0, 0.66)', surface: '#ffffff', accText: accTextOnLight(a), light: true, bg: null }
    if (look === 'accent') return { ...white, label: a, label2: rgba(a, 0.86), bg: null, shadow: true }
    return { ...white, bg: null, shadow: true }
  }
  if (look === 'light') {
    return { bg: '#f2f2f7', surface: '#f2f2f7', tile: '#ffffff', label: '#000000', label2: '#6c6c70', sep: '#d8d8de', acc: a, accText: accTextOnLight(a), glow: rgba(a, 0.16), light: true }
  }
  if (look === 'accent') {
    const ink = lum(a) > 0.36 ? '#000000' : '#ffffff'
    return { bg: a, surface: a, tile: rgba(ink, 0.12), label: ink, label2: rgba(ink, 0.72), sep: rgba(ink, 0.2), acc: ink, accText: ink, glow: rgba(ink === '#000000' ? '#ffffff' : '#000000', 0.18), light: ink === '#000000', onAccent: true }
  }
  return { bg: '#000000', surface: '#000000', tile: '#1c1c1e', label: '#ffffff', label2: '#98989f', sep: '#2c2c2e', acc: a, accText: a, glow: rgba(a, 0.24), light: false }
}

// The colours one can pick in the sheet (TestFlight 11-08: "a different colour as background or
// keep it see-through, same for other parts of the card"). 'auto' is the look's own; 'clear' a
// see-through background (a PNG with alpha); anything else a colour. The logo is never recoloured:
// it keeps the brand and sits on its dark badge wherever the paper is not its own (card-draw.js).
export const SHARE_BG_PRESETS = ['auto', 'brand', 'black', 'white', 'accent', 'clear']
export const SHARE_INK_PRESETS = ['auto', 'white', 'black', 'brand']
export const SHARE_HI_PRESETS = ['auto', 'brand', 'white', 'black']
const NAMED = { brand: BRAND.ink, black: '#000000', white: '#ffffff' }
const HI_NAMED = { brand: BRAND.green, white: '#ffffff', black: '#000000' }
const INK_NAMED = { white: '#ffffff', black: '#000000', brand: BRAND.green }
const hex = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null)

/** A picked colour as a CSS colour: a preset's, a custom #rrggbb, or null for the look's own. */
export function pickedColor(v, named, acc) {
  if (!v || v === 'auto') return null
  if (v === 'accent') return acc
  return named[v] || hex(v)
}

function contrastOf(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The look's palette with the sheet's picks on top: `bg` a background ('clear' for none), `ink`
 * the type and `hi` the highlights (the bar, the trophies, a record's best set). Type that is
 * left on 'auto' turns black or white for a picked background, so it stays readable; a highlight
 * too close to the paper falls back to the type's colour. A photo keeps its photo behind.
 */
export function customPalette(base, { template = 'classic', bg = 'auto', ink = 'auto', hi = 'auto' } = {}, acc = BRAND.green) {
  const out = { ...base }
  const own = template === 'classic' || template === 'lifts'
  if (own && bg === 'clear') {
    out.bg = null
    out.surface = '#101010'
    out.glow = null
    out.clear = true
    out.shadow = !out.light
  } else if (own) {
    const b = pickedColor(bg, NAMED, acc)
    if (b) {
      const dark = lum(b) <= 0.36
      const t0 = dark ? '#ffffff' : '#000000'
      Object.assign(out, { bg: b, surface: b, tile: rgba(t0, 0.12), label: t0, label2: rgba(t0, 0.72), sep: rgba(t0, 0.2), glow: null, light: !dark, onAccent: false })
      out.accText = contrastOf(out.acc, b) >= 3 ? out.acc : t0
      if (contrastOf(out.acc, b) < 1.6) out.acc = t0
    }
  }
  const k = pickedColor(ink, INK_NAMED, acc)
  if (k) {
    Object.assign(out, { label: k, label2: rgba(k, 0.78), sep: rgba(k, 0.22) })
    if (own && out.bg) out.tile = rgba(k, 0.12)
  }
  const h = pickedColor(hi, HI_NAMED, acc)
  if (h) {
    const paper = out.bg || (out.light ? '#ffffff' : '#000000')
    const ok = contrastOf(h, paper) >= 1.6
    out.acc = ok ? h : out.label
    out.accText = ok && contrastOf(h, paper) >= 3 ? h : out.label
    out.onAccent = false
  }
  return out
}

/* ---------------------------------------------------------------- layout -- */

/**
 * Where everything goes. `template` is one of SHARE_TEMPLATES, `format` one of SHARE_FORMATS
 * (a sticker is as tall as its content), `show` what shownElements says is on, `measure(text,
 * weight, size)` a width in px, `map` { aspect } of one body view or null, `photo` true when a
 * photo is behind the photo template. Returns { width, height, transparent, items }.
 */
export function layoutShareCard(model, { template = 'classic', format = 'story', show = shownElements(), measure, rtl = false, map = null, photo = false }) {
  const tpl = SHARE_TEMPLATES.includes(template) ? template : 'classic'
  const F = SHARE_FORMATS[format] || SHARE_FORMATS.story
  const width = F.width
  const small = format === 'square'
  const ctx = { model, show, measure, rtl, width, small, start: rtl ? width - PAD : PAD, end: rtl ? PAD : width - PAD, dir: rtl ? -1 : 1, inner: width - PAD * 2 }
  ctx.stats = model.stats.filter(s => show[s.id] !== false && !(s.id === 'prs' && !show.prs))
  ctx.hasMap = !!(map && model.levels && show.map)
  ctx.aspect = map?.aspect || 1.76
  if (tpl === 'sticker') return stickerLayout(ctx)
  const height = F.height
  const items = []
  if (tpl === 'photo') {
    items.push({ kind: 'photo', x: 0, y: 0, w: width, h: height, empty: !photo })
    return photoLayout(ctx, items, F, height)
  }
  items.push({ kind: 'bg', w: width, h: height })
  items.push({ kind: 'glow', x: rtl ? width * 0.1 : width * 0.9, y: F.top * 0.4, r: width * 0.95 })
  return pageLayout(ctx, items, F, height, tpl)
}

const lh = size => Math.round(size * 1.28)
function textItem(ctx, items, str, y, size, weight, color, extra = {}) {
  items.push({ kind: 'text', text: str, x: ctx.start, y: y + size, size, weight, color, ...extra })
  return y + lh(size)
}
// The heading: the title (two lines at most) and the date under it.
function headH(ctx, sizes) {
  let h = 0
  if (ctx.show.title && ctx.model.title) h += wrapText(ctx.model.title, ctx.inner, s => ctx.measure(s, 700, sizes.title), sizes.titleLines).length * lh(sizes.title)
  if (ctx.show.date && ctx.model.date) h += 6 + lh(sizes.date)
  return h
}
function head(ctx, items, y, sizes, colors = {}) {
  if (ctx.show.title && ctx.model.title) {
    for (const line of wrapText(ctx.model.title, ctx.inner, s => ctx.measure(s, 700, sizes.title), sizes.titleLines)) y = textItem(ctx, items, line, y, sizes.title, 700, colors.title || 'label', { track: -0.02 })
  }
  if (ctx.show.date && ctx.model.date) y = textItem(ctx, items, ctx.model.date, y + 6, sizes.date, 500, colors.date || 'label2')
  return y
}

// The numbers in rows, value over label: up to four in a row, five go three and two, so a number
// never shrinks to nothing next to its neighbours.
const chunk = (list, per) => { const out = []; for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per)); return out }
const rowsOf = (n, max) => (n <= max ? [n] : chunk(Array.from({ length: n }), Math.ceil(n / Math.ceil(n / max))).map(r => r.length))
const statLineH = size => Math.round(size * 1.05) + 12 + lh(28)
function statRowH(ctx, size) {
  const rows = rowsOf(ctx.stats.length, 4)
  return ctx.stats.length ? rows.length * statLineH(size) + (rows.length - 1) * 22 : 0
}
function statRow(ctx, items, y, size) {
  const n = ctx.stats.length
  if (!n) return y
  const gap = 28
  let i = 0
  const rows = rowsOf(n, 4)
  // One size for every number on the card, the one the tightest of them fits at.
  const widest = Math.max(...rows)
  const colW = (ctx.inner - gap * (widest - 1)) / widest
  const vSize = Math.min(...ctx.stats.map(s => fitSize(s.value, colW - (s.icon ? size * 0.9 : 0), ctx.measure, 700, size, 26)))
  rows.forEach((count, r) => {
    const ry = y + r * (statLineH(size) + 22)
    for (let c = 0; c < count; c++, i++) {
      const s = ctx.stats[i]
      const x = ctx.rtl ? ctx.width - PAD - c * (colW + gap) : PAD + c * (colW + gap)
      const base = ry + vSize
      let tx = x
      if (s.icon) {
        const ic = Math.round(vSize * 0.8)
        items.push({ kind: s.icon, x: ctx.rtl ? x - ic : x, y: base - ic + Math.round(ic * 0.04), size: ic })
        tx = x + (ic + 10) * ctx.dir
      }
      const [value] = wrapText(s.value, colW - Math.abs(tx - x), t2 => ctx.measure(t2, 700, vSize), 1)
      items.push({ kind: 'text', text: value, x: tx, y: base, size: vSize, weight: 700, color: 'label', num: true, track: -0.01 })
      const [label] = wrapText(s.label, colW, t2 => ctx.measure(t2, 500, 28), 1)
      items.push({ kind: 'text', text: label, x, y: base + 12 + 28 + 2, size: 28, weight: 500, color: 'label2' })
    }
  })
  return y + statRowH(ctx, size)
}

// The numbers as tiles: two to a row on a story or a 4:5 (three when there are five), up to
// three on a square. A short last row's tiles share its whole width.
const tileRows = ctx => rowsOf(ctx.stats.length, ctx.small ? 3 : ctx.stats.length >= 5 ? 3 : 2)
const tileH = ctx => (ctx.small ? 128 : ctx.stats.length >= 5 ? 150 : 164)
function tilesH(ctx) {
  if (!ctx.stats.length) return 0
  const rows = tileRows(ctx)
  return rows.length * tileH(ctx) + (rows.length - 1) * 18
}
function tiles(ctx, items, y) {
  if (!ctx.stats.length) return y
  const gap = 18
  const th = tileH(ctx)
  const rows = tileRows(ctx)
  const statMax = ctx.small ? 46 : rows[0] > 2 ? 54 : 62
  const labelSize = ctx.small ? 24 : 28
  let i = 0
  rows.forEach((count, r) => {
    const w = (ctx.inner - gap * (count - 1)) / count
    for (let c = 0; c < count; c++, i++) {
      const s = ctx.stats[i]
      const x = ctx.rtl ? ctx.width - PAD - c * (w + gap) - w : PAD + c * (w + gap)
      const ty = y + r * (th + gap)
      items.push({ kind: 'tile', x, y: ty, w, h: th })
      const tx = ctx.rtl ? x + w - 28 : x + 28
      const room = w - 56
      const [label] = wrapText(s.label, room, t2 => ctx.measure(t2, 500, labelSize), 1)
      items.push({ kind: 'text', text: label, x: tx, y: ty + 24 + labelSize, size: labelSize, weight: 500, color: 'label2' })
      const ic = s.icon ? Math.round(statMax * 0.8) : 0
      const icGap = ic ? 12 : 0
      const size = fitSize(s.value, room - ic - icGap, ctx.measure, 700, statMax, 20)
      const base = ty + th - 26
      if (ic) items.push({ kind: s.icon, x: ctx.rtl ? tx - ic : tx, y: base - ic + Math.round(ic * 0.06), size: ic })
      const [value] = wrapText(s.value, room - ic - icGap, t2 => ctx.measure(t2, 700, size), 1)
      items.push({ kind: 'text', text: value, x: tx + (ic + icGap) * ctx.dir, y: base, size, weight: 700, color: 'label', num: true, track: -0.01 })
    }
  })
  return y + tilesH(ctx)
}

function mapItems(ctx, items, y, h, align = 'center') {
  const gap = Math.round(h * 0.06)
  let viewH = h
  let viewW = viewH / ctx.aspect
  if (viewW * 2 + gap > ctx.inner) { viewW = (ctx.inner - gap) / 2; viewH = viewW * ctx.aspect }
  const total = viewW * 2 + gap
  const left = align === 'start' ? (ctx.rtl ? ctx.width - PAD - total : PAD) : (ctx.width - total) / 2
  items.push({ kind: 'map', view: 'front', x: left, y, w: viewW, h: viewH })
  items.push({ kind: 'map', view: 'back', x: left + viewW + gap, y, w: viewW, h: viewH })
  return y + viewH
}

function streakLine(ctx, items, y, size = 40) {
  if (!(ctx.show.streak && ctx.model.streak > 0)) return y
  const ic = Math.round(size * 1.35)
  items.push({ kind: 'flame', x: ctx.rtl ? ctx.start - ic : ctx.start, y: y - Math.round(size * 0.12), size: ic })
  const [line] = wrapText(t('{0} week streak', ctx.model.streak), ctx.inner - ic - 14, s => ctx.measure(s, 600, size), 1)
  items.push({ kind: 'text', text: line, x: ctx.start + (ic + 12) * ctx.dir, y: y + size, size, weight: 600, color: 'label' })
  return y + Math.round(size * 1.75)
}
const streakH = (ctx, size = 40) => (ctx.show.streak && ctx.model.streak > 0 ? Math.round(size * 1.75) : 0)

// One row of an exercise list: its name on the reading side, `right` (its sets, or its best set)
// at the other end, a trophy in front of a new record.
function liftRow(ctx, items, y, lift, { size, right, rightColor = 'label2', rightWeight = 500 }) {
  const rightW = right ? ctx.measure(right, rightWeight, size) : 0
  const ic = lift.pr ? Math.round(size * 1.05) : 0
  const nameRoom = ctx.inner - rightW - 32 - (ic ? ic + 14 : 0)
  let x = ctx.start
  if (ic) {
    items.push({ kind: 'trophy', x: ctx.rtl ? x - ic : x, y: y + Math.round(size * 0.08), size: ic })
    x += (ic + 14) * ctx.dir
  }
  const [name] = wrapText(lift.name, Math.max(80, nameRoom), s => ctx.measure(s, 500, size), 1)
  items.push({ kind: 'text', text: name, x, y: y + size, size, weight: 500, color: 'label' })
  if (right) items.push({ kind: 'text', text: right, x: ctx.end, y: y + size, size, weight: rightWeight, color: rightColor, anchor: 'end', num: true })
}

function moreLine(ctx, items, y, n, size) {
  return textItem(ctx, items, t('and {0} more', n), y, size, 500, 'label2')
}

// Classic and Lifts: the page from the top of the safe area down, the logo at its bottom. Classic
// gives the muscle map the room first and lists what fits under it; Lifts lists first and draws
// the map only when a readable one still fits.
function pageLayout(ctx, items, F, height, tpl) {
  const { model, show, small } = ctx
  const lifted = tpl === 'lifts'
  const sizes = small ? { title: 64, titleLines: 1, date: 32 } : { title: format4(F) ? 76 : 88, titleLines: 2, date: 38 }
  let y = F.top
  items.push({ kind: 'bar', x: ctx.start, y, w: 84 * ctx.dir, h: 10 })
  y += 10 + (small ? 30 : 44)
  y = head(ctx, items, y, sizes)
  y += small ? 28 : 44
  y = lifted ? statRow(ctx, items, y, small ? 50 : 60) : tiles(ctx, items, y)

  const bottom = height - F.bottom
  const footH = show.logo ? 96 : 0
  const strS = small ? 34 : 40
  const sh = streakH(ctx, strS)
  const room = bottom - footH - sh - y - (small ? 20 : 36)

  const lifts = show.exercises ? model.lifts : []
  const rowSize = lifted ? (small ? 36 : 44) : (small ? 32 : 40)
  const rowH = lifted ? lh(rowSize) + (small ? 18 : 26) : lh(rowSize) + (small ? 10 : 16)
  const moreSize = small ? 28 : 32
  const listTop = small ? 20 : 34
  const cap = Math.min(lifted ? MAX_LIFTS : 8, lifts.length)
  const listH = n => (n ? listTop + n * rowH + (lifts.length > n ? lh(moreSize) : 0) : 0)
  const rowsIn = r => { let n = cap; while (n > 0 && listH(n) > r) n--; return n }
  // A new record without the list: its own short block, as the old card had.
  const recs = !lifts.length && show.prs ? model.lifts.filter(l => l.pr) : []
  const recSize = small ? 32 : 40
  const recH = lh(recSize) + 12
  const recHead = 24 + lh(small ? 28 : 32) + 10
  const recRows = recs.length ? Math.min(6, recs.length, Math.max(0, Math.floor((room - recHead) / recH))) : 0
  const recBlock = recRows ? recHead + recRows * recH : 0
  const mapGap = small ? 24 : 48
  const minMap = small ? 220 : 320
  const maxMap = small ? 380 : 760
  // The map and the list share the room (TestFlight 11-08: "I'm only allowed to choose between
  // exercises and muscle heat map"): with both on, the map gives up height for the first few
  // rows down to a smaller floor, and only when even that does not fit is one of them left out,
  // which `left` names for the sheet to say.
  const minBoth = small ? 150 : 220
  const firstRows = Math.min(cap, small ? 2 : 3)
  let rows, mapH = 0
  if (ctx.hasMap && !lifted) {
    const avail = room - recBlock - mapGap
    let n = firstRows
    while (n > 0 && avail - listH(n) < minBoth) n--
    const want = Math.min(maxMap, avail - listH(n))
    if (want >= (n ? minBoth : minMap)) mapH = want
    rows = rowsIn(room - recBlock - (mapH ? mapGap + mapH : 0))
  } else {
    rows = rowsIn(room - recBlock)
    let spare = room - recBlock - listH(rows) - mapGap
    if (ctx.hasMap && spare < minBoth && firstRows) {
      // Lifts lists first: it keeps at least its first rows and the map takes what is left.
      let n = rows
      while (n > firstRows && room - recBlock - listH(n) - mapGap < minBoth) n--
      if (room - recBlock - listH(n) - mapGap >= minBoth) { rows = n; spare = room - recBlock - listH(n) - mapGap }
    }
    if (ctx.hasMap && spare >= (lifts.length ? minBoth : minMap)) mapH = Math.min(maxMap, spare)
  }
  const left = []
  if (ctx.hasMap && !mapH) left.push('map')
  if (lifts.length && !rows) left.push('exercises')

  if (mapH && !lifted) y = mapItems(ctx, items, y + mapGap, mapH)
  if (rows > 0) {
    y += listTop
    lifts.slice(0, rows).forEach((lift, i) => {
      if (lifted && i > 0) items.push({ kind: 'sep', x: PAD, y: y - Math.round((rowH - lh(rowSize)) / 2) - 1, w: ctx.inner })
      liftRow(ctx, items, y, lift, lifted
        ? { size: rowSize, right: lift.best || '', rightColor: lift.pr ? 'accText' : 'label', rightWeight: 700 }
        : { size: rowSize, right: tn('{0} set', '{0} sets', lift.sets) })
      y += rowH
    })
    if (lifts.length > rows) y = moreLine(ctx, items, y - (lifted ? 10 : 0), lifts.length - rows, moreSize)
  }
  if (mapH && lifted) y = mapItems(ctx, items, y + mapGap, mapH)
  if (recRows) {
    y += 24
    y = textItem(ctx, items, t('New personal records'), y, small ? 28 : 32, 600, 'accText') + 10
    for (const r of recs.slice(0, recRows)) { liftRow(ctx, items, y, r, { size: recSize }); y += recH }
  }
  if (sh) streakLine(ctx, items, Math.max(y + 24, bottom - footH - sh), strS)
  if (show.logo) {
    items.push({ kind: 'sep', x: PAD, y: bottom - 76, w: ctx.inner })
    items.push({ kind: 'brand', x: PAD, y: bottom, w: ctx.inner, size: small ? 34 : 40 })
  }
  return { width: ctx.width, height, rtl: ctx.rtl, transparent: false, items, left }
}
const format4 = F => F.height === 1350

// Names joined with a dot, broken between names (never in one), the last line cut with "…".
export function joinLines(names, width, measure, max) {
  const SEP = '  ·  '
  const lines = []
  let line = ''
  for (const name of names) {
    const next = line ? line + SEP + name : name
    if (measure(next) <= width || !line) { line = next; continue }
    lines.push(line)
    line = name
    if (lines.length === max) { line = ''; break }
  }
  if (line && lines.length < max) lines.push(line)
  const cut = lines.join(SEP) !== names.join(SEP)
  return lines.map((l, i) => (i === lines.length - 1 && (cut || measure(l) > width) ? wrapText(l + ' …', width, measure, 1)[0] : l))
}

// Photo: everything at the bottom on the darkened photo, the top left to the picture. What is
// switched on has to fit between the safe areas: when it does not, the list goes to one line, the
// map gets smaller, then whatever still does not fit is left out and named in `left` (the sheet
// says so). The logo is last, on its dark badge, with nothing under or over it (TestFlight 11-08:
// a line ran over it, and on a photo it read as see-through).
export const PHOTO_BRAND_H = 86
function photoLayout(ctx, items, F, height) {
  const { model, show, small } = ctx
  const statSize = small ? 50 : 60
  const lifts0 = show.exercises ? model.lifts : []
  const listSize = small ? 30 : 34
  const gap = small ? 22 : 34
  const bottom = height - F.bottom
  const room = bottom - F.top
  const plan = { listMax: small ? 1 : 2, mapH: ctx.hasMap ? (small ? 170 : 260) : 0, titleLines: small ? 1 : 2, list: lifts0.length > 0, streak: true }
  const left = []
  const measureAll = () => {
    const sizes = small ? { title: 64, titleLines: plan.titleLines, date: 32 } : { title: 84, titleLines: plan.titleLines, date: 36 }
    const lifts = plan.list ? lifts0 : []
    const listLines = lifts.length ? joinLines(lifts.map(l => l.name), ctx.inner, s2 => ctx.measure(s2, 500, listSize), plan.listMax) : []
    const recs = show.prs && !lifts.length ? model.lifts.filter(l => l.pr) : []
    const recLine = recs.length ? `${tnRecords(recs.length)}: ${recs.map(r => r.name).join(', ')}` : ''
    const hh = headH(ctx, sizes)
    const blocks = [
      plan.mapH ? plan.mapH + gap : 0,
      hh ? hh + gap : 0,
      ctx.stats.length ? statRowH(ctx, statSize) + gap : 0,
      listLines.length ? listLines.length * lh(listSize) + (lifts.some(l => l.pr) ? lh(listSize) : 0) + gap * 0.6 : 0,
      recLine ? lh(listSize) + gap * 0.6 : 0,
      plan.streak ? streakH(ctx, small ? 32 : 36) : 0,
      show.logo ? PHOTO_BRAND_H : 0,
    ]
    return { sizes, lifts, listLines, recLine, total: blocks.reduce((a, b) => a + b, 0) }
  }
  const steps = [
    () => plan.listMax > 1 && (plan.listMax = 1),
    () => plan.mapH > (small ? 120 : 180) && (plan.mapH = small ? 120 : 180),
    () => plan.titleLines > 1 && (plan.titleLines = 1),
    () => plan.mapH && (plan.mapH = 0, left.push('map')),
    () => plan.list && (plan.list = false, left.push('exercises')),
    () => plan.streak && streakH(ctx, 36) && (plan.streak = false, left.push('streak')),
  ]
  let m = measureAll()
  for (const step of steps) { if (m.total <= room) break; if (step()) m = measureAll() }
  const { sizes, lifts, listLines, recLine, total } = m
  let y = Math.max(F.top, bottom - total)
  items.splice(1, 0, { kind: 'shade', y0: Math.max(0, y - (small ? 260 : 520)), y1: height, top: F.top })
  if (plan.mapH) { y = mapItems(ctx, items, y, plan.mapH, 'start') + gap }
  if (headH(ctx, sizes)) y = head(ctx, items, y, sizes) + gap
  if (ctx.stats.length) y = statRow(ctx, items, y, statSize) + gap
  if (listLines.length) {
    for (const line of listLines) y = textItem(ctx, items, line, y, listSize, 500, 'label2')
    const prs = lifts.filter(l => l.pr)
    if (prs.length) {
      const ic = Math.round(listSize * 1.05)
      items.push({ kind: 'trophy', x: ctx.rtl ? ctx.start - ic : ctx.start, y: y + 2, size: ic })
      const [line] = wrapText(`${tnRecords(prs.length)}: ${prs.map(r => r.name).join(', ')}`, ctx.inner - ic - 12, s2 => ctx.measure(s2, 600, listSize), 1)
      items.push({ kind: 'text', text: line, x: ctx.start + (ic + 12) * ctx.dir, y: y + listSize, size: listSize, weight: 600, color: 'label' })
      y += lh(listSize)
    }
    y += gap * 0.6
  }
  if (recLine) {
    const ic = Math.round(listSize * 1.05)
    items.push({ kind: 'trophy', x: ctx.rtl ? ctx.start - ic : ctx.start, y: y + 2, size: ic })
    const [line] = wrapText(recLine, ctx.inner - ic - 12, s2 => ctx.measure(s2, 600, listSize), 1)
    items.push({ kind: 'text', text: line, x: ctx.start + (ic + 12) * ctx.dir, y: y + listSize, size: listSize, weight: 600, color: 'label' })
    y += lh(listSize) + gap * 0.6
  }
  if (plan.streak) y = streakLine(ctx, items, y, small ? 32 : 36)
  // The badge's top sits 42 px over the baseline and its foot 16 under it (size 36).
  if (show.logo) items.push({ kind: 'brand', x: PAD, y: Math.min(height - 20, y + 54), w: ctx.inner, size: small ? 32 : 36, badge: true })
  return { width: ctx.width, height, rtl: ctx.rtl, transparent: false, items, left }
}
// "PRs: Bench press, Squat": the count is right there in the names.
const tnRecords = () => t('PRs')

// Sticker: the numbers alone on a transparent canvas, cut to their own height, to lay over a
// photo that is already in Instagram.
function stickerLayout(ctx) {
  const items = []
  const sizes = { title: 72, titleLines: 2, date: 34 }
  const pad = 64
  let y = pad
  if (ctx.show.logo) { items.push({ kind: 'brand', x: PAD, y: y + 34, w: ctx.inner, size: 34, badge: true }); y += 34 + 40 }
  if (headH(ctx, sizes)) y = head(ctx, items, y, sizes) + 30
  if (ctx.stats.length) y = statRow(ctx, items, y, 64) + 26
  const prs = ctx.show.prs ? ctx.model.lifts.filter(l => l.pr) : []
  if (ctx.show.exercises && ctx.model.lifts.length) {
    const shown = ctx.model.lifts.slice(0, 5)
    for (const lift of shown) { liftRow(ctx, items, y, lift, { size: 36, right: lift.best || '', rightColor: 'label', rightWeight: 700 }); y += lh(36) + 10 }
    if (ctx.model.lifts.length > shown.length) y = moreLine(ctx, items, y, ctx.model.lifts.length - shown.length, 30)
    y += 16
  } else if (prs.length) {
    const ic = 38
    items.push({ kind: 'trophy', x: ctx.rtl ? ctx.start - ic : ctx.start, y: y + 2, size: ic })
    const [line] = wrapText(`${tnRecords(prs.length)}: ${prs.map(r => r.name).join(', ')}`, ctx.inner - ic - 12, s => ctx.measure(s, 600, 36), 1)
    items.push({ kind: 'text', text: line, x: ctx.start + (ic + 12) * ctx.dir, y: y + 36, size: 36, weight: 600, color: 'label' })
    y += lh(36) + 16
  }
  y = streakLine(ctx, items, y, 36)
  const height = Math.max(240, Math.round(y + pad - 16))
  return { width: ctx.width, height, rtl: ctx.rtl, transparent: true, items, left: [] }
}

/* ---------------------------------------------------------------- drawing -- */

/**
 * Paint a layout. `colors` from sharePalette; `map` { body, levels } as for drawWorkoutCard;
 * `photo` { image, width, height, pan, shade } with a decoded bitmap of the owner's own photo.
 */
export function drawShareCard(ctx, layout, colors, { map = null, photo = null, family = CARD_FONT } = {}) {
  const { width, height, items } = layout
  const shades = mapColors({ label: colors.label, surface: colors.surface || colors.bg || '#000000', acc: colors.onAccent ? colors.label : colors.acc })
  ctx.textBaseline = 'alphabetic'
  if (layout.transparent || !colors.bg) ctx.clearRect(0, 0, width, height)
  for (const item of items) {
    switch (item.kind) {
      case 'bg':
        if (!colors.bg) break   // see-through (the sheet's Background → See-through)
        ctx.fillStyle = colors.bg
        ctx.fillRect(0, 0, width, height)
        break
      case 'glow': {
        if (!colors.glow) break
        const g = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.r)
        g.addColorStop(0, colors.glow)
        g.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, width, height)
        break
      }
      case 'photo': {
        if (photo?.image) {
          const r = photoRect(photo.width, photo.height, width, height, photo.pan)
          ctx.drawImage(photo.image, r.x, r.y, r.w, r.h)
        } else {
          // No photo yet: a quiet accent wash, so the preview reads as "your photo goes here".
          const g = ctx.createLinearGradient(0, 0, width, height)
          g.addColorStop(0, mixColor(colors.acc, '#000000', 0.55))
          g.addColorStop(1, '#0a0a0a')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, width, height)
        }
        break
      }
      case 'shade': {
        const k = photo?.image ? (photo.shade ?? 0.7) : 0.6
        const g = ctx.createLinearGradient(0, item.y0, 0, item.y1)
        g.addColorStop(0, 'rgba(0, 0, 0, 0)')
        g.addColorStop(0.35, `rgba(0, 0, 0, ${(0.45 * k).toFixed(3)})`)
        g.addColorStop(1, `rgba(0, 0, 0, ${(0.62 + 0.3 * k).toFixed(3)})`)
        ctx.fillStyle = g
        ctx.fillRect(0, item.y0, width, item.y1 - item.y0)
        // A light scrim at the top too, so the logo of the app it is posted in stays readable.
        const top = ctx.createLinearGradient(0, 0, 0, item.top || 200)
        top.addColorStop(0, 'rgba(0, 0, 0, 0.28)')
        top.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = top
        ctx.fillRect(0, 0, width, item.top || 200)
        break
      }
      case 'bar':
        ctx.fillStyle = colors.acc
        roundRect(ctx, Math.min(item.x, item.x + item.w), item.y, Math.abs(item.w), item.h, item.h / 2)
        ctx.fill()
        break
      case 'tile':
        ctx.fillStyle = colors.tile
        roundRect(ctx, item.x, item.y, item.w, item.h, 32)
        ctx.fill()
        break
      case 'sep':
        ctx.fillStyle = colors.sep
        ctx.fillRect(item.x, item.y, item.w, 2)
        break
      case 'map': {
        const view = map?.body?.[item.view]
        if (view) withShadow(ctx, colors, () => drawView(ctx, view, item, map.levels, shades))
        break
      }
      case 'trophy':
        withShadow(ctx, colors, () => drawIcon(ctx, TROPHY, { ...item, color: colors.accText || colors.acc, width: 1.9 }))
        break
      case 'heart':
        withShadow(ctx, colors, () => drawIcon(ctx, HEART, { ...item, color: colors.onAccent ? colors.label : '#ff375f', fill: true }))
        break
      case 'flame':
        withShadow(ctx, colors, () => drawIcon(ctx, FLAME, { ...item, color: colors.onAccent ? colors.label : FLAME_COLOR, fill: true }))
        break
      case 'brand':
        // The badge is solid: no sticker shadow under the lockup, it would read as a smudge.
        drawBrand(ctx, { x: item.x, y: item.y, width: item.w, colors, family, size: item.size, badge: !!item.badge })
        break
      default:
        withShadow(ctx, colors, () => paintText(ctx, item, colors, !!layout.rtl, family))
    }
  }
}

// White type on a sticker sits on photos nobody has seen yet: a soft shadow keeps it readable.
function withShadow(ctx, colors, fn) {
  if (!colors.shadow) return fn()
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 2
  fn()
  ctx.restore()
}

function paintText(ctx, item, colors, rtl, family) {
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.textAlign = item.anchor === 'end' ? 'end' : item.anchor === 'center' ? 'center' : 'start'
  ctx.fillStyle = colors[item.color] || colors.label
  ctx.font = `${item.weight} ${item.size}px ${family}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = item.track ? `${(item.track * item.size).toFixed(1)}px` : '0px'
  // One isolated run per line in Arabic and Persian (lib/bidi.js, as workout-card.js drawText).
  ctx.fillText(rtl ? isoRun(item.text, true) : item.text, item.x, item.y)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
}
