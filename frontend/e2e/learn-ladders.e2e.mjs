import AxeBuilder from '@axe-core/playwright'
import { test, expect, enterAsGuest, openRoute, workout } from './fixtures.mjs'

for (const width of [390, 1440]) {
  test(`Learn shows ordered ladder progress offline at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    // Never retrieve exercise media, even if another app surface tries to show it.
    await context.route(/\/(?:exercise-media|exercise-photos|exercise-demos|img|gif)\//, route => route.abort())
    // Keep the delayed onboarding offer out of this separate keyboard journey.
    await page.addInitScript(() => localStorage.setItem('gym_tour_v1', JSON.stringify({ done: 1 })))
    await enterAsGuest(page)
    await openRoute(page, '/learn')
    const entry = page.getByRole('button', { name: 'Skill ladders', exact: true })
    await expect(entry).toBeVisible()
    const dialog = page.getByRole('dialog', { name: 'Skill ladders' })
    const push = dialog.getByRole('list', { name: 'Push-up ladder' })
    const rungs = push.getByRole('listitem')
    const open = async () => {
      await entry.focus()
      await entry.press('Enter')
      await expect(dialog).toBeVisible()
    }
    await open()
    await expect(rungs.locator('.ladder-n')).toHaveText([
      /push-up \(wall\)/i, /incline push-up/i, /kneeling push-up/i, /^push-up$/i,
      /diamond push-up/i, /archer push up/i, /single arm push-up/i,
    ])
    await expect(push.getByText('Not reached', { exact: true })).toHaveCount(7)
    await expect(dialog.getByText('Not started', { exact: true }).first()).toBeVisible()
    await expect(dialog).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await page.keyboard.press('PageDown')
    await expect.poll(() => dialog.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(entry).toBeFocused()

    // Install the production worker on loopback (the app normally registers on HTTPS).
    await page.evaluate(() => navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready))
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    const seed = async workouts => {
      await page.evaluate(workouts => {
        const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
        Object.assign(state, { workouts, theme: 'dark', gifSize: 'off', lang: 'en', langAuto: false,
          ladders: [{ id: 'stale', name: 'Missing exercises', steps: ['removed_a', 'removed_b'] }] })
        localStorage.setItem('gym_state_v1', JSON.stringify(state))
      }, workouts)
      await page.reload()
      await expect(entry).toBeVisible()
    }
    const incomplete = workout(2, '0725', 1)
    incomplete.entries[0].sets[0].done = false
    await seed([workout(1, '0025', 1), incomplete])
    await open()
    await expect(push.getByText('Not reached', { exact: true })).toHaveCount(7)
    await expect(dialog.getByRole('heading', { name: 'Missing exercises' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await context.setOffline(true)
    const middle = workout(4, '0662', 1)
    await seed([workout(3, '0659', 1), middle, workout(5, '0662', 1), incomplete]) // newer lower step first
    for (let visit = 0; visit < 2; visit++) {
      await open()
      await expect(rungs.getByText('Reached', { exact: true })).toHaveCount(4)
      for (let rung = 0; rung < 7; rung++) {
        await expect(rungs.nth(rung).getByText(rung < 4 ? 'Reached' : 'Not reached', { exact: true })).toBeVisible()
      }
      await expect(dialog.getByRole('button')).toHaveCount(1) // Close; the rungs are text.
      if (visit === 0) await page.keyboard.press('Escape')
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const { violations } = await new AxeBuilder({ page }).include('[role="dialog"][aria-modal="true"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations).toEqual([])
    await expect(dialog.locator('img, picture, video, canvas, iframe, object, embed')).toHaveCount(0)
    const screenshot = testInfo.outputPath(`learn-ladders-${width}-dark.png`)
    await page.screenshot({ path: screenshot })
    await testInfo.attach('Learn skill ladders', { path: screenshot, contentType: 'image/png' })
  })
}
