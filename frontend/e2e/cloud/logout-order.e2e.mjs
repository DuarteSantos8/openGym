import { test, expect, click } from '../fixtures.mjs'
import { pretendProject } from './pretend-project.mjs'

test('a delayed boot logout preserves a second tab’s new provider sign-in', async ({ page, context }) => {
  const { state } = await pretendProject(context)
  const second = await context.newPage()
  const me = tab => tab.evaluate(async () => (await fetch('/api/me')).status)
  const enter = async tab => {
    await tab.emulateMedia({ reducedMotion: 'reduce' })
    await tab.goto('/#/account')
    await tab.locator('input[name=email]').fill(state.users[0].email)
    await tab.locator('input[name=password]').fill(state.users[0].password)
    await click(tab.locator('[data-submit]'))
    await click(tab.locator('[data-continue]'))
    await expect(tab.getByRole('heading', { name: 'Hi Sam' })).toBeVisible({ timeout: 20_000 })
    expect(await me(tab)).toBe(200)
  }
  const signOut = async tab => {
    await tab.evaluate(() => { location.hash = '#/account' })
    await click(tab.locator('[data-signout]'))
    await expect(tab.locator('.iv-acct')).toHaveAttribute('data-mode', 'signin')
  }

  let deliver, received
  const release = new Promise(resolve => { deliver = resolve })
  const held = new Promise(resolve => { received = resolve })
  try {
    await enter(page)
    // The user's first sign-out fails on the network, so the next real app boot owes a logout.
    await page.route('**/api/logout', route => route.abort(), { times: 1 })
    await signOut(page)
    expect(await me(page)).toBe(200)
    await page.route('**/api/logout', async route => {
      const response = await route.fetch()
      received()
      await release
      await route.fulfill({ response })
    }, { times: 1 })
    await page.reload()
    await held
    // The server ended the old session. Its reply has not reached the original tab.
    expect(await me(page)).toBe(401)
    await enter(second)
    const oldReply = page.waitForResponse(r => new URL(r.url()).pathname === '/api/logout')
    deliver()
    expect((await oldReply).status()).toBe(200)
    await expect.poll(() => me(second)).toBe(200)
    await second.reload()
    await expect(second.getByRole('heading', { name: 'Hi Sam' })).toBeVisible()
    await signOut(second)
    expect(await me(second)).toBe(401)
  } finally {
    deliver()
    await second.close()
  }
})
