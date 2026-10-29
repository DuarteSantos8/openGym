/* Discovery and the provider's signing keys, driven end to end by a fake fetch.
 *
 * Two failures this suite exists to prevent, neither of which anyone can click their way into
 * finding.
 *
 * The first is an instance that stops being able to verify anything the moment the provider
 * rotates its signing key. A provider publishes the new key alongside the old one before it signs
 * with it, so a client that caches the key set with a lifetime AND refetches when it meets a key
 * identifier it does not know never misses a rotation. Drop either half and sign-in works for
 * weeks and then breaks at a moment nobody changed anything here.
 *
 * The second is that refetch turning into an amplifier. An unknown key identifier arrives from
 * whoever posts a token, and nothing in this server rate-limits anything, so an unthrottled
 * refetch is one small unauthenticated request causing unbounded outbound work. The cooldown case
 * below is what holds that shut.
 *
 * Everything here is offline. Every request goes through the injected fake, and the last case
 * asserts that none escaped to the real network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { jwtVerify } from 'jose';

/* Any request that escapes the injected fake lands here instead of on the network. */
const escaped = [];
globalThis.fetch = async url => { escaped.push(String(url)); throw new Error('this suite must never reach the network'); };

const { createIssuer } = await import('../oidc/issuer.js');

const ISSUER = 'https://id.example.com';
const WELL_KNOWN = ISSUER + '/.well-known/openid-configuration';
/* Pinned here rather than imported: the point of the lifetime case is that this is a decided value
   in the module, and reading it back out of the module would assert nothing. */
const META_TTL_MS = 3600000;
const FAILURE_COOLDOWN_MS = 30000;

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
const token = (kid, priv) => mint({ header: { kid }, claims: { iss: ISSUER, sub: 'u1' }, priv });

const keySet = (...jwks) => ({ keys: jwks });
const discoveryDoc = (over = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: ISSUER + '/authorize',
  token_endpoint: ISSUER + '/token',
  jwks_uri: ISSUER + '/jwks',
  ...over
});

/** A fetch that records what it was asked and answers from a script, by call number. */
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, signal: init.signal, redirect: init.redirect, method: init.method });
    const a = typeof answers === 'function' ? answers(calls.length, String(url), init) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    /* A fresh platform Response every time: the key-set reader calls json() on it, and a body that
       has already been read cannot be read again. */
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}

const isMeta = c => c.url.includes('/.well-known/');
const metaCalls = f => f.calls.filter(isMeta).length;
const keyCalls = f => f.calls.filter(c => !isMeta(c)).length;

/** The ordinary provider: a valid document and one published key. */
const script = ({ doc = discoveryDoc(), keys = () => keySet(jwk1) } = {}) => {
  let m = 0, k = 0;
  return fakeFetch((n, url) => url.includes('/.well-known/')
    ? { status: 200, body: typeof doc === 'function' ? doc(++m) : doc }
    : { status: 200, body: keys(++k, url) });
};

async function rejection(p) {
  try { await p; } catch (e) { return e; }
  assert.fail('expected a refusal, got a value');
}

/* ---------- discovery ---------- */

test('the discovery document is fetched once and then answered from memory', async () => {
  const f = script();
  const iss = createIssuer({ issuer: ISSUER, fetch: f });
  const a = await iss.metadata();
  const b = await iss.metadata();
  assert.equal(a.token_endpoint, ISSUER + '/token');
  assert.equal(b, a, 'the second call hands back the cached document');
  assert.equal(f.calls.length, 1, 'a cached document issues no request');
  assert.equal(f.calls[0].url, WELL_KNOWN);
});

