/* The phone app's own half of sign-in through the server's provider.
 *
 * A web browser cannot hold state across the full-page redirect a provider round trip makes, so
 * the server keeps a PKCE verifier for it. The phone app is a long-lived process instead: it can
 * hold its own verifier from the moment it leaves for the system browser until the moment it
 * comes back, which is what makes the one-shot return code useless to anyone who only intercepted
 * the redirect. Everything in this file is that: generating the verifier, deriving its S256
 * challenge, remembering the attempt while the system browser is away, and turning a return
 * address back into a token by presenting the verifier the server never saw until now.
 *
 * Framework-free and storage-injectable throughout, like every other pure helper in this
 * directory, so a test can drive it against an in-memory Storage without touching localStorage.
 */

// Where the one attempt this phone can have in flight lives while the system browser is away.
export const ATTEMPT_KEY = 'gym_oidc_app_attempt'
// Long enough to survive a slow provider and the app being backgrounded for a while; short enough
// that an attempt nobody finished is not still offered to a return address days later.
export const ATTEMPT_MAX_AGE_MS = 5 * 60 * 1000

const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * A fresh RFC 7636 verifier: 32 random bytes, base64url, 43 characters - the same shape and
 * encoding api/oidc/flow.js's own pkcePair() uses server-side, generated here with WebCrypto
 * instead of Node's crypto module.
 */
export function newVerifier(cryptoImpl = globalThis.crypto) {
  return b64u(cryptoImpl.getRandomValues(new Uint8Array(32)))
}

/**
 * The S256 challenge for a verifier: the base64url SHA-256 digest of its exact characters, via
 * crypto.subtle rather than Node's crypto module - the one primitive available in a WebView.
 */
export async function challengeFor(verifier, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64u(new Uint8Array(digest))
}

/**
 * Reads a return address (opengym://oidc?code=... or ?err=...) into { code } | { err } | null.
 * Anything but exactly this scheme and host is not a return this app made - null, so a caller
 * never redeems a code addressed at some other custom-scheme handler two apps happen to share.
 */
export function parseAppReturn(url) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'opengym:' || u.host !== 'oidc') return null
  const code = u.searchParams.get('code')
  if (code && /^[A-Za-z0-9_-]{16,128}$/.test(code)) return { code }
  const err = u.searchParams.get('err')
  if (err && /^[a-z-]{1,40}$/.test(err)) return { err }
  return null
}

/**
 * The address a departure navigates to: the server's own app-flavoured start route. A sign-in
 * carries this phone's own PKCE challenge; a link or a proof carries the ticket a Bearer-session
 * request already minted (that ticket itself carries the challenge, bought over the session the
 * system browser has none of).
 */
export function appStartUrl(base, mode, { challenge, ticket } = {}) {
  if (mode === 'link') return base + '/api/oidc/app/link/start?ticket=' + encodeURIComponent(ticket)
  if (mode === 'proof') return base + '/api/oidc/app/proof/start?ticket=' + encodeURIComponent(ticket)
  return base + '/api/oidc/app/start?challenge=' + encodeURIComponent(challenge)
}

/**
 * Begins one attempt: generates a fresh verifier, derives its challenge, and remembers both (with
 * the server base and what this attempt is for) until the return arrives. Replaces any earlier
 * attempt outright - a phone only ever has one departure in flight, and starting a new one makes
 * the previous verifier worthless anyway, since its own return address is now stale.
 */
export async function beginAttempt({ base, mode, act }, { storage = globalThis.localStorage, now = Date.now, cryptoImpl = globalThis.crypto } = {}) {
  const verifier = newVerifier(cryptoImpl)
  const challenge = await challengeFor(verifier, cryptoImpl)
  try { storage.setItem(ATTEMPT_KEY, JSON.stringify({ base, mode, act, verifier, at: now() })) } catch { /* best effort */ }
  return { challenge }
}

function readAttempt(storage, now) {
  let raw
  try { raw = storage.getItem(ATTEMPT_KEY) } catch { return null }
  if (!raw) return null
  let attempt
  try { attempt = JSON.parse(raw) } catch { return null }
  if (!attempt || typeof attempt.verifier !== 'string' || typeof attempt.base !== 'string' || typeof attempt.at !== 'number') return null
  if (now() - attempt.at > ATTEMPT_MAX_AGE_MS) return null
  return attempt
}

/** The attempt this phone is holding, without spending it - for a caller that only needs to peek. */
export function peekAttempt({ storage = globalThis.localStorage, now = Date.now } = {}) {
  return readAttempt(storage, now)
}

/** The attempt this phone is holding, and clears it: a return is answered at most once. */
export function takeAttempt({ storage = globalThis.localStorage, now = Date.now } = {}) {
  const attempt = readAttempt(storage, now)
  try { storage.removeItem(ATTEMPT_KEY) } catch { /* best effort */ }
  return attempt
}

/**
 * Turns a return address into an outcome, spending whatever attempt this phone is holding:
 * - `{ kind: 'none' }` when the URL is not a return this app made, or no attempt is held at all -
 *   `redeem` is never called, so a link someone else sends this phone signs nobody in.
 * - `{ kind: 'failed', mode, code }` for an `err=` return, when `redeem` itself throws (the
 *   thrown error's `data.code` or `code`, whichever the caller's redeem wrapper attaches), or when
 *   it answers something carrying neither a token nor a confirmation (code 'bad-response').
 * - `{ kind: 'signed-in', base, token, user }` when the answer carries both.
 * - `{ kind: 'confirm', base, handle, name, invite }` when the answer carries a confirmation
 *   instead - an identity nobody has linked yet, waiting for this phone's own naming screen.
 * - `{ kind: 'linked' }` when the answer confirms the identity was attached.
 * - `{ kind: 'proof', act, proof }` when the answer carries a one-shot proof id, with the act it
 *   was requested for carried on this phone's own attempt (never off the return address itself).
 */
export async function finishAppReturn(url, { redeem, storage = globalThis.localStorage, now = Date.now } = {}) {
  const ret = parseAppReturn(url)
  if (!ret) return { kind: 'none' }
  const attempt = takeAttempt({ storage, now })
  if (!attempt) return { kind: 'none' }
  if (ret.err) return { kind: 'failed', mode: attempt.mode, code: ret.err }
  try {
    const answer = await redeem(attempt.base, { code: ret.code, verifier: attempt.verifier }, attempt)
    if (answer && answer.token && answer.user) return { kind: 'signed-in', base: attempt.base, token: answer.token, user: answer.user }
    if (answer && answer.confirm) {
      return { kind: 'confirm', base: attempt.base, handle: answer.confirm.handle, name: answer.confirm.name, invite: answer.confirm.invite }
    }
    if (answer && answer.linked) return { kind: 'linked' }
    if (answer && answer.proof) return { kind: 'proof', act: attempt.act, proof: answer.proof }
    return { kind: 'failed', mode: attempt.mode, code: 'bad-response' }
  } catch (e) {
    return { kind: 'failed', mode: attempt.mode, code: e.data?.code || e.code }
  }
}
