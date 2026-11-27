// The four Edge Functions, as plain functions of (request, env, fetch): each index.ts is three
// lines that hand these the real ones. Written without an SDK on purpose (web-standard fetch and
// crypto only), so `node --test supabase/tests` runs every path against a fake Stripe and a fake
// database, and nothing here depends on a library version.
//
// env:
//   SUPABASE_URL                 the project URL
//   SUPABASE_SECRET_KEY          the secret (service role) key; SUPABASE_SERVICE_ROLE_KEY is read too
//   STRIPE_SECRET_KEY            sk_…
//   STRIPE_WEBHOOK_SECRET        whsec_… of this endpoint
//   STRIPE_PRICE_IDS             the price ids checkout may sell, comma-separated
//   APP_ORIGIN                   the web app's origin, e.g. https://app.example: CORS and return URLs
//   ENTITLEMENT_SIGNING_JWK      the private P-256 JWK that signs entitlement tokens
//
// Nothing secret is ever put in a response, a URL or a log line.
import { verifyStripeEvent, stripeRequest, StripeSignatureError } from './stripe.js'
import { subscriptionRow, entitlementRows, liveFeatures, userIdOf } from './entitlements.js'
import { signEntitlement, TOKEN_TTL_SEC } from './token.js'

import { secretKey, cors, json, fail, database, q, enter } from './http.js'

const priceAllowed = (env, id) => typeof id === 'string' && String(env.STRIPE_PRICE_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(id)
const appUrl = (env, hash) => String(env.APP_ORIGIN).replace(/\/+$/, '') + '/#' + hash

/** POST { priceId } → { url }: a Stripe Checkout page for a subscription to one of the allowed prices. */
export async function createCheckoutSession(req, env, fetchImpl = fetch, nowMs = Date.now()) {
  const { response, user } = await enter(req, env, fetchImpl)
  if (response) return response
  // A guest session has no email to bill and nothing to restore a purchase to.
  if (user.anonymous) return fail(env, 403, 'account-required')
  const body = await req.json().catch(() => null)
  const priceId = body?.priceId
  if (!priceAllowed(env, priceId)) return fail(env, 400, 'price')
  const db = database(env, fetchImpl)
  const live = await db.select('subscriptions', `select=id,status&user_id=eq.${q(user.id)}&status=in.(active,trialing,past_due)`)
  if (live.length) return fail(env, 409, 'already-subscribed')

  let customerId = (await db.select('customers', `select=stripe_customer_id&user_id=eq.${q(user.id)}`))[0]?.stripe_customer_id
  if (!customerId) {
    const customer = await stripeRequest('POST', '/v1/customers', {
      key: env.STRIPE_SECRET_KEY, fetchImpl, idempotencyKey: 'customer-' + user.id,
      params: { email: user.email, metadata: { supabase_user_id: user.id } },
    })
    customerId = customer.id
    await db.upsert('customers', [{ user_id: user.id, stripe_customer_id: customerId }], 'user_id')
  }
  // The same tap twice within ten minutes gets the same page, not a second one.
  const bucket = Math.floor(nowMs / 600000)
  const session = await stripeRequest('POST', '/v1/checkout/sessions', {
    key: env.STRIPE_SECRET_KEY, fetchImpl, idempotencyKey: `checkout-${user.id}-${priceId}-${bucket}`,
    params: {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { supabase_user_id: user.id } },
      allow_promotion_codes: true,
      success_url: appUrl(env, '/settings?checkout=done'),
      cancel_url: appUrl(env, '/settings?checkout=cancelled'),
    },
  })
  return json(env, 200, { url: session.url })
}

/** POST → { url }: the Stripe Customer Portal for the caller's own customer. */
export async function createPortalSession(req, env, fetchImpl = fetch) {
  const { response, user } = await enter(req, env, fetchImpl)
  if (response) return response
  const db = database(env, fetchImpl)
  const customerId = (await db.select('customers', `select=stripe_customer_id&user_id=eq.${q(user.id)}`))[0]?.stripe_customer_id
  if (!customerId) return fail(env, 404, 'no-customer')
  const session = await stripeRequest('POST', '/v1/billing_portal/sessions', {
    key: env.STRIPE_SECRET_KEY, fetchImpl, params: { customer: customerId, return_url: appUrl(env, '/settings') },
  })
  return json(env, 200, { url: session.url })
}

