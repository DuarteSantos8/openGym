// A downloaded video → the draft. Everything here works on a local file, which is what lets the
// end-to-end test run the real thing on a generated video without going near YouTube.

import path from 'node:path'
import fs from 'node:fs'
import { probe, extractCrops, still, stillDataUrl } from './frames.js'
import { readCrops } from './ocr.js'
import { segment, timerPhases } from './segment.js'
import { classify, cutsOf } from './classify.js'
import { dominantLabel, stripLabel, normName } from './text.js'
import { autoNameBox } from './auto-roi.js'
import { quality } from './gate.js'
import { nameGaps } from './gap-names.js'
import { suggestRois } from './roi-suggest.js'
import { suggestTimers } from './timer-suggest.js'
import { run } from './proc.js'

const STRIP_MIN = 60      // seconds: a row longer than this, read as one, gets a strip of stills
const STRIP_EVERY = 15
const STRIP_MAX = 24

/** Read each distinct crop once and fan the readings back out to every second. */
async function readAll(paths, kind, { workDir, signal, onProgress }) {
  const unique = [...new Set(paths.filter(Boolean))]
  const res = await readCrops(unique, { kind, workDir, signal, onBatch: n => onProgress?.(n / Math.max(1, unique.length)) })
  const byPath = new Map(unique.map((p, i) => [p, res[i]]))
  return { readings: paths.map(p => (p ? byPath.get(p) : { text: '', conf: 0 })), unique: unique.length }
}

/** The stills the ROI screen shows, and where the boxes probably go. */
export async function roiSetup(file, { workDir, signal, dims } = {}) {
  const d = dims || await probe(file, { signal })
  // Fifteen points across the video: a creator who shows the name only before each exercise has it
  // on screen a third of the time, and the suggestion needs to catch it at least twice.
  const at = Array.from({ length: 15 }, (_, i) => Math.round(d.duration * (0.05 + i * 0.065) * 10) / 10)
  const samples = []
  for (const t of [at[4], at[7], at[10]]) samples.push({ t, src: await stillDataUrl(file, t, workDir, { width: 640, signal }) })
  // Suggestions from full frames at the video's own size: Tesseract's sparse-text mode finds the
  // captions wherever they are.
  const frames = []
  for (const t of at) {
    const p = path.join(workDir, `suggest-${Math.round(t * 10)}.png`)
    try {
      await still(file, t, p, { signal })
      const { stdout } = await run('tesseract', [p, 'stdout', '--psm', '11', 'tsv'], { signal, timeoutMs: 120000 })
      frames.push({ tsv: stdout, width: d.width, height: d.height })
    } catch (e) { if (e.cancelled) throw e } finally { fs.rmSync(p, { force: true }) }
  }
  const suggest = suggestRois(frames)
  // A countdown in a ring is not something a whole-frame read picks out: read the corners and the
  // floor for numbers that count. What counts is the timer, whatever the whole frames said.
  try {
    const timers = await suggestTimers(file, { workDir, dims: d, signal })
    if (timers.length) Object.assign(suggest, { timer: timers[0], timers })
  } catch (e) { if (e.cancelled) throw e }
  return { samples, suggest, width: d.width, height: d.height }
}

/**
 * The boxes of a video, found by the program: { name, timer, captions } or null when it could not
 * tell where the names are. The timer is found by its counting (timer-suggest.js), the name by what
 * it reads (auto-roi.js), with the timer's column left out.
 */
export async function autoRois(file, { workDir, signal, dims } = {}) {
  const d = dims || await probe(file, { signal })
  let timers = []
  try { timers = await suggestTimers(file, { workDir, dims: d, signal }) } catch (e) { if (e.cancelled) throw e }
  const found = await autoNameBox(file, { dims: d, workDir, signal, avoid: timers.slice(0, 1) })
  if (!found) return null
  return { name: found.boxes.length > 1 ? found.boxes : found.box, timer: timers.length > 1 ? timers.slice(0, 2) : timers[0] || null, captions: found.captions }
}

/**
 * The per-second readings → blocks and the draft. Pure: no files, no OCR, no video. The worker
 * and the regression fixtures (test/fixtures) both go through here, so a fixture tests exactly
 * what a real import would do with the same readings.
 *
 * `gapNames` ([{ at, text, conf }], `at` the second a timed run starts) are names read from the
 * move before it (gap-names.js): the run that starts there becomes that move.
 */
export function draftFromFrames(frames, { hints = [], parts = [], gapNames = [] } = {}) {
  // A video that opens every caption with the same word ("NOW: SQUAT") has a label, not a move:
  // it goes, in every reading, as the OCR spelled it (NO, OW, W…).
  const label = dominantLabel(frames.map(f => f.name))
  if (label) frames = frames.map(f => (f.name ? { ...f, name: stripLabel(f.name, label) } : f))
  const phases = timerPhases(frames)
  let blocks = phases || segment(frames)
  // Names read from the move before (gap-names.js) go straight onto the runs they name, not into the
  // readings: a caption put into one run of several alike would be taken for a rest announcing the next.
  if (phases && gapNames.length) {
    blocks = blocks.map(b => {
      const n = gapNames.find(x => x.at === b.start)
      if (!n || (b.kind !== 'gap' && b.kind !== 'work')) return b
      const key = normName(n.text)
      return { ...b, kind: 'work', key, text: n.text, conf: Math.round(n.conf) / 100, variants: { [key]: 1 }, timed: undefined }
    })
  }
  const draft = classify(blocks, { hints, parts, cuts: cutsOf(frames.map(f => f.scene || 0)), timed: !!phases })
  return { blocks, draft, timed: !!phases }
}

