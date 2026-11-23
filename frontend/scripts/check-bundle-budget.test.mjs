/* check-bundle-budget.mjs (EP18-T03). The fixtures cover each way a build can break the budget;
 * the last test builds the real web bundle and holds it to bundle-budget.json. */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { entryFiles, measure, problems, readBudget } from './check-bundle-budget.mjs'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..')
const made = []
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }) })

function dist(files, html) {
  const d = mkdtempSync(join(tmpdir(), 'og-budget-'))
  made.push(d)
  mkdirSync(join(d, 'assets'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, 'assets', name), body)
  writeFileSync(join(d, 'index.html'), html)
  return d
}
const page = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/index.js"></script>
<link rel="modulepreload" crossorigin href="./assets/vendor.js">
<link rel="stylesheet" crossorigin href="./assets/index.css">
<link rel="icon" href="./favicon.svg">
</head><body></body></html>`
const budget = { entryJsGzip: 2000, entryCssGzip: 500, lazyOnly: [{ what: 'the guides', marker: 'Heels lifting off the floor.' }] }

describe('entryFiles', () => {
  it('lists the scripts, modulepreloads and stylesheets index.html asks for, once each, and nothing else', () => {
    expect(entryFiles(page)).toEqual(['assets/index.js', 'assets/vendor.js', 'assets/index.css'])
    expect(entryFiles(page + '<script src="./assets/index.js"></script>')).toHaveLength(3)
    expect(entryFiles('<script src="https://elsewhere.example/x.js"></script>')).toEqual([])
  })
})

describe('the budget', () => {
  it('passes a build inside it, and counts only what the page loads up front', () => {
    const d = dist({ 'index.js': 'console.log(1)', 'vendor.js': 'export {}', 'index.css': 'a{color:red}', 'lazy.js': 'x'.repeat(10) + randomBytes(9000).toString('hex') }, page)
    const m = measure(d)
    expect(m.files).toHaveLength(3)
    expect(m.entryJsGzip).toBeGreaterThan(0)
    expect(m.entryJsGzip).toBeLessThan(200)
    expect(problems(m, budget)).toEqual([])
  })

  it('names a first-load script that outgrew it', () => {
    const d = dist({ 'index.js': randomBytes(4000).toString('hex'), 'vendor.js': '', 'index.css': '' }, page)
    expect(problems(measure(d), budget)).toEqual([expect.stringMatching(/^first-load script is .* over the 2\.0 kB budget$/)])
  })

  it('names first-load styles that outgrew it', () => {
    const d = dist({ 'index.js': '1', 'vendor.js': '', 'index.css': randomBytes(2000).toString('hex') }, page)
    expect(problems(measure(d), budget)).toEqual([expect.stringMatching(/^first-load styles are .* over the 0\.5 kB budget$/)])
  })

  it('catches on-demand text pulled into the first load, in a preloaded chunk too', () => {
    const d = dist({ 'index.js': '1', 'vendor.js': 'const cue="Heels lifting off the floor."', 'index.css': '' }, page)
    expect(problems(measure(d), budget)).toEqual(['the guides is in the first load (assets/vendor.js); it is meant to load on demand'])
    const fine = dist({ 'index.js': '1', 'vendor.js': '', 'index.css': '', 'guide.js': 'const cue="Heels lifting off the floor."' }, page)
    expect(problems(measure(fine), budget)).toEqual([])
  })

  it('does not pass a page that loads no script at all', () => {
    const d = dist({}, '<!doctype html><html><head></head><body></body></html>')
    expect(problems(measure(d), budget)).toEqual(['index.html loads no script: the build or this check is broken'])
  })

  it('the checked-in budget is well formed and its markers are in the source they name', () => {
    const b = readBudget()
    expect(b.entryJsGzip).toBeGreaterThan(100000)
    expect(b.entryCssGzip).toBeGreaterThan(10000)
    expect(b.lazyOnly.length).toBeGreaterThanOrEqual(2)
    const src = ['src/content/exercise-guides.js', 'src/content/learn.js'].map(f => readFileSync(join(frontend, f), 'utf8')).join('\n')
    for (const { marker } of b.lazyOnly) expect(src.includes(marker), marker).toBe(true)
  })
})

describe('the web bundle', () => {
  it('holds to bundle-budget.json', () => {
    const out = mkdtempSync(join(tmpdir(), 'og-bundle-budget-'))
    made.push(out)
    execFileSync(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: frontend, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } })
    const m = measure(out)
    expect(problems(m, readBudget())).toEqual([])
    // and the budget is not so loose it would never notice: within a fifth of what is measured
    expect(m.entryJsGzip).toBeGreaterThan(readBudget().entryJsGzip * 0.8)
  }, 240_000)
})
