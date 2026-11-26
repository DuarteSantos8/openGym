// node --test supabase/tests/*.test.mjs
// Every path of the four Edge Functions, against a pretend project and a pretend Stripe (world.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCheckoutSession, createPortalSession, entitlementToken, stripeWebhook, exportAccount, deleteAccount } from '../functions/_shared/handlers.js'
import { generateKeyPair } from '../functions/_shared/token.js'
import { verifyEntitlement } from '../../frontend/src/lib/cloud/entitlement.js'
import { makeWorld, signStripe, post } from './world.mjs'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', G = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const users = { 'tok-a': { id: A, email: 'a@example.test' }, 'tok-b': { id: B, email: 'b@example.test' }, 'tok-guest': { id: G, is_anonymous: true } }
const NOW = 1_800_000_000
const iso = s => new Date(s * 1000).toISOString()
const world = extra => makeWorld({ users, env: extra })
const stripeSub = (id, status, { user = A, customer = 'cus_1', end = NOW + 2_000_000, meta = true } = {}) => ({
  id, status, customer, cancel_at_period_end: false, metadata: meta ? { supabase_user_id: user } : {},
  items: { data: [{ price: { id: 'price_month' }, current_period_end: end }] },
})
const hook = async (w, event, { secret = w.env.STRIPE_WEBHOOK_SECRET, t = NOW } = {}) => {
  const body = JSON.stringify(event)
  return stripeWebhook(post('stripe-webhook', { body, headers: { 'stripe-signature': await signStripe(body, secret, t) } }), w.env, w.fetchImpl, NOW)
}
const subEvent = (id, type, subId) => ({ id, type, data: { object: { id: subId } } })

// ───────────────────────────── checkout ─────────────────────────────