test('the well-known path is appended to the issuer, keeping any path component', async () => {
  const base = 'https://id.example.com/realms/gym';
  const f = fakeFetch(() => ({ status: 200, body: { issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', jwks_uri: base + '/certs' } }));
  await createIssuer({ issuer: base, fetch: f }).metadata();
  assert.equal(f.calls[0].url, base + '/.well-known/openid-configuration', 'the realm path is preserved, not replaced');
});

test('the discovery request asks for JSON, carries a deadline and refuses a redirect', async () => {
  const f = script();
  await createIssuer({ issuer: ISSUER, fetch: f }).metadata();
  const c = f.calls[0];
  assert.equal(c.headers.accept, 'application/json');
  assert.equal(c.redirect, 'manual', 'a redirected discovery document would come from a host nobody configured');
  assert.ok(c.signal && typeof c.signal.aborted === 'boolean', 'the request carries an abort signal');
});

test('a document whose issuer disagrees with the configured one is refused, naming both', async () => {
  const f = fakeFetch(() => ({ status: 200, body: discoveryDoc({ issuer: 'https://other.example.com' }) }));
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
  assert.ok(e.message.includes(ISSUER), 'the configured value is named');
  assert.ok(e.message.includes('https://other.example.com'), 'and so is the one the provider claims');
});

for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
  test(`a document with no ${field} is refused, and the error names the field`, async () => {
    const doc = discoveryDoc();
    delete doc[field];
    const f = fakeFetch(() => ({ status: 200, body: doc }));
    const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
    assert.ok(e.message.includes(field), `the error names ${field}, not "a field"`);
  });
}

test('an endpoint on a plain-http address that is not local is refused', async () => {
  const f = fakeFetch(() => ({ status: 200, body: discoveryDoc({ token_endpoint: 'http://id.example.com/token' }) }));
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
  assert.match(e.message, /must be an https address/);
  assert.ok(e.message.includes('token_endpoint'));
});

test('a local plain-http issuer may publish plain-http endpoints', async () => {
  const local = 'http://localhost:8080';
  const f = fakeFetch(() => ({ status: 200, body: { issuer: local, authorization_endpoint: local + '/authorize', token_endpoint: local + '/token', jwks_uri: local + '/jwks' } }));
  const m = await createIssuer({ issuer: local, fetch: f }).metadata();
  assert.equal(m.token_endpoint, local + '/token', 'refusing this would make the documented localhost deployment unusable');
});

/* One case per plain-http host the shared predicate accepts, so the refusal cannot be satisfied by
   special-casing a single spelling. Without it a remote issuer could publish a loopback token
   endpoint, and the authorization code and the client secret would be posted there in cleartext. */
for (const host of ['localhost', '127.0.0.1', '[::1]']) {
  test(`a remote https issuer publishing a plain-http endpoint on ${host} is refused`, async () => {
    const f = fakeFetch(() => ({ status: 200, body: discoveryDoc({ token_endpoint: `http://${host}/token` }) }));
    const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
    assert.match(e.message, /must be an https address/);
    assert.ok(e.message.includes(ISSUER), 'the error names the issuer whose scheme decided the refusal');
  });
}

test('a fetch that fails names the URL and the variable, never a stack trace', async () => {
  const f = fakeFetch(() => new Error('ECONNREFUSED at node:internal/net:1234'));
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
  assert.ok(e.message.includes(WELL_KNOWN));
  assert.match(e.message, /OIDC_ISSUER/);
  assert.ok(!e.message.includes('ECONNREFUSED'), 'the transport error is not echoed back at a person');
});

test('a status other than 200 names the status and the URL', async () => {
  const f = fakeFetch(() => ({ status: 404, body: { error: 'not found' } }));
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
  assert.match(e.message, /404/);
  assert.ok(e.message.includes(WELL_KNOWN));
});

test('a body that is not JSON says the address is probably not an issuer', async () => {
  const f = fakeFetch(() => ({ status: 200, body: '<html>sign in</html>' }));
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
  assert.match(e.message, /JSON/);
  assert.match(e.message, /OIDC_ISSUER/);
});

test('an unreachable provider is asked once per floor period, not once per inbound token', async () => {
  /* The trigger arrives from whoever posts a token and nothing in this server rate-limits
     anything, so an attempt per inbound token while the provider is down is one small
     unauthenticated request turning into an outbound flood, each attempt holding a socket open
     until its deadline. */
  let t = 0;
  const f = fakeFetch(() => new Error('ECONNREFUSED at node:internal/net:1234'));
  const iss = createIssuer({ issuer: ISSUER, fetch: f, now: () => t });
  for (let i = 0; i < 20; i++) {
    const e = await rejection(iss.metadata());
    assert.match(e.message, /OIDC_ISSUER/, 'every caller still gets the sentence naming the variable');
  }
  assert.equal(metaCalls(f), 1, 'the remembered failure answers the other nineteen');
  t = FAILURE_COOLDOWN_MS;
  await rejection(iss.metadata());
  assert.equal(metaCalls(f), 2, 'past the floor one fresh attempt is made, so a provider that came back is found');
});

test('callers arriving while a discovery request is in flight join it instead of starting their own', async () => {
  let release;
  const held = new Promise(r => { release = r; });
  const calls = [];
  const f = async url => {
    calls.push(String(url));
    await held;
    return new Response(JSON.stringify(discoveryDoc()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const iss = createIssuer({ issuer: ISSUER, fetch: f });
  const all = Promise.all(Array.from({ length: 25 }, () => iss.metadata()));
  release();
  const docs = await all;
  assert.equal(calls.length, 1, 'twenty-five simultaneous sign-ins are one outbound request');
  for (const d of docs) assert.equal(d, docs[0], 'and every caller gets the same document');
});

test('a key-set endpoint that is failing is asked once per floor period, not once per inbound token', async () => {
  /* The library throttles on its last SUCCESSFUL read, so while this endpoint is answering with
     an error its own cooldown never engages -- which is the state that amplifies. */
  let t = 0;
  const f = fakeFetch((n, url) => url.includes('/.well-known/')
    ? { status: 200, body: discoveryDoc() }
    : { status: 500, body: { error: 'down' } });
  const iss = createIssuer({ issuer: ISSUER, fetch: f, now: () => t });
  const resolver = await iss.signingKeys();
  for (let i = 0; i < 15; i++) await rejection(jwtVerify(token('k1', kp1.privateKey), resolver));
  assert.equal(keyCalls(f), 1, 'fifteen inbound tokens are one outbound request');
  t = FAILURE_COOLDOWN_MS;
  await rejection(jwtVerify(token('k1', kp1.privateKey), resolver));
  assert.equal(keyCalls(f), 2, 'past the floor the endpoint is tried again');
});

test('valid JSON that is not a document names the URL and the variable, never a stack trace', async () => {
  /* A body of literal null parses, and reading a field off it throws a bare TypeError that names
     nothing an operator can act on. An array parses too, and would report an issuer of undefined. */
  for (const body of ['null', '[]', '"a string"', '42']) {
    const f = fakeFetch(() => ({ status: 200, body }));
    const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
    assert.equal(e.constructor, Error, `${body} escaped as a ${e.constructor.name}`);
    assert.ok(e.message.includes(WELL_KNOWN), `the URL is not named for body ${body}`);
    assert.match(e.message, /OIDC_ISSUER/, `the variable is not named for body ${body}`);
    assert.ok(!e.message.includes('undefined'), `an absent field was read through for body ${body}: ${e.message}`);
  }
});

test('a body far larger than any discovery document is refused rather than buffered', async () => {
  /* The outbound deadline bounds the elapsed time and not the bytes, so a wrong address pointing
     at a large-file host would otherwise be an unbounded allocation in the process that holds
     every user's state. */
  const huge = JSON.stringify({ ...discoveryDoc(), padding: 'x'.repeat(400000) });
  const f = fakeFetch(() => ({ status: 200, body: huge }));
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: f }).metadata());
  assert.match(e.message, /larger than an OIDC discovery document can be/);
  assert.match(e.message, /OIDC_ISSUER/);
});

test('a body that only DECLARES an impossible length is refused before it is read', async () => {
  const declared = async () => new Response(JSON.stringify(discoveryDoc()), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': '99999999' }
  });
  const e = await rejection(createIssuer({ issuer: ISSUER, fetch: declared }).metadata());
  assert.match(e.message, /larger than an OIDC discovery document can be/);
});

test('the cached document expires on the injected clock', async () => {
  let t = 0;
  const f = script();
  const iss = createIssuer({ issuer: ISSUER, fetch: f, now: () => t });
  await iss.metadata();
  t = META_TTL_MS - 1;
  await iss.metadata();
  assert.equal(metaCalls(f), 1, 'just inside the lifetime the document is not refetched');
  t = META_TTL_MS;
  await iss.metadata();
  assert.equal(metaCalls(f), 2, 'past the lifetime it is');
});

test('a document already in memory answers a refresh that failed, so a blip degrades rather than breaks', async () => {
  let t = 0, failing = false;
  const f = fakeFetch(() => failing ? new Error('ECONNREFUSED at node:internal/net:1234') : { status: 200, body: discoveryDoc() });
  const iss = createIssuer({ issuer: ISSUER, fetch: f, now: () => t });
  const first = await iss.metadata();
  t = META_TTL_MS;
  failing = true;
  assert.equal(await iss.metadata(), first, 'the good copy is served rather than the outage being passed on');
  assert.equal(metaCalls(f), 2, 'the refresh was attempted before the copy was fallen back on');
  for (let i = 0; i < 10; i++) assert.equal(await iss.metadata(), first);
  assert.equal(metaCalls(f), 2, 'and it is not retried once per caller while the failure is remembered');
  t = META_TTL_MS + FAILURE_COOLDOWN_MS;
  failing = false;
  assert.notEqual(await iss.metadata(), first, 'past the floor the provider is asked again and the fresh document wins');
});

test('reset forgets the document and the key set', async () => {
  const f = script();
  const iss = createIssuer({ issuer: ISSUER, fetch: f });
  const r1 = await iss.signingKeys();
  iss.reset();
  const r2 = await iss.signingKeys();
  assert.equal(metaCalls(f), 2, 'the document is fetched again after a reset');
  assert.notEqual(r2, r1, 'and the key set is rebuilt rather than carried over');
});

/* ---------- signing keys ---------- */

test('a token signed by the key published at the first fetch verifies', async () => {
  const f = script();
  const iss = createIssuer({ issuer: ISSUER, fetch: f });
  const resolver = await iss.signingKeys();
  const { payload } = await jwtVerify(token('k1', kp1.privateKey), resolver);
  assert.equal(payload.sub, 'u1');
  assert.equal(keyCalls(f), 1, 'the key set is read through the injected fake, not the network');
  assert.equal(f.calls.at(-1).url, ISSUER + '/jwks');
});

test('a key added to the key set after the first fetch verifies, with no restart', async () => {
  let served = 0;
  const f = fakeFetch((n, url) => url.includes('/.well-known/')
    ? { status: 200, body: discoveryDoc() }
    : { status: 200, body: ++served === 1 ? keySet(jwk1) : keySet(jwk1, jwk2) });
  const iss = createIssuer({ issuer: ISSUER, fetch: f, cooldownMs: 0 });
  const resolver = await iss.signingKeys();
  await jwtVerify(token('k1', kp1.privateKey), resolver);
  assert.equal(served, 1);
  const { payload } = await jwtVerify(token('k2', kp2.privateKey), resolver);
  assert.equal(payload.sub, 'u1', 'the rotated key verifies through the same instance');
  assert.equal(served, 2, 'exactly one refetch, triggered by the unknown key identifier');
});

test('fifty unknown key identifiers are all refused and cause exactly one key-set fetch', async () => {
  const f = script();
  const iss = createIssuer({ issuer: ISSUER, fetch: f });
  const resolver = await iss.signingKeys();
  for (let i = 0; i < 50; i++) {
    const e = await rejection(jwtVerify(token('forged-' + i, kp2.privateKey), resolver));
    assert.equal(e.code, 'ERR_JWKS_NO_MATCHING_KEY', 'a forged identifier is refused, not resolved');
  }
  assert.equal(keyCalls(f), 1, 'the cooldown keeps a forged identifier from amplifying one request into many');
});

test('a key-set URI that moved rebuilds the key set against the new address', async () => {
  let t = 0, m = 0;
  const f = fakeFetch((n, url) => url.includes('/.well-known/')
    ? { status: 200, body: discoveryDoc(++m === 1 ? {} : { jwks_uri: ISSUER + '/jwks2' }) }
    : { status: 200, body: keySet(jwk1) });
  const iss = createIssuer({ issuer: ISSUER, fetch: f, now: () => t });
  const r1 = await iss.signingKeys();
  await jwtVerify(token('k1', kp1.privateKey), r1);
  t = META_TTL_MS;
  const r2 = await iss.signingKeys();
  assert.notEqual(r2, r1, 'the key set does not survive its own URI moving');
  await jwtVerify(token('k1', kp1.privateKey), r2);
  assert.equal(f.calls.at(-1).url, ISSUER + '/jwks2');
});

test('the key set is built once and handed back to every caller', async () => {
  const f = script();
  const iss = createIssuer({ issuer: ISSUER, fetch: f });
  assert.equal(await iss.signingKeys(), await iss.signingKeys(), 'two calls hand back the same resolver');
});

/* ---------- purity ---------- */

test('importing the module writes nothing, starts nothing and exports only what a consumer needs', async () => {
  const dir = new URL('../oidc/', import.meta.url);
  const before = fs.readdirSync(dir);
  const resources = process.getActiveResourcesInfo().length;
  const fresh = await import('../oidc/issuer.js?purity');
  assert.deepEqual(Object.keys(fresh).sort(), ['HTTP_TIMEOUT_MS', 'createIssuer', 'readBounded'], 'the factory, the shared timeout, and the bounded reader another module reuses rather than duplicating - nothing else');
  fresh.createIssuer({ issuer: ISSUER });
  assert.deepEqual(fs.readdirSync(dir), before, 'no file appears next to the module');
  assert.equal(process.getActiveResourcesInfo().length, resources, 'no timer and no socket is opened at import or at construction');
});

test('nothing in this file reached the network', () => {
  assert.deepEqual(escaped, [], 'every request went through the injected fake');
});
