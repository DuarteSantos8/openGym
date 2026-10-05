/* Whether an identity token is genuine. This is the security boundary of OIDC sign-in.

   Everything upstream of here is attacker-controlled: anyone at all can post a string that looks
   like an identity token, and until this function returns nothing about it has been established.
   Everything downstream treats what it returns as a verified identity. So the module is pure --
   no environment, no file, no network, no timer, no module-level state, and the clock is handed
   in -- which is what makes the whole decision assertable from a test rather than from clicking.

   The library does the cryptography and the registered claims. Three checks it deliberately
   leaves to the caller are ours: the nonce that ties a token to the sign-in attempt that asked
   for it, an extra audience the token names without being authorised to this one, and how far in
   the past the issued-at claim may be -- the last one only happens at all because a maximum token
   age is set, since with no bound the library never looks at that claim and accepts a token
   issued well in the future.

   The algorithm allowlist below is a closed list, and every symmetric algorithm and the unsigned
   case are absent from it ON PURPOSE. The specification makes the client secret the key for a
   symmetric algorithm, so accepting one would turn a leaked secret into the ability to forge any
   token at all. Adding a member here is a deliberate act; there is no default case anywhere.

   Refusals are sentences a person can act on, built from the library's error codes. No refusal
   ever contains the token, the authorization code or the client secret: a credential that reached
   an error string reaches every log line and every error page that repeats it. */
import { jwtVerify, errors } from 'jose';

/* The closed list. Asymmetric only, so verification needs a key the provider publishes and never
   a value this instance also holds. */
const ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
/* Two minutes either way. A drifting clock on a self-hosted box, not a policy knob: the library
   default of zero produces intermittent, unreproducible sign-in failures. */
const SKEW_S = 120;
/* The bound on the issued-at claim, and the reason that claim is checked at all. Fixed rather
   than configurable -- an identity token is spent within seconds of being minted. */
const MAX_AGE = '5m';

/**
 * @param {string} token           the identity token as received
 * @param {{ keys: Function,       a key resolver over the provider's published signing keys
 *           issuer: string,       the configured issuer, compared for exact equality
 *           clientId: string,     the configured client id, the only trusted audience
 *           nonce: string,        the value this sign-in attempt sent; required
 *           now?: number }} opts  the current time, injected
 * @returns {Promise<{ iss: string, sub: string, email: string|null, claims: object }>}
 * @throws on every refusal
 */
