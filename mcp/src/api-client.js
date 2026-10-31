/* The one way the MCP server writes: through the openGym api, as the app's own devices do.
   Reads stay on the data directory (state.js). A write goes over HTTP because PUT /api/data is
   the only place a profile's document is compared and written in one step — a second process
   renaming the same file underneath it has no lock to take, so a phone's push landing in between
   would be lost — and because that route is what stamps a change so every device's next merge
   keeps it (api/sync-stamps.js names "an API client" as one of the writers it stamps for).

   The credential is a paired session (scripts/pair.mjs): the same token the phone app holds,
   good for SESSION_DAYS and revoked by "Sign out everywhere". It is a full sign-in to the
   profile, so it only ever travels over https — plain http to this machine aside, the exception
   passkeys make too — and it is never put into a result or an error message. */

import { loadCredentials } from './credentials.js'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
// *.localhost is this machine by definition (RFC 6761): a dev proxy such as Traefik serves
// openGym at opengym.docker.localhost, and passkeys treat it the same way.
const isThisMachine = host => LOOPBACK.has(host) || host.endsWith('.localhost')
// What a session token is made of (api/server.js makeSession: `uid:exp:ver` and a base64url MAC).
// Checked before it goes into a header, because the header check's own error quotes the value.
const TOKEN_CHARS = /^[A-Za-z0-9._:~+/=-]+$/
const TIMEOUT_MS = 15000

function fail(code, message, extra) {
  const err = new Error(message)
  err.code = code
  if (extra) Object.assign(err, extra)
  return err
}

/** The server's base URL, checked: https, or http to this machine. Throws ENOCONFIG. */
export function apiBase(raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch {
    throw fail('ENOCONFIG', 'OPENGYM_URL is not a URL: the address you open openGym at, e.g. https://gym.example.com')
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isThisMachine(u.hostname))) {
    throw fail('ENOCONFIG', 'OPENGYM_URL must be https:// (plain http only for localhost or *.localhost): the token it carries is a full sign-in to your profile')
  }
  // A subpath install (/gym) keeps its path; the routes hang off it.
  return u.origin + u.pathname.replace(/\/+$/, '')
}

/** { base, token } from the environment, else from the file pair_opengym wrote; ENOCONFIG saying what to do. */
export function apiConfig(env = process.env) {
  const saved = loadCredentials(env)
  const url = (env.OPENGYM_URL || '').trim() || saved?.url || ''
  const token = (env.OPENGYM_TOKEN || '').trim() || saved?.token || ''
  if (!url || !token) {
    throw fail('ENOCONFIG', 'this MCP server is not paired with your openGym server yet: in the app open Settings, Account, "Pair the mobile app", and give the code it shows to the pair_opengym tool (or set OPENGYM_URL and OPENGYM_TOKEN in this server\'s config: mcp/README.md, "Pairing")')
  }
  if (!TOKEN_CHARS.test(token)) {
    throw fail('ENOCONFIG', 'the paired token has characters a token never has (a line break or space from copying it?): pair again with pair_opengym')
  }
  return { base: apiBase(url), token }
}

/**
 * Turn a pairing code into { token, user }: POST /api/pair/redeem, which needs no session because
 * the code is the credential (one use, five minutes). Never followed to a redirect, which would
 * replay the code elsewhere. Throws EPAIR for a code the server refuses, EAPI for anything else.
 */
export async function redeemPairingCode(base, code, { timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let res
  try {
    res = await fetchImpl(base + '/api/pair/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : (e?.cause?.code || e?.name || 'network error')
    throw fail('EAPI', `could not reach the openGym server at ${base} (${why})`)
  }
  if (res.status >= 300 && res.status < 400) {
    throw fail('EAPI', `the openGym server at ${base} redirects (${res.status}); give the address openGym is actually served at`, { status: res.status })
  }
  const data = await res.json().catch(() => null)
  if (res.status === 400) throw fail('EPAIR', 'that code is wrong, already used or expired (they last five minutes and work once): make a new one in the app')
  if (!res.ok || typeof data?.token !== 'string' || !data.token) throw fail('EAPI', `the openGym server answered ${res.status}`, { status: res.status })
  if (!TOKEN_CHARS.test(data.token)) throw fail('EAPI', 'the server sent back a token in a form no openGym token has; nothing was saved')
  return { token: data.token, user: data.user || null }
}

/**
 * One request. Resolves { status, body } for 2xx and 409 (a conflict is the caller's to merge);
 * throws EAUTH, ETOOBIG, EAPI otherwise. `fetchImpl` is for tests.
 */
export async function apiFetch(cfg, path, { method = 'GET', body, timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = {}) {
  let res
  try {
    res = await fetchImpl(cfg.base + path, {
      method,
      headers: { authorization: 'Bearer ' + cfg.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      // Never followed: a redirect to http:// or to another host would replay the profile (or,
      // pairing, the code) there, whatever OPENGYM_URL promised.
      redirect: 'manual',
    })
  } catch (e) {
    // Only a code or a name, never the exception's text: some of them quote what was sent.
    const why = e?.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : (e?.cause?.code || e?.name || 'network error')
    throw fail('EAPI', `could not reach the openGym server at ${cfg.base} (${why})`)
  }
  if (res.status >= 300 && res.status < 400) {
    throw fail('EAPI', `the openGym server at ${cfg.base} redirects (${res.status}); set OPENGYM_URL to the https address openGym is actually served at`, { status: res.status })
  }
  let data = null
  try { data = await res.json() } catch { /* an HTML error page from a proxy: the status says enough */ }
  if (res.ok || res.status === 409) return { status: res.status, body: data }
  if (res.status === 401) throw fail('EAUTH', 'the openGym server did not accept OPENGYM_TOKEN: it expired or was signed out everywhere. Pair again with the pair_opengym tool.')
  if (res.status === 413) throw fail('ETOOBIG', 'the profile is larger than the server accepts in one write (MAX_BODY); nothing was saved')
  const said = data && typeof data.error === 'string' ? `: ${data.error.slice(0, 200)}` : ''
  throw fail('EAPI', `the openGym server answered ${res.status}${said}`, { status: res.status })
}
