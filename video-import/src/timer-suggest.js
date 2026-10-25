// Where a countdown is drawn, found from the countdown itself.
//
// The name suggestion (roi-suggest.js) reads whole frames, and a number in a ring on the floor or
// in a corner is not something Tesseract picks out of a whole frame. A countdown is something a
// reader can verify, though: its number goes down by one every second. So a grid of boxes is read
// for a few seconds at a time, in a couple of places in the video, the way the real read would
// (the digits alone, from the brightest or the darkest marks), and the boxes whose readings step
// by one are the timer. Nothing else on a follow-along video counts like that.

import fs from 'node:fs'
import path from 'node:path'
import { run } from './proc.js'
import { readCrops } from './ocr.js'
import { timerMasks, pgm, difference } from './image.js'
import { parseTimer } from './text.js'
import { padBox } from './roi-suggest.js'

const XS = [0, 0.18, 0.39, 0.6, 0.78]
const YS = [0, 0.25, 0.5, 0.72]
const CW = 0.22, CH = 0.28
const SECONDS = 14      // read this many seconds in each place
const OUT_H = 96
const AT = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
const READ_TOP = 6      // boxes that get a real read in each place, the most digit-like by their masks

/** The grid of boxes tried, as fractions of the frame. */
export const candidateBoxes = () => YS.flatMap(y => XS.map(x => ({ x, y: Math.min(y, 1 - CH), w: Math.min(CW, 1 - x), h: CH })))

/**
 * How well readings count: of the seconds that follow a second with a reading and have one too, how
 * many step by exactly one (either way). Each second can have several readings (one per polarity).
 */
export function stepShare(readings) {
  let pairs = 0, steps = 0
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1], b = readings[i]
    if (!a?.length || !b?.length) continue
    pairs++
    if (a.some(x => b.some(y => Math.abs(x - y) === 1))) steps++
  }
  return { pairs, steps, share: pairs ? steps / pairs : 0 }
}

/** Two boxes that overlap by more than a fifth of the smaller. */
const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 && (w * h) / Math.min(a.w * a.h, b.w * b.h) > 0.2
}

/** The raw gray crops of every candidate for `seconds` from `from`: { raw: Buffer[], ow, oh }[] */
async function crops(file, from, { width, height, workDir, signal }) {
  const boxes = candidateBoxes()
  const parts = [`[0:v]fps=1,split=${boxes.length}${boxes.map((_, i) => `[c${i}]`).join('')}`]
  const maps = [], geo = []
  boxes.forEach((b, i) => {
    const cw = Math.max(8, Math.round(b.w * width)), chh = Math.max(8, Math.round(b.h * height))
    const cx = Math.min(width - cw, Math.round(b.x * width)), cy = Math.min(height - chh, Math.round(b.y * height))
    const ow = Math.min(1600, Math.round(cw * OUT_H / chh / 2) * 2)
    geo.push({ ow, oh: OUT_H })
    parts.push(`[c${i}]crop=${cw}:${chh}:${cx}:${cy},scale=${ow}:${OUT_H}:flags=bicubic,format=gray[o${i}]`)
    maps.push('-map', `[o${i}]`, '-f', 'rawvideo', path.join(workDir, `tc${i}.gray`))
  })
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(from), '-t', String(SECONDS), '-i', file,
    '-filter_complex', parts.join(';'), ...maps], { signal, timeoutMs: 5 * 60000 })
  return boxes.map((b, i) => {
    const f = path.join(workDir, `tc${i}.gray`)
    const raw = fs.readFileSync(f)
    fs.rmSync(f, { force: true })
    return { box: b, raw, ...geo[i] }
  })
}

/**
 * Where the digits were: the middle of the marks' boxes over the seconds that read (a ring on the
 * floor drifts with the camera, so the union of them would be half the frame). Null with fewer than
 * `min` such seconds.
 */