test('checkout: a signed-in user gets a Stripe page for an allowed price', async () => {
  const w = world()
  const res = await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_year' } }), w.env, w.fetchImpl, NOW * 1000)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { url: 'https://checkout.stripe.test/c/1' })
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(w.table('customers'), [{ user_id: A, stripe_customer_id: 'cus_1' }])
  const p = w.stripe.sessions[0].params
  assert.equal(p.mode, 'subscription')
  assert.equal(p.customer, 'cus_1')
  assert.equal(p.client_reference_id, A)
  assert.equal(p['line_items[0][price]'], 'price_year')
  assert.equal(p['line_items[0][quantity]'], '1')
  assert.equal(p['subscription_data[metadata][supabase_user_id]'], A)
  assert.match(p.success_url, /^https:\/\/app\.example\/#\/settings\?checkout=done$/)
  assert.equal(w.stripe.customers[0].email, 'a@example.test')
})

test('checkout: nobody signed in, a guest, a bad price and a wrong method are all turned away before Stripe', async () => {
  const w = world()
  const none = await createCheckoutSession(post('c', { body: { priceId: 'price_month' } }), w.env, w.fetchImpl)
  assert.equal(none.status, 401)
  const bad = await createCheckoutSession(post('c', { token: 'tok-nobody', body: { priceId: 'price_month' } }), w.env, w.fetchImpl)
  assert.equal(bad.status, 401)
  const guest = await createCheckoutSession(post('c', { token: 'tok-guest', body: { priceId: 'price_month' } }), w.env, w.fetchImpl)
  assert.equal(guest.status, 403)
  assert.deepEqual(await guest.json(), { error: 'account-required' })
  for (const body of [{ priceId: 'price_other' }, { priceId: 42 }, {}, 'not json']) {
    const res = await createCheckoutSession(post('c', { token: 'tok-a', body }), w.env, w.fetchImpl)
    assert.equal(res.status, 400)
  }
  const get = await createCheckoutSession(new Request('https://fn.example/c', { method: 'GET' }), w.env, w.fetchImpl)
  assert.equal(get.status, 405)
  const pre = await createCheckoutSession(new Request('https://fn.example/c', { method: 'OPTIONS' }), w.env, w.fetchImpl)
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.example')
  assert.equal(w.calls.filter(c => c.url.startsWith('https://api.stripe.com')).length, 0)
})

test('checkout: the same tap twice gives the same page and one customer', async () => {
  const w = world()
  const one = await (await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_month' } }), w.env, w.fetchImpl, NOW * 1000)).json()
  const two = await (await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_month' } }), w.env, w.fetchImpl, NOW * 1000 + 5000)).json()
  assert.equal(one.url, two.url)
  assert.equal(w.stripe.sessions.length, 1)
  assert.equal(w.stripe.customers.length, 1)
  // an hour later it is a new page, still the same customer
  await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_month' } }), w.env, w.fetchImpl, NOW * 1000 + 3_600_000)
  assert.equal(w.stripe.sessions.length, 2)
  assert.equal(w.stripe.customers.length, 1)
})

test('checkout: someone already subscribed is sent to the portal instead of paying twice', async () => {
  const w = world()
  w.table('subscriptions').push({ id: 'sub_1', user_id: A, status: 'active', current_period_end: iso(NOW + 99) })
  const res = await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_month' } }), w.env, w.fetchImpl)
  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: 'already-subscribed' })
  assert.equal(w.stripe.sessions.length, 0)
  // someone else's subscription does not count
  const other = await createCheckoutSession(post('c', { token: 'tok-b', body: { priceId: 'price_month' } }), w.env, w.fetchImpl)
  assert.equal(other.status, 200)
})

test('no response ever carries a secret', async () => {
  const w = world()
  const texts = []
  for (const res of [
    await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_month' } }), w.env, w.fetchImpl),
    await createCheckoutSession(post('c', { token: 'tok-guest', body: { priceId: 'price_month' } }), w.env, w.fetchImpl),
    await createPortalSession(post('p', { token: 'tok-a' }), w.env, w.fetchImpl),
  ]) texts.push(await res.text(), JSON.stringify([...res.headers]))
  for (const t of texts) for (const secret of [w.env.SUPABASE_SECRET_KEY, w.env.STRIPE_SECRET_KEY, w.env.STRIPE_WEBHOOK_SECRET]) assert.ok(!t.includes(secret))
})

// ───────────────────────────── portal ─────────────────────────────

test('portal: opens for the caller\'s own customer only', async () => {
  const w = world()
  w.table('customers').push({ user_id: A, stripe_customer_id: 'cus_A' }, { user_id: B, stripe_customer_id: 'cus_B' })
  const res = await createPortalSession(post('p', { token: 'tok-b' }), w.env, w.fetchImpl)
  assert.equal(res.status, 200)
  assert.equal(w.stripe.portals[0].params.customer, 'cus_B')
  assert.equal(w.stripe.portals[0].params.return_url, 'https://app.example/#/settings')
  assert.equal((await createPortalSession(post('p', {}), w.env, w.fetchImpl)).status, 401)
  const guest = await createPortalSession(post('p', { token: 'tok-guest' }), w.env, w.fetchImpl)
  assert.equal(guest.status, 404)
})

// ───────────────────────────── entitlement token ─────────────────────────────

test('entitlement token: signs what is live for the caller, and only the caller', async () => {
  const { privateJwk, publicJwk } = await generateKeyPair()
  const w = world({ ENTITLEMENT_SIGNING_JWK: JSON.stringify(privateJwk) })
  w.table('entitlements').push(
    { user_id: A, feature: 'pro', source: 'stripe', expires_at: iso(NOW + 500) },
    { user_id: A, feature: 'old', source: 'promo', expires_at: iso(NOW - 500) },
    { user_id: B, feature: 'demos', source: 'promo', expires_at: null },
  )
  const res = await entitlementToken(post('t', { token: 'tok-a' }), w.env, w.fetchImpl, NOW)
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.deepEqual(out.features, ['pro'])
  const claims = await verifyEntitlement(out.token, publicJwk)
  assert.equal(claims.sub, A)
  assert.deepEqual(claims.features, ['pro'])
  assert.equal(claims.exp, out.exp)
  assert.ok(!JSON.stringify(out).includes(privateJwk.d))
  const guest = await (await entitlementToken(post('t', { token: 'tok-guest' }), w.env, w.fetchImpl, NOW)).json()
  assert.deepEqual(guest.features, [])
  assert.equal((await entitlementToken(post('t', {}), w.env, w.fetchImpl, NOW)).status, 401)
})

// ───────────────────────────── webhook ─────────────────────────────

test('webhook: an unsigned, wrongly signed or stale request is refused and touches nothing', async () => {
  const w = world()
  const event = subEvent('evt_1', 'customer.subscription.updated', 'sub_1')
  assert.equal((await stripeWebhook(post('w', { body: event }), w.env, w.fetchImpl, NOW)).status, 400)
  assert.equal((await hook(w, event, { secret: 'whsec_wrong' })).status, 400)
  assert.equal((await hook(w, event, { t: NOW - 10_000 })).status, 400)
  assert.equal((await stripeWebhook(new Request('https://fn.example/w'), w.env, w.fetchImpl, NOW)).status, 405)
  assert.equal(w.calls.length, 0)
  assert.deepEqual(w.table('webhook_events'), [])
})

test('webhook: a new subscription makes the account Pro', async () => {
  const w = world()
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active')
  const res = await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { received: true, outcome: 'synced' })
  assert.deepEqual(w.table('customers'), [{ user_id: A, stripe_customer_id: 'cus_1' }])
  assert.equal(w.table('subscriptions')[0].status, 'active')
  assert.equal(w.table('subscriptions')[0].price_id, 'price_month')
  assert.deepEqual(w.table('entitlements'), [{ user_id: A, feature: 'pro', source: 'stripe', expires_at: iso(NOW + 2_000_000) }])
  assert.equal(w.table('webhook_events')[0].processed_at, iso(NOW))
})

