// Today's body picker (Ironvane), end to end in a real browser as a guest: the drawn body, the
// chips, the explorer opened on the picks, and a photo found by the real pose model, kept on the
// device and removed again. The fixtures' guard fails the test if any request leaves this machine.
import { fileURLToPath } from 'node:url'
import { test, expect, click, enterAsGuest, openRoute } from './fixtures.mjs'

// A whole body in view: a poster frame from the catalogue's own demo videos (CC BY-SA,
// catalogue/demos/NOTICE.md), so the test needs nothing from outside the repository.
const PHOTO = fileURLToPath(new URL('../../catalogue/demos/files/video-0025.webp', import.meta.url))

const card = page => page.locator('.bf-card')
const chip = (page, name) => card(page).locator('.bf-chips .chip', { hasText: new RegExp(`^${name}$`) })

test('pick areas on the drawn body and open their exercises', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/home')
  await expect(card(page).getByText('Tap where you want to get stronger')).toBeVisible()
  await expect(card(page).locator('.bm-v')).toHaveCount(2)
  await click(chip(page, 'Shoulders'))
  await card(page).locator('.bm-m[aria-label="Calves"]').first().dispatchEvent('click')
  await expect(chip(page, 'Shoulders')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, 'Calves')).toHaveAttribute('aria-pressed', 'true')

  await click(card(page).getByRole('button', { name: 'Show exercises' }))
  await expect(page).toHaveURL(/#\/muscles\?m=front-delts,side-delts,rear-delts,calves,tibialis$/)
  await expect(page.getByRole('button', { name: 'Any of them' })).toHaveAttribute('aria-pressed', 'true')
  // On iPhone WebKit a page that has just opened swaps its header for a new one a moment later
  // (every page does, not only this one), and a tap on the old back button goes nowhere: tap
  // again until Today is there, as a person would.
  await expect(async () => {
    await click(page.locator('#app > .page:not(.under) [data-back="/home"]'))
    await expect(page).toHaveURL(/#\/home$/, { timeout: 1500 })
  }).toPass({ timeout: 15_000 })
  await expect(chip(page, 'Shoulders')).toHaveAttribute('aria-pressed', 'true')   // remembered
})

test('a photo is read on the device, takes taps, and goes again', async ({ page }) => {
  test.setTimeout(120_000)
  await enterAsGuest(page)
  await openRoute(page, '/home')
  await card(page).locator('input[type=file]').setInputFiles(PHOTO)
  await expect(card(page).locator('.bf-photo img')).toBeVisible({ timeout: 90_000 })
  await expect(card(page).locator('.bf-photo svg circle')).toHaveCount(2)       // both shoulders
  expect(await page.evaluate(() => new Promise(resolve => {
    const r = indexedDB.open('ironvane-body')
    r.onsuccess = () => { const g = r.result.transaction('photos').objectStore('photos').getAllKeys(); g.onsuccess = () => resolve(g.result) }
  }))).toEqual(['front'])

  await card(page).locator('.bf-photo').evaluate(el => el.scrollIntoView({ block: 'center' }))
  const shoulder = await card(page).locator('.bf-photo svg circle').first().boundingBox()
  await card(page).locator('.bf-photo svg').dispatchEvent('click', {
    clientX: shoulder.x + shoulder.width / 2, clientY: shoulder.y + shoulder.height / 2,
  })
  await expect(chip(page, 'Shoulders')).toHaveAttribute('aria-pressed', 'true')

  await click(card(page).getByRole('button', { name: 'Remove photo' }))
  await expect(card(page).locator('.bf-photo')).toHaveCount(0)
  await expect(card(page).locator('.bm-v')).toHaveCount(2)
})
