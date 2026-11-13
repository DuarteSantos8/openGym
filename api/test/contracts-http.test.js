import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { boundPort } from './helpers.mjs'
import { visibleOptionalEntries } from '../sync-stamps.js'

test('HTTP optional profile compatibility: PUT, 409, old writers, tombstones, reset and malformed records', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep01-http-'))
  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(path.join(dir, 'secret'), secret, { mode: 0o600 })
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'probe', name: 'Synthetic' }], creds: [], subs: [], invites: [] }))
  const child = spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INTEGRATIONS: '' } })
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d)
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } fs.rmSync(dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`
  const payload = `probe:${Date.now() + 86400000}:0`
  const token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' }
  const get = async () => (await fetch(base + '/api/data', { headers })).json()
  const put = async body => { const r = await fetch(base + '/api/data', { method: 'PUT', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() } }
  const row = { id: 'a', schemaVersion: 1, grams: 100, futureField: 42, _ts: 10, _f: { schemaVersion: 10, grams: 10, futureField: 10 } }
  assert.equal((await put({ state: { _ts: 10, unit: 'kg', workouts: [], nutritionEntries: [row], futureSetting: 42 }, stamped: true })).status, 200)
  const initial = await get()
  await t.test('stale revision receives 409 and the exact optional record', async () => {
    const r = await put({ state: { workouts: [] }, baseRev: initial.rev - 1 })
    assert.equal(r.status, 409); assert.deepEqual(r.body.state.nutritionEntries, [row])
  })
  for (const stamped of [false, true]) await t.test(`an older ${stamped ? 'stamped' : 'unstamped'} writer omitting the whole collection preserves it`, async () => {
    const current = await get()
    assert.equal((await put({ state: { workouts: [], _ts: 20 }, baseRev: current.rev, stamped })).status, 200)
    assert.deepEqual((await get()).state.nutritionEntries, [row])
  })
  await t.test('unstamped writer omitting unknown fields within optional records preserves them', async () => {
    const current = await get()
    const partial = { id: 'a', schemaVersion: 1, grams: 110 }
    assert.equal((await put({ state: { workouts: [], nutritionEntries: [partial] }, baseRev: current.rev })).status, 200)
    const state = (await get()).state
    assert.equal(state.nutritionEntries[0].futureField, 42)
    assert.equal(state.nutritionEntries[0].grams, 110)
  })
  await t.test('explicit tombstone remains hidden through an older writer and replay', async () => {
    let current = await get()
    const gone = Date.now() + 100
    await put({ state: { ...current.state, deleted: { nutritionEntries: { a: gone } } }, baseRev: current.rev, stamped: true })
    current = await get()
    await put({ state: { workouts: [], nutritionEntries: [row] }, baseRev: current.rev, stamped: true })
    const state = (await get()).state
    assert.equal(state.deleted.nutritionEntries.a, gone)
    assert.deepEqual(visibleOptionalEntries(state, 'nutritionEntries'), [])
  })
  await t.test('malformed optional records cannot erase valid records or crash the server', async () => {
    const current = await get()
    assert.equal((await put({ state: { workouts: [], nutritionEntries: [null, 42, [], {}, { id: '__proto__' }] }, baseRev: current.rev, stamped: true })).status, 200)
    const state = (await get()).state
    assert.equal(state.nutritionEntries.length, 1); assert.equal(state.nutritionEntries[0].id, 'a')
  })
  await t.test('reset ids survive GET and suppress stale replay without reviving legacy unknown settings', async () => {
    let current = await get(); const resetAt = Date.now() + 1000
    await put({ state: { workouts: [], resetAt, resetIds: { nutritionEntries: ['a'] } }, baseRev: current.rev, stamped: true })
    current = await get()
    assert.equal(current.state.futureSetting, undefined)
    assert.deepEqual(current.state.resetIds.nutritionEntries, ['a'])
    assert.deepEqual(visibleOptionalEntries(current.state, 'nutritionEntries'), [])
    await put({ state: { workouts: [], nutritionEntries: [row] }, baseRev: current.rev, stamped: true })
    assert.deepEqual(visibleOptionalEntries((await get()).state, 'nutritionEntries'), [])
  })
})
