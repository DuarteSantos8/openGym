import http from 'node:http'
import { fork } from 'node:child_process'
import { boundPort } from '../../../api/test/helpers.mjs'
import { test, expect, click } from '../fixtures.mjs'
import { pretendProject } from './pretend-project.mjs'

test('a delayed boot logout preserves a second tab’s new provider sign-in', async ({ page, context, baseURL }, testInfo) => {
  const { state } = await pretendProject(context)
  const second = await context.newPage()
  const me = tab => tab.evaluate(async () => (await fetch('/api/me')).status)
  const enter = async tab => {
    await tab.emulateMedia({ reducedMotion: 'reduce' })
    await tab.goto(origin + '/#/account')
    await tab.locator('input[name=email]').fill(state.users[0].email)
    await tab.locator('input[name=password]').fill(state.users[0].password)
    await tab.locator('[data-submit]').click()
    await tab.locator('[data-continue]').click()
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
  // This scenario needs two provider round trips, regardless of how much sign-in budget
  // other tests have consumed on the project's server.
  let apiOrigin
  const proxy = http.createServer((req, res) => {
    const target = req.url.startsWith('/api/') ? apiOrigin : baseURL
    const upstream = http.request(new URL(req.url, target), { method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers)
      reply.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  await new Promise((resolve, reject) => proxy.once('error', reject).listen(0, 'localhost', resolve))
  const origin = 'http://localhost:' + proxy.address().port
  const server = fork(new URL('./linked-server.mjs', import.meta.url), ['0', origin], {
    stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  })
  try {
    apiOrigin = 'http://localhost:' + await boundPort(server)
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
    // This tab is only waiting for the held reply. Keep its boot deadline past the
    // test budget while the second tab signs in with its normal timers.
    await page.addInitScript(testBudget => {
      const schedule = window.setTimeout.bind(window)
      window.setTimeout = (fn, ms, ...args) => schedule(fn, ms > 0 ? Math.max(ms, testBudget) : ms, ...args)
    }, testInfo.timeout)
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
    if (server.connected) server.disconnect()
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
  }
})
