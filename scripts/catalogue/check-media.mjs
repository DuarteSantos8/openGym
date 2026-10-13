#!/usr/bin/env node
// The media licence allows 180x180 px at most in this repository (Gym visual agreement, Part A).
// This reads the size straight out of every file's header (WebP and MP4, no ffmpeg needed) and
// fails on anything larger, on a file that is not an exercise's, or on a format the app can't show.
//
//   node scripts/catalogue/check-media.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX = 180
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MEDIA = path.join(ROOT, 'catalogue/media')

export function webpSize(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 } }
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
  return null
}

// Largest track header (tkhd) in the file: width and height are 16.16 fixed point at its end.
export function mp4Size(b) {
  let best = null
  for (let i = b.indexOf('tkhd'); i > 0; i = b.indexOf('tkhd', i + 4)) {
    const version = b[i + 4]
    const end = i + 4 + (version === 1 ? 96 : 84)
    if (end > b.length) break
    const w = b.readUInt32BE(end - 8) / 65536, h = b.readUInt32BE(end - 4) / 65536
    if (w && h && (!best || w * h > best.w * best.h)) best = { w, h }
  }
  return best
}

const problems = []
let n = 0
for (const [dir, ext, size] of [['still', '.webp', webpSize], ['clip', '.mp4', mp4Size]]) {
  const d = path.join(MEDIA, dir)
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) {
    const rel = `catalogue/media/${dir}/${f}`
    if (!new RegExp(`^\\d{4,5}\\${ext}$`).test(f)) { problems.push(`${rel}: expected <id>${ext}`); continue }
    const s = size(fs.readFileSync(path.join(d, f)))
    n++
    if (!s) problems.push(`${rel}: could not read the size, not a ${ext} file?`)
    else if (s.w > MAX || s.h > MAX) problems.push(`${rel}: ${s.w}x${s.h}, the licence allows ${MAX}x${MAX} at most here`)
  }
}
for (const f of fs.existsSync(MEDIA) ? fs.readdirSync(MEDIA) : []) {
  if (!['still', 'clip', 'NOTICE.md'].includes(f)) problems.push(`catalogue/media/${f}: only still/, clip/ and NOTICE.md belong here`)
}
if (!fs.existsSync(path.join(MEDIA, 'NOTICE.md'))) problems.push('catalogue/media/NOTICE.md is missing (the licence requires it)')
if (problems.length) { console.error(problems.slice(0, 40).join('\n') + (problems.length > 40 ? `\n...and ${problems.length - 40} more` : '')); process.exit(1) }
console.log(`media OK: ${n} files, all within ${MAX}x${MAX}`)
