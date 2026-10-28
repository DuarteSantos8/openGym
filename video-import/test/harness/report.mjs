// The fixtures as a table, and the baseline ratchet.
//
//   node test/harness/report.mjs                    every reviewed fixture, against the baseline
//   node test/harness/report.mjs B7-F2              only ids containing "B7-F2"
//   node test/harness/report.mjs --all              unreviewed ones too (marked *)
//   node test/harness/report.mjs --update-baseline  record the current scores (only ever raises
//                                                   a metric unless --force)

import fs from 'node:fs'
import { load, run, readBaseline, BASELINE } from './fixtures.js'
import { regressions } from './score.js'

const args = process.argv.slice(2)
const has = k => args.includes(k)
const filter = args.find(a => !a.startsWith('--')) || ''
const fixtures = load(filter).filter(f => has('--all') || f.expected.reviewed)
const baseline = readBaseline()
const COLS = ['frames', 'sequence', 'boundaries', 'sections', 'startError']
const fmt = (v, was) => {
  if (v === undefined) return '–'.padStart(10) + '  '
  const s = v.toFixed(3).padStart(10)
  if (was === undefined) return s + '  '
  return s + (v > was + 0.005 ? ' ↑' : v < was - 0.005 ? ' ↓' : '  ')
}

console.log('fixture'.padEnd(28) + COLS.map(c => c.padStart(12)).join(''))
const sums = Object.fromEntries(COLS.map(c => [c, []]))
let bad = 0
const next = { ...baseline }
for (const f of fixtures) {
  const { metrics } = run(f)
  const was = baseline[f.id] || {}
  if (Object.keys(regressions(was, metrics)).length) bad++
  console.log((f.id + (f.expected.reviewed ? '' : ' *')).slice(0, 27).padEnd(28) + COLS.map(c => fmt(metrics[c], c === 'startError' ? undefined : was[c])).join(''))
  for (const c of COLS) if (metrics[c] !== undefined) sums[c].push(metrics[c])
  if (f.expected.reviewed) {
    next[f.id] = has('--force') || !baseline[f.id]
      ? metrics
      : Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, k === 'startError' ? v : Math.max(v, was[k] ?? 0)]))
  }
}
const mean = l => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : undefined)
console.log('mean'.padEnd(28) + COLS.map(c => fmt(mean(sums[c]))).join(''))
if (has('--update-baseline')) {
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + '\n')
  console.log(`baseline written: ${BASELINE}`)
} else if (bad) {
  console.log(`\n${bad} fixture(s) below the baseline (↓)`)
  process.exitCode = 1
}
