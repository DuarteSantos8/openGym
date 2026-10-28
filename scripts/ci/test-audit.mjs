#!/usr/bin/env node
// Reads the test files (not running them) and reports the tests that are least likely to say
// something about the app: a test with no assertion in it (it passes whatever the code does),
// two tests with the same body, two tests with the same name in one file (a report that cannot
// say which one failed), and tests that check the source text of a file instead of running it.
// The last kind is often deliberate here (CSS, native Java/Swift and Dockerfiles cannot run
// under vitest), so it is counted, not judged. Report only; never fails the build.
//
//   node scripts/ci/test-audit.mjs frontend/src frontend/scripts api/test mcp/test [--json out.json]
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const roots = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json')
const walk = (d) => readdirSync(d).flatMap((n) => {
  if (n === 'node_modules' || n.startsWith('.')) return []
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : /\.test\.(m?js|jsx)$/.test(n) ? [p] : []
})

// The body of the call that opens at `start` (the index of its '('), skipping strings,
// template literals and comments. Good enough for test files; not a parser.
function callBody(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return null; continue }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return src.slice(start + 1, i)
  }
  return null
}

const ASSERT = /\bexpect\w*\s*[.(]|\bassert\b|\bassert\.|\bfc\.assert\b|\.rejects\b|\.resolves\b|\bthrows\s*\(|\bok\s*\(|\bstrictEqual\b|\bdeepStrictEqual\b|\bmatch\s*\(\s*\w+\s*,|expectRow|\bcheck\w*\s*\(/
const SOURCE_READ = /readFileSync\([^)]*(\.jsx?|\.css|\.java|\.swift|\.gradle|Dockerfile|\.xml|\.html|\.mjs)['"`)]|readFileSync\([^)]*(src|App|views|components|android|ios)\b/

const files = roots.flatMap((r) => { try { return walk(r) } catch { return [] } })
const report = { files: files.length, tests: 0, noAssert: [], dupBodies: [], dupNames: [], sourcePattern: [] }
const bodies = new Map()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const names = new Map()
  const re = /\b(it|test)(\.each\([^)]*\))?\s*\(\s*(['"`])((?:\\.|(?!\3).)*)\3/g
  let m
  let count = 0
  while ((m = re.exec(src))) {
    if (m[2]) continue // .each: the body runs per row, judged by its table
    const open = src.indexOf('(', m.index + m[1].length)
    const body = callBody(src, open)
    if (body == null) continue
    count++
    const name = m[4]
    const fn = body.slice(body.indexOf(m[3], body.indexOf(m[3]) + 1) + 1)
    // A test that hands its whole body to a helper (a table, a shared scenario) asserts there.
    const delegates = /^\s*,\s*(\w+|\(\)\s*=>\s*\w+\([^)]*\))\s*(,\s*\d+\s*)?$/.test(fn)
    // The scanner is not a parser (a regex literal can end a body early): before calling a test
    // assertion-free, look at its whole text up to the next test as well.
    const next = src.slice(open + 1).search(/\n\s*(it|test|describe)(\.\w+)?\s*\(/)
    const raw = next < 0 ? src.slice(open) : src.slice(open, open + 1 + next)
    if (!ASSERT.test(fn) && !ASSERT.test(raw) && !delegates && fn.trim().length > 2) report.noAssert.push({ file: f, name })
    names.set(name, (names.get(name) || 0) + 1)
    const norm = fn.replace(/\s+/g, ' ').trim()
    if (norm.length > 80) {
      const h = createHash('sha1').update(norm).digest('hex')
      if (!bodies.has(h)) bodies.set(h, [])
      bodies.get(h).push({ file: f, name })
    }
  }
  report.tests += count
  for (const [n, k] of names) if (k > 1) report.dupNames.push({ file: f, name: n, times: k })
  if (SOURCE_READ.test(src)) report.sourcePattern.push({ file: f, tests: count })
}
for (const list of bodies.values()) if (list.length > 1) report.dupBodies.push(list)

const md = ['### Test audit (static, report only)', '',
  `${report.tests} tests in ${report.files} files read.`, '',
  '| Finding | Count |', '|---|---:|',
  `| Tests with no assertion in their body | ${report.noAssert.length} |`,
  `| Groups of tests with an identical body | ${report.dupBodies.length} |`,
  `| Test names used twice in one file | ${report.dupNames.length} |`,
  `| Files that check source text instead of running code | ${report.sourcePattern.length} (${report.sourcePattern.reduce((a, x) => a + x.tests, 0)} tests) |`, '']
const list = (title, rows) => { if (rows.length) md.push(`<details><summary>${title}</summary>`, '', ...rows.slice(0, 60), '', '</details>', '') }
list('No assertion', report.noAssert.map((t) => `- \`${t.file}\` › ${t.name}`))
list('Identical bodies', report.dupBodies.map((g) => `- ${g.map((t) => `\`${t.file}\` › ${t.name}`).join(' = ')}`))
list('Same name twice', report.dupNames.map((t) => `- \`${t.file}\` › ${t.name} (${t.times}×)`))
list('Source-text checks', report.sourcePattern.map((t) => `- \`${t.file}\` (${t.tests})`))
const out = md.join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n')
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2))