function digitBox(c, readings, min) {
  const spots = []
  c.masks.forEach((ms, i) => {
    const m = ms[0]
    if (!readings[i].length || !m) return
    let x0 = c.ow, y0 = c.oh, x1 = -1, y1 = -1
    for (let k = 0; k < m.length; k++) if (m[k] === 0) { const x = k % c.ow, y = (k - x) / c.ow; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    if (x1 >= 0) spots.push([x0, y0, x1, y1])
  })
  if (spots.length < min) return null
  const med = k => { const v = spots.map(q => q[k]).sort((a, b) => a - b); return v[v.length >> 1] }
  const x0 = med(0), y0 = med(1), x1 = med(2), y1 = med(3)
  return { x: c.box.x + c.box.w * x0 / c.ow, y: c.box.y + c.box.h * y0 / c.oh, w: c.box.w * (x1 - x0 + 1) / c.ow, h: c.box.h * (y1 - y0 + 1) / c.oh }
}

/**
 * Boxes where a countdown is drawn, best first: [{ x, y, w, h }] as fractions of the frame, at most
 * three (the pipeline reads up to three), none on top of another. Empty when nothing counts (no timer, or one nobody can read).
 */
export async function suggestTimers(file, { workDir, dims, signal } = {}) {
  const { width, height, duration } = dims
  const found = []
  // Evidence from windows too short to convince alone (a ring on the floor is read in bits): per
  // grid cell, the windows that did count; a cell that counts in two of them is a timer too.
  const weak = new Map()
  for (const at of AT) {
    const from = Math.max(0, Math.min(duration - SECONDS - 1, duration * at))
    const cands = await crops(file, from, { width, height, workDir, signal })
    // Which boxes have a changing digit-sized mark: cheap, and good enough to pick a few to read.
    const ranked = cands.map(c => {
      const size = c.ow * c.oh, n = Math.floor(c.raw.length / size)
      let changed = 0, prev = null
      const masks = []
      for (let i = 0; i < n; i++) {
        const ms = timerMasks(new Uint8Array(c.raw.subarray(i * size, (i + 1) * size)), c.ow, c.oh)
        masks.push(ms)
        const m = ms[0]
        let ink = 0
        if (m) for (let k = 0; k < m.length; k++) if (m[k] === 0) ink++
        if (m && ink / m.length > 0.01 && ink / m.length < 0.35) { if (prev && difference(prev, m) > 0.01) changed++; prev = m } else prev = null
      }
      return { ...c, masks, changed }
    }).sort((a, b) => b.changed - a.changed).slice(0, READ_TOP).filter(c => c.changed >= 4)
    // Read them as the pipeline would, both polarities, and see whether the numbers count.
    for (const [ci, c] of ranked.entries()) {
      const dir = path.join(workDir, `ts${ci}`)
      fs.mkdirSync(dir, { recursive: true })
      const paths = []
      c.masks.forEach((ms, i) => ms.slice(0, 2).forEach((m, p) => { const f = path.join(dir, `${i}-${p}.pgm`); fs.writeFileSync(f, pgm(m, c.ow, c.oh)); paths.push({ i, f }) }))
      const read = await readCrops(paths.map(p => p.f), { kind: 'timer', workDir, signal })
      const readings = c.masks.map(() => [])
      paths.forEach((p, k) => { const v = parseTimer(read[k]?.text); if (v != null && v >= 0 && v <= 99) readings[p.i].push(v) })
      fs.rmSync(dir, { recursive: true, force: true })
      const { pairs, steps, share } = stepShare(readings)
      if (pairs >= 1 && share >= 0.5 && !(pairs >= 6 && share >= 0.55)) {
        const key = `${c.box.x},${c.box.y}`
        const w = weak.get(key) || { windows: [], pairs: 0, steps: 0 }
        w.windows.push({ c, readings, pairs, share }); w.pairs += pairs; w.steps += steps
        weak.set(key, w)
      }
      if (pairs >= 6 && share >= 0.55) {
        const inner = digitBox(c, readings, 3)
        if (!inner) continue
        found.push({ box: padBox(inner, 0.9), share, pairs })
      }
    }
  }
  for (const w of weak.values()) {
    if (w.windows.length < 2 || w.pairs < 6 || w.steps / w.pairs < 0.55) continue
    const best = w.windows.sort((a, b) => b.pairs - a.pairs)[0]
    const inner = digitBox(best.c, best.readings, 2)
    if (inner) found.push({ box: padBox(inner, 0.9), share: w.steps / w.pairs, pairs: w.pairs })
  }
  const picked = []
  for (const f of found.sort((a, b) => b.share * Math.min(b.pairs, 12) - a.share * Math.min(a.pairs, 12))) {
    if (picked.length < 3 && !picked.some(p => overlap(p, f.box))) picked.push(f.box)
  }
  return picked
}
