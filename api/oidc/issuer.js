/* Where the provider's endpoints and signing keys come from: the provider's own metadata.
 *
 * A self-hosted issuer and a public one are then configured identically -- one address, and
 * everything else is read from the address. Nothing here is written to disk, ever. An instance
 * whose provider is unreachable cannot sign anyone in anyway, so a warm cache would buy nothing
 * and would put a file in the state directory that an instance with the feature switched off must
 * not have. The document and the key set live in the closure this factory returns, next to the
 * in-memory challenge store in server.js and the lifetime-plus-reset cache in coach/cohort.js.
 *
 * Nothing happens at import time and nothing happens at boot. Discovery is lazy on purpose:
 * fetching at start-up would couple the container's boot to a third party, and a provider having a
 * bad morning would take passkey sign-in -- which needs no third party at all -- down with it. The
 * cost is that a misconfigured issuer is reported at first use rather than at boot, which is why
 * every sentence below names the URL it could not use and the variable to go and change.
 *
 * Two properties carry the weight here. Key rotation has to survive without a restart, and it does
 * because a provider publishes its new key alongside the old one before it signs with it, so a
 * client that caches with a lifetime and refetches when it meets an unknown key identifier never
 * misses the changeover. And that refetch has to be throttled, because an unknown key identifier
 * arrives from whoever posts a token and nothing in this server rate-limits anything -- an
 * unthrottled refetch is one small unauthenticated request causing unbounded outbound work.
 */
import { createRemoteJWKSet, customFetch } from 'jose';
import { allowsPlainHttp } from './config.js';

/* How long a discovery document is trusted before it is read again. Endpoints move rarely, and
   the key-set URI moving is handled below regardless of this number. */
const META_TTL_MS = 3600000;
/* The key set is refetched when it is older than this even if every identifier still resolves,
   so a key withdrawn by the provider stops being accepted within the hour rather than never. */
const KEYS_TTL_MS = 600000;
/* The floor between two key-set fetches triggered by an unknown key identifier. This is the
   throttle: the identifier comes from whoever posted the token, so without a floor one forged
   header is an outbound request, and a stream of them is a stream of them. */
const COOLDOWN_MS = 30000;
/* How long a failed attempt is remembered before another one is made, on either request. A
   failure has to be remembered for as long as a success is trusted, or the anti-amplification
   property above holds on the happy path only: the trigger arrives from whoever posted the token,
   so while the provider is unreachable one inbound token becomes one outbound request, each one
   holding a socket open until its deadline. */
const FAILURE_COOLDOWN_MS = 30000;
/* Both outbound requests get the same deadline. Nothing in the boot path issues either, so an
   unreachable provider can delay a sign-in attempt and nothing else. */
export const HTTP_TIMEOUT_MS = 5000;
/* The upper bound on the discovery document, generously above any real one. The outbound deadline
   bounds the elapsed time and not the bytes, so without this an OIDC_ISSUER pointing at a
   large-file host -- or a provider answering with something that is not a document at all -- is an
   unbounded allocation in the process that also holds every user's state. */
const MAX_DOC_BYTES = 262144;

const ENDPOINTS = ['authorization_endpoint', 'token_endpoint', 'jwks_uri'];
const DOCS = 'See docs/SELF_HOSTING.md.';

/* The blocklist that keeps a user-supplied push endpoint off private addresses is deliberately
   NOT applied to the issuer or to anything the issuer publishes, and that omission is a decision
   rather than an oversight: the issuer is operator-supplied, the operator already controls this
   process, and an issuer on a private address -- a provider on the same LAN, the same host, the
   same compose file -- is the primary supported deployment. Applying that blocklist here would
   break exactly the deployment this feature exists for, in exchange for stopping someone who can
   already set environment variables from reaching addresses they can already reach. */

/* Reads a response body up to MAX_DOC_BYTES and returns null when it is longer, stopping the
   transfer rather than buffering past the bound. A declared length is refused before a byte is
   read; a response that declares none is cut off as it arrives. */
