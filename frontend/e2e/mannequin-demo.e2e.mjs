// The movement demo on the exercise sheet (EP26-T01, E5a), end to end as a guest: the 3D rig on a
// squat exercise, the still key pose with its words when the device cannot show it or the person
// asked for no motion, and the rig freed when the sheet closes. Scanned with axe; the fixture
// fails on any request that leaves this machine.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

/** Count the frames the rig actually draws, so "it is animating" is measured, not assumed. */
async function countDraws(page) {
  await page.addInitScript(() => {
    window.__draws = 0
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const ctx = orig.call(this, type, ...rest)
      if (ctx && /^webgl/.test(type) && !ctx.__counted) {
        ctx.__counted = true
        for (const name of ['drawElements', 'drawArrays']) {
          const fn = ctx[name]
          if (fn) ctx[name] = (...a) => { window.__draws++; return fn.apply(ctx, a) }
        }
      }
      return ctx
    }
  })
}

/** A device that cannot make a WebGL context at all. */
async function withoutWebGL(page) {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === 'webgl' || type === 'webgl2') return null
      return orig.call(this, type, ...rest)
    }
  })
}

async function enterAsGuestInDarkMode(page) {
  await enterAsGuest(page)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    Object.assign(state, { theme: 'dark', lang: 'en', langAuto: false })
    localStorage.setItem('gym_state_v1', JSON.stringify(state))
  })
  await page.reload()
}

async function openSquatSheet(page) {
  await openRoute(page, '/library')
  await page.getByPlaceholder(/Search/).fill('dumbbell goblet squat')
  await click(page.getByRole('button', { name: /^dumbbell goblet squat /i }).first())
  await expect(page.locator('.iv-guide')).toBeVisible({ timeout: 10_000 })
}

const KEY_WORDS = 'Hips back and down between the heels'

test('a squat exercise shows the movement demo, and it plays when asked', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' })
  await countDraws(page)
  await enterAsGuestInDarkMode(page)
  await openSquatSheet(page)

  const demo = page.locator('.mm-demo')
  await expect(demo).toBeVisible({ timeout: 10_000 })
  await expect(demo.locator('.mm-demo-text')).toContainText(KEY_WORDS)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'))
  if (webgl) {
    await expect(demo.locator('canvas')).toBeVisible()
    const play = demo.getByRole('button', { name: 'Play' })
    await expect(play).toBeVisible()
    await click(play)
    await expect.poll(() => page.evaluate(() => window.__draws), { timeout: 10_000 }).toBeGreaterThan(5)
    await expect(demo.getByRole('button', { name: 'Pause' })).toBeVisible()
    // The words follow the movement: the loop reaches the standing frame again.
    await expect(demo.locator('.mm-demo-text')).toContainText('Standing tall, feet about shoulder width apart', { timeout: 10_000 })
  } else {
    // No WebGL on this device: the still and the words, and nothing to play.
    await expect(demo.locator('[data-mm-still]')).toBeVisible()
    await expect(demo.locator('canvas')).toHaveCount(0)
    await expect(demo).toContainText('cannot show the 3D movement')
    await expect(demo.getByRole('button', { name: 'Play' })).toHaveCount(0)
  }

  const screenshot = testInfo.outputPath('mannequin-demo-390-dark.png')
  await demo.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: screenshot })
  await testInfo.attach('mannequin-demo-390-dark', { path: screenshot, contentType: 'image/png' })

  const { violations } = await new AxeBuilder({ page }).include('.mm-demo').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

  if (webgl) {
    // Closing the sheet stops the rig: the frames stop being drawn.
    await page.keyboard.press('Escape')
    await expect(demo).toHaveCount(0)
    const stopped = await page.evaluate(() => window.__draws)
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => window.__draws)).toBe(stopped)
  }
})

test('with motion off, the key pose is shown in words and nothing moves', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await countDraws(page)
  await enterAsGuestInDarkMode(page)
  await openSquatSheet(page)

  const demo = page.locator('.mm-demo')
  await expect(demo).toBeVisible({ timeout: 10_000 })
  const still = demo.locator('[data-mm-still]')
  await expect(still).toBeVisible()
  await expect(still.locator('path, circle, line')).not.toHaveCount(0)
  await expect(demo.locator('.mm-demo-text')).toContainText(KEY_WORDS)
  await expect(demo).toContainText('Motion is off on this device')
  // Nothing animates: no rig is built, so nothing is drawn.
  await expect(demo.locator('canvas')).toHaveCount(0)
  await expect(demo.getByRole('button', { name: 'Play' })).toHaveCount(0)
  expect(await page.evaluate(() => window.__draws)).toBe(0)

  const screenshot = testInfo.outputPath('mannequin-still-390-dark.png')
  await demo.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: screenshot })
  await testInfo.attach('mannequin-still-390-dark', { path: screenshot, contentType: 'image/png' })
})

test('without WebGL, the key pose is shown in words and the demo says why', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' })
  await withoutWebGL(page)
  await enterAsGuestInDarkMode(page)
  await openSquatSheet(page)

  const demo = page.locator('.mm-demo')
  await expect(demo).toBeVisible({ timeout: 10_000 })
  await expect(demo.locator('[data-mm-still]')).toBeVisible()
  await expect(demo.locator('.mm-demo-text')).toContainText(KEY_WORDS)
  await expect(demo).toContainText('cannot show the 3D movement')
  await expect(demo.locator('canvas')).toHaveCount(0)

  const screenshot = testInfo.outputPath('mannequin-no-webgl-390-dark.png')
  await demo.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: screenshot })
  await testInfo.attach('mannequin-no-webgl-390-dark', { path: screenshot, contentType: 'image/png' })
})

test('the movement demo works offline, once the app has been opened with a network', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await enterAsGuestInDarkMode(page)
  await openSquatSheet(page)
  // The production app registers its worker on HTTPS. Playwright serves this same build on HTTP loopback.
  await page.evaluate(() => navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready))
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.reload()
  await openSquatSheet(page)
  await expect(page.locator('.mm-demo')).toBeVisible({ timeout: 10_000 })

  await context.setOffline(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('.mm-demo')).toHaveCount(0)
  await openSquatSheet(page)
  await expect(page.locator('.mm-demo')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.mm-demo [data-mm-still]')).toBeVisible()
  await expect(page.locator('.mm-demo-text')).toContainText(KEY_WORDS)
  await context.setOffline(false)
})
