/* Shaping the token-endpoint request and parsing whatever comes back, defensively enough that a
 * hostile or broken provider cannot turn into a bare crash. Verifying the identity token itself is
 * unchanged and lives in verify.js; this module's whole job ends the moment a syntactically sound
 * id_token string is in hand.
 *
 * Every failure resolves to one of exactly two codes. Everything that is a failure to have a
 * coherent conversation with the provider at all - unreachable, timed out, answered with a status
 * this instance cannot use, answered with a body too large or not JSON or not an object - is
 * provider-unreachable: an operational problem with the provider or the network between here and
 * it, not a verdict on the person signing in. Only a provider that answered coherently and either
 * refused the request (an OAuth-level error body) or handed back something with no usable
 * identity token is token-invalid. Neither code, and no message this module throws, ever carries
 * the client secret or the authorization code - both are request-only values, read from the
 * caller's arguments and never echoed back in anything this module produces.
 */
import { readBounded, HTTP_TIMEOUT_MS } from './issuer.js';

const DOCS = 'See docs/SELF_HOSTING.md.';

/**
 * The body of the authorization_code grant, RFC 6749 section 4.1.3. `client_secret` is present
 * only when a secret is configured: its absence is not an error, it is a public client
 * authenticating with the PKCE verifier alone, which self-hosted issuers support and this
 * codebase already treats as a first-class configuration (readConfig's clientSecret is null, not
 * a required field).
 */
export function tokenRequestBody({ code, redirectUri, clientId, clientSecret, verifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier
  });
  if (clientSecret) body.set('client_secret', clientSecret);
  return body;
}

/**
 * @param {{ tokenEndpoint: string, code: string, redirectUri: string, clientId: string,
 *           clientSecret: string|null, verifier: string, fetch?: Function }} opts
 * @returns {Promise<{ idToken: string }>}
 *
 * fetch is injected, exactly like issuer.js's createIssuer, so no test here ever reaches the
 * network - and so that an escaped request in this codebase's test suite fails loudly rather than
 * silently answering from whatever happens to be listening on the real internet.
 */
export async function exchangeCode({ tokenEndpoint, code, redirectUri, clientId, clientSecret, verifier, fetch = globalThis.fetch }) {
  const body = tokenRequestBody({ code, redirectUri, clientId, clientSecret, verifier });

  let r;
  try {
    r = await fetch(tokenEndpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
  } catch {
    /* A transport error names a socket and a stack, neither of which helps whoever reads this -
       they need the address that could not be reached. */
    throw providerUnreachable(`could not reach the token endpoint at ${tokenEndpoint}`);
  }

  let text;
  try {
    text = await readBounded(r);
  } catch {
    throw providerUnreachable(`could not read the response from the token endpoint at ${tokenEndpoint}`);
  }
  if (text === null) throw providerUnreachable(`the response from the token endpoint at ${tokenEndpoint} is larger than a token response can be`);

  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw providerUnreachable(`the token endpoint at ${tokenEndpoint} did not return JSON`);
  }
  /* Valid JSON is not a document: null parses, and reading a field off it throws a bare
     TypeError - the one failure that would name neither the endpoint nor the reason. An array
     parses too and has no field this code is looking for. */
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw providerUnreachable(`the token endpoint at ${tokenEndpoint} did not return an OIDC token response`);

  if (r.status !== 200) {
    /* A coherent OAuth error body (RFC 6749 section 5.2) is the provider answering clearly and
       refusing - a verdict, not an operational failure - so it is the one non-200 case that maps
       to token-invalid rather than provider-unreachable. The error field is the provider's own
       fixed vocabulary (invalid_grant, invalid_client, ...); error_description is provider-supplied
       free text and is never interpolated into a message this instance produces. */
    if (typeof doc.error === 'string' && doc.error) throw tokenInvalid(`the token endpoint rejected the request: ${doc.error}`);
    throw providerUnreachable(`the token endpoint at ${tokenEndpoint} answered ${r.status}`);
  }

  if (typeof doc.id_token !== 'string' || !doc.id_token) throw tokenInvalid(`the token endpoint at ${tokenEndpoint} returned no id_token`);
  return { idToken: doc.id_token };
}

function providerUnreachable(message) {
  const e = new Error(`${message} - check OIDC_ISSUER and network connectivity to the provider. ${DOCS}`);
  e.code = 'provider-unreachable';
  return e;
}

function tokenInvalid(message) {
  const e = new Error(`${message}. ${DOCS}`);
  e.code = 'token-invalid';
  return e;
}
