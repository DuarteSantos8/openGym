#!/usr/bin/env node
/* Run after `npm run build:mobile`'s `cap sync`: is what went into the native shells the phone
 * build, whole?
 *
 * A web `vite build` that runs into the same dist/ between the mobile build and `cap sync` (two
 * builds in one worktree) leaves the web index.html beside the mobile chunks, and the APK then
 * opens the web app: no Android-only settings, a service worker, the passkey login screen. Each
 * copy is checked for
 *   - the flavour tag the mobile build writes into index.html (vite.config.js, `opengym-flavor`),
 *   - every script and stylesheet index.html loads, present beside it,
 *   - a stamped service worker (no `__BUILD__` left in sw.js).
 *
 * Usage: node scripts/check-mobile-bundle.mjs [frontend dir]   — exit code 1 on any problem. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkStagedMedia } from '../../scripts/catalogue/stage-media.mjs'

const COPIES = [
  'dist',
  'android/app/src/main/assets/public',
  'ios/App/App/public',
]

export function checkCopy(dir, { requireMedia = false } = {}) {
  const problems = []
  const html = join(dir, 'index.html')
  if (!existsSync(html)) return [`${dir}: no index.html`]
  const text = readFileSync(html, 'utf8')
  if (!/<meta\s+name="opengym-flavor"\s+content="mobile"/.test(text))
    problems.push(`${dir}/index.html is not the mobile build (no opengym-flavor meta) — another build ran into dist/?`)
  for (const [, ref] of text.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g))
    if (!existsSync(join(dir, ref))) problems.push(`${dir}/index.html loads ${ref}, which is missing`)
  const sw = join(dir, 'sw.js')
  if (existsSync(sw) && readFileSync(sw, 'utf8').includes('__BUILD__'))
    problems.push(`${dir}/sw.js is not stamped (__BUILD__ left in it)`)
  problems.push(...checkStagedMedia(dir, { requireManifest: requireMedia }).map(p => `${dir}: ${p}`))
  return problems
}

export function checkMobileBundle(root, { sourceDir = 'dist', platform = null, requireMedia = false } = {}) {
  if (platform && !['android', 'ios'].includes(platform)) throw new Error('platform must be android or ios')
  const selected = [sourceDir, ...COPIES.slice(1).filter(rel => !platform || rel.startsWith(platform + '/'))]
  const copies = selected.map(rel => join(root, rel)).filter((dir, i) => i === 0 || platform || existsSync(dir))
  const problems = copies.flatMap(dir => checkCopy(dir, { requireMedia }))
  const sourceManifest = join(copies[0], 'exercise-media/manifest.json')
  if (existsSync(sourceManifest)) {
    const expected = readFileSync(sourceManifest, 'utf8')
    for (const dir of copies.slice(1)) {
      const manifest = join(dir, 'exercise-media/manifest.json')
      if (existsSync(manifest) && readFileSync(manifest, 'utf8') !== expected) problems.push(`${dir}: exercise media manifest differs from selected source build`)
    }
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))
  const value = flag => { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1] }
  const problems = checkMobileBundle(root, { sourceDir: value('--source'), platform: value('--platform'), requireMedia: process.argv.includes('--media') })
  if (problems.length) {
    for (const p of problems) console.error('✗ ' + p)
    process.exit(1)
  }
  console.log('Mobile bundle OK in ' + COPIES.filter(rel => existsSync(join(root, rel))).join(', ') + '.')
}
