import assert from 'node:assert/strict'
// Reuse for adapters with the existing connect/deliver interface. These are transport-free
// checks, not certification: each adapter also needs DNS/timeout/size/OAuth-specific tests.
export function providerContractChecklist(test, { create, input, secrets }) {
  test('provider declares finite per-instance and per-connection rate limits', () => {
    const p = create()
    for (const rate of [p.rate, p.connRate]) {
      assert.ok(Number.isFinite(rate.capacity) && rate.capacity > 0)
      assert.ok(Number.isFinite(rate.refillMs) && rate.refillMs > 0)
    }
  })
  test('configuration does not contact a third party and keeps secrets out of public info', () => {
    let calls = 0
    const p = create(async () => { calls++; return { status: 200 } })
    const made = p.connect(input)
    assert.equal(calls, 0)
    for (const secret of Object.values(made.secrets)) assert.ok(!JSON.stringify(made.info).includes(secret))
  })
  test('redirect and unavailable response cannot be reported as successful delivery', async () => {
    for (const status of [302, 401, 429, 503]) {
      const p = create(async () => ({ status, headers: {} }))
      const out = await p.deliver({ payload: { id: 'synthetic-event', type: 'workout.finished' } }, k => secrets[k])
      assert.equal(out.ok, false)
      if (status === 302) assert.equal(out.retry, false)
    }
  })
  test('same job keeps its delivery identity across retries', async () => {
    const calls = []
    const p = create(async (_url, req) => { calls.push(req); return { status: 503, headers: {} } })
    const job = { payload: { id: 'synthetic-event', type: 'workout.finished' } }
    await p.deliver(job, k => secrets[k]); await p.deliver(job, k => secrets[k])
    assert.equal(calls[0].headers['X-OpenGym-Delivery'], calls[1].headers['X-OpenGym-Delivery'])
    assert.equal(calls[0].body, calls[1].body)
  })
}
