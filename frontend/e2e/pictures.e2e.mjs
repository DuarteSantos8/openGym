// Extra exercise pictures (catalogue/photos, Everkinetic): shown on the exercise sheet, served
// from this origin, each credited. The fixture still fails the test on any request that leaves.
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

test('an exercise with Everkinetic drawings shows start and end, credited, from this origin', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/library')
  await page.getByPlaceholder(/Search/).fill('barbell bench press')
  // The row's name is lower case in the DOM (capitalised by CSS); "(side pov)" is another exercise.
  await click(page.getByRole('button', { name: /^barbell bench press pectorals/i }))
  const pics = page.locator('section.expics')
  await expect(pics).toBeVisible({ timeout: 10_000 })
  await expect(pics.locator('img')).toHaveCount(2)
  for (const img of await pics.locator('img').all()) {
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true)
    expect(await img.getAttribute('src')).toMatch(/^exercise-photos\/files\/\d{4}-(relaxation|tension)\.webp$/)
  }
  await expect(pics.locator('figcaption').first()).toContainText('Start position')
  await expect(pics.locator('figcaption').first()).toContainText('CC BY-SA 4.0')
})