test('webhook: the same event twice is acted on once', async () => {
  const w = world()
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active')
  await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  const before = w.calls.length
  const again = await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  assert.deepEqual(await again.json(), { received: true, duplicate: true })
  assert.equal(w.calls.slice(before).filter(c => c.url.startsWith('https://api.stripe.com')).length, 0)
  assert.equal(w.table('webhook_events').length, 1)
  assert.equal(w.table('entitlements').length, 1)
})

test('webhook: events out of order still end where Stripe is now', async () => {
  const w = world()
  // Stripe already says cancelled; the "updated" and "created" events arrive late, after "deleted".
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'canceled', { end: NOW - 10 })
  await hook(w, subEvent('evt_3', 'customer.subscription.deleted', 'sub_1'))
  await hook(w, subEvent('evt_2', 'customer.subscription.updated', 'sub_1'))
  await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  assert.equal(w.table('subscriptions').length, 1)
  assert.equal(w.table('subscriptions')[0].status, 'canceled')
  assert.deepEqual(w.table('entitlements'), [])
})

test('webhook: cancelling takes Pro away, and only the Stripe-granted part', async () => {
  const w = world()
  w.table('entitlements').push({ user_id: A, feature: 'demos', source: 'promo', expires_at: null })
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active')
  await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  assert.equal(w.table('entitlements').length, 2)
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'canceled', { end: NOW - 1 })
  await hook(w, subEvent('evt_2', 'customer.subscription.deleted', 'sub_1'))
  assert.deepEqual(w.table('entitlements'), [{ user_id: A, feature: 'demos', source: 'promo', expires_at: null }])
})

test('webhook: a failed payment keeps Pro until the paid period ends, then not', async () => {
  const w = world()
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'past_due', { end: NOW + 3600 })
  await hook(w, { id: 'evt_1', type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1' } } })
  assert.equal(w.table('entitlements').length, 1)
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'past_due', { end: NOW - 1 })
  // the newer invoice shape names the subscription under parent
  await hook(w, { id: 'evt_2', type: 'invoice.payment_failed', data: { object: { id: 'in_2', parent: { subscription_details: { subscription: 'sub_1' } } } } })
  assert.equal(w.table('entitlements').length, 0)
})

