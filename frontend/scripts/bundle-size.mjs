#!/usr/bin/env node
// Measures the production bundle (raw + gzip, per file and total) and, given a baseline,
// prints the difference. CI runs it in every pipeline and keeps the result as an artifact,
// so a merge request can fetch main's numbers and show what it adds — the one thing
// reviewers otherwise never see until a self-hoster asks why the app got slower.
//
//   node scripts/bundle-size.mjs --out bundle-size.json              # measure dist/
//   node scripts/bundle-size.mjs --compare baseline.json current.json # print the delta
//
// Report-only: growth is a review question, not a build failure.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const dist = new URL('../dist/', import.meta.url).pathname

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  )
}

function measure() {
  const files = {}
  let raw = 0, gzip = 0
  for (const f of walk(dist)) {
    if (!/\.(js|css|html)$/.test(f)) continue
    const buf = readFileSync(f)
    const g = gzipSync(buf, { level: 9 }).length
    // Hashed chunk names change on every build; key by the stable part so deltas line up.
    const key = relative(dist, f).replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, '.$1')
    files[key] = { raw: buf.length, gzip: g }
    raw += buf.length
    gzip += g
  }
  return { total: { raw, gzip }, files }
}

const kb = (n) => (n / 1024).toFixed(1).padStart(8) + ' kB'
const delta = (a, b) => {
  const d = b - a
  if (!a) return '     (new)'
  const pct = ((d / a) * 100).toFixed(1)
  return (d >= 0 ? '+' : '') + (d / 1024).toFixed(1) + ' kB (' + (d >= 0 ? '+' : '') + pct + '%)'
}

if (args[0] === '--out') {
  const r = measure()
  writeFileSync(args[1], JSON.stringify(r, null, 2))
  console.log(`bundle: ${kb(r.total.raw).trim()} raw, ${kb(r.total.gzip).trim()} gzip, ${Object.keys(r.files).length} files`)
} else if (args[0] === '--compare') {
  let base
  try { base = JSON.parse(readFileSync(args[1], 'utf8')) } catch { base = null }
  const cur = JSON.parse(readFileSync(args[2], 'utf8'))
  if (!base) {
    console.log('no baseline from main available — nothing to compare against')
    process.exit(0)
  }
  console.log('bundle size vs main (gzip):')
  const names = new Set([...Object.keys(base.files), ...Object.keys(cur.files)])
  for (const n of [...names].sort()) {
    const a = base.files[n]?.gzip ?? 0, b = cur.files[n]?.gzip ?? 0
    if (a === b) continue
    console.log(`  ${n.padEnd(40)} ${kb(a)} -> ${kb(b)}   ${b ? delta(a, b) : '(removed)'}`)
  }
  console.log(`  ${'TOTAL'.padEnd(40)} ${kb(base.total.gzip)} -> ${kb(cur.total.gzip)}   ${delta(base.total.gzip, cur.total.gzip)}`)
  const growth = (cur.total.gzip - base.total.gzip) / base.total.gzip
  if (growth > 0.1) console.log(`\n⚠ the gzipped bundle grew by ${(growth * 100).toFixed(1)}% — worth a look in review`)
} else {
  console.error('usage: bundle-size.mjs --out FILE | --compare BASE CURRENT')
  process.exit(2)
}
