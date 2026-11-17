#!/usr/bin/env node
// Layout check in a real browser: what the unit tests cannot see, because jsdom does no layout.
// It serves a demo build (VITE_DEMO=1, seeded example data, no api), opens it at a phone and a
// desktop size, starts a workout, ticks a set so the rest timer comes up, and fails when a
// floating action lands under the rest timer or the tab bar, or a screen logs an error. Every
// screen it visits is saved as a PNG for the `ui-layout` artifact, so a reviewer can look too.
//
//   node scripts/ci/ui-layout.mjs <demo-dist> [out-dir]
//
// Playwright is not a dependency of the project: CI installs playwright-core on its own
// (PLAYWRIGHT_DIR, the folder holding node_modules/playwright-core) and drives the runner's Chrome
// (CHROME, default /usr/bin/google-chrome). Locally: `npm i --prefix /tmp/pw playwright-core`.
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join, resolve, normalize } from 'node:path'

const dist = resolve(process.argv[2] || 'frontend/dist-demo')
const out = resolve(process.argv[3] || 'ui-layout')
const pwDir = resolve(process.env.PLAYWRIGHT_DIR || '.')
const chrome = process.env.CHROME || '/usr/bin/google-chrome'
const { chromium } = createRequire(join(pwDir, 'noop.js'))('playwright-core')

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
  for (const f of [join(dist, path), join(dist, 'index.html')]) {
    try {
      const body = await readFile(f)
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' })
      return res.end(body)
    } catch { /* next */ }
  }
  res.writeHead(404).end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
await mkdir(out, { recursive: true })

const failures = []
const fail = msg => { failures.push(msg); console.log('::error::' + msg) }
// Two boxes share area (a few px of shadow or rounding do not count).
const overlap = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4
const box = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width && r.height ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null
}, sel)

const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] })
for (const [size, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
  const ctx = await browser.newContext({ viewport, locale: 'en-US', deviceScaleFactor: 1, isMobile: size === 'phone', hasTouch: size === 'phone' })
  const page = await ctx.newPage()
  page.on('pageerror', e => fail(`${size}: page error: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/navigator\.vibrate/.test(m.text())) fail(`${size}: console error: ${m.text()}`) })
  const go = async route => { await page.evaluate(r => { location.hash = '#' + r }, route); await page.waitForTimeout(1200) }
  const shot = name => page.screenshot({ path: join(out, `${size}-${name}.png`) })

  await page.goto(base + '/#/home', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  for (const r of ['home', 'plan', 'library', 'stats', 'history', 'settings']) { await go('/' + r); await shot(r) }

  // A workout with a rest running: the state where floating actions collide.
  await go('/plan')
  const start = page.locator('.iv-plan-start .btn')
  if (!(await start.count())) { fail(`${size}: Plan shows no Start for the demo's planned day`); await ctx.close(); continue }
  await start.click()
  await page.waitForTimeout(1000)
  const noWeigh = page.getByText('Start without weighing in')
  if (await noWeigh.count()) await noWeigh.click()
  await page.waitForTimeout(1200)
  const set1 = page.locator('button[aria-label^="Set 1 done"]').first()
  if (await set1.count()) await set1.click()
  await page.waitForTimeout(1200)
  await shot('workout-resting')
  const resting = await page.evaluate(() => document.body.classList.contains('resting') && !!document.querySelector('#timer'))
  if (!resting) fail(`${size}: ticking set 1 did not bring up the rest timer`)

  await go('/library')
  await page.locator('.iv-lib-select').first().click()
  await page.waitForTimeout(300)
  await shot('library-resting-picked')
  const add = await box(page, '.iv-lib-primary')
  if (!add) fail(`${size}: Library shows no Add bar after a Select`)
  if (overlap(add, await box(page, '#timer'))) fail(`${size}: Library's Add bar sits under the rest timer`)
  if (overlap(add, await box(page, '#tabbar'))) fail(`${size}: Library's Add bar sits under the tab bar`)

  await go('/plan')
  await page.evaluate(() => document.querySelector('.iv-plan-start .btn')?.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot('plan-resting')
  // Whatever is painted at the middle of Resume must be Resume itself, not a bar over it.
  const onTop = await page.evaluate(() => {
    const b = document.querySelector('.iv-plan-start .btn')
    if (!b) return 'missing'
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return b.contains(hit) ? 'ok' : (hit?.id || hit?.className || 'something')
  })
  if (onTop !== 'ok') fail(`${size}: Plan's Resume button is covered (${onTop})`)
  await ctx.close()
}
await browser.close()
server.close()
console.log(failures.length ? `${failures.length} layout problem(s); screenshots in ${out}` : `layout ok; screenshots in ${out}`)
process.exit(failures.length ? 1 : 0)
