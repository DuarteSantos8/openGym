// From a Stripe subscription to what the account may use (docs/next/adr/0011-payments-iap.md).
// Pure: the webhook re-reads the subscription from Stripe and hands it here, so the answer never
// depends on the order events arrived in.
//
//   active, trialing        Pro, until the period ends
//   past_due                Pro until the period that was paid for ends: a failed card is a
//                           reminder to fix the card, not an instant lock-out
//   canceled, unpaid,
//   incomplete(_expired),
//   paused, anything else   nothing
//
// Stripe moved `current_period_end` from the subscription onto its items in 2025; both are read.

export const FEATURE_PRO = 'pro'
const LIVE = new Set(['active', 'trialing', 'past_due'])

/** When the paid period ends, in seconds since the epoch, or null when the subscription does not say. */
export function periodEndOf(sub) {
  const top = Number(sub?.current_period_end)
  if (Number.isFinite(top) && top > 0) return top
  const ends = (sub?.items?.data || []).map(i => Number(i?.current_period_end)).filter(n => Number.isFinite(n) && n > 0)
  return ends.length ? Math.max(...ends) : null
}

/** The Supabase user a subscription belongs to: written into its metadata at checkout. */
export const userIdOf = sub => {
  const id = sub?.metadata?.supabase_user_id
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null
}

const iso = sec => (sec == null ? null : new Date(sec * 1000).toISOString())

/** The row for public.subscriptions. */
export function subscriptionRow(sub, userId) {
  return {
    id: sub.id,
    user_id: userId,
    status: String(sub.status || ''),
    price_id: sub?.items?.data?.[0]?.price?.id || null,
    current_period_end: iso(periodEndOf(sub)),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    source: 'stripe',
  }
}

const endSecOf = row => (row?.current_period_end ? Date.parse(row.current_period_end) / 1000 : null)

/** Whether one public.subscriptions row grants anything at `nowSec`. */
export function rowIsLive(row, nowSec = Math.floor(Date.now() / 1000)) {
  if (!row || !LIVE.has(row.status)) return false
  // A past-due subscription keeps what was paid for, and nothing beyond it.
  if (row.status === 'past_due') { const end = endSecOf(row); return end != null && end > nowSec }
  return true
}

/**
 * The rows for public.entitlements that all of a user's subscription rows grant together at
 * `nowSec` (none when none is live). Computed from every row, not from the one that just changed,
 * so cancelling a second subscription can never take away what the first still pays for.
 * `features` are the feature names the product stands for. The entitlement runs to the latest
 * period end among the live rows; with no end known it has none.
 */
export function entitlementRows(subscriptionRows, userId, { features = [FEATURE_PRO], nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!userId) return []
  const live = (Array.isArray(subscriptionRows) ? subscriptionRows : []).filter(r => r?.user_id === userId && rowIsLive(r, nowSec))
  if (!live.length) return []
  const ends = live.map(endSecOf)
  const end = ends.some(e => e == null) ? null : Math.max(...ends)
  return features.map(feature => ({ user_id: userId, feature, source: 'stripe', expires_at: iso(end) }))
}

/** The features in a list of entitlement rows that are live at `nowSec`, each once, sorted. */
export function liveFeatures(rows, nowSec = Math.floor(Date.now() / 1000)) {
  const out = new Set()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.feature !== 'string') continue
    if (r.expires_at == null || Date.parse(r.expires_at) / 1000 > nowSec) out.add(r.feature)
  }
  return [...out].sort()
}