/**
 * file + roi → { frames, blocks, draft, stats }.
 * `progress(stage, fraction)` for the job: 'frames' then 'ocr' then 'thumbs'.
 */
export async function analyse(file, roi, { workDir, signal, hints = [], parts = [], progress = () => {}, dims } = {}) {
  const d = dims || await probe(file, { signal })
  progress('frames', 0)
  const crops = await extractCrops(file, roi, { ...d, workDir, signal, onProgress: f => progress('frames', f) })
  progress('ocr', 0)
  const hasTimer = crops.timers.some(l => l.some(Boolean))
  const share = hasTimer ? 0.7 / crops.names.length : 1 / crops.names.length   // per name box (mask and plain together)
  const names = []
  for (let b = 0; b < crops.names.length; b++) {
    names.push(await readAll(crops.names[b], 'name', { workDir, signal, onProgress: f => progress('ocr', share * (b + f) / 2) }))
    // The plain crops too (where something looked like text): a caption half faded in is read
    // whole from them, and in pieces from the mask.
    if (crops.namesPlain?.[b]?.some(Boolean)) {
      names.push(await readAll(crops.namesPlain[b], 'name', { workDir, signal, onProgress: f => progress('ocr', share * (b + 0.5 + f / 2)) }))
    }
  }
  const clocks = []
  for (let c = 0; hasTimer && c < crops.timers.length; c++) {
    clocks.push(await readAll(crops.timers[c], 'timer', { workDir, signal, onProgress: f => progress('ocr', 0.7 + 0.3 * (c + f) / crops.timers.length) }))
  }
  // With several name boxes, each second takes the reading that looks most like a name: the
  // most letters, read with the most confidence. The other boxes are empty at that moment.
  const score = r => (r && r.text ? (String(r.text).match(/\p{L}/gu) || []).length * (r.conf || 0) : 0)
  const frames = []
  for (let t = 0; t < crops.seconds; t++) {
    const best = names.map(n => n.readings[t]).reduce((a, r) => (score(r) > score(a) ? r : a), { text: '', conf: 0 })
    const timers = clocks.map(c => c.readings[t]?.text || '')
    frames.push({ t, name: best.text, nameConf: best.conf, timer: timers[0] || '', timers, scene: crops.scene[t] || 0 })
  }
  // The countdown first, where the video has one the OCR can follow: it knows every work, rest
  // and hold to the second. Whether it can be followed is what timerPhases finds — confirmed
  // countdowns over a good part of the video — not how clean every reading is: a timer shown
  // only during the work, or read in one of its four readings, still runs the show. The
  // captions alone otherwise.
  let { blocks, draft, timed } = draftFromFrames(frames, { hints, parts })
  // Runs of the countdown no caption named (a warm-up or stretch whose names show in the last
  // seconds of the move before, away from the name box): read from the tail of the run before.
  let gapNames = []
  if (timed) {
    try {
      const found = await nameGaps(file, blocks, { dims: d, workDir, signal })
      gapNames = found.map(n => ({ at: blocks[n.index].start, text: n.text, conf: n.conf }))
    } catch (e) { if (e.cancelled || signal?.aborted) throw e }
    if (gapNames.length) ({ blocks, draft, timed } = draftFromFrames(frames, { hints, parts, gapNames }))
  }
  const signals = quality(frames, draft, timed, { expectTimed: [].concat(roi?.timer || []).length > 0 })
  progress('thumbs', 0)
  const rows = draft.sections.flatMap(s => s.rows)
  for (let i = 0; i < rows.length; i++) {
    rows[i].thumb = await stillDataUrl(file, rows[i].thumbT, workDir, { width: 240, signal })
    // A long stretch with nothing on screen to name its moves (a cool-down of 30-second holds
    // shown only by a timer nobody could read): a still every STRIP_EVERY seconds, so the review
    // screen can split it and the user can see which move is which.
    if (rows[i].rounds === 1 && rows[i].sec > STRIP_MIN && rows[i].occurrences?.length === 1) {
      const o = rows[i].occurrences[0]
      rows[i].strip = []
      for (let t = o.start + 3; t < o.start + o.dur && rows[i].strip.length < STRIP_MAX; t += STRIP_EVERY) {
        rows[i].strip.push({ t, src: await stillDataUrl(file, t, workDir, { width: 160, signal }) })
      }
    }
    progress('thumbs', (i + 1) / rows.length)
  }
  return {
    frames, blocks, draft, gapNames, quality: signals,
    stats: { seconds: crops.seconds, uniqueName: names.reduce((t, n) => t + n.unique, 0), uniqueTimer: clocks.reduce((t, c) => t + c.unique, 0), readFrames: frames.filter(f => f.name).length, gapNamed: gapNames.length }
  }
}
