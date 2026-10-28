// Where the exercise name is, found by reading, not by guessing from one look.
//
// A name box has a property nothing else on a follow-along video has: read at enough moments, it
// says a different thing each time, and what it says is the name of an exercise. So the frame is
// cut into horizontal strips, each strip is read at a few dozen moments spread over the video,
// and the strip whose readings are many different captions made of words the exercise library
// knows is the one. Its box is then the extent of the words it read, not of one guess.
//
// A label that never changes ("NEXT", a logo, a channel name) says one thing, and a talking head
// says nothing a library knows; neither wins. The timer is found elsewhere (timer-suggest.js),
// by its counting.

import fs from 'node:fs'
import path from 'node:path'
import { run } from './proc.js'
import { mapBatches, OCR_PROCS } from './ocr.js'
import { normName, knownShare } from './text.js'

export const PROBES = 36          // moments the strips are read at
export const EXTRA_PROBES = 84    // more of them when those found no caption (names shown only briefly)
const STRIP_H = 0.12              // a strip's height, as a share of the frame
const STEP = 0.05                 // how far apart the strips start
const OUT_H = 96                  // a strip is read at this height in pixels
export const SIDE_TOKEN = /^[(\[]?[RL][)\]]?$/   // "(R)", "(L)": the side of a move, one letter
const MAX_WORD_H = 0.8 * OUT_H    // a "word" as tall as the strip is an edge or a bar, not text
const MIN_CONF = 45               // a word Tesseract is less sure of than this is not read
const BATCH = 60
export const MIN_CAPTIONS = 4     // different captions a strip must have read to be the name
export const MIN_CAPTIONS_FEW = 3 // ... or this many, when they were read often (a video with few moves)
export const MIN_HITS_FEW = 6

/** Tesseract TSV → words { text, conf, x, y, w, h } in the pixels of the image, per image. */
export function tsvWords(tsv, count) {
  const pages = Array.from({ length: count }, () => [])
  for (const line of String(tsv || '').split('\n').slice(1)) {
    const c = line.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const page = +c[1] - 1
    const conf = Number(c[10])
    const text = c.slice(11).join('\t').trim()
    if (!pages[page] || !text || conf < 0) continue
    pages[page].push({ text, conf, x: +c[6], y: +c[7], w: +c[8], h: +c[9] })
  }
  return pages
}

/** The strips of a frame: [{ y, h }] as fractions, the last one ending at the frame's foot. */
export function strips() {
  const out = []
  for (let y = 0; y + STRIP_H < 1 + 1e-9; y += STEP) out.push({ y: Math.round(y * 1000) / 1000, h: STRIP_H })
  const last = out[out.length - 1]
  if (last.y + last.h < 1 - 1e-6) out.push({ y: Math.round((1 - STRIP_H) * 1000) / 1000, h: STRIP_H })
  return out
}

/** The words of one reading that count: sure enough, with letters, outside what is to be avoided. */
function usable(words, { width, avoid, keepSides, maxH = MAX_WORD_H }) {
  return words.filter(w => w.conf >= MIN_CONF && w.h <= maxH && (/\p{L}{2}/u.test(w.text) || (keepSides && SIDE_TOKEN.test(w.text))) &&
    !avoid.some(a => {
      const cx = (w.x + w.w / 2) / width
      return cx >= a.x && cx <= a.x + a.w
    }))
}

const percentile = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))] : 0 }
const round = v => Math.round(v * 1000) / 1000

/** Words → lines of text: words whose middles are within half a line's height of each other. */
function linesOf(words, gapK = 1.2) {
  const sorted = [...words].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
  const lines = []
  for (const w of sorted) {
    const mid = w.y + w.h / 2
    const ln = lines.find(l => Math.abs(l.mid - mid) <= Math.max(l.h, w.h) * 0.5)
    if (ln) {
      ln.words.push(w)
      ln.mid = ln.words.reduce((t, x) => t + x.y + x.h / 2, 0) / ln.words.length
      ln.h = Math.max(ln.h, w.h)
    } else lines.push({ words: [w], mid, h: w.h })
  }
  // Words far apart on the same height are not one caption (a sign in the background, a logo):
  // a gap wider than a line is tall starts another line.
  const pieces = []
  for (const l of lines) {
    const ws = l.words.sort((a, b) => a.x - b.x)
    let cur = [ws[0]]
    for (const w of ws.slice(1)) {
      const prev = cur[cur.length - 1]
      if (w.x - (prev.x + prev.w) > gapK * l.h) { pieces.push(cur); cur = [w] } else cur.push(w)
    }
    pieces.push(cur)
  }
  return pieces.map(ws => ({ words: ws, text: ws.map(w => w.text).join(' '), x0: ws[0].x, x1: Math.max(...ws.map(w => w.x + w.w)), y0: Math.min(...ws.map(w => w.y)), y1: Math.max(...ws.map(w => w.y + w.h)) }))
}

