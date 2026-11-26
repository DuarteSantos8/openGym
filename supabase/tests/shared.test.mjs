// node --test supabase/tests
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyStripeEvent, StripeSignatureError, formEncode, stripeRequest, StripeApiError } from '../functions/_shared/stripe.js'
import { periodEndOf, userIdOf, subscriptionRow, rowIsLive, entitlementRows, liveFeatures } from '../functions/_shared/entitlements.js'
import { signEntitlement, generateKeyPair, TOKEN_TTL_SEC } from '../functions/_shared/token.js'
import { verifyEntitlement, stateOf, hasFeature, GRACE_SEC, EntitlementError, saveToken, loadToken, loadEntitlement } from '../../frontend/src/lib/cloud/entitlement.js'
import { signStripe } from './world.mjs'

const NOW = 1_800_000_000
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const code = c => e => e instanceof StripeSignatureError && e.code === c

test('stripe signature: accepts what Stripe signed', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } })
  const event = await verifyStripeEvent(body, await signStripe(body, 'whsec_a', NOW), 'whsec_a', { nowSec: NOW + 10 })
  assert.equal(event.id, 'evt_1')
})

test('stripe signature: refuses a changed body, another secret, an old or missing header', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'x' })
  const header = await signStripe(body, 'whsec_a', NOW)
  await assert.rejects(verifyStripeEvent(body.replace('evt_1', 'evt_2'), header, 'whsec_a', { nowSec: NOW }), code('signature'))
  await assert.rejects(verifyStripeEvent(body, header, 'whsec_b', { nowSec: NOW }), code('signature'))
  await assert.rejects(verifyStripeEvent(body, header, 'whsec_a', { nowSec: NOW + 301 }), code('timestamp'))
  await assert.rejects(verifyStripeEvent(body, header, 'whsec_a', { nowSec: NOW - 301 }), code('timestamp'))
  for (const bad of ['', 'v1=abc', 't=abc,v1=abc', 't=' + NOW, 'garbage']) await assert.rejects(verifyStripeEvent(body, bad, 'whsec_a', { nowSec: NOW }), code('header'))
  await assert.rejects(verifyStripeEvent(body, header, '', { nowSec: NOW }), code('header'))
  await assert.rejects(verifyStripeEvent(body, header.replace(/v1=.{4}/, 'v1=0000'), 'whsec_a', { nowSec: NOW }), code('signature'))
})

test('stripe signature: any one of several v1 signatures is enough (secret rotation)', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'x' })
  const good = await signStripe(body, 'whsec_new', NOW)
  const header = `t=${NOW},v1=${'0'.repeat(64)},${good.split(',')[1]}`
  assert.equal((await verifyStripeEvent(body, header, 'whsec_new', { nowSec: NOW })).id, 'evt_1')
})

test('stripe signature: a signed body that is not an event is refused', async () => {
  for (const body of ['not json', '{}', '{"id":1,"type":"x"}']) {
    await assert.rejects(verifyStripeEvent(body, await signStripe(body, 's', NOW), 's', { nowSec: NOW }), code('signature'))
  }
})

test('formEncode: nested objects and arrays the way Stripe reads them', () => {
  assert.equal(formEncode({ mode: 'subscription', line_items: [{ price: 'p_1', quantity: 1 }], subscription_data: { metadata: { a: 'b c' } }, skip: null, also: undefined }),
    'mode=subscription&line_items%5B0%5D%5Bprice%5D=p_1&line_items%5B0%5D%5Bquantity%5D=1&subscription_data%5Bmetadata%5D%5Ba%5D=b%20c')
  assert.equal(formEncode({}), '')
  assert.equal(formEncode({ ok: true, n: 0 }), 'ok=true&n=0')
})

test('stripeRequest: the key rides in the header only, and errors carry no key', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ id: 'x' }), { status: 200 }) }
  await stripeRequest('POST', '/v1/customers', { key: 'sk_test_secret', params: { email: 'a@b.c' }, idempotencyKey: 'k1', fetchImpl })
  await stripeRequest('GET', '/v1/subscriptions/sub_1', { key: 'sk_test_secret', fetchImpl })
  assert.equal(seen[0].url, 'https://api.stripe.com/v1/customers')
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk_test_secret')
  assert.equal(seen[0].init.headers['Idempotency-Key'], 'k1')
  assert.equal(seen[0].init.body, 'email=a%40b.c')
  assert.equal(seen[1].init.body, undefined)
  assert.ok(!seen.some(s => s.url.includes('sk_test_secret')))
  const failing = async () => new Response(JSON.stringify({ error: { message: 'No such price', type: 'invalid_request_error' } }), { status: 400 })
  await assert.rejects(stripeRequest('POST', '/v1/x', { key: 'sk_test_secret', fetchImpl: failing }), e => e instanceof StripeApiError && e.status === 400 && !e.message.includes('sk_test_secret'))
  await assert.rejects(stripeRequest('POST', '/v1/x', { fetchImpl }), /key missing/)
})

