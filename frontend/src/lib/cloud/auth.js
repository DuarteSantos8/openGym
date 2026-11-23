// Accounts in the Cloud edition (docs/next/adr/0010-backend-hybrid.md, 0013): sign up, sign in,
// stay signed in, reset a password, and approve a sign-in to the app's own server.
//
// Written against the hosted auth service's REST interface with fetch alone, like the Edge
// Functions (supabase/functions/_shared): no SDK, so nothing here depends on a library version,
// the bundle gains a few kilobytes instead of a few hundred, and every path is tested against a
// pretend server (auth.test.js) and a real project (supabase/tests/live.test.mjs).
//
//   - Only the PUBLISHABLE key is ever used here. It is public by design: what a visitor may do
//     with it is decided by the project's row level security, not by keeping the key quiet.
//   - The session (access token, refresh token, who) is kept in this browser's storage, as any
//     single-page app must. Signing out forgets it at once, reachable server or not.
//   - An error carries a code for the screen to word (invalid_credentials, weak_password, …),
//     never the server's sentence, a password or a token.
//
// Loaded only through import() behind isCloud() (lib/edition.js): never in the default build.

export const SESSION_KEY = 'gym_cloud_session_v1'
/** Swap the access token this long before it runs out, so a request in flight never carries a dead one. */
const REFRESH_EARLY_MS = 60_000
const LINK_TYPES = new Set(['signup', 'recovery', 'email', 'magiclink', 'invite', 'email_change'])
/** The refresh token is finished: sign out. Anything else (a blip, a 500) keeps the session. */
const DEAD_REFRESH = new Set(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired', 'user_not_found', 'user_banned', 'bad_jwt'])

export class CloudAuthError extends Error {
  constructor(code, status = 0) { super(code); this.name = 'CloudAuthError'; this.code = code; this.status = status }
}

const isLoopback = host => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * The project's address and public key from a build's environment, or null when the build has
 * none (then there is no cloud sign-in to offer). A secret key is refused outright: it must
 * never be in a browser, and a build that was handed one should fail to sign in, loudly.
 */
export function cloudConfig(env) {
  const raw = env?.VITE_SUPABASE_URL, key = env?.VITE_SUPABASE_PUBLISHABLE_KEY
  if (typeof raw !== 'string' || typeof key !== 'string' || !raw || !key) return null
  if (/^sb_secret_/.test(key)) return null
  let u
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback(u.hostname))) return null
  return { url: raw.replace(/\/+$/, ''), key }
}

const cleanEmail = v => String(v ?? '').trim().toLowerCase()
const safeId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)

/** What is kept of a token answer: nothing the app does not use. */
function sessionOf(body, now) {
  if (!body || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || !body.user || typeof body.user.id !== 'string') return null
  const life = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Number(body.expires_at) > 0 && !body.expires_in ? Number(body.expires_at) * 1000 : now + life * 1000,
    user: { id: body.user.id, email: typeof body.user.email === 'string' ? body.user.email : '' },
  }
}

function readStored(storage) {
  try {
    const s = JSON.parse(storage.getItem(SESSION_KEY) || 'null')
    if (!s || typeof s.access_token !== 'string' || typeof s.refresh_token !== 'string' || typeof s.expires_at !== 'number' || typeof s.user?.id !== 'string') return null
    return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: { id: s.user.id, email: typeof s.user.email === 'string' ? s.user.email : '' } }
  } catch { return null }
}

