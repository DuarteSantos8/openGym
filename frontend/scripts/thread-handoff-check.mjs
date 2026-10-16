#!/usr/bin/env node
// The onboarding thread's hand-off pixel check (fitness-eval motion-onboarding-thread.md §4,
// "Hand-off exactness"): when a run ends, the overlay line hides and the scene's own line shows in
// the same frame, and the two must be the same pixels. For each hand-off on the flow, at DPR 1, 2
// and 3, the last frame the thread paints and the first frame after it are captured around the
// anchor and compared; the pixels that differ must stay under 0.2% of the anchor's area.
//
//   npx vite build && node scripts/thread-handoff-check.mjs        # exit 1 on any hand-off over
//   node scripts/thread-handoff-check.mjs --out <dir>              # + the frames of each one over
//   node scripts/thread-handoff-check.mjs --dpr 2                  # one DPR only
//
// Needs Playwright's Chromium once: npx playwright install chromium-headless-shell
//
// The built app runs under `vite preview` in Chromium (Playwright), with the API and the hub
// answered here. Time is Playwright's clock, stepped a frame at a time, so the frame before the
// hand-off is the one the thread really painted last; other animations (the screen coming in, the
// art) are finished before each capture, so the only change between the two is the hand-off.
// The Summary's own hand-off (ring) is checked when the Summary lands.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const BUDGET = 0.002
// --dpr <n>: that one only.
const one = process.argv.indexOf('--dpr')
const DPRS = one > 0 ? [Number(process.argv[one + 1])] : [1, 2, 3]
const FRAME = 16
const T0 = Date.parse('2026-10-16T09:00:00Z')
// A channel this far apart counts as a different pixel: below it is the rasteriser's own noise.
const TOLERANCE = 24
// --out <dir>: the two frames of every hand-off over budget, as PNGs, to look at.
const at = process.argv.indexOf('--out')
const OUT = at > 0 ? process.argv[at + 1] : null
if (OUT) mkdirSync(OUT, { recursive: true })

const USER = { id: 'u1', name: 'Maria', synced: true }
const HUB = { answers: {}, completedAt: null, next: 'goal', remaining: ['goal', 'body', 'training', 'plan'], coachAvailable: false, starterAvailable: true, prefill: { answered: [], sources: { opengym: 'ok', nutritrace: 'ok' } } }

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
function answer(signedIn) {
  return route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const p = url.pathname
    if (p === '/api/config') return json(route, 200, {})
    if (p === '/api/me') return signedIn ? json(route, 200, { user: USER }) : json(route, 401, { error: 'not signed in' })
    if (p.startsWith('/api/invites/')) return json(route, 200, { status: 'valid', inviterName: 'Andrei', suggestedName: 'Maria' })
    if (p === '/api/data/rev') return json(route, 200, { rev: 0, wid: 'handoff-check' })
    if (p === '/hub/api/onboarding') return json(route, 200, method === 'GET' ? HUB : {})
    if (p === '/hub/api/onboarding/preview') return json(route, 200, { ready: true, targets: { calories: 1850 } })
    return json(route, 404, { error: 'not here' })
  }
}

// Every animation but the thread's (rAF) to its end: CSS transitions, the screen's WAAPI entry, the art.
const settle = page => page.evaluate(() => {
  for (const a of document.getAnimations()) { try { a.finish() } catch { /* an infinite one: left running */ } }
})
const threadVisible = page => page.evaluate(() => {
  const svg = document.querySelector('.ob-thread')
  return !!svg && getComputedStyle(svg).visibility === 'visible'
})
// Real time, for what the page waits on outside its clock (a response, the onboarding's chunk).
const breathe = () => new Promise(resolve => setTimeout(resolve, 10))

// The anchor the thread is carrying in, padded by its stroke: the region compared.
const anchorBox = page => page.evaluate(() => {
  const el = document.querySelector('[data-thread-claim]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const w = parseFloat(getComputedStyle(el).strokeWidth) || 1.5
  const pad = Math.ceil(w) + 4
  return {
    clip: { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: r.width + 2 * pad, height: r.height + 2 * pad },
    area: Math.max(r.width, w) * Math.max(r.height, w),
  }
})

async function differing(page, a, b) {
  return page.evaluate(async ([a64, b64, tol]) => {
    const load = async s => createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
    const [A, B] = await Promise.all([load(a64), load(b64)])
    const pixels = img => {
      const c = new OffscreenCanvas(img.width, img.height)
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, img.width, img.height).data
    }
    if (A.width !== B.width || A.height !== B.height) return Infinity
    const p = pixels(A), q = pixels(B)
    let n = 0
    for (let i = 0; i < p.length; i += 4) {
      if (Math.abs(p[i] - q[i]) > tol || Math.abs(p[i + 1] - q[i + 1]) > tol || Math.abs(p[i + 2] - q[i + 2]) > tol) n++
    }
    return n
  }, [a.toString('base64'), b.toString('base64'), TOLERANCE])
}

