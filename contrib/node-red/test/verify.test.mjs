// The verifier against openGym's own signer and envelope (api/integrations/crypto.js signature,
// events.js envelope/testData): what openGym sends passes, everything else is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { signature, newSecret } from '../../../api/integrations/crypto.js'
import { envelope, testData } from '../../../api/integrations/events.js'

const require = createRequire(import.meta.url)
const { verifyOpenGymWebhook, publicBody, OPENGYM_EVENTS, rememberDelivery } = require('../verify.js')

const SECRET = newSecret()
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)
const T = Math.floor(NOW / 1000)
const event = (type = 'workout.finished', id = 'evt_abc123') => envelope({ id, type, data: testData(type, NOW), at: NOW })
const delivery = ({ body = JSON.stringify(event()), secret = SECRET, ts = T, header } = {}) => ({
  rawBody: Buffer.from(body),
  headers: { 'content-type': 'application/json', 'x-opengym-signature': header ?? signature(secret, body, ts), 'x-opengym-delivery': 'evt_abc123' },
})
const check = (d, extra = {}) => verifyOpenGymWebhook({ ...d, secret: SECRET, crypto, seen: {}, now: NOW, ...extra })

test('a delivery signed by openGym passes, for every event type it sends', () => {
  assert.deepEqual(OPENGYM_EVENTS, ['workout.finished', 'workout.pr', 'weighin.logged'])
  for (const type of OPENGYM_EVENTS) {
    const r = check(delivery({ body: JSON.stringify(event(type, 'evt_' + type)) }))
    assert.equal(r.ok, true, type)
    assert.equal(r.status, 200)
    assert.equal(r.envelope.type, type)
  }
})

test('the signature is over the bytes received: re-serialised JSON does not pass', () => {
  const raw = '{"data":{"workout":{"id":"w1"}},  "version":1,"type":"workout.finished","id":"evt_ws"}'
  assert.equal(check(delivery({ body: raw })).ok, true)
  const d = delivery({ body: raw })
  d.rawBody = Buffer.from(JSON.stringify(JSON.parse(raw)))
  assert.equal(check(d).status, 401)
})

test('a changed body, timestamp or secret is refused', () => {
  const d = delivery()
  d.rawBody = Buffer.from(d.rawBody.toString().replace('Test workout', 'Test workoux'))
  assert.equal(check(d).status, 401, 'one byte of the body')
  const sig = signature(SECRET, JSON.stringify(event()), T)
  assert.equal(check(delivery({ header: sig.replace(`t=${T}`, `t=${T - 1}`) })).status, 401, 'timestamp swapped in the header')
  assert.equal(check(delivery({ secret: newSecret() })).status, 401, 'another secret')
})

test('a missing, malformed or doubled signature header is refused', () => {
  const good = signature(SECRET, JSON.stringify(event()), T)
  const hex = good.split('v1=')[1]
  for (const header of ['', 'v1=' + hex, `t=${T}`, `sha256=${hex}`, `t=${T},v1=${hex.toUpperCase()}`,
    `t=${T},v1=${hex},v0=${hex}`, ` ${good}`, `t=${T},v1=${hex.slice(2)}`, `t=abc,v1=${hex}`]) {
    assert.equal(check(delivery({ header })).status, 401, JSON.stringify(header))
  }
  const d = delivery(); delete d.headers['x-opengym-signature']
  assert.equal(check(d).reason, 'missing signature header')
  const two = delivery(); two.headers['x-opengym-signature'] = [good, good]
  assert.equal(check(two).status, 401)
})

test('a timestamp outside the window is refused, either side; the edge passes', () => {
  assert.equal(check(delivery({ ts: T - 301 })).status, 401, 'stale')
  assert.equal(check(delivery({ ts: T + 301 })).status, 401, 'from the future')
  assert.equal(check(delivery({ ts: T - 300 })).ok, true)
  assert.equal(check(delivery({ ts: T - 50 }), { toleranceSec: 30 }).status, 401, 'a tighter window')
})

