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
  // Nine points across the video: a creator who shows the name only before each exercise has it
  // on screen a third of the time, and the suggestion needs to catch it at least twice.
  const at = [0.15, 0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75, 0.85].map(f => Math.round(d.duration * f * 10) / 10)
  const samples = []
  for (const t of [at[2], at[4], at[6]]) samples.push({ t, src: await stillDataUrl(file, t, workDir, { width: 640, signal }) })
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
export async function analyse(file, roi, { workDir, signal, hints = [], progress = () => {}, dims } = {}) {
  const d = dims || await probe(file, { signal })
  progress('frames', 0)
  const crops = await extractCrops(file, roi, { ...d, workDir, signal, onProgress: f => progress('frames', f) })
  progress('ocr', 0)
  const hasTimer = crops.timer.some(Boolean)
  const name = await readAll(crops.name, 'name', { workDir, signal, onProgress: f => progress('ocr', hasTimer ? f * 0.7 : f) })
  const timer = hasTimer
    ? await readAll(crops.timer, 'timer', { workDir, signal, onProgress: f => progress('ocr', 0.7 + f * 0.3) })
    : { readings: crops.timer.map(() => ({ text: '', conf: 0 })), unique: 0 }
  const frames = name.readings.map((r, t) => ({ t, name: r.text, nameConf: r.conf, timer: timer.readings[t]?.text || '' }))
  const blocks = segment(frames)
  const draft = classify(blocks, { hints })
  progress('thumbs', 0)
  const rows = draft.sections.flatMap(s => s.rows)
  for (let i = 0; i < rows.length; i++) {
    rows[i].thumb = await stillDataUrl(file, rows[i].thumbT, workDir, { width: 240, signal })
    progress('thumbs', (i + 1) / rows.length)
  }
  return {
    frames, blocks, draft,
    stats: { seconds: crops.seconds, uniqueName: name.unique, uniqueTimer: timer.unique, readFrames: frames.filter(f => f.name).length }
  }
}
