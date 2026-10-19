// Getting pixels out of the video with ffmpeg: a probe, still frames, and the two crops at one
// frame per second. The crops come out as raw 8-bit gray — no image encoder in between — and are
// thresholded in Node (image.js), so the only image tool the worker needs is ffmpeg itself.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { run } from './proc.js'
import { binarize, pgm, blank, difference, timerMasks, textMask } from './image.js'

const even = n => Math.max(2, Math.round(n / 2) * 2)
export const NEAR = 0.01   // share of differing pixels below which two name crops are one caption

/** { width, height, duration } of the first video stream. */
export async function probe(file, { signal } = {}) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { signal, timeoutMs: 60000 })
  const j = JSON.parse(stdout)
  const s = (j.streams || [])[0] || {}
  return { width: +s.width || 0, height: +s.height || 0, duration: +(j.format?.duration) || 0 }
}

/** One still at `t` seconds, `width` px wide (0 = as is). Returns the path. */
export async function still(file, t, out, { width = 0, signal } = {}) {
  const vf = width ? ['-vf', `scale=${width}:-2`] : []
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', ...vf, '-q:v', '4', out], { signal, timeoutMs: 60000 })
  return out
}

/** A still as a data: URL — what the result carries for the review table and the ROI screen. */
export async function stillDataUrl(file, t, workDir, { width = 240, signal } = {}) {
  const out = path.join(workDir, `still-${Math.round(t * 10)}-${width}.jpg`)
  await still(file, t, out, { width, signal })
  const url = 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64')
  fs.rmSync(out, { force: true })
  return url
}

/** Pixel crop and output size for a fractional box on a w×h video, sized for the OCR. */
export function cropGeometry(box, w, h, outH = 72) {
  const cw = Math.max(8, Math.round(box.w * w)), ch = Math.max(8, Math.round(box.h * h))
  const cx = Math.min(w - cw, Math.max(0, Math.round(box.x * w))), cy = Math.min(h - ch, Math.max(0, Math.round(box.y * h)))
  const oh = even(outH)
  const ow = Math.min(1600, even(cw * oh / ch))
  return { cw, ch, cx, cy, ow, oh }
}

/** The name boxes of a ROI as a list: one box, or several where a video shows its names in more than one place. */
export const nameBoxes = roi => [].concat(roi?.name || []).filter(Boolean).slice(0, MAX_NAME_BOXES)
export const MAX_NAME_BOXES = 3

/**
 * The name and timer crops at 1 fps, thresholded and de-duplicated.
 *
 * Returns { seconds, names: [[...], ...], timer: [...] }: one list per name box and one for the
 * timer, each with an entry per second — the path of a PGM to read, or null for a blank crop.
 * Identical crops share a path, so a caption that sits still for 40 seconds is read once.
 */
