/* Addresses the browser navigates to for the OIDC sign-in routes.
 *
 * These are full navigations (`window.location.href = ...`), never fetches: the server answers
 * every one of them with a redirect, so a script-driven request has nothing to read back that a
 * navigation would not already deliver on its own.
 *
 * Kept apart from lib/api.js, which many tests replace wholesale - a module this small has no
 * business dragging every one of those mocks along with it.
 */
import { appBase } from './app-base.js'
import { api } from './api.js'

export const oidcStartUrl = () => appBase() + 'api/oidc/start'

// The address the browser navigates to once a link ticket is minted - the ticket, not a session
// alone, is what lets this reach the provider (a proof-gated POST bought it first).
export const oidcLinkStartUrl = ticket => appBase() + 'api/oidc/link/start?ticket=' + encodeURIComponent(ticket)

// Buys a one-shot link ticket with the owner's proof; the caller then navigates to
// oidcLinkStartUrl(ticket). A refusal (already linked, provider off, a bad proof) throws.
export const requestLinkTicket = proof => api('/api/account/identities/link-ticket', { method: 'POST', body: JSON.stringify(proof) })
  .then(r => r.ticket)

// Removes the profile's linked identity with the owner's proof, returning the account state
// the way every other removal route does.
export const removeIdentity = proof => api('/api/account/identities', { method: 'DELETE', body: JSON.stringify(proof) })

// The address the browser navigates to once a proof ticket is minted - same shape as
// oidcLinkStartUrl, for the round trip that proves ownership rather than attaching an identity.
export const oidcProofStartUrl = ticket => appBase() + 'api/oidc/proof/start?ticket=' + encodeURIComponent(ticket)

// Buys a one-shot proof ticket bound to the given act; the caller then navigates to
// oidcProofStartUrl(ticket). A refusal (no linked identity, provider off, an act this instance
// does not recognise) throws. `challenge` is the phone app's own addition (its S256 PKCE
// challenge, over its Bearer session) - sent only when given, so every web caller's request body
// stays exactly what it always was.
export const requestProofTicket = (act, challenge) => api('/api/account/identities/proof-ticket', {
  method: 'POST', body: JSON.stringify(challenge ? { act, challenge } : { act })
}).then(r => r.ticket)

// A confirmation only has to be noticed - the reader already knows what they did. A sentence
// explaining a failure has to be read, so a caller showing one passes this duration to toast().
export const SENTENCE_TOAST_MS = 6000

// Peeks the identity a provider callback parked for a sign-in it has never seen before, without
// spending it - reloading the naming screen must not lose a sign-in that is still valid.
export const oidcPending = () => api('/api/oidc/pending')

// Creates the profile for that waiting identity (or resolves to the one a concurrent submission
// already created for it) and returns the signed-in user.
export const oidcConfirm = (name, code) => api('/api/oidc/confirm', {
  method: 'POST',
  body: JSON.stringify({ name, code: (code || '').trim() })
}).then(res => res.user)
