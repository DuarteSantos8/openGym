// Reading the crops. Tesseract by default; PaddleOCR when the image was built with it
// (OCR_ENGINE=paddle) — it copes far better with stylised and outlined fonts, at the price of a
// Python runtime and about 1.5 GB. Either way one process reads a whole batch of crops: starting
// Tesseract once per second of video would cost more than the reading itself.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './proc.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ENGINE = (process.env.OCR_ENGINE || 'tesseract').toLowerCase()
const LANGS = process.env.OCR_LANGS || 'eng'
const BATCH = 200
// Paddle loads its model every time it starts (seconds, not milliseconds): fewer, larger batches.
const PADDLE_BATCH = 1000

/** Page-by-page text and confidence from one TSV of a multi-image run. */
export function tsvPages(tsv, count) {
  const pages = Array.from({ length: count }, () => ({ words: [], conf: [] }))
  for (const line of String(tsv || '').split('\n').slice(1)) {
    const c = line.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const page = +c[1] - 1
    const conf = Number(c[10])
    const text = c.slice(11).join('\t').trim()
    if (!pages[page] || !text || conf < 0) continue
    pages[page].words.push(text); pages[page].conf.push(conf)
  }
  return pages.map(p => ({
    text: p.words.join(' '),
    conf: p.conf.length ? Math.round(p.conf.reduce((a, b) => a + b, 0) / p.conf.length) : 0
  }))
}

async function tesseract(files, { kind, workDir, signal }) {
  const list = path.join(workDir, `ocr-${kind}-${process.hrtime.bigint()}.txt`)
  fs.writeFileSync(list, files.join('\n') + '\n')
  // One line of text (psm 7). The timer only ever shows digits and a colon, and saying so
  // stops "0:35" being read as "O:3S".
  // Names can run to two lines ("5 x PUSH UPS to / DOWNWARDS DOG"): a block (psm 6), its lines
  // joined. The timer is one line (psm 7).
  const args = [list, 'stdout', '--psm', kind === 'timer' ? '7' : '6', '-l', kind === 'timer' ? 'eng' : LANGS]
  if (kind === 'timer') args.push('-c', 'tessedit_char_whitelist=0123456789:')
  args.push('tsv')
  try {
    // One thread per process: Tesseract's own OpenMP threads spin against each other whenever the
    // machine has anything else to do, and a batch of 200 small crops then takes a minute instead
    // of three seconds. The parallelism is across batches (VIDEO_IMPORT_OCR_PROCS), not inside one.
    const { stdout } = await run('tesseract', args, { signal, timeoutMs: 10 * 60000, env: { ...process.env, OMP_THREAD_LIMIT: '1' } })
    return tsvPages(stdout, files.length)
  } finally { fs.rmSync(list, { force: true }) }
}

async function paddle(files, { kind, signal, workDir }) {
  const list = path.join(workDir, `ocr-${kind}-${process.hrtime.bigint()}.txt`)
  fs.writeFileSync(list, files.join('\n') + '\n')
  try {
    const { stdout } = await run('python3', ['-I', path.join(HERE, 'paddle_ocr.py'), list, kind], { signal, timeoutMs: 20 * 60000 })
    const rows = stdout.split('\n').filter(Boolean).map(l => JSON.parse(l))
    return files.map((_, i) => rows[i] || { text: '', conf: 0 })
  } finally { fs.rmSync(list, { force: true }) }
}

let paddleBroken = false

/** How many Tesseract processes read at once (VIDEO_IMPORT_OCR_PROCS; 4 at most unless asked for more). */
export const OCR_PROCS = Math.max(1, Math.floor(+process.env.VIDEO_IMPORT_OCR_PROCS) || Math.min(4, os.availableParallelism?.() || 2))

/**
 * Run `read(batch)` over every batch with at most `lanes` going at once and return the answers
 * flattened in the order of the batches, whichever finishes first. `onBatch(doneCount)` counts
 * the items finished. The first failure ends the run: nothing starts after it.
 */
export async function mapBatches(batches, read, lanes = 1, onBatch) {
  const results = new Array(batches.length)
  let next = 0, done = 0, failed = false
  const lane = async () => {
    for (;;) {
      if (failed || next >= batches.length) return
      const k = next++
      try { results[k] = await read(batches[k]) } catch (e) { failed = true; throw e }
      done += batches[k].length
      onBatch?.(done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, batches.length)) }, lane))
  return results.flat()
}

/**
 * Read `files` (image paths) as `kind` ('name' | 'timer'). [{ text, conf }] in the same order.
 * `onBatch(doneCount)` after each batch, for the job's progress.
 */
export async function readCrops(files, { kind, workDir, signal, onBatch } = {}) {
  const usePaddle = ENGINE === 'paddle' && kind !== 'timer'
  const step = usePaddle ? PADDLE_BATCH : BATCH
  const batches = []
  for (let i = 0; i < files.length; i += step) batches.push(files.slice(i, i + step))
  const readBatch = async batch => {
    let res
    // The timer is digits and a colon, which Tesseract with a whitelist reads as well as anything
    // and many times faster: Paddle is spent on the names, where it is better.
    if (usePaddle && !paddleBroken) {
      try { res = await paddle(batch, { kind, signal, workDir }) } catch (e) {
        if (e.cancelled) throw e
        // A Paddle that will not start is reported once and Tesseract takes over for the rest
        // of this process: the job still finishes, just with the plainer reader.
        console.warn('PaddleOCR failed, falling back to Tesseract:', e.message)
        paddleBroken = true
      }
    }
    return res || tesseract(batch, { kind, workDir, signal })
  }
  // Paddle loads its model for every batch and is heavy: one at a time. Tesseract is cheap to run
  // several of, one thread each.
  return mapBatches(batches, readBatch, usePaddle ? 1 : OCR_PROCS, onBatch)
}
