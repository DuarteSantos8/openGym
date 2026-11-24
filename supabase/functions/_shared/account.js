// The account itself: take your data with you, or take the account away (EP19-T06).
// Every path is in supabase/tests/handlers.test.mjs, and both run against a real project in
// supabase/tests/live-account.test.mjs.
import { secretKey, json, fail, database, q, enter } from './http.js'

/**
 * "Give me my data": the caller's own rows from every table that has any, as one JSON document.
 * Training data is not here to give: it lives in the app's own server, which has its own export.
 * The payment provider's id for the customer is left out; it identifies them to the provider,
 * not to themselves.
 */
export async function exportAccount(req, env, fetchImpl = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  const { response, user } = await enter(req, env, fetchImpl)
  if (response) return response
  const db = database(env, fetchImpl)
  const id = q(user.id)
  const [profiles, subscriptions, entitlements] = await Promise.all([
    db.select('profiles', `select=display_name,experience,node_uid,created_at,updated_at&id=eq.${id}`),
    db.select('subscriptions', `select=id,status,price_id,current_period_end,cancel_at_period_end,source,updated_at&user_id=eq.${id}`),
    db.select('entitlements', `select=feature,source,expires_at,updated_at&user_id=eq.${id}`),
  ])
  return json(env, 200, {
    exported_at: new Date(nowSec * 1000).toISOString(),
    account: { id: user.id, email: user.email },
    profile: profiles[0] || null,
    subscriptions, entitlements,
  })
}

/** A subscription in one of these states is still being charged for, or about to be. */
const BILLING = ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']

/**
 * "Delete my account": the auth user, and with it every row that refers to them (each table's
 * `on delete cascade`). Always the caller, never an id from the body. Needs `{ confirm: "delete" }`
 * so a stray request cannot do it, and is refused while a subscription is still running: the
 * account is what a later refund or cancellation would be looked up by, so that comes first.
 */
export async function deleteAccount(req, env, fetchImpl = fetch) {
  const { response, user } = await enter(req, env, fetchImpl)
  if (response) return response
  const body = await req.json().catch(() => null)
  if (body?.confirm !== 'delete') return fail(env, 400, 'confirm')
  const db = database(env, fetchImpl)
  const running = await db.select('subscriptions', `select=id&user_id=eq.${q(user.id)}&status=in.(${BILLING.join(',')})`)
  if (running.length) return fail(env, 409, 'subscription_active')
  const key = secretKey(env)
  const res = await fetchImpl(String(env.SUPABASE_URL).replace(/\/+$/, '') + '/auth/v1/admin/users/' + q(user.id), { method: 'DELETE', headers: { apikey: key, Authorization: 'Bearer ' + key } })
  if (!res.ok) return fail(env, 502, 'upstream')
  return json(env, 200, { deleted: true })
}

