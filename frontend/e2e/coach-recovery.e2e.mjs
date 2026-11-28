import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures.mjs'
import { boundPort, sampleState } from '../../api/test/helpers.mjs'

const apiDir = fileURLToPath(new URL('../../api/', import.meta.url))
const prompt = 'Add a push day on Tuesday and a pull day on Wednesday'
const proposal = { coach_contract: 1, answer: 'Two training days.', actions: [
  { type: 'routine', name: 'Push', items: [{ id: '0662', sets: 2, reps: 8 }] },
  { type: 'routine', name: 'Pull', items: [{ id: '1772', sets: 2, reps: 8 }] },
  { type: 'schedule', name: 'Push', day: 2 },
  { type: 'schedule', name: 'Pull', day: 3 },
] }

test('a timed-out and then interrupted Coach request saves its plan once, on approval', async ({ page, playwright }, info) => {
  test.skip(info.project.name !== 'chromium', 'one real server restart and provider timeout per run')
  test.setTimeout(240000)
  const dir = await mkdtemp(join(tmpdir(), 'gym-coach-retry-'))
  let sends = 0, allowProposal = false
  const provider = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(404); return res.end() }
    let body = ''
    for await (const chunk of req) body += chunk
    const message = JSON.parse(body).messages.at(-1).content
    const warmup = message === 'Reply with exactly {"coach_contract":1} and nothing else.'
    if (!warmup) {
      sends++
      if (!allowProposal) return // leave the user's request parked for timeout and restart
    }
    res.setHeader('content-type', 'application/json')
    const content = JSON.stringify(warmup ? { coach_contract: 1 } : proposal)
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const client = await playwright.request.newContext()
  let worker, origin
  async function start() {
    worker = spawn(process.execPath, ['server.js'], { cwd: apiDir, env: {
      PATH: process.env.PATH, DATA_DIR: dir, PORT: '0', PASSWORD_LOGIN: '1', COACH_JOB_TIMEOUT_MS: '60000',
    }, stdio: ['ignore', 'pipe', 'ignore'] })
    origin = 'http://127.0.0.1:' + await boundPort(worker)
  }
  async function stop() {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return
    const ended = once(worker, 'exit')
    origin = null
    worker.kill('SIGKILL')
    await ended
  }
  const headers = { 'Sec-Fetch-Site': 'same-origin' }
  async function api(path, method = 'GET', data) {
    const response = await client.fetch(origin + '/api/' + path, { method, data, headers })
    expect(response.ok(), method + ' ' + path + ' returned ' + response.status()).toBe(true)
    return response.json()
  }
  async function send() {
    await page.locator('.composer textarea').fill(prompt)
    const received = page.waitForResponse(response => response.url().endsWith('/api/coach/ask'))
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    expect((await received).status()).toBe(202)
  }
  const status = () => api('coach/status')
  const training = async () => {
    const { state } = await api('data')
    return { routines: state.routines.map(({ id, name }) => ({ id, name })), week: state.week }
  }
  try {
    await writeFile(join(dir, 'coach.json'), JSON.stringify({ enabled: true, provider: 'compatible',
      providerOptions: { compatible: { baseUrl: 'http://127.0.0.1:' + provider.address().port } },
      routinesUrl: 'off',
      models: { compatible: 'local-fixture' }, caps: { perProfileDaily: 3, instanceDaily: 0 },
    }))
    await start()
    await api('register/password', 'POST', { name: 'coach-test', password: randomUUID() })
    const state = sampleState({ week: { 1: ['r1'] } })
    state.coach.consent.version = 3
    await api('data', 'PUT', { state })
    const before = await training()
    // The UI always sees one app origin. Its private API can restart on a fresh ephemeral port.
    await page.route('**/api/**', async route => {
      const req = route.request()
      const target = origin
      if (!target) return route.fulfill({ status: 503, json: { error: 'restarting' } })
      const { pathname, search } = new URL(req.url())
      try {
        const response = await client.fetch(target + pathname + search, { method: req.method(),
          headers: { ...headers, 'content-type': 'application/json' }, data: req.postDataBuffer() || undefined })
        await route.fulfill({ response })
      } catch (error) {
        if (target === origin) throw error
        await route.fulfill({ status: 503, json: { error: 'restarting' } })
      }
    })
    await page.addInitScript(() => localStorage.setItem('gym_tour_v1', '{"done":true}'))
    await page.goto('/#/coach')
    await send()
    await expect.poll(async () => (await status()).last?.errorClass, { timeout: 80000 }).toBe('timeout')
    await expect(page.locator('.msg.coach .bub.err')).toHaveText('The Coach took too long and gave up.', { timeout: 15000 })
    expect(await training()).toEqual(before)
    expect((await status()).cap).toMatchObject({ limit: 3, used: 1 })
    expect(sends).toBe(1)
    await page.reload()
    await send()
    await expect.poll(async () => (await status()).job?.state).toBe('running')
    await expect.poll(() => sends).toBe(2)
    await expect(page.locator('.chat-st')).toHaveText('thinking…')
    await stop()
    await start()
    expect((await status()).last?.errorClass).toBe('restart')
    // Keep the mounted job transition; a failed status poll can back off for the full idle interval.
    await expect(page.locator('.msg.coach .bub.err').last()).toHaveText('The server restarted while the Coach was thinking.', { timeout: 90000 })
    expect((await status()).cap.used).toBe(2)
    expect(await training()).toEqual(before)
    allowProposal = true
    await page.reload()
    await send()
    const approve = page.getByRole('button', { name: 'Import this plan' })
    await expect(approve).toBeVisible({ timeout: 20000 })
    expect(await training()).toEqual(before)
    await approve.click()
    await expect.poll(async () => (await training()).routines.length).toBe(3)
    const after = await training()
    expect(after.routines.map(r => r.name)).toEqual([before.routines[0].name, 'Push', 'Pull'])
    expect(after.week).toEqual({ 1: ['r1'], 2: [after.routines[1].id], 3: [after.routines[2].id] })
    await expect.poll(async () => (await status()).last?.outcome).toBe('applied')
    const loadedStatus = page.waitForResponse(response => response.url().endsWith('/api/coach/status') && response.ok())
    await page.reload()
    const reloadedStatus = await (await loadedStatus).json()
    expect(reloadedStatus.pending).toBeFalsy()
    expect(reloadedStatus.last?.outcome).toBe('applied')
    await expect(page.locator('.composer textarea')).toBeVisible()
    await expect(page.locator('.composer-cap')).toHaveText('3 of 3 Coach runs used today')
    await expect(approve).toHaveCount(0)
    expect(await training()).toEqual(after)
    expect((await status()).cap.used).toBe(3)
    expect(sends).toBe(3)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    for (const [day, name] of [[1, before.routines[0].name], [2, 'Push'], [3, 'Pull']]) {
      await expect(page.locator(`.plan-week .plan-day[data-day="${day}"] .tt`)).toHaveText(name)
    }
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await stop()
    provider.close()
    provider.closeAllConnections()
    await client.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
