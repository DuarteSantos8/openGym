// @node-test: The opt-in nutrition lookup must not weaken openGym's login boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boundPort } from './helpers.mjs'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SECRET = crypto.randomBytes(32).toString('hex')
const UID = 'u_addon_food'
function cookie() {
  const payload = `${UID}:${Date.now() + 86400000}:0`
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `gymsid=${payload}.${signature}`
}
async function server(t, addon = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-addon-food-'))
  fs.writeFileSync(path.join(folder, 'secret'), SECRET, { mode: 0o600 })
  fs.writeFileSync(path.join(folder, 'db.json'), JSON.stringify({ users: [{ id: UID, name: 'Test' }], creds: [] }))
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: folder,
      RP_ID: 'localhost', ORIGIN: 'http://localhost:8080', MEDIA_UPLOADS: '0',
      ADDON_NUTRITION: addon ? '1' : '0' }
  })
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(folder, { recursive: true, force: true }) })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  const port = await boundPort(child, () => log)
  return `http://127.0.0.1:${port}`
}

test('nutrition add-on is absent from unconfigured servers', async t => {
  const base = await server(t, false)
  const r = await fetch(base + '/api/addons/food?barcode=3017620422003', { headers: { Cookie: cookie() } })
  assert.equal(r.status, 404)
  const config = await fetch(base + '/api/config', { headers: { Cookie: cookie() } }).then(r => r.json())
  assert.equal(config.addons, undefined)
})

test('enabled food lookup is private, validates barcode, and announces itself only to signed-in users', async t => {
  const base = await server(t, true)
  const anonymous = await fetch(base + '/api/addons/food?barcode=3017620422003')
  assert.equal(anonymous.status, 401)
  const configuration = await fetch(base + '/api/config').then(r => r.json())
  assert.equal(configuration.addons, undefined)
  const signed = await fetch(base + '/api/config', { headers: { Cookie: cookie() } }).then(r => r.json())
  assert.deepEqual(signed.addons, { nutrition: true })
  const invalid = await fetch(base + '/api/addons/food?barcode=123', { headers: { Cookie: cookie() } })
  assert.equal(invalid.status, 400)
  assert.match((await invalid.json()).error, /8 to 14/)
})
