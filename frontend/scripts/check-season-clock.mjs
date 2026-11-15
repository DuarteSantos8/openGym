#!/usr/bin/env node
/* The seasonal QA date hook (src/lib/season-clock.js) is for the dev server and screenshot builds
 * only. This scans a built bundle and fails when any trace of it shipped, so nobody can open the
 * advent calendar (or any seasonal theme) early with ?season-date=.
 *
 * Usage: node scripts/check-season-clock.mjs [dist dir]   (exit code 1 when the hook is in there). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TRACES = ['og_season_clock', 'season-date']
const dir = resolve(process.argv[2] || 'dist')
if (!existsSync(dir)) { console.error(`No build at ${dir}. Run vite build first.`); process.exit(1) }
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
const hits = []
for (const f of walk(dir).filter(f => /\.(js|mjs|html)$/.test(f))) {
  const text = readFileSync(f, 'utf8')
  for (const tr of TRACES) if (text.includes(tr)) hits.push(`${f}: ${tr}`)
}
if (hits.length) {
  console.error('The seasonal date hook is in this build (set VITE_SEASON_CLOCK only for screenshots):\n  ' + hits.join('\n  '))
  process.exit(1)
}
console.log('Season clock: no date hook in ' + dir)
