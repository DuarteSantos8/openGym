import { test, expect } from '../fixtures.mjs'

// Delay a genuine logout response while another tab completes OIDC against the local API.
test('a late logout response preserves a newer sign-in in another tab', async ({ page, context }) => {
  const second = await context.newPage()
  const me = tab => tab.evaluate(async () => (await fetch('/api/me')).status)
  const logout = tab => tab.evaluate(async () => (await fetch('/api/logout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).status)
  const signIn = async tab => {
    // The Cloud account watcher is a separate journey. Land the real callback on a neutral page.
    await tab.route(url => url.pathname === '/', route => route.fulfill({ body: 'Signed in' }))
    await tab.goto('/api/oidc/start')
    expect(await me(tab)).toBe(200)
  }

  let deliver, received
  const release = new Promise(resolve => { deliver = resolve })
  const held = new Promise(resolve => { received = resolve })
  await page.route('**/api/logout', async route => {
    const response = await route.fetch()
    received()
    await release
    await route.fulfill({ response })
  })
  try {
    await signIn(page)
    const firstLogout = logout(page)
    await held
    await signIn(second)
    deliver()
    expect(await firstLogout).toBe(200)
    expect(await me(second)).toBe(200)
    expect(await logout(second)).toBe(200)
    expect(await me(second)).toBe(401)
  } finally {
    deliver()
    await second.close()
  }
})
