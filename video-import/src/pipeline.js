// A downloaded video → the draft. Everything here works on a local file, which is what lets the
// end-to-end test run the real thing on a generated video without going near YouTube.

import path from 'node:path'
import fs from 'node:fs'
import { probe, extractCrops, still, stillDataUrl } from './frames.js'
import { readCrops } from './ocr.js'
import { segment } from './segment.js'
import { classify } from './classify.js'
import { suggestRois } from './roi-suggest.js'
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
  return { samples, suggest: suggestRois(frames), width: d.width, height: d.height }
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
  const hasTimer = crops.timer.some(Boolean)
  const share = hasTimer ? 0.7 / crops.names.length : 1 / crops.names.length
  const names = []
  for (let b = 0; b < crops.names.length; b++) {
    names.push(await readAll(crops.names[b], 'name', { workDir, signal, onProgress: f => progress('ocr', share * (b + f)) }))
  }
  const timer = hasTimer
    ? await readAll(crops.timer, 'timer', { workDir, signal, onProgress: f => progress('ocr', 0.7 + f * 0.3) })
    : { readings: crops.timer.map(() => ({ text: '', conf: 0 })), unique: 0 }
  // With several name boxes, each second takes the reading that looks most like a name: the
  // most letters, read with the most confidence. The other boxes are empty at that moment.
  const score = r => (r && r.text ? (String(r.text).match(/\p{L}/gu) || []).length * (r.conf || 0) : 0)
  const frames = []
  for (let t = 0; t < crops.seconds; t++) {
    const best = names.map(n => n.readings[t]).reduce((a, r) => (score(r) > score(a) ? r : a), { text: '', conf: 0 })
    frames.push({ t, name: best.text, nameConf: best.conf, timer: timer.readings[t]?.text || '' })
  }
  const blocks = segment(frames)
  const draft = classify(blocks, { hints, parts })
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
    frames, blocks, draft,
    stats: { seconds: crops.seconds, uniqueName: names.reduce((t, n) => t + n.unique, 0), uniqueTimer: timer.unique, readFrames: frames.filter(f => f.name).length }
  }
}
