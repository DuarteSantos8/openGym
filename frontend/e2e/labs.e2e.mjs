// The openGym Next labs on the add-ons page, end to end in a real browser.
import { test, expect, click, enterAsGuest, openRoute, workout, EX } from './fixtures.mjs'

// The Progression lab sits folded under Advanced with the roadmap (release pass, Addons.jsx).
const advanced = page => page.locator('details.addon-advanced')
const openAdvanced = page => click(advanced(page).locator('summary'))

test('a guest reaches the add-ons page and every lab is there', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/addons')
  for (const h of ['Movement lab', '3D muscle map']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible()
  }
  // folded away until asked for, then there
  await expect(page.getByRole('heading', { name: 'Progression rule lab' })).toBeHidden()
  await openAdvanced(page)
  await expect(advanced(page)).toHaveAttribute('open', '')
  await expect(page.getByRole('heading', { name: 'Progression rule lab' })).toBeVisible()
})

test('Progression lab: Simulate produces a session table and writes nothing', async ({ page }) => {
  await enterAsGuest(page)
  await openRoute(page, '/addons')
  await openAdvanced(page)
  const before = await page.evaluate(() => localStorage.getItem('gym_state_v1'))
  const lab = page.locator('section[aria-labelledby="addon-prog-title"]')
  await click(lab.getByRole('button', { name: 'Simulate' }))
  await expect(lab.getByRole('columnheader', { name: 'Session' })).toBeVisible()
  await expect(lab.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('gym_state_v1'))).toBe(before)
})

test('Movement lab: the camera starts on this device and stops again', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit has no fake camera; covered on a real iPhone (docs/next/devices.md)')
  await enterAsGuest(page)
  await openRoute(page, '/addons')
  const lab = page.locator('section[aria-labelledby="addon-move-title"]')
  await click(lab.getByRole('button', { name: 'Start camera' }))
  await expect(lab.getByRole('button', { name: 'Stop camera' })).toBeVisible({ timeout: 30_000 })
  await expect(lab.getByText('Reps', { exact: true })).toBeVisible()
  await click(lab.getByRole('button', { name: 'Stop camera' }))
  await expect(lab.getByRole('button', { name: 'Start camera' })).toBeVisible()
})

test('3D muscle map: loads, shades the trained muscles, closes cleanly', async ({ page }) => {
  await enterAsGuest(page, [workout(1, EX.squat, 12), workout(2, EX.bench, 8)])
  await openRoute(page, '/addons')
  const lab = page.locator('section[aria-labelledby="addon-anatomy-title"]')
  await click(lab.getByRole('button', { name: 'Show in 3D' }))
  await expect(lab.getByText('Drag to turn the body')).toBeVisible({ timeout: 30_000 })
  await expect(lab.locator('.addon-3d canvas')).toHaveCount(1)
  const level = name => lab.locator('.addon-muscles li', { hasText: name }).locator('.hm-c')
  await expect(level('Chest')).toHaveClass(/\bl[1-4]\b/)
  await expect(level('Quads')).toHaveClass(/\bl[1-4]\b/)
  await expect(level('Lats')).toHaveClass(/\bl0\b/)
  await click(lab.getByRole('button', { name: 'Close 3D' }))
  await expect(lab.locator('.addon-3d canvas')).toHaveCount(0)
})