test('webhook: a finished checkout links the customer and grants Pro', async () => {
  const w = world()
  w.stripe.subscriptions.sub_9 = stripeSub('sub_9', 'trialing', { user: B, customer: 'cus_77' })
  const res = await hook(w, { id: 'evt_c', type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: B, customer: 'cus_77', subscription: 'sub_9' } } })
  assert.equal(res.status, 200)
  assert.deepEqual(w.table('customers'), [{ user_id: B, stripe_customer_id: 'cus_77' }])
  assert.equal(w.table('entitlements')[0].user_id, B)
})

test('webhook: a subscription without the user in its metadata is found through its customer', async () => {
  const w = world()
  w.table('customers').push({ user_id: A, stripe_customer_id: 'cus_1' })
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active', { meta: false })
  await hook(w, subEvent('evt_1', 'customer.subscription.updated', 'sub_1'))
  assert.equal(w.table('entitlements')[0].user_id, A)
})

test('webhook: a subscription that belongs to nobody here is noted and granted to nobody', async () => {
  const w = world()
  w.stripe.subscriptions.sub_x = stripeSub('sub_x', 'active', { meta: false, customer: 'cus_unknown' })
  const res = await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_x'))
  assert.deepEqual(await res.json(), { received: true, outcome: 'orphan' })
  assert.deepEqual(w.table('entitlements'), [])
  assert.deepEqual(w.table('subscriptions'), [])
})

test('webhook: an event it has no use for is acknowledged and changes nothing', async () => {
  const w = world()
  const res = await hook(w, { id: 'evt_1', type: 'charge.refunded', data: { object: { id: 'ch_1' } } })
  assert.deepEqual(await res.json(), { received: true, outcome: 'ignored' })
  assert.equal(w.calls.filter(c => c.url.startsWith('https://api.stripe.com')).length, 0)
  assert.equal(w.table('webhook_events').length, 1)
})

