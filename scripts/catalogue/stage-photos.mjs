#!/usr/bin/env node
// Copies the extra exercise pictures (catalogue/photos/: Everkinetic drawings, CC BY-SA 4.0, see
// catalogue/photos/NOTICE.md) next to a built app, as exercise-photos/:
//
//   node scripts/catalogue/stage-photos.mjs frontend/dist
//
// The web Docker image copies the same folder itself (web/Dockerfile).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const src = path.join(ROOT, 'catalogue/photos')
const out = path.join(path.resolve(process.argv[2] || 'frontend/dist'), 'exercise-photos')
if (!fs.existsSync(path.join(src, 'index.json'))) {
  console.log('pictures: none (catalogue/photos/index.json is missing)')
  process.exit(0)
}
fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(src, out, { recursive: true })
const n = fs.readdirSync(path.join(out, 'files')).length
console.log(`pictures: ${n} files -> ${path.relative(process.cwd(), out) || out}`)