/** The line of a reading that is a caption, if one is: letters enough, most of them words an exercise is named with. */
export function captionLine(words, o, minKnown = 0.6, gapK = 1.2) {
  let best = null
  for (const ln of linesOf(usable(words || [], o), gapK)) {
    const letters = (ln.text.match(/\p{L}/gu) || []).length
    if (letters >= 6 && knownShare(ln.text) >= minKnown && (!best || letters > best.letters)) best = { ...ln, letters, key: normName(ln.text) }
  }
  return best
}

/** The strip that reads most like a caption among `exclude`-d others: { s, hits, captions } or null. */
function bestStrip(readings, o, exclude = new Set()) {
  let best = null
  readings.forEach((probes, s) => {
    if (exclude.has(s)) return
    const hits = []
    probes.forEach((words, p) => { const ln = captionLine(words, o); if (ln) hits.push({ ...ln, p }) })
    const captions = new Set(hits.map(h => h.key))
    // A strip that says one thing all video is a label; one that says many is the caption.
    const score = captions.size + 0.05 * hits.length
    const enough = captions.size >= MIN_CAPTIONS || (captions.size >= MIN_CAPTIONS_FEW && hits.length >= MIN_HITS_FEW)
    if (enough && (!best || score > best.score)) best = { s, hits, captions, score }
  })
  return best
}

/**
 * Which strips are the name, and where its words sit. `readings[s][p]` is the words read in strip
 * `s` at probe `p` (pixels of the strip image, `scale` px per frame px, the frame `width` wide).
 * Pure. { box, boxes, captions, strip } or null; up to two places (some creators show the next
 * move in another spot). `avoid` is boxes (the timer) whose columns are skipped.
 */
export function pickNameBox(readings, stripList, { width, scale = 1, avoid = [] } = {}) {
  const o = { width: width * scale, avoid }
  const boxes = []
  let first = null
  const exclude = new Set()
  for (let place = 0; place < 2; place++) {
    const best = bestStrip(readings, o, exclude)
    if (!best) break
    // A second place says other things than the first, or it is the first seen again in the next strip.
    if (first) {
      const shared = [...best.captions].filter(k => first.captions.has(k)).length
      if (shared / Math.max(1, Math.min(best.captions.size, first.captions.size)) > 0.5) { exclude.add(best.s); place--; continue }
    }
    const strip = stripList[best.s]
    // Where the caption sits: the height most of the caption lines share. Captions that turn up at
    // other heights (a title card, a different layout in the warm-up) are another place.
    const tol = Math.max(8, 0.6 * percentile(best.hits.map(h => h.y1 - h.y0), 0.5))
    const clusters = []
    for (const h of [...best.hits].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
      const mid = (h.y0 + h.y1) / 2
      const c = clusters.find(k => Math.abs(k.mid - mid) <= tol)
      if (c) { c.hits.push(h); c.mid = c.hits.reduce((t, x) => t + (x.y0 + x.y1) / 2, 0) / c.hits.length } else clusters.push({ mid, hits: [h] })
    }
    const here = clusters.sort((a, b) => new Set(b.hits.map(h => h.key)).size - new Set(a.hits.map(h => h.key)).size)[0].hits
    // Its extent is that of the lines read there: the longest name sets the right edge.
    const y0 = percentile(here.map(h => h.y0), 0.05), y1 = percentile(here.map(h => h.y1), 0.95)
    const x0 = percentile(here.map(h => h.x0), 0.02) / (width * scale), x1 = percentile(here.map(h => h.x1), 0.98) / (width * scale)
    const padL = 0.02, padR = 0.04, padY = 0.15 * (y1 - y0) / OUT_H * strip.h
    const top = strip.y + (y0 / OUT_H) * strip.h - padY, bottom = strip.y + (y1 / OUT_H) * strip.h + padY
    const bx = Math.max(0, x0 - padL)
    const box = { x: round(bx), y: round(Math.max(0, top)), w: round(Math.min(1, x1 + padR) - bx), h: round(Math.min(1, bottom) - Math.max(0, top)) }
    boxes.push(box)
    if (!first) first = best
    // Strips that see this band are spoken for.
    stripList.forEach((st, k) => { if (st.y < box.y + box.h + 0.02 && st.y + st.h > box.y - 0.02) exclude.add(k) })
  }
  if (!boxes.length) return null
  return { box: boxes[0], boxes, captions: first.captions.size, strip: first.s }
}

/** Read every image of `files` as one sparse line of text, in parallel; per file, its words. */
async function readStrips(files, { workDir, signal }) {
  const batches = []
  for (let i = 0; i < files.length; i += BATCH) batches.push(files.slice(i, i + BATCH))
  const read = async batch => {
    const list = path.join(workDir, `auto-roi-${process.hrtime.bigint()}.txt`)
    fs.writeFileSync(list, batch.join('\n') + '\n')
    try {
      const { stdout } = await run('tesseract', [list, 'stdout', '--psm', '6', '-l', 'eng', 'tsv'], {
        signal, timeoutMs: 10 * 60000, env: { ...process.env, OMP_THREAD_LIMIT: '1' }
      })
      return tsvWords(stdout, batch.length)
    } finally { fs.rmSync(list, { force: true }) }
  }
  return mapBatches(batches, read, OCR_PROCS)
}

