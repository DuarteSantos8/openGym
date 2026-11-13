#!/usr/bin/env node
/* Does the phone build carry every exercise picture its own bundle will ask for?
 *
 * 1.4.3 reached the App Store with stills and no animation at all (#962): the release folder held
 * WebP, the build asked for MP4, nothing was copied and every check after counted files instead of
 * names. This one reads what the bundle really asks for (lib/exercises.js: the clip extension and
 * the base baked in by VITE_CLIP_EXT / VITE_GIF_BASE) and looks up every catalogue exercise's
 * still and clip, both figures, by exact name in exercise-media/. It also reads the built-in
 * clip size from the first WebP's header (bytes 24 to 29, the canvas, never the picture) against
 * VITE_BUILTIN_CLIP_PX: a build that claims 360 px but carries 180 px never offers the 360 pack.
 *
 * LICENCE: the media are Gym visual's. This only lists file names and reads one header; it never
 * decodes a picture.
 *
 * Usage: node scripts/check-app-media.mjs <public dir> [...]   exit code 1 on any problem.
 * Run by check-mobile-bundle.mjs (npm run build:mobile) and scripts/ios/finish-ipa.sh. */
import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CLIP_BASE = 'exercise-media/clip/'
const DEFAULT_STILL_BASE = 'exercise-media/still/'

/** What the built bundle asks for: { ext, builtinPx, clipBase, stillBase } from its env object. */
export function bundleMediaConfig(js) {
  const val = key => {
    const m = new RegExp(key + '\\s*:\\s*([`"\'])([^`"\']*)\\1').exec(js)
    return m ? m[2] : null
  }
  const px = Number(val('VITE_BUILTIN_CLIP_PX'))
  return {
    ext: val('VITE_CLIP_EXT') === 'webp' ? '.webp' : '.mp4',
    builtinPx: px > 0 ? px : 180,
    clipBase: val('VITE_GIF_BASE'),
    stillBase: val('VITE_IMG_BASE'),
  }
}

/** The file names the app asks for, the same rules as lib/exercises.js imgSrc and gifSrc. */
export function wantedMedia(exdb, ext) {
  const clips = new Set(), stills = new Set()
  const clipFile = f => (ext !== '.mp4' && f.endsWith('.mp4') ? f.slice(0, -4) + ext : f)
  for (const ex of exdb) {
    if (ex.img) stills.add(ex.img)
    if (ex.gif) clips.add(clipFile(ex.gif))
    for (const twin of [ex.fv, ex.mv]) {
      if (!twin) continue
      stills.add(twin + '.webp')
      clips.add(twin + ext)
    }
  }
  return { clips, stills }
}

/** The canvas width of an animated WebP from its VP8X header, or null. */
export function webpWidth(head) {
  if (!head || head.length < 30) return null
  if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WEBP') return null
  if (head.toString('latin1', 12, 16) !== 'VP8X') return null
  return head.readUIntLE(24, 3) + 1
}

const readHead = file => {
  const fd = openSync(file, 'r')
  try { const b = Buffer.alloc(30); const n = readSync(fd, b, 0, 30, 0); return b.subarray(0, n) } finally { closeSync(fd) }
}

/** The chunk that holds lib/exercises.js: the one naming the clip folder. */
function exercisesChunk(dir) {
  const assets = join(dir, 'assets')
  if (!existsSync(assets)) return null
  for (const f of readdirSync(assets)) {
    if (!f.endsWith('.js')) continue
    const js = readFileSync(join(assets, f), 'utf8')
    if (js.includes(DEFAULT_CLIP_BASE) && js.includes('VITE_MOBILE')) return js
  }
  for (const f of readdirSync(assets)) {
    if (!f.endsWith('.js')) continue
    const js = readFileSync(join(assets, f), 'utf8')
    if (js.includes(DEFAULT_CLIP_BASE)) return js
  }
  return null
}

const sample = names => names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '')

/** Problems with one built copy (dist/, ios/App/App/public, ...); [] when it is whole. */
export function checkAppMedia(dir, exdb) {
  const js = exercisesChunk(dir)
  if (!js) return [`${dir}: no bundle chunk names ${DEFAULT_CLIP_BASE}, cannot tell what the app asks for`]
  const cfg = bundleMediaConfig(js)
  // A build that points the media at a CDN (the demo) has nothing of its own to check.
  if (cfg.clipBase || cfg.stillBase) return []
  const problems = []
  const { clips, stills } = wantedMedia(exdb, cfg.ext)
  const list = sub => {
    const d = join(dir, sub)
    return existsSync(d) ? new Set(readdirSync(d)) : null
  }
  for (const [sub, want, kind] of [[DEFAULT_CLIP_BASE, clips, 'animations'], [DEFAULT_STILL_BASE, stills, 'stills']]) {
    const have = list(sub)
    if (!have) { problems.push(`${dir}/${sub}: missing, the app shows no ${kind} (the bundle asks for ${kind === 'animations' ? cfg.ext : '.webp'})`); continue }
    const missing = [...want].filter(n => !have.has(n)).sort()
    if (missing.length) {
      const other = kind === 'animations' && missing.length === want.size
        ? ` (the bundle asks for ${cfg.ext}${cfg.ext === '.mp4' ? '; a release folder of WebP needs VITE_CLIP_EXT=webp' : ''})`
        : ''
      problems.push(`${dir}/${sub}: ${missing.length} of ${want.size} ${kind} the app asks for are missing${other}: ${sample(missing)}`)
    }
  }
  if (cfg.ext === '.webp') {
    const first = [...clips].sort().find(n => existsSync(join(dir, DEFAULT_CLIP_BASE, n)))
    const w = first ? webpWidth(readHead(join(dir, DEFAULT_CLIP_BASE, first))) : null
    if (first && w == null) problems.push(`${dir}/${DEFAULT_CLIP_BASE}${first}: not an animated WebP`)
    else if (w != null && w !== cfg.builtinPx)
      problems.push(`${dir}/${DEFAULT_CLIP_BASE}: the animations are ${w} px but the bundle says ${cfg.builtinPx} px (VITE_BUILTIN_CLIP_PX), so the quality packs would be offered wrong`)
  }
  return problems
}

export async function loadCatalogue() {
  return (await import('../src/lib/exercises-data.js')).EXDB
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2)
  if (!dirs.length) { console.error('usage: check-app-media.mjs <public dir> [...]'); process.exit(2) }
  const exdb = await loadCatalogue()
  const problems = dirs.flatMap(d => checkAppMedia(resolve(d), exdb))
  if (problems.length) {
    for (const p of problems) console.error('✗ ' + p)
    process.exit(1)
  }
  console.log(`Exercise media OK in ${dirs.join(', ')}: every still and animation the app asks for is there.`)
}
