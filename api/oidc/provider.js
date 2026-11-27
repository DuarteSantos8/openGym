/* Talking to the identity provider: discovery (.well-known/openid-configuration), its key set,
 * the token endpoint and userinfo. Each answer is size-capped and time-boxed, the discovery
 * document and the keys are cached for an hour, and the last error is kept for the admin page.
 * The profile picture the provider names (the `picture` claim) is fetched here too. */
import net from 'node:net';
import { fetch as undiciFetch, Agent } from 'undici';
import { OidcError } from './jwt.js';
import { isPrivateAddr, outboundLookup } from '../net-guard.js';

const HOUR = 3600000;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 10000;
// Keys rotate: a token with an unknown kid fetches the set again, but not more often than this,
// so junk tokens cannot turn us into a request amplifier against the provider.
const REFETCH_MIN_MS = 30000;

// Some providers let people type their own picture address (a Keycloak attribute, an LDAP field
// behind Authelia). Off the issuer's own origin it is fetched like a push endpoint is sent to:
// over https only, never from a private, loopback or link-local address, judged in the
// connection's own lookup.
let publicAgent = null;
const publicFetch = (url, init) => undiciFetch(url, { ...init, dispatcher: (publicAgent ||= new Agent({ connect: { lookup: outboundLookup() } })) });
const localHost = h => /^localhost$|\.localhost$/i.test(h) || (net.isIP(h) !== 0 && isPrivateAddr(h));

async function readJson(r, what) {
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new OidcError('provider', `the ${what} answer is too large`);
  try { return JSON.parse(text); } catch { throw new OidcError('provider', `the ${what} answer is not JSON`); }
}

export function createProvider(cfg, { fetchImpl = globalThis.fetch, pictureFetch = publicFetch, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  let meta = null, metaAt = 0;
  let keys = null, keysAt = 0, keysTriedAt = 0;
  const status = { lastOk: null, lastError: null, lastErrorAt: null };
  const fail = e => { status.lastError = e.message || String(e); status.lastErrorAt = now(); };

  async function call(url, init, what) {
    let r;
    try { r = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new OidcError('provider', `the ${what} could not be reached (${e.name === 'TimeoutError' ? 'timeout' : 'network'})`); }
    const body = await readJson(r, what);
    if (!r.ok) {
      const why = typeof body?.error === 'string' ? body.error.slice(0, 60) : 'HTTP ' + r.status;
      throw new OidcError('provider', `the ${what} said no (${why})`);
    }
    return body;
  }

  // An https issuer must not hand us plain-http endpoints.
  const sameSecurity = u => {
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) && (!cfg.issuer.startsWith('https:') || x.protocol === 'https:'); }
    catch { return false; }
  };

  async function discover({ force = false } = {}) {
    if (meta && !force && now() - metaAt < HOUR) return meta;
    try {
      const doc = await call(cfg.issuer + '/.well-known/openid-configuration', { headers: { Accept: 'application/json' } }, 'discovery document');
      // The document must be for the issuer we were told to trust (OIDC Discovery 4.3).
      if (typeof doc.issuer !== 'string' || doc.issuer.replace(/\/+$/, '') !== cfg.issuer) throw new OidcError('provider', 'the discovery document names another issuer');
      for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (typeof doc[k] !== 'string' || !sameSecurity(doc[k])) throw new OidcError('provider', `the discovery document has no usable ${k}`);
      }
      for (const k of ['userinfo_endpoint', 'end_session_endpoint']) if (doc[k] !== undefined && (typeof doc[k] !== 'string' || !sameSecurity(doc[k]))) delete doc[k];
      if (Array.isArray(doc.code_challenge_methods_supported) && !doc.code_challenge_methods_supported.includes('S256')) {
        throw new OidcError('provider', 'the provider does not offer PKCE with S256');
      }
      meta = doc; metaAt = now(); status.lastOk = now();
      return meta;
    } catch (e) {
      fail(e);
      // A provider that blips keeps working on what it told us last.
      if (meta && !force) return meta;
      throw e;
    }
  }

  async function jwks({ force = false } = {}) {
    if (keys && !force && now() - keysAt < HOUR) return keys;
    if (keys && force && now() - keysTriedAt < REFETCH_MIN_MS) return keys;
    keysTriedAt = now();
    const m = await discover();
    try {
      const set = await call(m.jwks_uri, { headers: { Accept: 'application/json' } }, 'key set');
      if (!Array.isArray(set?.keys)) throw new OidcError('provider', 'the key set has no keys');
      keys = set; keysAt = now();
      return keys;
    } catch (e) { fail(e); if (keys) return keys; throw e; }
  }

  async function exchange({ code, verifier }) {
    const m = await discover();
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: verifier });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (cfg.clientSecret && cfg.tokenAuth === 'basic') {
      // RFC 6749 2.3.1: both halves form-encoded before the base64.
      const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
      headers.Authorization = 'Basic ' + Buffer.from(enc(cfg.clientId) + ':' + enc(cfg.clientSecret)).toString('base64');
    } else {
      form.set('client_id', cfg.clientId);
      if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret);
    }
    try {
      const tok = await call(m.token_endpoint, { method: 'POST', headers, body: form.toString() }, 'token endpoint');
      if (typeof tok.id_token !== 'string') throw new OidcError('provider', 'the token endpoint sent no ID token');
      status.lastOk = now();
      return tok;
    } catch (e) { fail(e); throw e; }
  }

  async function userinfo(accessToken, { quiet = false } = {}) {
    const m = await discover();
    if (!m.userinfo_endpoint || typeof accessToken !== 'string') return null;
    try { return await call(m.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' } }, 'userinfo endpoint'); }
    catch (e) { if (!quiet) fail(e); return null; }
  }

  // Not counted as a provider error on the admin page: the address can be the person's own.
  async function picture(url, maxBytes) {
    const u = new URL(url);
    const own = u.origin === new URL(cfg.issuer).origin;
    // 'picture-refused': the same address will never do, unlike a timeout or a provider's 5xx.
    const refused = why => new OidcError('picture-refused', why);
    if (!own && u.protocol !== 'https:') throw refused('the picture is not on https');
    if (!own && localHost(u.hostname.replace(/^\[|\]$/g, ''))) throw refused('the picture is on a private address');
    const tooLarge = () => new OidcError('picture-size', 'the picture is too large');
    try {
      const r = await (own ? fetchImpl : pictureFetch)(u.href, { headers: { Accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) {
        r.body?.cancel().catch(() => {});
        const why = 'HTTP ' + r.status;
        throw r.status < 500 && r.status !== 408 && r.status !== 429 ? refused(why) : new OidcError('picture', why);
      }
      if (Number(r.headers.get('content-length')) > maxBytes) { r.body?.cancel().catch(() => {}); throw tooLarge(); }
      const parts = [];
      let n = 0;
      for await (const chunk of r.body || []) {
        n += chunk.length;
        if (n > maxBytes) throw tooLarge();
        parts.push(chunk);
      }
      return Buffer.concat(parts);
    } catch (e) {
      if (e instanceof OidcError) throw e;
      if (e?.cause?.code === 'EBLOCKED') throw refused('the picture is on a private address');
      throw new OidcError('picture', e.name === 'TimeoutError' ? 'timeout' : 'network');
    }
  }

  return { discover, jwks, exchange, userinfo, picture, status, get meta() { return meta; }, get keyCount() { return keys?.keys?.length || 0; } };
}