/** How a frame is cut into strips for reading: the strips, and the width a strip image has. */
export function stripGeometry(dims, outH = OUT_H) {
  const outW = Math.round(dims.width * (outH / (dims.height * STRIP_H)))
  return { list: strips(), outW, scale: outW / dims.width }
}

/**
 * The words read in every strip at every one of `times` (seconds): `out[s][p]` for strip `s` at
 * `times[p]`, in the pixels of the strip image. A moment that could not be cut reads as nothing.
 */
export async function readMoments(file, times, { dims, workDir, signal, onProgress, outH = OUT_H, regions } = {}) {
  // Full-width strips by default; `regions` ([{ x, y, w, h }], fractions of the frame) read narrower
  // pieces instead, which Tesseract reads small captions out of better than out of a whole row.
  const list = regions || stripGeometry(dims, outH).list
  const crop = r => {
    const w = regions ? Math.max(8, Math.round(dims.width * r.w)) : dims.width
    const x = regions ? Math.min(dims.width - 8, Math.round(dims.width * r.x)) : 0
    return `crop=${w}:${Math.max(8, Math.round(dims.height * r.h))}:${x}:${Math.min(dims.height - 8, Math.round(dims.height * r.y))},scale=${regions ? '-2' : stripGeometry(dims, outH).outW}:${outH}:flags=bicubic,format=gray`
  }
  const files = []
  for (let p = 0; p < times.length; p++) {
    const split = `split=${list.length}${list.map((_, s) => `[a${s}]`).join('')}`
    const parts = list.map((st, s) => `[a${s}]${crop(st)}[o${s}]`)
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(times[p]), '-i', file, '-filter_complex', `[0:v]${split};${parts.join(';')}`]
    list.forEach((_, s) => {
      const out = path.join(workDir, `strip-${p}-${s}-${process.hrtime.bigint()}.png`)
      args.push('-map', `[o${s}]`, '-frames:v', '1', out)
      files.push(out)
    })
    try { await run('ffmpeg', args, { signal, timeoutMs: 60000 }) } catch (e) { if (e.cancelled) throw e }
    onProgress?.((p + 1) / times.length)
  }
  // Frames that could not be cut are skipped (an unreadable moment is not a caption).
  const present = files.map(f => fs.existsSync(f))
  const existing = files.filter((_, i) => present[i])
  let words = []
  try { words = await readStrips(existing, { workDir, signal }) } finally { for (const f of files) fs.rmSync(f, { force: true }) }
  const out = list.map(() => [])
  let k = 0
  files.forEach((_, i) => out[i % list.length].push(present[i] ? words[k++] || [] : []))
  return out
}

/** Narrow pieces of the frame (three columns of rows), for reading small captions: [{ x, y, w, h }]. */
export function columnRegions({ rowH = 0.14, step = 0.06, colW = 0.42 } = {}) {
  const ys = []
  for (let y = 0; y + rowH < 1 + 1e-9; y += step) ys.push(Math.round(y * 1000) / 1000)
  if (ys[ys.length - 1] + rowH < 1 - 1e-6) ys.push(Math.round((1 - rowH) * 1000) / 1000)
  return ys.flatMap(y => [0, (1 - colW) / 2, 1 - colW].map(x => ({ x: Math.round(x * 1000) / 1000, y, w: colW, h: rowH })))
}

/**
 * The name box of a video: { box, captions } or null when no strip reads like a caption. The
 * frame is cut into strips at PROBES moments with one ffmpeg run each, and the strips read. When
 * nothing reads like a caption, more moments are read (names that show only for a few seconds, in
 * the rest, are missed by a few dozen) and judged together with the first.
 */
export async function autoNameBox(file, { dims, workDir, signal, avoid = [], onProgress } = {}) {
  const { list, scale } = stripGeometry(dims)
  const moment = f => Math.round(dims.duration * (0.03 + 0.94 * f) * 10) / 10
  const first = Array.from({ length: PROBES }, (_, i) => moment(i / (PROBES - 1)))
  const readings = await readMoments(file, first, { dims, workDir, signal, onProgress: f => onProgress?.(f * 0.4) })
  const pick = () => pickNameBox(readings, list, { width: dims.width, scale, avoid })
  let found = pick()
  if (!found) {
    // Other moments than the first pass read: the thirds and midpoints between its steps.
    const step = 1 / (PROBES - 1)
    const more = []
    for (let i = 0; i < PROBES - 1 && more.length < EXTRA_PROBES; i++) for (const q of [1 / 3, 1 / 2, 2 / 3]) if (more.length < EXTRA_PROBES) more.push(moment((i + q) * step))
    const extra = await readMoments(file, more, { dims, workDir, signal, onProgress: f => onProgress?.(0.4 + f * 0.6) })
    extra.forEach((r, s) => readings[s].push(...r))
    found = pick()
  }
  onProgress?.(1)
  return found
}
