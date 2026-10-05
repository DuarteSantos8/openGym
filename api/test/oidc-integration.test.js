/* The one place the configuration reader, the issuer and the token verifier run as ONE chain, in
 * one process, with nothing stubbed out but the network.
 *
 * The failure this file exists to prevent is three modules that each pass their own suite and do
 * not fit together: a configuration field spelled one way and read another, an issuer whose key
 * resolver satisfies the library called directly but not the verifier built on top of it, a
 * client id that is the audience in one place and something else in the other. Every one of those
 * is invisible to a unit suite, because a unit suite hands each module a stand-in for its
 * neighbour -- and a stand-in is exactly the thing that cannot disagree with its neighbour.
 *
 * That matters for two specific sentences. "This instance can decide on its own whether a token is
 * genuine" and "this instance keeps verifying across a signing-key rotation" are claims about the
 * instance, not about a layer of it; until the verifier runs over the issuer's own resolver they
 * are proved one storey below where they are stated. Two cases close that, and two is enough --
 * this file is not a second copy of either unit suite.
 *
 * Everything is offline. Every request goes through the injected fake, including the key-set
 * request, and the last case asserts none escaped. The clock is passed in so nothing here can go
 * flaky. If a case in this file fails, the defect is in the module at fault and is fixed there,
 * never worked around here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/* Any request that escapes the injected fake lands here instead of on the network. */
const escaped = [];
globalThis.fetch = async url => { escaped.push(String(url)); throw new Error('this suite must never reach the network'); };

const { readConfig } = await import('../oidc/config.js');
const { createIssuer } = await import('../oidc/issuer.js');
const { verifyIdToken } = await import('../oidc/verify.js');

const ISSUER = 'https://id.example.com';

/* A complete block, ORIGIN included: the configuration reader requires that variable rather than
   defaulting it, so a block without it reports the feature off and nothing below would run. */
const ENV = {
  ORIGIN: 'https://gym.example.com',
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: 'opengym-instance',
  OIDC_CLIENT_SECRET: 'client-secret-that-plays-no-part-in-verification',
  OIDC_NAME: 'Example ID'
};

/* The fixtures below are COPIED from the issuer suite rather than imported from it. Each test file
   runs in its own process, so a cross-file import would make one file's fixtures load-bearing for
   another and a change made for one file's reasons would break the other at a distance. */
const kp1 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kp2 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const asJwk = (kp, kid) => ({ ...kp.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
const jwk1 = asJwk(kp1, 'k1');
const jwk2 = asJwk(kp2, 'k2');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Signs a compact JWS by hand, so this file owns everything it signs with. */
function mint({ header, claims, priv, alg = 'RS256' }) {
  const h = b64({ alg, typ: 'JWT', ...header }), p = b64(claims);
  return h + '.' + p + '.' + crypto.sign('sha' + alg.slice(2), Buffer.from(h + '.' + p), priv).toString('base64url');
}
/** An identity token as a provider would mint one for this instance. */
const idToken = ({ kid, priv, aud, nonce, now, sub = 'subject-1' }) => mint({
  header: { kid },
  priv,
  claims: {
    iss: ISSUER, sub, aud, nonce,
    iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300,
    email: 'lifter@example.com', email_verified: true
  }
});

const keySet = (...jwks) => ({ keys: jwks });
const discoveryDoc = () => ({
  issuer: ISSUER,
  authorization_endpoint: ISSUER + '/authorize',
  token_endpoint: ISSUER + '/token',
  jwks_uri: ISSUER + '/jwks'
});

/** A fetch that records what it was asked and answers as a function of the URL. */
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const a = answer(String(url), calls.length);
    /* A fresh platform Response every time: the key-set reader calls json() on it, and a body
       that has already been read cannot be read again. */
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

const isMeta = c => c.url.includes('/.well-known/');

/* ---------- the three modules as one chain ---------- */

test('a token minted for the served key set is accepted through the whole chain', async () => {
  /* Read the issuer and the client id off the configuration reader's own result rather than out
     of the fixture, so a disagreement between what that module returns and what the verifier
     expects fails here instead of staying invisible. */
  const cfg = readConfig({ env: ENV });
  assert.equal(cfg.on, true, cfg.error || 'the fixture environment must be a complete one');

  const f = fakeFetch(url => isMeta({ url })
    ? { status: 200, body: discoveryDoc() }
    : { status: 200, body: keySet(jwk1) });
  const issuer = createIssuer({ issuer: cfg.issuer, fetch: f, cooldownMs: 0 });

  const now = Date.now();
  const nonce = 'the-nonce-this-attempt-sent';
  const token = idToken({ kid: 'k1', priv: kp1.privateKey, aud: cfg.clientId, nonce, now });

  const id = await verifyIdToken(token, {
    keys: await issuer.signingKeys(), issuer: cfg.issuer, clientId: cfg.clientId, nonce, now
  });

  assert.equal(id.iss, cfg.issuer, 'the identity carries the configured issuer');
  assert.equal(id.sub, 'subject-1', 'together with the subject the provider named, which is the handle');
  assert.equal(id.email, 'lifter@example.com', 'an address the issuer vouched for comes through');
  assert.equal(f.calls.filter(isMeta).length, 1, 'discovery went through the injected fake');
  assert.equal(f.calls.filter(c => !isMeta(c)).length, 1, 'and so did the key set');
});

test('after the served key set rotates, a token signed by the new key still verifies through the same instance', async () => {
  let served = 0;
  const f = fakeFetch(url => isMeta({ url })
    ? { status: 200, body: discoveryDoc() }
    : { status: 200, body: ++served === 1 ? keySet(jwk1) : keySet(jwk1, jwk2) });

  const cfg = readConfig({ env: ENV });
  /* One composed instance for both halves of this case: the same issuer object and the same
     verifier, with no restart and no second createIssuer call in between. */
  const issuer = createIssuer({ issuer: cfg.issuer, fetch: f, cooldownMs: 0 });
  const now = Date.now();

  const first = 'nonce-before-the-rotation';
  await verifyIdToken(idToken({ kid: 'k1', priv: kp1.privateKey, aud: cfg.clientId, nonce: first, now }), {
    keys: await issuer.signingKeys(), issuer: cfg.issuer, clientId: cfg.clientId, nonce: first, now
  });
  assert.equal(served, 1, 'the provider has published one key so far');

  const second = 'nonce-after-the-rotation';
  /* Resolved through signingKeys() again rather than reusing a resolver captured before the
     rotation: a stale capture is one of the ways this can pass while a real instance would not. */
  const rotated = await verifyIdToken(idToken({ kid: 'k2', priv: kp2.privateKey, aud: cfg.clientId, nonce: second, now }), {
    keys: await issuer.signingKeys(), issuer: cfg.issuer, clientId: cfg.clientId, nonce: second, now
  });

  assert.equal(rotated.sub, 'subject-1', 'the key the provider only started serving today verifies');
  assert.equal(served, 2, 'exactly one refetch, triggered by the unknown key identifier');
});

test('nothing in this file reached the network', () => {
  assert.deepEqual(escaped, [], 'every request went through the injected fake');
});