test('webhook: when Stripe cannot be reached the event stays open and the retry finishes it', async () => {
  const w = world()
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active')
  w.stripe.down = true
  await assert.rejects(hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1')))
  assert.equal(w.table('webhook_events')[0].processed_at, null)
  assert.deepEqual(w.table('entitlements'), [])
  w.stripe.down = false
  const retry = await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  assert.deepEqual(await retry.json(), { received: true, outcome: 'synced' })
  assert.equal(w.table('entitlements').length, 1)
  assert.equal(w.table('webhook_events').length, 1)
})

test('webhook: two subscriptions, one cancelled: still Pro', async () => {
  const w = world()
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active', { end: NOW + 100 })
  w.stripe.subscriptions.sub_2 = stripeSub('sub_2', 'active', { end: NOW + 900 })
  await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  await hook(w, subEvent('evt_2', 'customer.subscription.created', 'sub_2'))
  w.stripe.subscriptions.sub_2 = stripeSub('sub_2', 'canceled', { end: NOW - 1 })
  await hook(w, subEvent('evt_3', 'customer.subscription.deleted', 'sub_2'))
  assert.deepEqual(w.table('entitlements'), [{ user_id: A, feature: 'pro', source: 'stripe', expires_at: iso(NOW + 100) }])
})

test('nothing in any path talks to a host other than the project and Stripe', async () => {
  const w = world()
  w.stripe.subscriptions.sub_1 = stripeSub('sub_1', 'active')
  await createCheckoutSession(post('c', { token: 'tok-a', body: { priceId: 'price_month' } }), w.env, w.fetchImpl)
  await hook(w, subEvent('evt_1', 'customer.subscription.created', 'sub_1'))
  const hosts = new Set(w.calls.map(c => new URL(c.url).origin))
  assert.deepEqual([...hosts].sort(), ['https://api.stripe.com', 'https://proj.example'])
})

// ───────────────────────────── the account: take it with you, or take it away ─────────────────────────────

test('export: a signed-in user gets their own rows and nobody else\'s', async () => {
  const w = world()
  w.table('profiles').push({ id: A, display_name: 'Sam', experience: 'beginner', node_uid: 'n-1', created_at: iso(NOW), updated_at: iso(NOW) }, { id: B, display_name: 'Other', experience: null, node_uid: null })
  w.table('subscriptions').push({ id: 'sub_a', user_id: A, status: 'active', price_id: 'price_month', current_period_end: iso(NOW + 100), cancel_at_period_end: false, source: 'stripe' }, { id: 'sub_b', user_id: B, status: 'active' })
  w.table('entitlements').push({ user_id: A, feature: 'pro', source: 'stripe', expires_at: null }, { user_id: B, feature: 'pro', source: 'promo', expires_at: null })
  w.table('customers').push({ user_id: A, stripe_customer_id: 'cus_secretish' })
  const res = await exportAccount(post('export-account', { token: 'tok-a' }), w.env, w.fetchImpl, NOW)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const out = await res.json()
  assert.equal(out.exported_at, iso(NOW))
  assert.deepEqual(out.account, { id: A, email: 'a@example.test' })
  assert.equal(out.profile.display_name, 'Sam')
  assert.deepEqual(out.subscriptions.map(x => x.id), ['sub_a'])
  assert.deepEqual(out.entitlements.map(x => x.feature), ['pro'])
  const text = JSON.stringify(out)
  assert.ok(!text.includes(B) && !text.includes('Other'))
  // the payment provider's own id for the customer is not the person's data to carry around
  assert.ok(!text.includes('cus_secretish'))
  assert.ok(!text.includes(w.env.SUPABASE_SECRET_KEY))
})

test('export and delete: nobody signed in is refused, and only POST is answered', async () => {
  const w = world()
  for (const fn of [exportAccount, deleteAccount]) {
    assert.equal((await fn(post('x', { body: { confirm: 'delete' } }), w.env, w.fetchImpl, NOW)).status, 401)
    assert.equal((await fn(post('x', { token: 'nope', body: { confirm: 'delete' } }), w.env, w.fetchImpl, NOW)).status, 401)
    assert.equal((await fn(new Request('https://fn.example/x', { method: 'GET', headers: { authorization: 'Bearer tok-a' } }), w.env, w.fetchImpl, NOW)).status, 405)
    const pre = await fn(new Request('https://fn.example/x', { method: 'OPTIONS' }), w.env, w.fetchImpl, NOW)
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.example')
  }
  assert.deepEqual(w.admin.deleted, [])
})

test('delete: needs the word, then removes the account and everything that hangs off it', async () => {
  const w = world()
  w.table('profiles').push({ id: A, display_name: 'Sam' }, { id: B, display_name: 'Other' })
  w.table('entitlements').push({ user_id: A, feature: 'pro', source: 'promo', expires_at: null }, { user_id: B, feature: 'pro', source: 'promo', expires_at: null })
  for (const body of [undefined, {}, { confirm: true }, { confirm: 'DELETE' }, { confirm: 'yes' }]) {
    const no = await deleteAccount(post('delete-account', { token: 'tok-a', body }), w.env, w.fetchImpl, NOW)
    assert.equal(no.status, 400)
    assert.deepEqual(await no.json(), { error: 'confirm' })
  }
  assert.deepEqual(w.admin.deleted, [])
  const res = await deleteAccount(post('delete-account', { token: 'tok-a', body: { confirm: 'delete' } }), w.env, w.fetchImpl, NOW)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { deleted: true })
  assert.deepEqual(w.admin.deleted, [A])
  assert.deepEqual(w.table('profiles').map(r => r.id), [B])
  assert.deepEqual(w.table('entitlements').map(r => r.user_id), [B])
  // the token no longer names anyone
  assert.equal((await exportAccount(post('export-account', { token: 'tok-a' }), w.env, w.fetchImpl, NOW)).status, 401)
})