test('a body over the limit is a 413, decided before any HMAC work', () => {
  const big = JSON.stringify({ ...event(), pad: 'x'.repeat(70 * 1024) })
  let hmacs = 0
  const counting = { ...crypto, createHmac: (...a) => { hmacs++; return crypto.createHmac(...a) }, timingSafeEqual: crypto.timingSafeEqual }
  const r = check(delivery({ body: big }), { crypto: counting })
  assert.equal(r.status, 413)
  assert.equal(hmacs, 0)
  assert.equal(check(delivery({ body: big }), { maxBytes: 128 * 1024 }).ok, true, 'the limit is configurable')
})

test('the comparison is constant-time: every well-formed signature goes through timingSafeEqual', () => {
  const calls = []
  const spy = { createHmac: crypto.createHmac, timingSafeEqual: (a, b) => { calls.push([a.length, b.length]); return crypto.timingSafeEqual(a, b) } }
  check(delivery({ secret: newSecret() }), { crypto: spy })
  check(delivery(), { crypto: spy })
  assert.deepEqual(calls, [[32, 32], [32, 32]])
})

test('nothing is parsed before the signature passes; a signed body must be a version-1 envelope', () => {
  assert.equal(check(delivery({ body: 'not json', header: 't=1,v1=' + '0'.repeat(64) })).status, 401)
  assert.equal(check(delivery({ body: 'not json' })).status, 400)
  assert.equal(check(delivery({ body: '[1,2]' })).status, 400)
  assert.equal(check(delivery({ body: JSON.stringify({ ...event(), version: 2 }) })).status, 400)
  assert.equal(check(delivery({ body: JSON.stringify({ ...event(), type: 42 }) })).status, 400)
  assert.equal(check(delivery({ body: JSON.stringify({ ...event(), type: 'x'.repeat(65) }) })).status, 400)
  assert.equal(check(delivery({ body: JSON.stringify({ ...event(), id: 'x'.repeat(101) }) })).status, 400)
  assert.equal(check(delivery({ body: JSON.stringify({ ...event(), id: 42 }) })).status, 400)
})

test('replay: the signed id is remembered; openGym\'s own retry (same id, new timestamp) is a 200 duplicate', () => {
  const seen = {}
  const body = JSON.stringify(event())
  assert.equal(check(delivery({ body }), { seen }).envelope.id, 'evt_abc123')
  const replay = check(delivery({ body }), { seen })
  assert.deepEqual([replay.ok, replay.status, replay.duplicate], [true, 200, true])
  const retry = check(delivery({ body, ts: T + 60 }), { seen, now: NOW + 60_000 })
  assert.equal(retry.duplicate, true)
  // The unsigned X-OpenGym-Delivery header plays no part.
  const other = delivery({ body: JSON.stringify(event('workout.finished', 'evt_new')) })
  other.headers['x-opengym-delivery'] = 'evt_abc123'
  assert.equal(check(other, { seen }).duplicate, undefined)
  // Forgotten after twice the window, when any copy of it is long refused by its timestamp.
  assert.equal(check(delivery({ body, ts: T + 601 }), { seen, now: NOW + 601_000 }).duplicate, undefined)
})

test('the id store is bounded: past the cap the oldest go first; a refused delivery stores nothing', () => {
  const seen = {}
  for (let i = 0; i < 5; i++) check(delivery({ body: JSON.stringify(event('workout.finished', 'evt_' + i)) }), { seen, maxSeen: 3 })
  assert.deepEqual(Object.keys(seen), ['k:evt_2', 'k:evt_3', 'k:evt_4'])
  check(delivery({ secret: newSecret(), body: JSON.stringify(event('workout.finished', 'evt_forged')) }), { seen })
  assert.equal('k:evt_forged' in seen, false)
})

test('misconfiguration is a 500 (openGym retries) and says so in the log, not to the sender', () => {
  const parsed = delivery(); parsed.rawBody = JSON.parse(parsed.rawBody.toString())
  assert.match(check(parsed).reason, /Do not parse request body/)
  assert.equal(check(parsed).status, 500)
  assert.equal(check(delivery(), { secret: '' }).status, 500)
  assert.equal(check(delivery(), { secret: undefined }).status, 500)
  assert.equal(check(delivery(), { crypto: undefined }).status, 500)
})

