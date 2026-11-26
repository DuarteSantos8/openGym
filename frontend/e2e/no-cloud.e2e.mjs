// The default build has no Cloud edition in it (ADR 0008): the account address shows the app's
// own sign-in like any other address, and nothing asks a hosted project for anything. The bundle
// check (scripts/check-bundle-budget.mjs) holds the files to the same; this holds the behaviour.
import { test, expect } from './fixtures.mjs'

test('the default build has no cloud account screen', async ({ page }) => {
  await page.goto('/#/account')
  await expect(page.getByRole('button', { name: 'Continue without account' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.iv-acct')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /cloud/i.test(k)))).toEqual([])
})
