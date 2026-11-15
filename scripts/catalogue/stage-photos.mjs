#!/usr/bin/env node
// Copies the extra exercise media next to a built app:
//   catalogue/photos/ -> exercise-photos/  (Everkinetic drawings, CC BY-SA 4.0, see its NOTICE.md)
//   catalogue/demos/  -> exercise-demos/   (Commons videos and U.S. Army photos, see its NOTICE.md)
//
//   node scripts/catalogue/stage-photos.mjs frontend/dist
//
// The web Docker image copies the same folders itself (web/Dockerfile).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dist = path.resolve(process.argv[2] || 'frontend/dist')
for (const [from, to, what] of [['catalogue/photos', 'exercise-photos', 'pictures'], ['catalogue/demos', 'exercise-demos', 'demos']]) {
  const src = path.join(ROOT, from)
  const out = path.join(dist, to)
  if (!fs.existsSync(path.join(src, 'index.json'))) { console.log(`${what}: none (${from}/index.json is missing)`); continue }
  fs.rmSync(out, { recursive: true, force: true })
  fs.cpSync(src, out, { recursive: true })
  const n = fs.readdirSync(path.join(out, 'files')).length
  console.log(`${what}: ${n} files -> ${path.relative(process.cwd(), out) || out}`)
}