export async function extractCrops(file, roi, { width, height, duration, workDir, signal, onProgress } = {}) {
  const parts = [], maps = []
  const boxes = nameBoxes(roi)
  // Up to three timers: some videos count the work in one place and the rest in another, and
  // some move the work timer part-way through.
  const clocks = timerBoxes(roi)
  const kinds = [...boxes.map((_, i) => 'name' + i), ...clocks.flatMap((_, j) => ['timer' + j, 'timer' + j + 'B'])]
  const geo = {}
  kinds.forEach(k => { geo[k] = cropGeometry(k.startsWith('timer') ? clocks[+k[5]] : boxes[+k.slice(4)], width, height, k.startsWith('timer') ? TIMER_H : 72) })
  // A timer redraws the moment its number changes, often with a little animation (the digits
  // spin or fade in), and where in the second that falls differs from video to video and even
  // within one. So the timer is taken twice a second — at the start and half a second in — and
  // the countdown keeps whichever reading fits it (segment.js). Everything else once, half a
  // second in. One more branch: the whole frame, tiny, for spotting cuts (see sceneChanges).
  const once = kinds.filter(k => !/^timer\dB$/.test(k))
  const split = `split=${once.length + 1}${once.map(k => `[${k}s]`).join('')}[scene0]`
  parts.push(`[0:v]split=2[at0][at5]`)
  parts.push(`[at5]trim=start=0.5,setpts=PTS-STARTPTS,fps=1,${split}`)
  parts.push(!clocks.length ? `[at0]nullsink` : clocks.length === 1 ? `[at0]fps=1[timer0Bs]` : `[at0]fps=1,split=${clocks.length}${clocks.map((_, j) => `[timer${j}Bs]`).join('')}`)
  parts.push(`[scene0]scale=${SCENE_W}:${SCENE_H}:flags=area,format=gray[scene]`)
  maps.push('-map', '[scene]', '-f', 'rawvideo', path.join(workDir, 'scene.gray'))
  for (const k of kinds) {
    const g = geo[k]
    parts.push(`[${k}s]crop=${g.cw}:${g.ch}:${g.cx}:${g.cy},scale=${g.ow}:${g.oh}:flags=bicubic,format=gray[${k}]`)
    maps.push('-map', `[${k}]`, '-f', 'rawvideo', path.join(workDir, `${k}.gray`))
  }
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-i', file, '-filter_complex', parts.join(';'), ...maps], {
    signal, timeoutMs: 60 * 60000,
    onLine: l => {
      const m = /^out_time_us=(\d+)/.exec(l)
      if (m && duration > 0) onProgress?.(Math.min(1, +m[1] / 1e6 / duration))
    }
  })
  const out = {}
  let seconds = Infinity
  for (const k of kinds) {
    const { ow, oh } = geo[k]
    const size = ow * oh
    const raw = fs.readFileSync(path.join(workDir, `${k}.gray`))
    fs.rmSync(path.join(workDir, `${k}.gray`), { force: true })
    const n = Math.floor(raw.length / size)
    seconds = Math.min(seconds, n)
    const seen = new Map()
    const dir = path.join(workDir, k)
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(dir + 'Alt', { recursive: true })
    // Identical crops share one file, so a caption that sits still for 40 seconds is read once.
    const keep = (px, into) => {
      const hash = into + crypto.createHash('sha1').update(px).digest('hex')
      let p = seen.get(hash)
      if (!p) {
        p = path.join(workDir, into, `${String(seen.size).padStart(5, '0')}.pgm`)
        fs.writeFileSync(p, pgm(px, ow, oh))
        seen.set(hash, p)
      }
      return p
    }
    out[k] = []
    out[k + 'Alt'] = []
    let last = null   // { px, path } of the crop the previous second used
    for (let i = 0; i < n; i++) {
      let altDone = false
      // The masks are plain JavaScript over every second of the video: hand the event loop back
      // now and then, so the job's progress (and a cancel) are still answered while they run.
      if (i % 25 === 24) await new Promise(r => setImmediate(r))
      const gray = raw.subarray(i * size, (i + 1) * size)
      let px
      if (k.startsWith('timer')) {
        // The timer is read as its digits alone, taken from the brightest (or the darkest)
        // marks: the ring round a countdown and a light wall behind white digits read as noise.
        // The other polarity's best guess goes along as a second reading.
        const [a, b] = timerMasks(gray, ow, oh)
        if (!a) { out[k].push(null); out[k + 'Alt'].push(null); last = null; continue }
        px = a
        out[k + 'Alt'].push(b ? keep(b, k + 'Alt') : null)
      } else {
        // Text-like marks first (white captions over a sky); the plain threshold where nothing
        // in the crop looks like text yet.
        px = textMask(gray, ow, oh)
        if (!px) {
          const b = binarize(gray)
          if (blank(b)) { out[k].push(null); out[k + 'Alt'].push(null); last = null; continue }
          px = b.px
          // Low-contrast white text on a light wall has no mask; the crop as it is reads fine.
          out[k + 'Alt'].push(keep(gray, k + 'Alt'))
          altDone = true
        } else if (px.some(v => v === 0)) {
          // A mask keeps the cores of the strokes: a caption that is thin or half faded in (a
          // transition) comes out in pieces, and the same crop untouched reads fine. Where
          // something looks like text, the plain crop is read as well; each second keeps the
          // better of the two (pipeline.js).
          out[k + 'Alt'].push(keep(gray, k + 'Alt'))
          altDone = true
        }
      }
      // A caption over a moving picture is never byte-identical from one second to the next.
      // Within NEAR of the crop just read it is the same caption, and is not read again. The
      // timer changes every second by design, so it only shares exact copies.
      if (!k.startsWith('timer') && !altDone) out[k + 'Alt'].push(null)
      if (!k.startsWith('timer') && last && difference(px, last.px) < NEAR) { out[k].push(last.path); continue }
      const p = keep(px, k)
      last = { px, path: p }
      out[k].push(p)
    }
  }
  const len = Number.isFinite(seconds) ? seconds : 0
  const sceneRaw = fs.readFileSync(path.join(workDir, 'scene.gray'))
  fs.rmSync(path.join(workDir, 'scene.gray'), { force: true })
  return {
    seconds: len,
    scene: sceneChanges(sceneRaw, SCENE_W * SCENE_H).slice(0, len),
    names: boxes.map((_, i) => out['name' + i]),
    // The same boxes, the crop as it is (no mask) where something looked like text, else null.
    namesPlain: boxes.map((_, i) => out['name' + i + 'Alt']),
    // Every reading of every timer, one list each: per box, at the start and half a second in,
    // in each polarity. The countdown keeps whichever fits.
    timers: clocks.flatMap((_, j) => ['timer' + j, 'timer' + j + 'B'].flatMap(k => [out[k], out[k + 'Alt']])).map(l => l || new Array(len).fill(null))
  }
}

const SCENE_W = 64, SCENE_H = 36

/** Per second, how much the whole picture changed since the second before (mean absolute grey difference, 0–255). */
export function sceneChanges(raw, size) {
  const n = Math.floor(raw.length / size)
  const out = [0]
  for (let i = 1; i < n; i++) {
    let d = 0
    for (let k = 0; k < size; k++) d += Math.abs(raw[i * size + k] - raw[(i - 1) * size + k])
    out.push(Math.round(d / size))
  }
  return out
}

// Timer crops are scaled to this height: big enough for Tesseract to read two digits cleanly.
const TIMER_H = 120

/**
 * The timer boxes of a ROI as a list, up to three: a work timer and a rest timer, and a second
 * place for the work timer in videos that move it part-way through.
 */
export const timerBoxes = roi => [].concat(roi?.timer || []).filter(Boolean).slice(0, MAX_TIMER_BOXES)
export const MAX_TIMER_BOXES = 3
