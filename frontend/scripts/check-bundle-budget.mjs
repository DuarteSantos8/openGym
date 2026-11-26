#!/usr/bin/env node
/* check-bundle-budget.mjs (EP18-T03): hold the web build to bundle-budget.json.
 *
 * Two things a phone on a slow connection pays for before the first screen: the script and the
 * styles index.html asks for up front (its own tags and its modulepreloads). This adds them up
 * gzipped and compares with the budget, and checks that text meant to load on demand (the
 * exercise guides, the Learn hub) has not been pulled into that first load by a stray import,
 * and that a default build has none of the Cloud edition's code in any file.
 *
 *   node scripts/check-bundle-budget.mjs [dist]     exit 1 with one line per problem
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The .js and .css files index.html loads before anything is tapped, in document order. */
export function entryFiles(html) {
  const out = []
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    const ref = m[1].replace(/^\.?\//, '')
    if (!/^https?:/.test(ref) && !out.includes(ref)) out.push(ref)
  }
  return out
}

/** Sizes of the first load in `dist`, and the entry scripts' text for the lazy-only check. */
export function measure(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const files = entryFiles(html).filter(f => existsSync(join(dist, f)))
  let entryJsGzip = 0, entryCssGzip = 0
  const scripts = []
  for (const f of files) {
    const buf = readFileSync(join(dist, f))
    const gz = gzipSync(buf).length
    if (f.endsWith('.js')) { entryJsGzip += gz; scripts.push({ file: f, text: buf.toString('utf8') }) }
    else entryCssGzip += gz
  }
  // Every script the build made, loaded up front or not: for what must not be there at all.
  const assets = join(dist, 'assets')
  const all = existsSync(assets) ? readdirSync(assets).filter(f => f.endsWith('.js')).map(f => ({ file: 'assets/' + f, text: readFileSync(join(assets, f), 'utf8') })) : []
  return { files, entryJsGzip, entryCssGzip, scripts, all }
}

const kb = n => (n / 1000).toFixed(1) + ' kB'

/** One line per way the measured build breaks the budget. Empty means it holds. */
export function problems(m, budget) {
  const out = []
  if (!m.files.some(f => f.endsWith('.js'))) out.push('index.html loads no script: the build or this check is broken')
  if (m.entryJsGzip > budget.entryJsGzip) out.push(`first-load script is ${kb(m.entryJsGzip)} gzipped, over the ${kb(budget.entryJsGzip)} budget`)
  if (m.entryCssGzip > budget.entryCssGzip) out.push(`first-load styles are ${kb(m.entryCssGzip)} gzipped, over the ${kb(budget.entryCssGzip)} budget`)
  for (const { what, marker } of budget.lazyOnly || []) {
    const hit = m.scripts.find(s => s.text.includes(marker))
    if (hit) out.push(`${what} is in the first load (${hit.file}); it is meant to load on demand`)
  }
  // A default build carries no Cloud edition code, reachable or not (ADR 0008).
  for (const { what, marker } of budget.absent || []) {
    const hit = (m.all || []).find(s => s.text.includes(marker))
    if (hit) out.push(`${what} is in this build (${hit.file}); a default build must not contain it`)
  }
  return out
}

export const readBudget = (file = join(frontend, 'bundle-budget.json')) => JSON.parse(readFileSync(file, 'utf8'))

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2] || join(frontend, 'dist')
  const m = measure(dist)
  const bad = problems(m, readBudget())
  console.log(`first load: ${m.files.length} files, script ${kb(m.entryJsGzip)}, styles ${kb(m.entryCssGzip)} (gzipped)`)
  for (const line of bad) console.error('bundle budget: ' + line)
  process.exit(bad.length ? 1 : 0)
}
