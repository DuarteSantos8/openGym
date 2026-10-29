/**
 * Remembers which change a person was confirming while the browser is away at the provider, so
 * the same sheet can reopen on return already past its proof step - the same way a passkey or
 * password proof resolves inline, without a round trip that leaves the page.
 *
 * Holds no credential and cannot confirm anything by itself: it is a hint for which sheet to
 * reopen and what draft to restore, nothing more. The server alone decides whether the round
 * trip actually proves anything (proveOwner in api/server.js).
 *
 * Kept in `sessionStorage` on purpose - this tab only, gone once the tab closes - and given the
 * same five-minute lifetime as the server's own proof ticket (api/server.js PROOF_TTL_MS), so a
 * record left behind by an abandoned attempt does not resurface a stale draft days later. Every
 * storage access is wrapped, since a browser can refuse storage access entirely (private
 * browsing, a disabled setting) and that must not crash the caller.
 */
const KEY = 'gym_pending_proof'
const MAX_AGE_MS = 5 * 60 * 1000

/**
 * @param {object} change
 * @param {string} change.act Which change the proof is for.
 * @param {*} [change.draft] Whatever the sheet needs to restore itself on return.
 * @param {object} [opts]
 * @param {Storage} [opts.storage] Defaults to `sessionStorage`.
 * @param {number} [opts.now] Defaults to `Date.now()`.
 */
export function rememberProof({ act, draft }, { storage = globalThis.sessionStorage, now = Date.now() } = {}) {
  try { storage.setItem(KEY, JSON.stringify({ act, draft, at: now })) } catch { /* no storage, or it refused - nothing to reopen on return */ }
}

/**
 * Returns the remembered change once, and clears it whether or not it is still valid - a spent
 * or malformed record must not be handed out again on a second call.
 *
 * @param {object} [opts]
 * @param {Storage} [opts.storage] Defaults to `sessionStorage`.
 * @param {number} [opts.now] Defaults to `Date.now()`.
 * @returns {{act: string, draft: *}|null}
 */
export function recallProof({ storage = globalThis.sessionStorage, now = Date.now() } = {}) {
  let raw
  try { raw = storage.getItem(KEY) } catch { return null }
  if (raw == null) return null
  try { storage.removeItem(KEY) } catch { /* best effort - the record is treated as spent either way */ }
  let record
  try { record = JSON.parse(raw) } catch { return null }
  if (!record || typeof record !== 'object' || typeof record.act !== 'string' || typeof record.at !== 'number') return null
  if (now - record.at > MAX_AGE_MS) return null
  return { act: record.act, draft: record.draft }
}

/**
 * @param {object} [opts]
 * @param {Storage} [opts.storage] Defaults to `sessionStorage`.
 */
export function forgetProof({ storage = globalThis.sessionStorage } = {}) {
  try { storage.removeItem(KEY) } catch { /* nothing to clear */ }
}
