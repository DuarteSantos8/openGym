import { test, expect, enterAsGuest, openRoute } from './fixtures.mjs'

test('a guest finds the rest timer through local app help', async ({ page }) => {
  const provider = []
  page.on('request', req => { if (req.url().includes('/api/coach/help')) provider.push(req.url()) })
  await enterAsGuest(page)
  await openRoute(page, '/settings')
  await page.getByRole('button', { name: 'App help' }).click()
  const query = page.getByRole('searchbox', { name: 'App help' })
  await query.fill('where is the rest timer?')
  await page.getByRole('button', { name: /Rest timer/ }).first().click()
  await expect(page).toHaveURL(/#\/settings\/workout$/)
  await expect(page.getByText('Rest timer', { exact: true }).first()).toBeVisible()
  expect(provider).toEqual([])
})
