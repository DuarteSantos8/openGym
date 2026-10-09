#!/usr/bin/env node
// Copies the exercise stills and animations next to a built app, as exercise-media/still and /clip:
//
//   node scripts/catalogue/stage-media.mjs frontend/dist                 web demo, 180 px from catalogue/media
//   APP_MEDIA_DIR=/private/app node scripts/catalogue/stage-media.mjs frontend/dist
//                                                                        Android package: larger animations
//
// The media are licensed from Gym visual for openGym only (catalogue/media/NOTICE.md). 180 px is
// what may sit in the repository, a website or a self-hosted server; anything larger may only
// ever end up inside a compiled app package, so APP_MEDIA_DIR is set by the release build alone
// and points at the maintainer's private copy, never at anything in this repository.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = path.resolve(process.argv[2] || 'frontend/dist')
const media = path.join(ROOT, 'catalogue/media')
const appDir = process.env.APP_MEDIA_DIR

const copyDir = (from, to, ext) => {
  fs.mkdirSync(to, { recursive: true })
  let n = 0
  for (const f of fs.readdirSync(from)) {
    if (!f.endsWith(ext)) continue
    fs.copyFileSync(path.join(from, f), path.join(to, f))
    n++
  }
  return n
}
const dest = path.join(out, 'exercise-media')
const stills = copyDir(path.join(media, 'still'), path.join(dest, 'still'), '.webp')
const clips = copyDir(appDir || path.join(media, 'clip'), path.join(dest, 'clip'), '.mp4')
fs.copyFileSync(path.join(media, 'NOTICE.md'), path.join(dest, 'NOTICE.md'))
console.log(`media: ${stills} stills, ${clips} animations${appDir ? ' (app size)' : ''} -> ${path.relative(ROOT, out) || out}`)
