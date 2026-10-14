// Reading the crops. Tesseract by default; PaddleOCR when the image was built with it
// (OCR_ENGINE=paddle) — it copes far better with stylised and outlined fonts, at the price of a
// Python runtime and about 1.5 GB. Either way one process reads a whole batch of crops: starting
// Tesseract once per second of video would cost more than the reading itself.

import fs from 'node:fs'
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
    const { stdout } = await run('tesseract', args, { signal, timeoutMs: 10 * 60000 })
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

/**
 * Read `files` (image paths) as `kind` ('name' | 'timer'). [{ text, conf }] in the same order.
 * `onBatch(doneCount)` after each batch, for the job's progress.
 */
export async function readCrops(files, { kind, workDir, signal, onBatch } = {}) {
  const out = []
  const usePaddle = ENGINE === 'paddle' && kind !== 'timer'
  const step = usePaddle ? PADDLE_BATCH : BATCH
  for (let i = 0; i < files.length; i += step) {
    const batch = files.slice(i, i + step)
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
    if (!res) res = await tesseract(batch, { kind, workDir, signal })
    out.push(...res)
    onBatch?.(Math.min(files.length, i + step))
  }
  return out
}
