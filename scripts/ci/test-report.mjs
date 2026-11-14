#!/usr/bin/env node
// Turns a test run into numbers that say something about the app: how many tests guard each
// part of it (sync, workout logging, plates, rest timer, ...), how much of that part's code
// they run, which tests are slow, and what failed. CI writes the result to the job summary
// ($GITHUB_STEP_SUMMARY) and keeps the JSON as an artifact; run it locally the same way.
//
//   vitest (frontend, mcp):
//     node scripts/ci/test-report.mjs --label Frontend --root frontend \
//       --vitest frontend/test-results.json --coverage frontend/coverage/coverage-summary.json \
//       [--bundle frontend/bundle-size.json] --out stats/frontend.json
//   node:test (api, run with --test-reporter=scripts/ci/node-test-reporter.mjs):
//     node scripts/ci/test-report.mjs --label API --root api \
//       --node api/test-results.jsonl --lcov api/lcov.info --out stats/api.json
//   several suites into one table:
//     node scripts/ci/test-report.mjs --combine stats/*.json [--out combined.json]
//
// Inputs are optional: a suite that crashed before writing its report still gets a line saying
// so, rather than the step failing on top of the real failure.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { areaOf, AREAS } from './test-areas.mjs'

const ORDER = [...AREAS.map((a) => a.name), 'Other UI', 'Other']

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const readJSON = (f) => { try { return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null } catch { return null } }
const rel = (root, f) => relative(resolve(root || '.'), resolve(f)).split(sep).join('/')
const pct = (c, t) => (t ? Math.round((c / t) * 1000) / 10 : null)
const fmtPct = (p) => (p == null ? '–' : `${p.toFixed(1)} %`)
const fmtS = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`)

// ---- readers ------------------------------------------------------------------------------

// vitest --reporter=json (the jest-compatible shape).
function fromVitest(file, root) {
  const j = readJSON(file)
  if (!j) return null
  const tests = []
  const files = []
  for (const tr of j.testResults || []) {
    const path = rel(root, tr.name)
    const dur = (tr.endTime || 0) - (tr.startTime || 0)
    files.push({ file: path, ms: dur, status: tr.status, tests: (tr.assertionResults || []).length, message: tr.status === 'failed' && !(tr.assertionResults || []).length ? String(tr.message || '').slice(0, 300) : undefined })
    for (const a of tr.assertionResults || []) {
      tests.push({ file: path, name: [...(a.ancestorTitles || []), a.title].join(' > '), status: a.status === 'pending' || a.status === 'todo' ? 'skipped' : a.status, ms: a.duration || 0, message: a.status === 'failed' ? String((a.failureMessages || [])[0] || '').split('\n')[0].slice(0, 300) : undefined })
    }
  }
  return { tests, files, startTime: j.startTime }
}

// node --test with scripts/ci/node-test-reporter.mjs: one JSON line per test, with its file.
function fromNodeJson(file, root) {
  if (!file || !existsSync(file)) return null
  const tests = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter((t) => t && t.file).map((t) => ({ file: rel(root, t.file), name: t.name, status: t.status, ms: t.ms || 0, message: t.message }))
  const byFile = new Map()
  for (const t of tests) {
    const f = byFile.get(t.file) || { file: t.file, ms: 0, tests: 0, status: 'passed' }
    f.tests++
    f.ms += t.ms
    if (t.status === 'failed') f.status = 'failed'
    byFile.set(t.file, f)
  }
  return { tests, files: [...byFile.values()] }
}

// v8 json-summary (vitest --coverage.reporter=json-summary).
function coverageFromSummary(file, root) {
  const j = readJSON(file)
  if (!j) return null
  const out = []
  for (const [f, v] of Object.entries(j)) {
    if (f === 'total') continue
    out.push({ file: rel(root, f), lines: [v.lines.covered, v.lines.total], branches: [v.branches.covered, v.branches.total], functions: [v.functions.covered, v.functions.total] })
  }
  return out
}

// lcov (node --test-reporter=lcov).
function coverageFromLcov(file, root) {
  if (!file || !existsSync(file)) return null
  const out = []
  let cur = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [k, v] = line.split(':')
    if (k === 'SF') cur = { file: rel(root, line.slice(3)), lines: [0, 0], branches: [0, 0], functions: [0, 0] }
    else if (!cur) continue
    else if (k === 'LH') cur.lines[0] = +v
    else if (k === 'LF') cur.lines[1] = +v
    else if (k === 'BRH') cur.branches[0] = +v
    else if (k === 'BRF') cur.branches[1] = +v
    else if (k === 'FNH') cur.functions[0] = +v
    else if (k === 'FNF') cur.functions[1] = +v
    else if (line === 'end_of_record') { if (!/(^|\/)(test|node_modules)\//.test(cur.file) && !/\.test\.[cm]?js$/.test(cur.file)) out.push(cur); cur = null }
  }
  return out
}

// ---- aggregation --------------------------------------------------------------------------

function summarise(label, run, cov, bundle) {
  const s = { label, generated: new Date().toISOString(), ok: !!run }
  if (!run) return s
  const t = run.tests
  s.tests = { total: t.length, passed: t.filter((x) => x.status === 'passed').length, failed: t.filter((x) => x.status === 'failed').length, skipped: t.filter((x) => x.status === 'skipped').length }
  s.files = run.files.length
  s.brokenFiles = run.files.filter((f) => f.status === 'failed' && !f.tests).map((f) => ({ file: f.file, message: f.message }))
  // Sum of per-file wall time: what the suite costs single-threaded (the job runs it in parallel).
  s.cpuMs = Math.round(run.files.reduce((a, f) => a + (f.ms || 0), 0))
  s.failures = t.filter((x) => x.status === 'failed').slice(0, 30).map(({ file, name, message }) => ({ file, name, message }))
  s.slowTests = [...t].sort((a, b) => b.ms - a.ms).slice(0, 10).map(({ file, name, ms }) => ({ file, name, ms: Math.round(ms) }))
  s.slowFiles = [...run.files].sort((a, b) => b.ms - a.ms).slice(0, 10).map(({ file, ms, tests }) => ({ file, ms: Math.round(ms), tests }))
  const areas = {}
  const bump = (a) => (areas[a] = areas[a] || { tests: 0, failed: 0, testFiles: 0, srcFiles: 0, lines: [0, 0], branches: [0, 0], functions: [0, 0] })
  for (const x of t) { const a = bump(areaOf(x.file)); a.tests++; if (x.status === 'failed') a.failed++ }
  for (const f of run.files) bump(areaOf(f.file)).testFiles++
  if (cov) {
    const tot = { lines: [0, 0], branches: [0, 0], functions: [0, 0] }
    for (const c of cov) {
      const a = bump(areaOf(c.file))
      a.srcFiles++
      for (const k of ['lines', 'branches', 'functions']) { a[k][0] += c[k][0]; a[k][1] += c[k][1]; tot[k][0] += c[k][0]; tot[k][1] += c[k][1] }
    }
    s.coverage = Object.fromEntries(Object.entries(tot).map(([k, [c, n]]) => [k, pct(c, n)]))
    // The source files with the most uncovered lines: where a new test buys the most.
    s.leastCovered = cov.filter((c) => c.lines[1] >= 40).map((c) => ({ file: c.file, uncovered: c.lines[1] - c.lines[0], lines: pct(...c.lines) })).sort((a, b) => b.uncovered - a.uncovered).slice(0, 10)
  }
  s.areas = Object.fromEntries(Object.entries(areas).sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b)).map(([k, v]) => [k, { ...v, linesPct: pct(...v.lines), branchesPct: pct(...v.branches) }]))
  if (bundle?.total) s.bundle = { rawKB: Math.round(bundle.total.raw / 1024), gzipKB: Math.round(bundle.total.gzip / 1024), files: Object.keys(bundle.files || {}).length }
  return s
}

// ---- markdown -----------------------------------------------------------------------------

function md(s) {
  const out = []
  out.push(`### ${s.label} tests`)
  if (!s.ok) { out.push('', 'No test report was written: the suite did not get as far as reporting (see the step log).'); return out.join('\n') }
  const { total, passed, failed, skipped } = s.tests
  const icon = failed || s.brokenFiles.length ? '❌' : '✅'
  out.push('', `${icon} **${passed}/${total} passed**${failed ? `, **${failed} failed**` : ''}${skipped ? `, ${skipped} skipped` : ''} in ${s.files} files · ${fmtS(s.cpuMs)} of test time` + (s.coverage ? ` · coverage: lines ${fmtPct(s.coverage.lines)}, branches ${fmtPct(s.coverage.branches)}, functions ${fmtPct(s.coverage.functions)}` : '') + (s.bundle ? ` · bundle ${s.bundle.gzipKB} kB gzip` : ''))
  if (s.brokenFiles.length) { out.push('', '**Test files that did not load:**'); for (const f of s.brokenFiles) out.push(`- \`${f.file}\`: ${f.message || ''}`) }
  if (s.failures.length) { out.push('', '**Failed:**'); for (const f of s.failures) out.push(`- \`${f.file}\` › ${f.name}${f.message ? `: ${f.message.replace(/\|/g, '\\|')}` : ''}`) }
  out.push('', '| Area | Tests | Test files | Source files | Lines | Branches |', '|---|---:|---:|---:|---:|---:|')
  for (const [k, a] of Object.entries(s.areas)) out.push(`| ${k}${a.failed ? ' ❌' : ''} | ${a.tests} | ${a.testFiles} | ${a.srcFiles || '–'} | ${fmtPct(a.linesPct)} | ${fmtPct(a.branchesPct)} |`)
  out.push('', '<details><summary>Slowest tests and files</summary>', '', '| Test | Time |', '|---|---:|')
  for (const t of s.slowTests) out.push(`| \`${t.file}\` › ${t.name.replace(/\|/g, '\\|').slice(0, 120)} | ${fmtS(t.ms)} |`)
  out.push('', '| File | Tests | Time |', '|---|---:|---:|')
  for (const f of s.slowFiles) out.push(`| \`${f.file}\` | ${f.tests} | ${fmtS(f.ms)} |`)
  out.push('', '</details>')
  if (s.leastCovered?.length) {
    out.push('', '<details><summary>Most uncovered lines (where a test buys the most)</summary>', '', '| File | Uncovered lines | Lines |', '|---|---:|---:|')
    for (const f of s.leastCovered) out.push(`| \`${f.file}\` | ${f.uncovered} | ${fmtPct(f.lines)} |`)
    out.push('', '</details>')
  }
  return out.join('\n')
}