/** POST → { token, features, exp }: the signed note the app keeps for offline checks. */
export async function entitlementToken(req, env, fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  const { response, user } = await enter(req, env, fetchImpl)
  if (response) return response
  const db = database(env, fetchImpl)
  const rows = await db.select('entitlements', `select=feature,expires_at&user_id=eq.${q(user.id)}`)
  const features = liveFeatures(rows, nowSec)
  const token = await signEntitlement({ sub: user.id, features, nowSec }, JSON.parse(env.ENTITLEMENT_SIGNING_JWK))
  return json(env, 200, { token, features, exp: nowSec + TOKEN_TTL_SEC })
}

// The subscription a webhook event is about, whichever object it carries.
function subscriptionIdOf(event) {
  const o = event?.data?.object || {}
  if (event.type.startsWith('customer.subscription.')) return o.id || null
  if (event.type === 'checkout.session.completed') return typeof o.subscription === 'string' ? o.subscription : o.subscription?.id || null
  if (event.type.startsWith('invoice.')) {
    const s = o.subscription ?? o.parent?.subscription_details?.subscription
    return typeof s === 'string' ? s : s?.id || null
  }
  return null
}

const HANDLED = /^(checkout\.session\.completed|customer\.subscription\.(created|updated|deleted|paused|resumed)|invoice\.(paid|payment_failed))$/

/* Brings one subscription's row and its owner's entitlements in line with what Stripe says now. */
async function syncSubscription(subId, env, fetchImpl, db, nowSec) {
  const sub = await stripeRequest('GET', '/v1/subscriptions/' + q(subId), { key: env.STRIPE_SECRET_KEY, fetchImpl })
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  const userId = userIdOf(sub) || (customerId ? (await db.select('customers', `select=user_id&stripe_customer_id=eq.${q(customerId)}`))[0]?.user_id : null)
  // A subscription made outside the app (in the dashboard, say) belongs to nobody here.
  if (!userId) return 'orphan'
  if (customerId) await db.upsert('customers', [{ user_id: userId, stripe_customer_id: customerId }], 'user_id')
  await db.upsert('subscriptions', [subscriptionRow(sub, userId)], 'id')
  const all = await db.select('subscriptions', `select=user_id,status,current_period_end&user_id=eq.${q(userId)}`)
  const grants = entitlementRows(all, userId, { nowSec })
  // Grant first, then take away what is no longer granted: an account that stays Pro is never
  // without its entitlement for the length of two requests.
  if (grants.length) {
    await db.upsert('entitlements', grants, 'user_id,feature,source')
    await db.remove('entitlements', `user_id=eq.${q(userId)}&source=eq.stripe&feature=not.in.(${grants.map(g => q(g.feature)).join(',')})`)
  } else {
    await db.remove('entitlements', `user_id=eq.${q(userId)}&source=eq.stripe`)
  }
  return 'synced'
}

/**
 * Stripe's webhook. The signature is checked on the raw body before anything else. Each event id
 * is written down first; one already finished answers 200 without acting, one written down but
 * not finished (a crash half way) is done again, which is safe because the work is "make the rows
 * match Stripe", not "apply this change". Stripe is re-read every time, so events that arrive
 * out of order end in the same place. A failure answers 500 and Stripe sends the event again.
 */
export async function stripeWebhook(req, env, fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  if (req.method !== 'POST') return new Response('method', { status: 405 })
  const raw = await req.text()
  let event
  try { event = await verifyStripeEvent(raw, req.headers.get('stripe-signature') || '', env.STRIPE_WEBHOOK_SECRET, { nowSec }) }
  catch (e) { return new Response(e instanceof StripeSignatureError ? e.code : 'signature', { status: 400 }) }

  const db = database(env, fetchImpl)
  const fresh = await db.insertOnce('webhook_events', { id: event.id, type: event.type })
  if (!fresh) {
    const seen = (await db.select('webhook_events', `select=processed_at&id=eq.${q(event.id)}`))[0]
    if (seen?.processed_at) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  let outcome = 'ignored'
  if (HANDLED.test(event.type)) {
    const subId = subscriptionIdOf(event)
    if (subId) outcome = await syncSubscription(subId, env, fetchImpl, db, nowSec)
  }
  await db.update('webhook_events', `id=eq.${q(event.id)}`, { processed_at: new Date(nowSec * 1000).toISOString() })
  return new Response(JSON.stringify({ received: true, outcome }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// Account export and deletion live in ./account.js; re-exported so one import still finds everything.
export { exportAccount, deleteAccount } from './account.js'
