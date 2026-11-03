#!/usr/bin/env node
// Render the PDF exports of a stress-test profile (scripts/pdf/fixture.mjs) with headless Chrome,
// in several languages and paper sizes, and (with --check) assert that no exercise block, chart or
// list row is split across a page, that no heading is left alone at the bottom of a page and that
// nothing runs past the page edge. The check reads the PDF itself (scripts/pdf/check-pdf.py, PyMuPDF):
// the documents are rendered with invisible probe marks at the top and bottom of every block that
// must stay whole, and the check finds the page each mark landed on.
//
//   node scripts/pdf/render-samples.mjs --out /tmp/pdf [--langs en,de,ar] [--paper A4,Letter] [--check] [--png]
//
// Needs Node 22, a Chrome (CHROME=… or the Puppeteer cache) and, for --check/--png, python3 with
// PyMuPDF (pip install pymupdf). Runs one browser, one page at a time: light on the machine.
import { createServer } from 'vite'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { launchChrome } from './chrome-pdf.mjs'
import { addStressCase, STRESS_ROUTINE_ID, STRESS_WORKOUT_ID } from './fixture.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name)
  return i < 0 ? def : process.argv[i + 1]
}
const flag = name => process.argv.includes('--' + name)
const out = resolve(arg('out', join(root, 'pdf-samples')))
const langs = arg('langs', 'en,de,ar').split(',').filter(Boolean)
const papers = arg('paper', 'A4').split(',').filter(Boolean)
const only = arg('only', '')
const owner = arg('owner', 'Ana Duarte')
mkdirSync(out, { recursive: true })

const server = await createServer({
  root, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  define: { __APP_VERSION__: JSON.stringify('dev') },
})
const load = p => server.ssrLoadModule(p)
const core = await load('/src/lib/i18n-core.js')
const { registerCustom } = await load('/src/lib/exercises.js')
const { buildDemoState } = await load('/src/lib/demoSeed.js')
const plan = await load('/src/lib/plan-share.js')
const hasReport = existsSync(join(root, 'src/lib/report-print.js'))
const report = hasReport ? await load('/src/lib/report-print.js') : null

async function useLang(l) {
  const base = core.baseLang(l)
  const pack = async p => { try { return (await load(p)).default } catch { return null } }
  const dict = base === 'en' ? {} : await pack(`/src/locales/${base}.js`)
  const names = base === 'en' || !core.EXERCISE_NAME_LANGS.includes(base) ? null : await pack(`/src/exercise-names/${base}.js`)
  core._setLangState(l, core.derivePack(l, dict || {}), null, core.derivePack(l, names), true, false)
}

// A fixed "now" keeps the samples comparable from run to run.
const S = addStressCase(buildDemoState())
registerCustom(S.customEx)
const W = S.workouts.find(w => w.id === STRESS_WORKOUT_ID)

const docs = [
  ['plan-week', () => plan.planPrintHTML(S, owner, { probe: true })],
  ['plan-routine', () => plan.planPrintHTML(S, owner, { routineId: STRESS_ROUTINE_ID, probe: true })],
]
if (report) {
  docs.push(['workout', () => report.workoutPrintHTML(S, W, { owner, probe: true })])
  docs.push(['report-7d', () => report.reportPrintHTML(S, { range: '7d', owner, probe: true })])
  docs.push(['report-4w', () => report.reportPrintHTML(S, { range: '4w', owner, probe: true })])
  docs.push(['report-3m', () => report.reportPrintHTML(S, { range: '3m', owner, probe: true })])
}

const chrome = await launchChrome()
const made = []
try {
  for (const l of langs) {
    await useLang(l)
    for (const [name, html] of docs) {
      if (only && !only.split(',').includes(name)) continue
      const file = join(out, `${name}-${l}.html`)
      writeFileSync(file, html())
      for (const paper of papers) {
        const pdf = join(out, `${name}-${l}-${paper}.pdf`)
        await chrome.print('file://' + file, pdf, { paper })
        made.push(pdf)
        console.log('wrote', pdf)
      }
    }
  }
} finally {
  await chrome.close()
  await server.close()
}

if (flag('check') || flag('png')) {
  const args = [join(here, 'check-pdf.py'), ...(flag('png') ? ['--png'] : []), ...(flag('check') ? [] : ['--no-check']), ...made]
  const r = spawnSync('python3', args, { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
