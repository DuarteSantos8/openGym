// The server down behind a proxy that holds the connection open (the web app's /api forwarded to
// a server that stopped answering): the app still starts, on this browser, without the boot
// screen's "taking too long to start" error. The boot screen gives up at 10 s (index.html).
import { test, expect, click } from './fixtures.mjs'

test.use({ serviceWorkers: 'block' })

test('the app starts as usual when the server never answers', async ({ page }) => {
  await page.route('**/api/**', () => {})   // held open, never answered
  const started = Date.now()
  await page.goto('/')
  const guest = page.getByRole('button', { name: 'Continue without account' })
  await expect(guest).toBeVisible({ timeout: 9000 })
  expect(Date.now() - started, 'ms to the sign-in screen').toBeLessThan(9000)
  await expect(page.locator('#boot.fail')).toHaveCount(0)

  await click(guest)
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