test('what goes back never carries the secret, the expected signature or the reason', () => {
  const body = JSON.stringify(event())
  const expected = signature(SECRET, body, T).split('v1=')[1]
  const results = [check(delivery()), check(delivery({ secret: newSecret() })), check(delivery({ ts: 1 })),
    check(delivery({ body: 'x'.repeat(70000) })), check(delivery({ body: 'not json' })), check(delivery(), { secret: '' })]
  for (const r of results) {
    const out = JSON.stringify(publicBody(r))
    assert.ok(!out.includes(SECRET) && !out.includes(expected) && !out.includes('ogwh_'), out)
    if (!r.ok) assert.ok(!out.includes(r.reason), out)
  }
  assert.deepEqual(results.map(r => publicBody(r)), [{ ok: true }, { error: 'unauthorized' }, { error: 'unauthorized' },
    { error: 'payload too large' }, { error: 'bad request' }, { error: 'receiver not configured' }])
})

test('sign-example.mjs prints requests the verifier judges as their comments say, and never the secret', async () => {
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, [new URL('../sign-example.mjs', import.meta.url).pathname], { env: { ...process.env, OPENGYM_WEBHOOK_SECRET: SECRET }, encoding: 'utf8' })
  assert.ok(!out.includes(SECRET))
  const reqs = [...out.matchAll(/-H 'X-OpenGym-Signature: ([^']+)' --data-binary '([^']+)'/g)].map(m => ({ rawBody: Buffer.from(m[2]), headers: { 'x-opengym-signature': m[1] } }))
  assert.equal(reqs.length, 3)
  const now = Date.now()
  assert.deepEqual(reqs.map(r => verifyOpenGymWebhook({ ...r, secret: SECRET, crypto, seen: {}, now }).status), [200, 401, 401])
})

// openGym answers a non-retryable 4xx with a final failure (providers/webhook.js judge), so a 400
// for an event type this flow does not know yet would break the webhook the day openGym adds one.
test('an authentic delivery of an event type this flow does not know is acknowledged, not handled, and still deduplicated', () => {
  const seen = {}
  const body = JSON.stringify({ ...event(), type: 'workout.deleted', id: 'evt_future' })
  const first = check(delivery({ body }), { seen })
  assert.equal(first.ok, true)
  assert.equal(first.status, 200)
  assert.equal(first.ignored, true)
  assert.equal(first.envelope, undefined, 'nothing to hand to the handler')
  assert.deepEqual(publicBody(first), { ok: true, ignored: true })
  const again = check(delivery({ body }), { seen })
  assert.equal(again.duplicate, true)
  // Authenticity still comes first: the same unknown type, unsigned or tampered, is a 401.
  assert.equal(check(delivery({ body, header: 't=1,v1=' + '0'.repeat(64) })).status, 401)
})

// A delivery counts as seen only once its handler is done: recorded before, a handler that failed
// would turn openGym's retry (same id) into a "duplicate" 200 and the event would be lost
// (Codex review on #8). With `defer`, the check records nothing and says what to record after.
test('defer: an authentic delivery is not recorded until rememberDelivery, so a failed handler can be retried', () => {
  const seen = {}
  const body = JSON.stringify(event('workout.finished', 'evt_defer'))
  const first = check(delivery({ body }), { seen, defer: true })
  assert.equal(first.ok, true)
  assert.ok(first.envelope)
  assert.deepEqual(Object.keys(seen), [], 'nothing recorded yet')
  assert.equal(first.remember.id, 'evt_defer')
  // The handler failed: openGym retries the same id and it is handled again, not a duplicate.
  const retry = check(delivery({ body }), { seen, defer: true })
  assert.ok(retry.envelope && !retry.duplicate)
  // The handler succeeded: recorded now, so a third copy is the duplicate.
  rememberDelivery(seen, retry.remember, NOW, 10000)
  assert.equal(check(delivery({ body }), { seen, defer: true }).duplicate, true)
  // Without defer nothing changes for other callers: recorded at once.
  const eager = {}
  check(delivery({ body }), { seen: eager })
  assert.equal(check(delivery({ body }), { seen: eager }).duplicate, true)
})
