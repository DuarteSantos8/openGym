// "How to do it" on the exercise sheet: a demonstration video (catalogue/demos, Wikimedia Commons),
// the U.S. Army photo sequence, and the Everkinetic drawings as numbered steps (catalogue/photos).
// All served from this origin and credited; the fixture still fails the test on any request that leaves.
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

test('barbell bench press shows a video, the whole movement and numbered steps, all credited', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/library')
  await page.getByPlaceholder(/Search/).fill('barbell bench press')
  // The row's name is lower case in the DOM (capitalised by CSS); "(side pov)" is another exercise.
  await click(page.getByRole('button', { name: /^barbell bench press pectorals/i }))
  const how = page.locator('section.expics')
  await click(page.getByRole('button', { name: 'Video', exact: true }))
  await expect(how).toBeVisible({ timeout: 10_000 })

  const video = how.locator('video')
  await expect(video).toHaveCount(1)
  expect(await video.getAttribute('src')).toMatch(/^exercise-demos\/files\/video-0025\.mp4$/)
  const poster = await video.getAttribute('poster')
  expect(poster).toMatch(/^exercise-demos\/files\/video-0025\.webp$/)
  const res = await page.request.get(await video.getAttribute('src'))
  expect(res.ok()).toBe(true)
  expect(res.headers()['content-type']).toMatch(/video\/mp4/)
  expect((await page.request.get(poster)).ok()).toBe(true)
  await expect(how.locator('.expics-video figcaption')).toContainText('CC BY-SA 4.0')

  await click(page.getByRole('button', { name: 'Steps', exact: true }))
  await expect(how.locator('video')).toHaveCount(0)
  const imgs = how.locator('img')
  await expect(imgs).toHaveCount(3)
  for (const img of await imgs.all()) {
    await img.scrollIntoViewIfNeeded()
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true)
  }
  expect(await imgs.nth(0).getAttribute('src')).toMatch(/^exercise-demos\/files\/atp-14-6\.webp$/)
  await expect(how.locator('.expics-seq figcaption')).toContainText('Public domain')
  expect(await imgs.nth(1).getAttribute('src')).toMatch(/^exercise-photos\/files\/\d{4}-relaxation\.webp$/)
  await expect(how.locator('.expics-strip figcaption').first()).toContainText('Step 1 · Start position')
  await expect(how.locator('.expics-strip figcaption').last()).toContainText('Step 2 · End position')
})