export async function readBounded(r) {
  const declared = r.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_DOC_BYTES) return null;
  if (!r.body) {
    const text = await r.text();
    return Buffer.byteLength(text) > MAX_DOC_BYTES ? null : text;
  }
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOC_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released by cancel on some platforms */ }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {{ issuer: string,             the configured issuer, already shape-validated
 *           fetch?: Function,           injected so a test reaches no network
 *           now?: () => number,         injected clock for the document lifetime
 *           cooldownMs?: number }} opts
 * @returns {{ metadata: () => Promise<object>,
 *             signingKeys: () => Promise<Function>,
 *             reset: () => void }}
 *
 * cooldownMs is an argument for one reason, and it is not configurability: the key-set reader
 * checks its own freshness against the real clock, which is not injectable, so a rotation cannot
 * be demonstrated in milliseconds unless the caller can lower the floor. No environment variable
 * exposes it and the default is the only value that ships.
 */
export function createIssuer({ issuer, fetch = globalThis.fetch, now = Date.now, cooldownMs = COOLDOWN_MS } = {}) {
  let meta = null, metaAt = 0, keys = null;
  let inflight = null, metaFailure = null, metaFailedAt = 0;
  let keyFailure = null, keyFailedAt = 0;

  async function fetchMetadata() {
    const base = new URL(issuer);
    const url = issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration';
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), redirect: 'manual', headers: { accept: 'application/json' } });
    } catch {
      /* The transport error is not passed through: it names a socket and a stack, and whoever
         reads this needs the address and the variable instead. */
      throw new Error(`could not reach the identity provider at ${url} - check OIDC_ISSUER. ${DOCS}`);
    }
    if (r.status !== 200) throw new Error(`the identity provider answered ${r.status} at ${url} - check OIDC_ISSUER. ${DOCS}`);
    let body;
    try { body = await readBounded(r); } catch { throw new Error(`could not read the discovery document at ${url} - check OIDC_ISSUER. ${DOCS}`); }
    if (body === null) throw new Error(`the discovery document at ${url} is larger than an OIDC discovery document can be - the address in OIDC_ISSUER is probably not an OIDC issuer. ${DOCS}`);
    let doc;
    try { doc = JSON.parse(body); } catch { throw new Error(`${url} did not return JSON - the address in OIDC_ISSUER is probably not an OIDC issuer. ${DOCS}`); }

    /* Valid JSON is not a document. A body of literal null parses, and reading a field off it
       throws a bare TypeError -- the one failure in this file that would name neither the URL nor
       the variable, and that would reach an operator as a stack trace. An array parses too and
       names its issuer as undefined. */
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${url} did not return an OIDC discovery document - the address in OIDC_ISSUER is probably not an OIDC issuer. ${DOCS}`);

    /* Discovery 1.0 section 4.3: the issuer named in the document MUST equal the one that was
       asked for. Without this check, anything that can answer on the configured host can serve
       someone else's endpoints from it. */
    if (doc.issuer !== issuer) throw new Error(`OIDC_ISSUER is ${issuer} but the provider calls itself ${doc.issuer}. These are compared byte for byte, so the two have to match exactly. ${DOCS}`);

    /* Whether plain http is permitted AT ALL is decided once, from the CONFIGURED issuer, before
       any endpoint is looked at -- and the order is the whole point. The carve-out exists for an
       instance whose provider runs on the same machine, and it can never be wider than the issuer
       the operator configured. Asking only whether an endpoint's own host is local would be a
       hole: a remote https provider could publish a loopback token endpoint, and the token
       exchange would post the authorization code and the client secret to it in cleartext, across
       the loopback interface of whatever machine runs this container, readable by anything else
       on it. Gated on the issuer, that cannot happen, and a localhost deployment loses nothing --
       a localhost deployment configures a localhost issuer. */
    const plainHttpGate = base.protocol === 'http:' && allowsPlainHttp(base);

    for (const field of ENDPOINTS) {
      const raw = doc[field];
      if (typeof raw !== 'string' || !raw) throw new Error(`the provider's discovery document at ${url} has no ${field}. That address is required to complete a sign-in, so OIDC_ISSUER is probably not an OIDC issuer. ${DOCS}`);
      let e;
      try { e = new URL(raw); } catch { throw new Error(`the provider's ${field} is ${raw}, which is not a valid URL. ${DOCS}`); }
      if (e.protocol === 'https:') continue;
      if (e.protocol === 'http:' && plainHttpGate && allowsPlainHttp(e)) continue;
      throw new Error(plainHttpGate
        ? `the provider's ${field} is ${raw}, and it must be an https address or a plain-http address on localhost, 127.0.0.1 or [::1] - the same carve-out OIDC_ISSUER=${issuer} itself uses. ${DOCS}`
        : `the provider's ${field} is ${raw}, and it must be an https address because OIDC_ISSUER=${issuer} is. A plain-http endpoint here would carry the authorization code and the client secret in cleartext. ${DOCS}`);
    }

    /* A key set that moved is dropped rather than carried over: continuing to trust keys from an
       address the provider no longer publishes is trusting a document that no longer exists. */
    if (meta && meta.jwks_uri !== doc.jwks_uri) keys = null;
    meta = doc;
    metaAt = now();
    return meta;
  }

  async function metadata() {
    if (meta && now() - metaAt < META_TTL_MS) return meta;
    /* A remembered failure answers the callers that arrive behind it, so an unreachable provider
       costs one outbound request per floor period rather than one per inbound token. */
    if (metaFailure && now() - metaFailedAt < FAILURE_COOLDOWN_MS) {
      if (meta) return meta;
      throw metaFailure;
    }
    /* And one request in flight serves every caller that arrives while it is, so a burst of
       simultaneous sign-ins is a burst of one. */
    if (inflight) return inflight;
    inflight = fetchMetadata().then(
      doc => { metaFailure = null; return doc; },
      e => {
        metaFailure = e;
        metaFailedAt = now();
        /* A document that was valid an hour ago is a better answer than no answer: endpoints move
           rarely, the key set has a freshness rule of its own, and the alternative is that one
           transient blip at the provider takes sign-in down while a perfectly good copy of the
           document is sitting in memory. */
        if (meta) return meta;
        throw e;
      }
    ).finally(() => { inflight = null; });
    return inflight;
  }

  async function signingKeys() {
    const m = await metadata();
    if (keys) return keys;
    /* Both lifetimes are set here rather than inherited, so they are readable in this file and a
       library upgrade cannot change them underneath. The injected fetch is passed through too, or
       the key-set request would be the one thing in this module that still reaches the network. */
    const resolve = createRemoteJWKSet(new URL(m.jwks_uri), {
      timeoutDuration: HTTP_TIMEOUT_MS,
      cacheMaxAge: KEYS_TTL_MS,
      cooldownDuration: cooldownMs,
      [customFetch]: fetch
    });
    /* The library's own throttle is keyed on the last SUCCESSFUL read, so while the key-set
       endpoint is failing it never engages at all and every inbound token is another outbound
       request. The floor below is keyed on the last FAILURE, which is the case that amplifies. */
    keys = async (header, token) => {
      if (keyFailure && now() - keyFailedAt < FAILURE_COOLDOWN_MS) throw keyFailure;
      try {
        const key = await resolve(header, token);
        keyFailure = null;
        return key;
      } catch (e) {
        /* A key identifier the published set does not carry is a verdict on the token, not a
           failure to read the set. Remembering it would hold a genuine key rotation out for the
           length of the floor, and the refetch it triggers has a throttle of its own already. */
        if (e && (e.code === 'ERR_JWKS_NO_MATCHING_KEY' || e.code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS')) throw e;
        keyFailure = e;
        keyFailedAt = now();
        throw e;
      }
    };
    return keys;
  }

  return {
    metadata,
    signingKeys,
    reset: () => { meta = null; keys = null; metaAt = 0; inflight = null; metaFailure = null; metaFailedAt = 0; keyFailure = null; keyFailedAt = 0; }
  };
}
