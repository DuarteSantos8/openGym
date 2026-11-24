// The Cloud edition's account screen, end to end, in the cloud build (ADR 0008, 0013), against
// a pretend project (./pretend-project.mjs). Every step is scanned with axe, and the shared
// fixture fails the test if any request leaves this machine.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '../fixtures.mjs'
import { pretendProject, PROJECT } from './pretend-project.mjs'

async function serious(page) {
  await page.waitForTimeout(350)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.impact} ${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`)
}
const open = async (page, hash = '#/account') => { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/' + hash); await expect(page.locator('.iv-acct')).toBeVisible({ timeout: 15_000 }) }
const mode = page => page.locator('.iv-acct')
const signIn = async (page, password = 'right-password') => {
  await page.fill('input[name="email"]', 'sam@example.com')
  await page.fill('input[name="password"]', password)
  await page.click('[data-submit]')
}

test('sign in, change the name, stay signed in over a reload, sign out', async ({ page }) => {
  const { seen } = await pretendProject(page)
  await open(page)
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  await expect(page.locator('[data-submit]')).toBeDisabled()
  expect(await serious(page)).toEqual([])

  await signIn(page, 'not-the-password')
  await expect(page.getByRole('alert')).toHaveText('That email or password is not right.')
  expect(await serious(page)).toEqual([])

  await signIn(page)
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')
  await expect(page.locator('.iv-acct-title')).toHaveText('Sam')
  await expect(page.locator('.iv-acct-who')).toContainText('sam@example.com')
  expect(await serious(page)).toEqual([])

  await page.fill('input[name="name"]', 'Samira')
  await page.click('[data-save]')
  // Save says so (the owner pressed it eight times on the real project and saw nothing), and
  // has nothing more to do until the name changes again.
  await expect(page.locator('[data-saved]')).toHaveText('Saved')
  await expect(page.locator('[data-save]')).toBeDisabled()
  await expect(page.locator('.iv-acct-title')).toHaveText('Samira')
  await page.reload()
  await expect(page.locator('.iv-acct-title')).toHaveText('Samira', { timeout: 15_000 })

  await page.click('[data-signout]')
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  // the password never travelled anywhere but the sign-in call, and every call carried the public key
  expect(seen.filter(c => JSON.stringify(c.body).includes('right-password')).map(c => c.path)).toEqual(['/auth/v1/token'])
  expect(seen.every(c => c.apikey === 'sb_publishable_e2e')).toBe(true)
})

test('create an account and ask for a reset: both end at "check your email", with the link coming back here', async ({ page }) => {
  const { state } = await pretendProject(page)
  await open(page)
  await page.click('[data-go="signup"]')
  await expect(page.locator('.iv-acct-title')).toHaveText('Create account')
  await page.fill('input[name="email"]', 'new@example.com')
  await page.fill('input[name="password"]', 'short')
  await expect(page.locator('[data-submit]')).toBeDisabled()
  await page.fill('input[name="password"]', 'long-enough-password')
  expect(await serious(page)).toEqual([])
  await page.click('[data-submit]')
  await expect(mode(page)).toHaveAttribute('data-mode', 'sent')
  await expect(page.locator('.iv-acct-hint')).toContainText('may already have an account')
  await expect(page.locator('.iv-acct-lead')).toContainText('new@example.com')
  expect(await serious(page)).toEqual([])

  await page.click('[data-go="signin"]')
  await page.click('[data-go="forgot"]')
  await page.fill('input[name="email"]', 'sam@example.com')
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(mode(page)).toHaveAttribute('data-mode', 'sent')
  expect(state.emails.map(e => e.kind)).toEqual(['signup', 'recovery'])
  for (const e of state.emails) expect(e.redirect).toMatch(/^http:\/\/localhost:\d+\/#\/account$/)
})

test('a reset link lands on a new password; a dead link says so', async ({ page }) => {
  const { state } = await pretendProject(page)
  await open(page, '#/account?token_hash=good-hash&type=recovery')
  await expect(mode(page)).toHaveAttribute('data-mode', 'newpass')
  await expect(page).not.toHaveURL(/token_hash/)
  // Loading the page again must not skip the step: the link's session is kept, so the account
  // would open with the old password still in force.
  await page.reload()
  await expect(mode(page)).toHaveAttribute('data-mode', 'newpass')
  await page.fill('input[name="password"]', 'a-brand-new-password')
  expect(await serious(page)).toEqual([])
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')
  expect(state.users[0].password).toBe('a-brand-new-password')
  await page.reload()
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')

  await page.click('[data-signout]')
  // Only the hash changes, so this is the same document: the app follows the link by itself. (A
  // reload here would race it: once the link is spent and gone from the address, loading the page
  // again is a fresh start with nothing to say.)
  await page.goto('/#/account?token_hash=stale&type=signup')
  await expect(page.getByRole('alert')).toHaveText('This link has expired. Ask for a new one.')
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
})

test('deleting needs the word, then the account is gone and its password no longer signs in', async ({ page }) => {
  const { state } = await pretendProject(page)
  await open(page)
  await signIn(page)
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')
  // Folded away until it is asked for.
  await expect(page.locator('input[name="confirm"]')).toBeHidden()
  await page.locator('.iv-acct-danger > summary').click()
  await expect(page.locator('[data-delete]')).toBeDisabled()
  await page.fill('input[name="confirm"]', 'delet')
  await expect(page.locator('[data-delete]')).toBeDisabled()
  await page.fill('input[name="confirm"]', 'delete')
  expect(await serious(page)).toEqual([])
  await page.click('[data-delete]')
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  expect(state.deleted).toEqual(['u-1'])
  await signIn(page)
  await expect(page.getByRole('alert')).toHaveText('That email or password is not right.')
})

test('approving a sign-in to the app\'s own server: sign in first, see who asks, and be sent on', async ({ page }) => {
  const { state } = await pretendProject(page)
  await open(page, '#/account?authorization_id=az-1')
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  await signIn(page)
  await expect(mode(page)).toHaveAttribute('data-mode', 'consent')
  await expect(page.locator('.iv-acct-title')).toHaveText('Allow Ironvane server to sign you in?')
  expect(await serious(page)).toEqual([])
  await page.click('[data-allow]')
  await expect(page.locator('#landed')).toBeVisible({ timeout: 15_000 })
  expect(page.url()).toBe(`${PROJECT}/api/oidc/callback?code=c-1`)
  expect(state.consents).toEqual([{ id: 'az-1', action: 'approve' }])
})

// Found by the owner on the real project: after signing in, Continue left them on the app's own
// sign-in screen, whose "Create new profile" asks a server of the app's own that did not answer.
test('the first screen offers the account and this device; signed in, Continue goes into the app', async ({ page }) => {
  await pretendProject(page)
  // As on the real deployment that day: what stands where the app's own server would be refuses
  // everything. (The E2E run has such a server; the hosted edition does not have to.)
  await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'text/plain', body: '401 Unauthorized' }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const account = page.getByRole('button', { name: 'Sign in or create account' })
  await expect(account).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Continue without account' })).toBeVisible()
  for (const name of ['Create new profile', 'Sign in with passkey']) await expect(page.getByRole('button', { name })).toHaveCount(0)
  expect(await serious(page)).toEqual([])

  await account.click()
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  // Not signing in after all: back to the first screen, where this device is offered. (An app
  // installed to the home screen has no browser back to do this with.)
  await page.click('[data-back]')
  await expect(page.getByRole('button', { name: 'Continue without account' })).toBeVisible()
  // Back went back: the account is not left behind in the history to be reopened by the next back.
  expect(await page.evaluate(() => [location.hash.replace(/^#\/?/, ''), history.state?.idx ?? 0])).toEqual(['', 0])
  await account.click()
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  expect(await serious(page)).toEqual([])
  await signIn(page)
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')
  await page.click('[data-continue]')
  // In the app on this device: not the account screen, and not asked to sign in a second time.
  await expect(page.locator('.iv-acct')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in or create account' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create new profile' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('gym_guest'))).toBe('1')
  // And the app knows who they are: not "Guest mode", and the button goes to their account.
  const line = page.locator('.conn-t')
  await expect(line).toHaveText('Signed in as Sam. Your training is stored on this device.')
  await expect(page.getByText('Guest mode')).toHaveCount(0)
  // Settings says the same at the top: their name, not "Guest" and "Sign in to sync".
  await page.evaluate(() => { location.hash = '#/settings' })
  const card = page.locator('.sp-acct')
  await expect(card.locator('.lrow-t')).toHaveText('Sam')
  await expect(card.locator('.lrow-s')).toHaveText('Signed in as sam@example.com. Your training is stored on this device.')
})

// The app's own server, once it exists (docs/next/CLOUD-SERVER.md): a real API here, whose one
// way in is an identity provider (./linked-server.mjs). The provider is a stand-in that signs the
// person straight in; the hosted one shows our consent page first, which the test above covers.
test("where the app's own server signs people in with the account, Continue makes them a profile there", async ({ page }) => {
  await pretendProject(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  // The first screen is still the account and this device, not the server's own sign-in page.
  const account = page.getByRole('button', { name: 'Sign in or create account' })
  await expect(account).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Sign in with Ironvane' })).toHaveCount(0)
  expect(await serious(page)).toEqual([])
  await account.click()
  await signIn(page)
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')
  await page.click('[data-continue]')
  // Off to the server's sign-in and back again: in the app, as a profile on the server.
  await expect(page.locator('.iv-acct')).toHaveCount(0, { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => fetch('api/me').then(r => (r.ok ? r.json() : null)).then(j => j?.user?.name || null)), { timeout: 20_000 }).toBe('Sam')
  // Home greets them by the name the server has, and Settings says the same.
  await expect(page.getByRole('heading', { name: 'Hi Sam' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Settings' }).click()
  const card = page.locator('.sp-acct')
  await expect(card.locator('.lrow-t')).toHaveText('Sam')
  await expect(card).not.toContainText('Guest')
  await expect(page.getByText('Guest mode')).toHaveCount(0)
})

// The two sessions end together (lib/cloud/server-link.js, found in review of #78): a profile
// left open on the server would show this person's training to whoever uses the browser next.
test('the server profile ends with the account: signed out here, or signed out elsewhere', async ({ page }) => {
  const onServer = () => page.evaluate(() => fetch('api/me').then(r => (r.ok ? r.json() : null)).then(j => j?.user?.name || null))
  const linkUp = async () => {
    await page.getByRole('button', { name: 'Sign in or create account' }).click()
    await signIn(page)
    await expect(mode(page)).toHaveAttribute('data-mode', 'account')
    await page.click('[data-continue]')
    await expect(page.getByRole('heading', { name: 'Hi Sam' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(onServer, { timeout: 15_000 }).toBe('Sam')
  }
  await pretendProject(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in or create account' })).toBeVisible({ timeout: 15_000 })
  await linkUp()

  // Signed out of the account somewhere else (another tab), then this page is loaded again:
  // the server profile is signed out too, and the app is back at its first screen.
  await page.evaluate(() => localStorage.removeItem('gym_cloud_session_v1'))
  await page.reload()
  await expect.poll(onServer, { timeout: 15_000 }).toBeNull()
  await expect(page.getByRole('button', { name: 'Sign in or create account' })).toBeVisible({ timeout: 15_000 })

  // Signed out on the account screen itself: the same, before the account is signed out.
  await linkUp()
  await page.evaluate(() => { location.hash = '#/account' })
  await expect(mode(page)).toHaveAttribute('data-mode', 'account')
  await page.click('[data-signout]')
  await expect(mode(page)).toHaveAttribute('data-mode', 'signin')
  await expect.poll(onServer, { timeout: 15_000 }).toBeNull()
})
