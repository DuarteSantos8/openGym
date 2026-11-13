import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerContractChecklist } from './provider-contract-checklist.mjs'
import { webhookProvider, judge, TIMEOUT_MS, READ_MAX } from '../integrations/providers/webhook.js'
const url = 'https://provider.example/api/webhook/synthetic-secret-path'
providerContractChecklist(test, { create: transport => webhookProvider({ transport }), input: { url }, secrets: { url, secret: 'synthetic-key' } })
test('existing webhook bounds timeout/response size and rejects private addresses at connect', () => {
  assert.equal(TIMEOUT_MS, 10000); assert.equal(READ_MAX, 2048)
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://169.254.169.254', 'https://10.0.0.1']) assert.throws(() => webhookProvider().connect({ url }))
})
test('characterization: legacy generic network errors expose their message, so new adapters must sanitize them', () => {
  assert.equal(judge(null, new Error('synthetic-secret-in-error')).msg, 'synthetic-secret-in-error')
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createIntegrations } from '../integrations/index.js'
test('characterization: connected means configured, and cross-user revoke fails closed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep01-provider-'))
  let calls = 0
  const hub = createIntegrations({ dataDir: dir, secret: 's'.repeat(64), env: { INTEGRATIONS: 'webhook' },
    transport: async () => { calls++; return { status: 503, headers: {} } } })
  try {
    const { connection } = hub.connect('owner', 'webhook', { url })
    assert.equal(connection.status, 'connected'); assert.equal(connection.lastOk, null); assert.equal(calls, 0)
    assert.throws(() => hub.disconnect('other', connection.id), /no such connection/)
    const unavailable = await hub.test('owner', connection.id)
    assert.equal(unavailable.ok, false)
    hub.disconnect('owner', connection.id)
    assert.deepEqual(hub.describe('owner').connections, [])
    await assert.rejects(() => hub.test('owner', connection.id), /no such connection/)
  } finally { hub.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