function mdCombined(list) {
  const out = ['## Test report', '', '| Suite | Passed | Failed | Skipped | Files | Test time | Lines | Branches |', '|---|---:|---:|---:|---:|---:|---:|---:|']
  let T = 0, P = 0, F = 0
  for (const s of list) {
    if (!s.ok) { out.push(`| ${s.label} | – | did not report | – | – | – | – | – |`); continue }
    T += s.tests.total; P += s.tests.passed; F += s.tests.failed
    out.push(`| ${s.label} | ${s.tests.passed} | ${s.tests.failed} | ${s.tests.skipped} | ${s.files} | ${fmtS(s.cpuMs)} | ${fmtPct(s.coverage?.lines)} | ${fmtPct(s.coverage?.branches)} |`)
  }
  out.push(`| **all** | **${P}** | **${F}** | | | | | |`)
  // The same app areas across suites: the api's sync tests and the frontend's together.
  const areas = {}
  for (const s of list) for (const [k, a] of Object.entries(s.areas || {})) {
    const x = (areas[k] = areas[k] || { tests: 0, lines: [0, 0], branches: [0, 0], by: [] })
    x.tests += a.tests
    for (const m of ['lines', 'branches']) { x[m][0] += a[m][0]; x[m][1] += a[m][1] }
    if (a.tests) x.by.push(`${s.label} ${a.tests}`)
  }
  out.push('', '| App area | Tests | Where | Lines | Branches |', '|---|---:|---|---:|---:|')
  for (const name of ORDER) {
    const a = areas[name]
    if (!a) continue
    out.push(`| ${name} | ${a.tests} | ${a.by.join(', ')} | ${fmtPct(pct(...a.lines))} | ${fmtPct(pct(...a.branches))} |`)
  }
  out.push('', `${T} tests in total. Per-suite details (slowest tests, least covered files) are in each job's summary.`)
  return out.join('\n')
}

// ---- main ---------------------------------------------------------------------------------

function emit(markdown, json) {
  console.log(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n\n')
  const out = opt('--out')
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(json, null, 2)) }
}

const ci = argv.indexOf('--combine')
if (ci >= 0) {
  const files = argv.slice(ci + 1).filter((a) => !a.startsWith('--') && a !== opt('--out'))
  const list = files.map(readJSON).filter((s) => s && s.label)
  emit(mdCombined(list), { generated: new Date().toISOString(), suites: list })
} else {
  const root = opt('--root') || '.'
  const run = opt('--vitest') ? fromVitest(opt('--vitest'), root) : fromNodeJson(opt('--node'), root)
  const cov = opt('--coverage') ? coverageFromSummary(opt('--coverage'), root) : coverageFromLcov(opt('--lcov'), root)
  const s = summarise(opt('--label') || 'Tests', run, cov, readJSON(opt('--bundle')))
  emit(md(s), s)
}
