import AxeBuilder from '@axe-core/playwright'
import { test, expect, enterAsGuest, openRoute } from './fixtures.mjs'

test('a guest can read, swap and advance a guided workout offline', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await enterAsGuest(page)
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('gym_state_v1') || '{}')
    const exercises = ['1760', '1197'].map(id => ({ id, sets: 1, reps: 8 }))
    state.routines = [{ id: 'strength', name: 'Strength', ex: exercises }]
    state.active = {
      id: 'guide', d: new Date().toISOString().slice(0, 10), name: 'Strength', start: Date.now(),
      cur: 0, routineId: 'strength', routineIds: ['strength'], workoutView: 'focus',
      entries: exercises.map(ex => ({ id: ex.id, rid: 'strength', target: ex, sets: [{ w: 0, r: 8, done: false }] })),
    }
    Object.assign(state, { theme: 'dark', gifSize: 'off', spokenCues: false, lang: 'en', langAuto: false })
    localStorage.setItem('gym_state_v1', JSON.stringify(state))
  })
  await page.reload()
  await openRoute(page, '/workout')
  const options = page.getByRole('button', { name: 'Workout options' })
  await expect(options).toBeVisible()
  // The production app registers its worker on HTTPS. Playwright serves this same build on HTTP loopback.
  await page.evaluate(() => navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready))
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.reload()
  await expect(options).toBeVisible()
  const closeGuestBanner = page.locator('.conn-row').getByRole('button', { name: 'Close' })
  if (await closeGuestBanner.isVisible()) await closeGuestBanner.click()
  await context.setOffline(true)
  await options.click()
  await page.getByRole('button', { name: /Layout/ }).click()
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  const header = page.locator('.focus-card-header')
  await expect(header).toBeVisible()
  await header.evaluate(el => el.scrollIntoView({ block: 'start' }))
  const before = testInfo.outputPath('focus-before-390-dark.png')
  await page.screenshot({ path: before })
  await testInfo.attach('focus-before-390-dark', { path: before, contentType: 'image/png' })
  await options.click()
  await page.getByRole('button', { name: /Layout/ }).click()
  await page.getByRole('button', { name: 'Guided workout' }).click()

  const card = page.getByRole('region', { name: 'Guided workout' })
  await expect(card.getByRole('listitem')).toHaveCount(4)
  await expect(card).toContainText('Exercise 1 of 2')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const { violations } = await new AxeBuilder({ page }).include('.guided-card').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([])
  await page.locator('.focus-card-header').evaluate(el => el.scrollIntoView({ block: 'start' }))
  const screenshot = testInfo.outputPath('guided-workout-390-dark.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('guided-workout-390-dark', { path: screenshot, contentType: 'image/png' })

  await card.getByRole('button', { name: 'Too hard' }).click()
  await expect(card.getByRole('button', { name: 'Too hard' })).toHaveCount(0)
  await expect(page.getByText(/Using .* for this workout\./)).toBeVisible()
  await card.getByRole('button', { name: 'Next' }).click()
  await expect(card).toContainText('Exercise 2 of 2')
  await expect(card.getByRole('button', { name: 'Next' })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => {
    const { active, routines } = JSON.parse(localStorage.getItem('gym_state_v1'))
    return [active.cur, active.entries.map(e => e.id), routines[0].ex.map(e => e.id)]
  })).toEqual([1, ['1197', '1197'], ['1760', '1197']])
})