test('periodEndOf: reads the subscription or, since 2025, its items', () => {
  assert.equal(periodEndOf({ current_period_end: 100 }), 100)
  assert.equal(periodEndOf({ items: { data: [{ current_period_end: 200 }, { current_period_end: 300 }] } }), 300)
  assert.equal(periodEndOf({}), null)
  assert.equal(periodEndOf(null), null)
})

test('userIdOf: only a real uuid from the metadata', () => {
  assert.equal(userIdOf({ metadata: { supabase_user_id: USER.toUpperCase() } }), USER)
  assert.equal(userIdOf({ metadata: { supabase_user_id: 'not-a-uuid' } }), null)
  assert.equal(userIdOf({}), null)
})

test('subscriptionRow: what goes into public.subscriptions', () => {
  const row = subscriptionRow({ id: 'sub_1', status: 'active', cancel_at_period_end: true, items: { data: [{ price: { id: 'price_month' }, current_period_end: NOW }] } }, USER)
  assert.deepEqual(row, { id: 'sub_1', user_id: USER, status: 'active', price_id: 'price_month', current_period_end: new Date(NOW * 1000).toISOString(), cancel_at_period_end: true, source: 'stripe' })
})

const sub = (status, endSec, user = USER) => ({ user_id: user, status, current_period_end: endSec == null ? null : new Date(endSec * 1000).toISOString() })

test('entitlements: active and trialing grant pro until the period ends', () => {
  for (const status of ['active', 'trialing']) {
    assert.deepEqual(entitlementRows([sub(status, NOW + 1000)], USER, { nowSec: NOW }), [{ user_id: USER, feature: 'pro', source: 'stripe', expires_at: new Date((NOW + 1000) * 1000).toISOString() }])
  }
})

test('entitlements: past due keeps what was paid for and nothing beyond it', () => {
  assert.equal(entitlementRows([sub('past_due', NOW + 50)], USER, { nowSec: NOW }).length, 1)
  assert.equal(entitlementRows([sub('past_due', NOW - 1)], USER, { nowSec: NOW }).length, 0)
  assert.equal(entitlementRows([sub('past_due', null)], USER, { nowSec: NOW }).length, 0)
  assert.equal(rowIsLive(sub('past_due', NOW + 50), NOW), true)
})

test('entitlements: every other status grants nothing', () => {
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', 'whatever']) {
    assert.deepEqual(entitlementRows([sub(status, NOW + 1000)], USER, { nowSec: NOW }), [], status)
  }
  assert.deepEqual(entitlementRows([], USER), [])
  assert.deepEqual(entitlementRows(null, USER), [])
  assert.deepEqual(entitlementRows([sub('active', NOW + 1)], null), [])
})