test('delete: only ever the caller, whatever the body says', async () => {
  const w = world()
  const res = await deleteAccount(post('delete-account', { token: 'tok-a', body: { confirm: 'delete', id: B, user_id: B } }), w.env, w.fetchImpl, NOW)
  assert.equal(res.status, 200)
  assert.deepEqual(w.admin.deleted, [A])
})

test('delete preflight: authenticates and checks the subscription without deleting the account', async () => {
  const w = world()
  const check = token => deleteAccount(post('delete-account', { token, body: { confirm: 'check' } }), w.env, w.fetchImpl, NOW)
  assert.equal((await check()).status, 401)

  w.table('subscriptions').push({ id: 'sub_1', user_id: A, status: 'active', source: 'stripe' })
  const refused = await check('tok-a')
  assert.equal(refused.status, 409)
  assert.deepEqual(await refused.json(), { error: 'subscription_active' })

  w.table('subscriptions')[0].status = 'canceled'
  const allowed = await check('tok-a')
  assert.equal(allowed.status, 200)
  assert.deepEqual(await allowed.json(), { allowed: true })
  assert.deepEqual(w.admin.deleted, [])
})

test('delete: an expected subject must match the verified caller before either mode proceeds', async () => {
  const w = world()
  const requests = []
  const fetchImpl = (url, ...args) => {
    requests.push(new URL(url).pathname)
    return w.fetchImpl(url, ...args)
  }
  const request = (confirm, subject) => deleteAccount(post('delete-account', { token: 'tok-a', body: { confirm, subject } }), w.env, fetchImpl)
  for (const confirm of ['check', 'delete']) {
    for (const subject of [B, null, { id: A }]) {
      const refused = await request(confirm, subject)
      assert.equal(refused.status, 403)
      assert.deepEqual(await refused.json(), { error: 'subject_mismatch' })
    }
  }
  assert.deepEqual(requests, Array(6).fill('/auth/v1/user'))
  assert.deepEqual(w.admin.deleted, [])
  assert.deepEqual(await (await request('check', A)).json(), { allowed: true })
  assert.deepEqual(await (await request('delete', A)).json(), { deleted: true })
  assert.deepEqual(w.admin.deleted, [A])
})

test('delete: refused while a subscription is still being paid for, so nobody is billed for an account that is gone', async () => {
  const w = world()
  for (const status of ['active', 'trialing', 'past_due']) {
    w.table('subscriptions').length = 0
    w.table('subscriptions').push({ id: 'sub_1', user_id: A, status, source: 'stripe' })
    const res = await deleteAccount(post('delete-account', { token: 'tok-a', body: { confirm: 'delete' } }), w.env, w.fetchImpl, NOW)
    assert.equal(res.status, 409, status)
    assert.deepEqual(await res.json(), { error: 'subscription_active' })
  }
  assert.deepEqual(w.admin.deleted, [])
  // one that has ended, or someone else's, does not stand in the way
  w.table('subscriptions').length = 0
  w.table('subscriptions').push({ id: 'sub_old', user_id: A, status: 'canceled', source: 'stripe' }, { id: 'sub_b', user_id: B, status: 'active', source: 'stripe' })
  assert.equal((await deleteAccount(post('delete-account', { token: 'tok-a', body: { confirm: 'delete' } }), w.env, w.fetchImpl, NOW)).status, 200)
})

test('delete: says so when the account could not be removed, and removes nothing by halves', async () => {
  const w = world()
  w.table('profiles').push({ id: A, display_name: 'Sam' })
  w.admin.down = true
  const res = await deleteAccount(post('delete-account', { token: 'tok-a', body: { confirm: 'delete' } }), w.env, w.fetchImpl, NOW)
  assert.equal(res.status, 502)
  assert.deepEqual(await res.json(), { error: 'upstream' })
  assert.equal(w.table('profiles').length, 1)
})