/** Runs `trigger`, waits for the thread to start, and measures its hand-off. */
async function handoff(page, dpr, trigger) {
  await trigger()
  for (let i = 0; !(await threadVisible(page)); i++) {
    if (i > 600) throw new Error('the thread never started')
    await breathe()
    await page.clock.runFor(FRAME)
  }
  for (let t = 0; t < 2000; t += FRAME) {
    await settle(page)
    const box = await anchorBox(page)
    if (!box) throw new Error('no anchor claimed while the thread runs')
    const before = await page.screenshot({ clip: box.clip, animations: 'allow' })
    await page.clock.runFor(FRAME)
    if (await threadVisible(page)) continue
    await settle(page)
    const after = await page.screenshot({ clip: box.clip, animations: 'allow' })
    const n = await differing(page, before, after)
    return { n, ratio: n / (box.area * dpr * dpr), before, after }
  }
  throw new Error('the thread never handed over')
}

const click = (page, role, name) => () => page.getByRole(role, { name, exact: true }).click()

// The hand-offs on this branch, in the order a person meets them. Each starts where the last ended.
const SIGNED_OUT = [
  ['invite: the floor drawn out of a dot', async () => {}],
  ['invite to name: line to line', p => click(p, 'button', 'Create my account')()],
]
const SIGNED_IN = [
  ['passkey to goal: check to line', async () => {}],
  ['goal to sex: the floors coincide, the line holds', p => p.getByRole('radio', { name: /^Keep my weight/ }).click()],
  ['sex to born: the floors coincide', p => p.getByRole('radio', { name: /^Female/ }).click()],
  ['born to height', async p => { await p.getByRole('slider').press('ArrowDown'); await click(p, 'button', 'Next')() }],
  ['height to weight', async p => { await p.getByRole('slider').press('ArrowRight'); await click(p, 'button', 'Next')() }],
  ['weight to training', async p => { await p.getByRole('slider').press('ArrowRight'); await click(p, 'button', 'Next')() }],
  ['training to plan', p => p.getByRole('radio', { name: /^3\b/ }).click()],
  ['plan to starter', p => p.getByRole('radio', { name: /Use a ready-made plan/ }).click()],
  ['starter to the end', p => click(p, 'button', 'Use this plan')()],
]

async function walk(browser, base, dpr, signedIn, start, steps) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, reducedMotion: 'no-preference', serviceWorkers: 'block',
  })
  const page = await context.newPage()
  await page.route('**/api/**', answer(signedIn))
  // Held still: the page's frames and timers move only when this script steps them.
  await page.clock.install({ time: T0 })
  await page.clock.pauseAt(T0 + 1000)
  await page.goto(base + start)
  let failed = false
  for (const [name, trigger] of steps) {
    const { n, ratio, before, after } = await handoff(page, dpr, () => trigger(page))
    const ok = ratio < BUDGET
    if (!ok) failed = true
    if (!ok && OUT) {
      const stem = join(OUT, `dpr${dpr}-${name.split(':')[0].replace(/\W+/g, '-')}`)
      writeFileSync(stem + '-before.png', before)
      writeFileSync(stem + '-after.png', after)
    }
    console.log(`${ok ? 'ok  ' : 'OVER'} DPR ${dpr}  ${(ratio * 100).toFixed(3).padStart(7)}%  ${String(n).padStart(5)} px  ${name}`)
  }
  await context.close()
  return failed
}

const server = await preview({ root, logLevel: 'silent', preview: { port: 0, strictPort: false, open: false } })
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch()
let failed = false
try {
  for (const dpr of DPRS) {
    if (await walk(browser, base, dpr, false, '/#/join/AB12', SIGNED_OUT)) failed = true
    if (await walk(browser, base, dpr, true, '/#/onboarding/passkey', SIGNED_IN)) failed = true
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(failed ? `A hand-off differs by ${BUDGET * 100}% of its anchor or more.` : `Every hand-off within ${BUDGET * 100}% of its anchor.`)
process.exit(failed ? 1 : 0)