test('entitlements: cancelling one subscription does not take away what another still pays for', () => {
  const rows = [sub('canceled', NOW - 5), sub('active', NOW + 500), sub('active', NOW + 900, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')]
  const out = entitlementRows(rows, USER, { nowSec: NOW })
  assert.equal(out.length, 1)
  assert.equal(out[0].expires_at, new Date((NOW + 500) * 1000).toISOString())
})

test('entitlements: the latest end wins, and no known end means no end', () => {
  assert.equal(entitlementRows([sub('active', NOW + 5), sub('trialing', NOW + 50)], USER, { nowSec: NOW })[0].expires_at, new Date((NOW + 50) * 1000).toISOString())
  assert.equal(entitlementRows([sub('active', null)], USER, { nowSec: NOW })[0].expires_at, null)
  assert.deepEqual(entitlementRows([sub('active', NOW + 5)], USER, { nowSec: NOW, features: ['pro', 'demos'] }).map(r => r.feature), ['pro', 'demos'])
})

test('liveFeatures: what is granted now, once each', () => {
  const at = s => new Date(s * 1000).toISOString()
  assert.deepEqual(liveFeatures([{ feature: 'pro', expires_at: at(NOW + 1) }, { feature: 'pro', expires_at: null }, { feature: 'old', expires_at: at(NOW - 1) }, { feature: 'demos', expires_at: null }, null, {}], NOW), ['demos', 'pro'])
  assert.deepEqual(liveFeatures(undefined, NOW), [])
})

test('token: what the function signs, the app verifies', async () => {
  const { privateJwk, publicJwk } = await generateKeyPair()
  const token = await signEntitlement({ sub: USER, features: ['pro', 'pro', 'demos'], nowSec: NOW }, privateJwk)
  const claims = await verifyEntitlement(token, publicJwk)
  assert.deepEqual(claims, { sub: USER, features: ['demos', 'pro'], iat: NOW, exp: NOW + TOKEN_TTL_SEC })
  assert.equal(hasFeature(claims, 'pro', { nowSec: NOW + 10, userId: USER }), true)
  assert.equal(hasFeature(claims, 'pro', { nowSec: NOW + 10, userId: 'someone-else' }), false)
  assert.equal(hasFeature(claims, 'nope', { nowSec: NOW + 10 }), false)
})

test('token: Pro holds through the grace period offline, then lapses', async () => {
  const { privateJwk, publicJwk } = await generateKeyPair()
  const claims = await verifyEntitlement(await signEntitlement({ sub: USER, features: ['pro'], nowSec: NOW }, privateJwk), publicJwk)
  const day = 86400
  assert.equal(stateOf(claims, NOW), 'active')
  assert.equal(stateOf(claims, NOW + 6 * day), 'active')
  assert.equal(stateOf(claims, NOW + 7 * day), 'grace')
  assert.equal(stateOf(claims, NOW + 13 * day), 'grace')
  assert.equal(hasFeature(claims, 'pro', { nowSec: NOW + 13 * day }), true)
  assert.equal(stateOf(claims, NOW + TOKEN_TTL_SEC + GRACE_SEC), 'expired')
  assert.equal(hasFeature(claims, 'pro', { nowSec: NOW + 15 * day }), false)
  assert.equal(stateOf(null, NOW), 'expired')
})

test('token: a tampered token, another key or another algorithm is refused', async () => {
  const a = await generateKeyPair(), b = await generateKeyPair()
  const token = await signEntitlement({ sub: USER, features: [], nowSec: NOW }, a.privateJwk)
  const [h, p, s] = token.split('.')
  const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const forged = b64u({ sub: USER, features: ['pro'], iat: NOW, exp: NOW + 9e9 })
  const is = c => e => e instanceof EntitlementError && e.code === c
  await assert.rejects(verifyEntitlement(`${h}.${forged}.${s}`, a.publicJwk), is('signature'))
  await assert.rejects(verifyEntitlement(token, b.publicJwk), is('signature'))
  await assert.rejects(verifyEntitlement(`${b64u({ alg: 'none' })}.${forged}.`, a.publicJwk), is('malformed'))
  await assert.rejects(verifyEntitlement(`${b64u({ alg: 'none' })}.${forged}.AAAA`, a.publicJwk), is('alg'))
  await assert.rejects(verifyEntitlement(`${b64u({ alg: 'HS256' })}.${forged}.AAAA`, a.publicJwk), is('alg'))
  for (const bad of ['', 'a.b', 'a.b.c.d', null, 42, '!!!.???.***']) await assert.rejects(verifyEntitlement(bad, a.publicJwk), is('malformed'))
  await assert.rejects(signEntitlement({ sub: '', features: [] }, a.privateJwk), /sub missing/)
})

test('token: kept between launches, and a bad one is thrown away', async () => {
  const { privateJwk, publicJwk } = await generateKeyPair()
  const mem = new Map()
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) }
  assert.equal(await loadEntitlement(publicJwk, { storage }), null)
  const token = await signEntitlement({ sub: USER, features: ['pro'], nowSec: NOW }, privateJwk)
  assert.equal(saveToken(token, storage), true)
  assert.equal(loadToken(storage), token)
  assert.equal((await loadEntitlement(publicJwk, { storage, nowSec: NOW + 5 })).state, 'active')
  saveToken(token.slice(0, -4) + 'AAAA', storage)
  assert.equal(await loadEntitlement(publicJwk, { storage, nowSec: NOW + 5 }), null)
  assert.equal(loadToken(storage), null)
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('full') }, removeItem() {} }
  assert.equal(saveToken(token, broken), false)
  assert.equal(loadToken(broken), null)
})