export async function verifyIdToken(token, { keys, issuer, clientId, nonce, now = Date.now() }) {
  /* Before the token is touched. Without this a caller who forgot the nonce would compare
     undefined against a token that carries no nonce claim, the two would match, and the one check
     standing between a captured token and a replay of it would have failed open. A blank string
     is not a nonce for the same reason it is not a configured value anywhere else here. */
  if (typeof nonce !== 'string' || !nonce.trim()) throw new Error('a nonce is required to verify an identity token, and this sign-in attempt supplied none');

  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer, audience: clientId, algorithms: ALGS,
      clockTolerance: SKEW_S, maxTokenAge: MAX_AGE,
      currentDate: new Date(now), requiredClaims: ['sub', 'iat', 'exp']
    }));
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw new Error('the sign-in took too long - try again');
    if (e instanceof errors.JWKSNoMatchingKey) throw new Error('no signing key at the provider matches this token');
    /* Not reaching the provider is an operational failure, not a verdict on the token. Reporting
       it as "did not verify" is the most misleading sentence available during an outage: it sends
       whoever reads it looking at the token and the client registration for a fault that is a
       network away. */
    if (e instanceof errors.JWKSTimeout || (e && e.name === 'TimeoutError')) throw new Error('the identity provider did not answer in time - try again');
    /* An error carrying no code did not come from the library's own checks, so there is no verdict
       to report and nothing to interpolate - the alternative renders as the literal "(undefined)",
       which tells a reader nothing at all. */
    if (!(e && e.code)) throw new Error('the identity token could not be checked against the provider');
    throw new Error('the provider\'s identity token did not verify (' + e.code + ')');
  }

  /* Audience membership is what the library establishes, and membership is not validation: a
     token naming this client alongside others was minted for whoever asked, and only the
     authorized-party claim says which of them it was actually for. */
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (aud.length > 1 && payload.azp !== clientId) throw new Error('the identity token names other audiences and is not authorised to this one');
  /* The authorized party is binding wherever it appears, not only where the audience is plural.
     A provider that mints a token for another client at the same issuer, names this instance as
     the sole audience and records the other client as the authorized party, is describing a token
     that belongs to that other client -- accepting it hands whoever holds it a session here as
     the subject it names. */
  if (payload.azp !== undefined && payload.azp !== clientId) throw new Error('the identity token was issued to another client at this provider');
  if (payload.nonce !== nonce) throw new Error('the identity token does not answer this sign-in attempt');
  /* The library type-checks the time claims and nothing else, so requiring the subject asserts
     only that it is THERE. This is the one place that can refuse a subject that is not a usable
     handle: a number and its decimal spelling would be one identity to a key built by
     concatenation, an object would be [object Object] shared by every token carrying one, and an
     empty string would be a handle that is just the issuer. */
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('the identity token carries no usable subject');

  /* An address is only ever as good as the issuer's own verification of it, so an unverified one
     is reported as ABSENT rather than as a weaker truth -- and absent means absent everywhere,
     which is why `claims` is a copy with both raw email claims removed rather than the verified
     payload itself. Leaving them on it would put the address the field beside them just refused
     to vouch for back within reach under a second name, and the rule would hold for one accessor
     while quietly not holding for the object next to it.
     The `email` field is therefore the only sanctioned way to read an address at all, and it is
     null unless the issuer vouched for it. An address is profile data and must never become a
     lookup key: resolving an existing account from an external issuer's assertion, on a service
     that has no rate limiting anywhere, is an account-takeover path.
     The identity handle is the issuer and the subject TOGETHER, never the subject alone -- a
     second provider configured later would otherwise collide with the first, with nothing in the
     stored data able to tell them apart. */
  const { email, email_verified: verified, ...claims } = payload;
  const vouchedFor = verified === true && typeof email === 'string' && email ? email : null;
  return { iss: payload.iss, sub: payload.sub, email: vouchedFor, claims };
}

/* Whether the issuer reports a sign-in made for the request that asked for it. The request to
   authenticate again (`prompt`, `max_age`) travels through the browser, which can strip it, and
   some issuers ignore it or never report when the sign-in happened at all, so the only checkable
   fact is the time the issuer itself reports in `auth_time`. When reported, it must not predate
   the request, less the same clock skew the token checks allow, nor lie further in the future
   than that skew: a provider session left open since yesterday is not a sign-in for this request.
   When not reported, freshness is unknown and the caller must not claim it -- the identity the
   token names is then the whole of what it proves. A value that is present but cannot be read as a
   time counts as stale, never as unreported, so a malformed claim cannot step around the rule.

   Pure, like the verifier above: the clock is handed in, and the claims are only read. */
/**
 * @param {object} claims                the verified token's claims (verifyIdToken's `claims`)
 * @param {{ authAfter: number,          when the request left for the provider, epoch seconds
 *           now?: number }} opts        the current time in milliseconds, injected
 * @returns {'fresh'|'stale'|'unreported'}
 * @throws when authAfter is not a finite number -- a caller that lost the request time must
 *         never be answered 'fresh' or 'unreported'
 */
export function signInFreshness(claims, { authAfter, now = Date.now() } = {}) {
  if (typeof authAfter !== 'number' || !Number.isFinite(authAfter)) throw new Error('the time the sign-in was requested is required to judge its freshness');
  if (!claims || !Object.prototype.hasOwnProperty.call(claims, 'auth_time')) return 'unreported';
  const at = claims.auth_time;
  if (typeof at !== 'number' || !Number.isFinite(at)) return 'stale';
  return at >= authAfter - SKEW_S && at <= now / 1000 + SKEW_S ? 'fresh' : 'stale';
}
