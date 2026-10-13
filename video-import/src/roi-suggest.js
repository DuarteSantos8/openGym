// Where the exercise name and the timer probably are, from OCR of a few whole frames.
//
// Pure. The input is Tesseract's TSV for each sampled frame. Text that sits in the same place
// in several frames is one "spot"; a spot whose text changes from frame to frame is a caption
// (a logo or a channel name never changes, so it is never suggested). A spot that reads as a
// clock or a number is the timer; the largest changing spot of words is the name. Boxes come
// back as fractions of the frame, padded, so the user starts from something close and nudges it.

import { normName, parseTimer } from './text.js'

/** Tesseract TSV → line boxes { text, conf, x, y, w, h } in pixels (level 5 words joined by line). */
export function tsvLines(tsv) {
  const rows = String(tsv || '').split('\n').slice(1).map(l => l.split('\t')).filter(c => c.length >= 12)
  const lines = new Map()
  for (const c of rows) {
    if (c[0] !== '5') continue
    const text = c.slice(11).join('\t').trim()
    const conf = Number(c[10])
    if (!text || conf < 0) continue
    const key = c.slice(1, 5).join(':')     // page, block, paragraph, line
    const [left, top, width, height] = c.slice(6, 10).map(Number)
    const ln = lines.get(key) || { words: [], conf: [], x0: Infinity, y0: Infinity, x1: 0, y1: 0 }
    ln.words.push(text); ln.conf.push(conf)
    ln.x0 = Math.min(ln.x0, left); ln.y0 = Math.min(ln.y0, top)
    ln.x1 = Math.max(ln.x1, left + width); ln.y1 = Math.max(ln.y1, top + height)
    lines.set(key, ln)
  }
  return [...lines.values()].map(l => ({
    text: l.words.join(' '), conf: l.conf.reduce((a, b) => a + b, 0) / l.conf.length,
    x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0
  }))
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

const isClock = s => parseTimer(s) != null && /\d/.test(s) && String(s).replace(/[\s:.0-9oOsS]/g, '').length === 0
const wordy = s => normName(s).replace(/\s/g, '').length >= 3

/** Pad a fractional box by `pad` of its own size each way, clamped to the frame. */
export function padBox(b, pad = 0.25) {
  const x = Math.max(0, b.x - b.w * pad), y = Math.max(0, b.y - b.h * pad)
  const x1 = Math.min(1, b.x + b.w * (1 + pad)), y1 = Math.min(1, b.y + b.h * (1 + pad))
  return { x: round(x), y: round(y), w: round(x1 - x), h: round(y1 - y) }
}
const round = v => Math.round(v * 1000) / 1000

/**
 * frames: [{ tsv, width, height }] — returns { name, timer }, each a fractional box or null.
 */
export function suggestRois(frames) {
  const spots = []
  frames.forEach((f, fi) => {
    for (const l of tsvLines(f.tsv)) {
      if (l.conf < 30 || !f.width || !f.height) continue
      const box = { x: l.x / f.width, y: l.y / f.height, w: l.w / f.width, h: l.h / f.height }
      let spot = spots.find(s => iou(s.box, box) >= 0.3)
      if (!spot) { spot = { box: { ...box }, seen: [] }; spots.push(spot) }
      // The spot grows to hold every line seen there: a longer name needs a wider box.
      const x1 = Math.max(spot.box.x + spot.box.w, box.x + box.w), y1 = Math.max(spot.box.y + spot.box.h, box.y + box.h)
      spot.box.x = Math.min(spot.box.x, box.x); spot.box.y = Math.min(spot.box.y, box.y)
      spot.box.w = x1 - spot.box.x; spot.box.h = y1 - spot.box.y
      spot.seen.push({ fi, text: l.text, h: box.h })
    }
  })
  const scored = spots.map(s => {
    const frames = new Set(s.seen.map(x => x.fi)).size
    const texts = new Set(s.seen.map(x => normName(x.text) || x.text.replace(/\s/g, ''))).size
    const clock = s.seen.filter(x => isClock(x.text)).length / s.seen.length
    const words = s.seen.filter(x => wordy(x.text) && !isClock(x.text)).length / s.seen.length
    const height = s.seen.reduce((a, x) => a + x.h, 0) / s.seen.length
    // How much of the time the spot says one and the same thing: a label ("NEXT", "MOD", a
    // logo) says it always, a caption a different thing at each exercise.
    const counts = new Map()
    for (const x of s.seen) { const k = normName(x.text) || x.text; counts.set(k, (counts.get(k) || 0) + 1) }
    const fixed = Math.max(...counts.values()) / s.seen.length
    return { box: s.box, frames, texts, clock, words, height, fixed }
  }).filter(s => s.frames >= 2 && s.texts >= 2)

  const timer = scored.filter(s => s.clock >= 0.6).sort((a, b) => b.frames * b.texts - a.frames * a.texts)[0] || null
  const names = scored.filter(s => s !== timer && s.words >= 0.6 && s.fixed < 0.6)
    .sort((a, b) => b.texts * b.height - a.texts * a.height)
  // Up to two places: some creators show the next exercise in a different spot in the warm-up.
  const picked = []
  for (const s of names) if (picked.length < 2 && !picked.some(p => iou(p.box, s.box) > 0.1)) picked.push(s)
  const boxes = picked.map(s => padBox(s.box))
  return {
    name: boxes[0] || null,
    names: boxes,
    timer: timer ? padBox(timer.box, 0.35) : null
  }
}

/** A box the user drew, made safe: fractions inside the frame, not degenerate. null if unusable. */
export function cleanBox(b) {
  if (!b || typeof b !== 'object') return null
  const n = k => (Number.isFinite(Number(b[k])) ? Number(b[k]) : NaN)
  let x = n('x'), y = n('y'), w = n('w'), h = n('h')
  if ([x, y, w, h].some(Number.isNaN)) return null
  x = Math.min(Math.max(x, 0), 1); y = Math.min(Math.max(y, 0), 1)
  w = Math.min(Math.max(w, 0), 1 - x); h = Math.min(Math.max(h, 0), 1 - y)
  if (w < 0.02 || h < 0.02) return null
  return { x: round(x), y: round(y), w: round(w), h: round(h) }
}

/** One name box or several (up to three), cleaned; a single box stays a single box. null if none is usable. */
export function cleanNames(v) {
  if (Array.isArray(v)) {
    const boxes = v.map(cleanBox).filter(Boolean).slice(0, 3)
    return boxes.length ? (boxes.length === 1 ? boxes[0] : boxes) : null
  }
  return cleanBox(v)
}
