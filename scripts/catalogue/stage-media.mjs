#!/usr/bin/env node
// Stage only the files described by this build's manifest. Never publish licensed media.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildMediaManifest } from './build-media-manifest.mjs'
import { validateCatalogueManifest } from '../../frontend/src/lib/catalogue-media-manifest.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel) }
const canonical = p => {
  let existing = path.resolve(p)
  const tail = []
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) throw new Error('cannot resolve media output')
    tail.unshift(path.basename(existing)); existing = parent
  }
  return path.join(fs.realpathSync(existing), ...tail)
}

export function checkStagedMedia(out, { requireManifest = true } = {}) {
  const dest = path.join(out, 'exercise-media'), file = path.join(dest, 'manifest.json')
  if (!fs.existsSync(file)) return requireManifest ? ['exercise-media/manifest.json is missing'] : []
  const problems = []
  let manifest
  try { manifest = validateCatalogueManifest(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  catch (err) { return [err.message] }
  const expected = new Set(['manifest.json', 'NOTICE.md'])
  for (const a of manifest.assets) {
    if (!a.bundledPath) continue
    const local = path.join(out, a.bundledPath)
    expected.add(`${a.kind}/${a.drawingId}.${a.format}`)
    if (!fs.existsSync(local)) { problems.push(`missing bundled media: ${a.bundledPath}`); continue }
    if (fs.lstatSync(local).isSymbolicLink()) { problems.push(`symlink bundled media: ${a.bundledPath}`); continue }
    const b = fs.readFileSync(local)
    if (b.length !== a.bytes || createHash('sha256').update(b).digest('hex') !== a.sha256) problems.push(`bundled media mismatch: ${a.bundledPath}`)
  }
  const walk = (dir, prefix = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + e.name
      if (e.isDirectory() && ['still', 'clip'].includes(rel)) walk(path.join(dir, e.name), rel + '/')
      else if (!expected.has(rel)) problems.push(`unexpected staged media: ${rel}`)
    }
  }
  walk(dest)
  if (!fs.existsSync(path.join(dest, 'NOTICE.md')) || !fs.readFileSync(path.join(dest, 'NOTICE.md'), 'utf8').trim()) problems.push('exercise-media/NOTICE.md is missing or blank')
  return problems
}

export function stageMedia({ out, stillDir = path.join(ROOT, 'catalogue/media/still'), clipDir = process.env.APP_MEDIA_DIR || path.join(ROOT, 'catalogue/media/clip'), notice = path.join(ROOT, 'catalogue/media/NOTICE.md'), ...options }) {
  if (!out) throw new Error('an explicit output directory is required')
  const manifest = buildMediaManifest({ stillDir, clipDir, ...options })
  const output = canonical(out), dest = path.join(output, 'exercise-media')
  // Resolve every existing target before recursive removal. An output symlink must not lead
  // into the catalogue or the maintainer's private source directory.
  const target = canonical(dest)
  if (!inside(output, target)) throw new Error('media output must be inside the selected output directory')
  for (const input of [stillDir, clipDir, notice]) {
    const source = canonical(input)
    if (source === target || inside(target, source) || inside(source, target)) throw new Error('media output overlaps source input')
  }
  fs.mkdirSync(output, { recursive: true })
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(path.join(dest, 'still'), { recursive: true })
  if (manifest.mode === 'full') fs.mkdirSync(path.join(dest, 'clip'), { recursive: true })
  for (const a of manifest.assets) {
    if (!a.bundledPath) continue
    fs.copyFileSync(path.join(a.kind === 'still' ? stillDir : clipDir, `${a.drawingId}.${a.format}`), path.join(output, a.bundledPath))
  }
  fs.copyFileSync(notice, path.join(dest, 'NOTICE.md'))
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest) + '\n')
  const problems = checkStagedMedia(output)
  if (problems.length) throw new Error(problems.join('\n'))
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = stageMedia({ out: path.resolve(process.argv[2] || 'frontend/dist') })
    console.log(`media: ${manifest.assets.filter(a => a.kind === 'still').length} stills, ${manifest.assets.filter(a => a.kind === 'clip' && a.bundledPath).length} bundled animations (${manifest.mode})`)
  } catch (err) {
    let message = err.message
    if (process.env.APP_MEDIA_DIR) message = message.split(process.env.APP_MEDIA_DIR).join('[private media input]')
    console.error(message); process.exitCode = 1
  }
}
