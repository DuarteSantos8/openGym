// The movement demo on the exercise sheet (EP26-T01, E5a), end to end as a guest: the 3D rig on a
// squat exercise, the still key pose with its words when the device cannot show it or the person
// asked for no motion, and the rig freed when the sheet closes. Scanned with axe; the fixture
// fails on any request that leaves this machine.
import AxeBuilder from '@axe-core/playwright'
import { keyFrameFor, loopFor, poseFor, stillTextFor } from '../src/components/mannequin/poses.js'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

/** Count the frames the rig actually draws, so "it is animating" is measured, not assumed. */
async function countDraws(page, preservePixels = false) {
  await page.addInitScript(preservePixels => {
    window.__draws = 0
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const webgl = /^webgl/.test(type)
      // Keep the real framebuffer readable after compositing for pixel assertions.
      if (webgl && preservePixels) rest[0] = { ...rest[0], preserveDrawingBuffer: true }
      const ctx = orig.call(this, type, ...rest)
      if (ctx && webgl && !ctx.__counted) {
        ctx.__counted = true
        for (const name of ['drawElements', 'drawArrays']) {
          const fn = ctx[name]
          if (fn) ctx[name] = (...a) => { window.__draws++; return fn.apply(ctx, a) }
        }
      }
      return ctx
    }
  }, preservePixels)
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
  await page.route(/\/(exercise-(?:media|photos|demos)|img|gif)\//, route => route.fulfill({ status: 404 }))
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
  await demo.screenshot({ path: screenshot })
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
  await demo.screenshot({ path: screenshot })
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
  await demo.screenshot({ path: screenshot })
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

const examples = [
  ['lunge', '0781', 'split squat'],
  ['hinge', '1459', 'dumbbell romanian deadlift'],
  ['push-h', '0662', 'push-up'],
  ['push-v', '0426', 'dumbbell standing overhead press'],
  ['pull-h', '0293', 'dumbbell bent over row'],
  ['pull-v', '2330', 'cable lat pulldown full range of motion'],
  ['core', '0276', 'dead bug'],
  ['isolation', '0294', 'dumbbell biceps curl'],
]

for (const [pattern, id, exercise] of examples) {
  test(`${pattern} on its dark phone sheet: key pose, keyboard playback and still fallbacks`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' })
    await page.clock.install()
    await countDraws(page, true)
    await enterAsGuestInDarkMode(page)
    await openRoute(page, '/library')
    // Closing the sheet can remount Library and clear the query.
    const open = async () => {
      await page.getByPlaceholder(/Search/).fill(exercise)
      const row = page.locator('.item-open').filter({ has: page.getByText(exercise, { exact: true }) })
      await expect(row).toHaveCount(1, { timeout: 10_000 })
      await click(row)
    }
    await open()
    const demo = page.locator(`[data-guide="${id}"] .mm-demo`)
    const caption = demo.locator('.mm-demo-text')
    const still = demo.locator(`[data-mm-still="${pattern}"]`)
    const canvas = demo.locator('canvas')
    const play = demo.getByRole('button', { name: 'Play', exact: true })
    const pause = demo.getByRole('button', { name: 'Pause', exact: true })
    const draws = () => page.evaluate(() => window.__draws)
    const close = async () => {
      await page.keyboard.press('Escape')
      await expect(demo).toHaveCount(0)
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(demo.getByText('Movement pattern example')).toBeVisible()
    await expect(caption).toHaveText(stillTextFor(pattern))
    if (await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))) {
      await expect(canvas).toBeVisible()
      await expect.poll(draws).toBeGreaterThan(0)
      const pixels = () => canvas.evaluate(el => el.toDataURL())
      const blankImage = await canvas.evaluate(el => {
        const blank = document.createElement('canvas')
        blank.width = el.width
        blank.height = el.height
        return blank.toDataURL()
      })
      const keyImage = await pixels()
      expect(keyImage).not.toBe(blankImage)
      await demo.screenshot({ path: testInfo.outputPath(`${pattern}-key-rig-390-dark.png`) })
      const beforePlayback = await draws()
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000))
      await play.focus()
      await expect(play).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(pause).toBeFocused()
      // The rig starts at the key pose. Step just past the wrap to the first pose.
      await page.clock.runFor(loopFor(pattern) - keyFrameFor(pattern).at + 32)
      expect(await draws()).toBeGreaterThan(beforePlayback + 20)
      await expect(caption).toHaveText(poseFor(pattern)[0].note)
      await page.keyboard.press('Space')
      await expect(play).toBeFocused()
      const paused = await draws()
      await expect(caption).toHaveText(poseFor(pattern)[0].note)
      const pausedImage = await pixels()
      expect(pausedImage).not.toBe(blankImage)
      expect(pausedImage).not.toBe(keyImage)
      await page.clock.runFor(64)
      expect(await pixels()).toBe(pausedImage)
      expect(await draws()).toBe(paused)
      await page.clock.resume()
      await demo.screenshot({ path: testInfo.outputPath(`${pattern}-rig-390-dark.png`) })
      expect(await draws()).toBe(paused)
      await page.keyboard.press('Enter')
      await expect.poll(draws).toBeGreaterThan(paused)
      await close()
      const stopped = await draws()
      // Check again after another refresh opportunity.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      expect(await draws()).toBe(stopped)
      testInfo.annotations.push({ type: 'WebGL', description: 'Playback, paused pixels and disposal verified' })
    } else {
      await expect(still).toBeVisible()
      await expect(demo).toContainText('cannot show the 3D movement')
      await close()
      testInfo.annotations.push({ type: 'WebGL', description: 'Browser has no WebGL 2; native fallback verified' })
    }

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open()
    await expect(still).toBeVisible()
    await expect(still.locator('circle')).not.toHaveCSS('fill', 'none')
    await expect(caption).toHaveText(stillTextFor(pattern))
    await expect(demo).toContainText('Motion is off on this device')
    await expect(play).toHaveCount(0)
    await expect(canvas).toHaveCount(0)
    const viewBox = await still.getAttribute('viewBox')
    const keyPicture = await still.innerHTML()
    await demo.screenshot({ path: testInfo.outputPath(`${pattern}-still-390-dark.png`) })
    if (['lunge', 'push-v', 'core'].includes(pattern)) {
      await demo.evaluate(el => el.scrollIntoView({ block: 'center' }))
      await page.screenshot({ path: testInfo.outputPath(`${pattern}-sheet-390-dark.png`) })
    }
    await close()

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await withoutWebGL(page)
    await page.reload()
    await openRoute(page, '/library')
    await open()
    await expect(still).toBeVisible()
    await expect(still).toHaveAttribute('viewBox', viewBox)
    expect(await still.innerHTML()).toBe(keyPicture)
    await expect(caption).toHaveText(stillTextFor(pattern))
    await expect(demo).toContainText('cannot show the 3D movement')
    await expect(play).toHaveCount(0)
    await expect(canvas).toHaveCount(0)
    const { violations } = await new AxeBuilder({ page }).include('.mm-demo').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })
}

test('a normal sheet without a supported guide shows no movement example', async ({ page }) => {
  await enterAsGuestInDarkMode(page)
  await openRoute(page, '/library')
  await page.getByPlaceholder(/Search/).fill('treadmill')
  await click(page.locator('.item-open').filter({ hasText: 'treadmill' }))
  await expect(page.locator('.exdetail-name')).toContainText(/treadmill/i)
  await expect(page.locator('.mm-demo')).toHaveCount(0)
})