export function createAuth({ url, key, fetchImpl = (...a) => globalThis.fetch(...a), storage = globalThis.localStorage, now = () => Date.now() }) {
  const base = String(url).replace(/\/+$/, '') + '/auth/v1'
  let current = readStored(storage)
  let refreshing = null
  // Goes up whenever who is signed in changes on purpose (sign in, sign out, a link). A refresh
  // that was already on its way when that happened belongs to the past and is thrown away.
  let epoch = 0
  const listeners = new Set()

  const keep = s => {
    current = s
    try { if (s) storage.setItem(SESSION_KEY, JSON.stringify(s)); else storage.removeItem(SESSION_KEY) } catch { /* private mode: the session lasts as long as the page */ }
    for (const fn of listeners) { try { fn(s) } catch { /* a listener's fault is its own */ } }
    return s
  }

  /** One request. Resolves with the parsed answer, rejects with a CloudAuthError and nothing else. */
  async function call(method, path, { body, token } = {}) {
    let res
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new CloudAuthError('network') }
    let data = null
    try { data = await res.json() } catch { data = null }
    if (res.ok) return data ?? {}
    const code = typeof data?.error_code === 'string' && /^[a-z0-9_]{1,64}$/.test(data.error_code) ? data.error_code : 'unknown'
    throw new CloudAuthError(code, res.status)
  }

  const withRedirect = (path, redirectTo) => (redirectTo ? `${path}?redirect_to=${encodeURIComponent(redirectTo)}` : path)
  const signedIn = () => { if (!current) throw new CloudAuthError('not_signed_in'); return current }

  /** A token good for at least a minute, refreshing if need be; null when nobody is signed in. */
  async function fresh() {
    if (!current) return null
    if (current.expires_at - now() > REFRESH_EARLY_MS) return current.access_token
    refreshing ||= (async () => {
      const at = epoch
      try {
        const s = sessionOf(await call('POST', '/token?grant_type=refresh_token', { body: { refresh_token: current.refresh_token } }), now())
        // Signed out, or someone else signed in, while this was on its way: it must not undo that.
        if (epoch !== at) return current?.access_token ?? null
        if (!s) throw new CloudAuthError('unknown')
        return keep(s).access_token
      } catch (e) {
        if (epoch !== at) return current?.access_token ?? null
        if (e instanceof CloudAuthError && DEAD_REFRESH.has(e.code)) { keep(null); return null }
        throw e
      } finally { refreshing = null }
    })()
    return refreshing
  }

  return {
    /** Who is signed in on this device, or null. Synchronous: from memory, loaded from storage. */
    session: () => current,
    /** Calls `fn(session | null)` on every change. Returns the function that stops it. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    fresh,

    async signIn(email, password) {
      const s = sessionOf(await call('POST', '/token?grant_type=password', { body: { email: cleanEmail(email), password: String(password ?? '') } }), now())
      if (!s) throw new CloudAuthError('unknown')
      epoch++
      return keep(s)
    },

    /** `{ session, needsConfirmation }`: with email confirmation on there is no session until the link is followed. */
    async signUp(email, password, { redirectTo } = {}) {
      const body = await call('POST', withRedirect('/signup', redirectTo), { body: { email: cleanEmail(email), password: String(password ?? '') } })
      const s = sessionOf(body, now())
      if (s) epoch++
      return s ? { session: keep(s), needsConfirmation: false } : { session: null, needsConfirmation: true }
    },

    async signOut() {
      const token = current?.access_token
      epoch++
      keep(null)
      if (token) { try { await call('POST', '/logout?scope=local', { token }) } catch { /* already signed out here, which is what was asked */ } }
    },

    /** Sends the reset email. Resolves the same whether or not the address has an account. */
    async recover(email, { redirectTo } = {}) {
      await call('POST', withRedirect('/recover', redirectTo), { body: { email: cleanEmail(email) } })
    },

    /** The hash from a confirmation or reset link, traded for a session. */
    async verify({ type, tokenHash }) {
      if (!LINK_TYPES.has(type) || typeof tokenHash !== 'string' || !tokenHash) throw new CloudAuthError('validation_failed')
      const s = sessionOf(await call('POST', '/verify', { body: { type, token_hash: tokenHash } }), now())
      if (!s) throw new CloudAuthError('unknown')
      epoch++
      return keep(s)
    },

    async updatePassword(password) {
      signedIn()
      await call('PUT', '/user', { body: { password: String(password ?? '') }, token: await fresh() })
    },

    /** What a pending sign-in to the app's own server is asking for (the hosted OAuth server, ADR 0013). */
    async authorization(id) {
      signedIn()
      if (!safeId(id)) throw new CloudAuthError('validation_failed')
      return call('GET', `/oauth/authorizations/${id}`, { token: await fresh() })
    },

    /** Approve or refuse it. `{ redirectTo }` is where the browser must go next. */
    async consent(id, approve) {
      signedIn()
      if (!safeId(id)) throw new CloudAuthError('validation_failed')
      const out = await call('POST', `/oauth/authorizations/${id}/consent`, { body: { action: approve ? 'approve' : 'deny' }, token: await fresh() })
      return { redirectTo: typeof out?.redirect_url === 'string' ? out.redirect_url : null }
    },
  }
}
